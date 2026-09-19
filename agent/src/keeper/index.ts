// Keeper (SPEC flow E/F/G). Every write is signed by the Dynamic agent wallet (ctx.wallet()).
// Per loan, each tick: collect fees → sell only as much WETH as the debt needs (Uniswap Trading API, sized and
// sanity-checked with Chainlink) → if debt is still open, TWAP only the covering slice of the creator token (Flash) →
// payDesk (dining draws) → release() once covered and no Flash order is open. Leftover WETH/tokens go back to the
// borrower with the lien. Also cancels vaults the borrower never pledged.
import { timingSafeEqual } from "node:crypto";
import type { Hono } from "hono";
import { decodeEventLog, parseAbi, parseEther } from "viem";
import { ADDR, ERC20_ABI, FEE_DESK_ABI, FEE_NOTE_ABI, FEE_VAULT_ABI, FEES_MANAGER_ABI, VAULT_STATUS, type Address, type DebtState, type Hex, type Loan, type Terms } from "@feedesk/shared";
import { jsonBody, need, opt, type Ctx } from "../ctx.ts";
import { addEvent, getLoan, listLoans, updateLoan } from "../db/index.ts";
import { claimableFees } from "../bankr/index.ts";
import { buildVaultSwap, oracleEthUsd8, wethForDebt } from "../uniswap/index.ts";

const deskAbi = parseAbi(FEE_DESK_ABI);
const vaultAbi = parseAbi(FEE_VAULT_ABI);
const erc20 = parseAbi(ERC20_ABI);
const noteAbi = parseAbi(FEE_NOTE_ABI);
const S = { Created: 0, Pledged: 1, Auction: 2, Active: 3, Released: 4, Cancelled: 5 } as const;
const PLEDGE_TIMEOUT_MS = 24 * 3600_000; // SPEC G: unpledged vaults are cancelled by the keeper after a day

/** Flow A, step 6: the Dynamic agent wallet deploys this loan's FeeVault + FeeNote. */
export async function createLoanOnchain(
  ctx: Ctx,
  a: { borrower: Address; poolId: Hex; feesManager: Address; creatorToken: Address; symbol: string; terms: Terms },
): Promise<{ onchainId: number; vault: Address; note: Address; txHash: Hex }> {
  const w = await ctx.wallet();
  const next = (await ctx.pub.readContract({ address: ctx.deskAddress, abi: deskAbi, functionName: "loanCount" })) + 1n;
  const sym = a.symbol.replace(/[^A-Za-z0-9]/g, "").slice(0, 12) || "TOKEN";
  const params = {
    borrower: a.borrower, poolId: a.poolId, feesManager: a.feesManager, creatorToken: a.creatorToken,
    principal: BigInt(a.terms.principalRaw), faceValue: BigInt(a.terms.faceValueRaw), drawLimit: BigInt(a.terms.drawLimitRaw),
    noteName: `FeeNote ${sym} #${next}`, noteSymbol: `fn${sym}${next}`, // ponytail: #n is a hint; LoanCreated below is authoritative
    // Flash token-leg custody (FeeVault.sendTokenLegToKeeper) is fixed per vault at creation; only the "keeper" mode needs it.
    keeperTokenCustody: opt("FLASH_TOKEN_LEG_MODE", "vault1271") === "keeper",
  };
  const { hash, receipt } = await w.write({ address: ctx.deskAddress, abi: deskAbi, functionName: "createLoan", args: [params] });
  const ev = receipt.logs
    .filter((l) => l.address.toLowerCase() === ctx.deskAddress.toLowerCase())
    .map((l) => { try { return decodeEventLog({ abi: deskAbi, data: l.data, topics: l.topics }); } catch { return null; } })
    .find((e) => e?.eventName === "LoanCreated");
  if (!ev || ev.eventName !== "LoanCreated") throw new Error(`createLoan ${hash}: no LoanCreated event`);
  return { onchainId: Number(ev.args.loanId), vault: ev.args.vault, note: ev.args.note, txHash: hash };
}

/** Flow B: vault checks shares moved (vault > 0, borrower == 0) and flips Created → Pledged. */
export async function confirmPledge(ctx: Ctx, loan: Loan): Promise<Hex> {
  if (!loan.vault) throw new Error(`loan ${loan.id} has no vault`);
  const w = await ctx.wallet();
  return (await w.write({ address: loan.vault, abi: vaultAbi, functionName: "confirmPledge" })).hash;
}

/** Live on-chain debt state of a vault (one multicall). */
export async function readDebt(ctx: Ctx, vault: Address): Promise<DebtState> {
  const v = { address: vault, abi: vaultAbi } as const;
  const [note, token, drawDebt, outstanding, canRelease] = await ctx.pub.multicall({
    allowFailure: false,
    contracts: [
      { ...v, functionName: "note" }, { ...v, functionName: "creatorToken" }, { ...v, functionName: "drawDebt" },
      { ...v, functionName: "debtOutstanding" }, { ...v, functionName: "canRelease" },
    ],
  });
  const bal = (t: Address) => ({ address: t, abi: erc20, functionName: "balanceOf", args: [vault] }) as const;
  const [noteSupply, usdc, weth, tok] = await ctx.pub.multicall({
    allowFailure: false,
    contracts: [{ address: note, abi: noteAbi, functionName: "totalSupply" }, bal(ADDR.USDC), bal(ADDR.WETH), bal(token)],
  });
  return {
    noteSupplyRaw: noteSupply.toString(), usdcInVaultRaw: usdc.toString(), drawDebtRaw: drawDebt.toString(),
    outstandingRaw: outstanding.toString(), wethInVaultRaw: weth.toString(), tokenInVaultRaw: tok.toString(), canRelease,
  };
}

/** Lazy so a disabled/missing flash module never breaks the WETH path. */
async function flashMod() {
  return (await import("../flash/index.ts")) as {
    hasOpenFlashOrder(ctx: Ctx, loanId: number): boolean;
    twapSellTokenLeg(ctx: Ctx, loan: Loan, amount: bigint): Promise<{ orderId: string }>;
    searchToken(token: Address): Promise<{ priceUsd: number }>;
  };
}

export const TOKEN_LEG_BUFFER_PCT = 110n; // Flash TWAP floor is spot × 0.95, so 1.1× covers a floor-price fill
/** Raw creator tokens to TWAP for `outstandingUsdc` of debt at `priceUsd`, capped at `held`. */
export function tokenForDebt(outstandingUsdc: bigint, priceUsd: number, decimals: number, held: bigint): bigint {
  if (!(priceUsd > 0)) throw new Error(`token price ${priceUsd}`);
  const p18 = BigInt(Math.floor(priceUsd * 1e18)); // USD per whole token, 18 dec
  if (p18 === 0n) throw new Error(`token price ${priceUsd} below 1e-18`);
  const want = (outstandingUsdc * 10n ** BigInt(decimals) * 10n ** 12n * TOKEN_LEG_BUFFER_PCT) / (p18 * 100n);
  return want < held ? want : held;
}

async function launch(ctx: Ctx, loanId: number) {
  const cca = (await import("../cca/index.ts")) as { launchAuction(ctx: Ctx, loan: Loan): Promise<{ auction: Address; txHash: Hex }> };
  const a = await cca.launchAuction(ctx, getLoan(ctx.db, loanId)!);
  addEvent(ctx.db, loanId, "auction_started", a.txHash, { auction: a.auction, by: "keeper" });
}

const STATUS_NAME: Record<number, Loan["status"]> = { 0: "APPROVED", 1: "PLEDGED", 2: "AUCTION", 3: "ACTIVE", 4: "RELEASED", 5: "CANCELLED" };

/** One full servicing pass for a loan. Each step is independent: one failing step is recorded and the rest still run. */
export async function runKeeperOnce(ctx: Ctx, loanId: number): Promise<void> {
  const loan = getLoan(ctx.db, loanId);
  if (!loan) throw new Error(`loan ${loanId} not found`);
  if (!loan.vault) return; // DECLINED or createLoan never landed: nothing on-chain
  const vault = loan.vault;
  const v = { address: vault, abi: vaultAbi } as const;
  const w = await ctx.wallet();
  const step = async (name: string, fn: () => Promise<void>) => {
    try { await fn(); } catch (e) {
      const msg = (e as Error).message.split("\n")[0];
      ctx.log("keeper", `loan ${loanId} ${name} failed: ${msg}`);
      addEvent(ctx.db, loanId, "error", null, { module: "keeper", step: name, error: msg });
    }
  };

  let status = Number(await ctx.pub.readContract({ ...v, functionName: "status" }));

  if (status === S.Created) {
    // B (liveness): the borrower pledged (e.g. by Bankr chat) but nobody called POST /pledge → confirm + launch here.
    const fm = { address: loan.feesManager, abi: parseAbi(FEES_MANAGER_ABI), functionName: "getShares" } as const;
    const [vs, bs] = await Promise.all([
      ctx.pub.readContract({ ...fm, args: [loan.poolId, vault] }),
      ctx.pub.readContract({ ...fm, args: [loan.poolId, loan.borrower] }),
    ]);
    if (vs > 0n && bs === 0n) {
      await step("confirmPledge", async () => {
        const hash = await confirmPledge(ctx, loan);
        addEvent(ctx.db, loanId, "pledged", hash, { by: "keeper", vaultShares: vs.toString() });
        updateLoan(ctx.db, loanId, { status: "PLEDGED" });
        await launch(ctx, loanId);
      });
      return;
    }
    // G: borrower never pledged → return the pool slot (only keeper may cancel a Created vault).
    if (Date.now() - Date.parse(loan.createdAt) < PLEDGE_TIMEOUT_MS) return;
    await step("cancel", async () => {
      const r = await w.write({ ...v, functionName: "cancel" });
      addEvent(ctx.db, loanId, "cancelled", r.hash, { reason: "not pledged within 24h", by: w.address });
    });
    status = Number(await ctx.pub.readContract({ ...v, functionName: "status" }));
  }

  // Pledged but the CCA launch failed earlier (server retries only on POST /pledge): relaunch after a grace period
  // so we never race the server's own launch. launchAuction is idempotent.
  if (status === S.Pledged && Date.now() - Date.parse(loan.updatedAt) > 120_000) await step("launchAuction", () => launch(ctx, loanId));

  if (status === S.Pledged || status === S.Auction || status === S.Active) {
    // 1. Collect. Simulate first (on-chain truth, also correct on the fork where Bankr's API can't see the vault).
    await step("collect", async () => {
      const { result } = await ctx.pub.simulateContract({ ...v, functionName: "collect", account: w.address });
      const [f0, f1] = result;
      if (f0 === 0n && f1 === 0n) return;
      // Bankr's claimable-fees view of the same beneficiary, logged next to on-chain truth (it can lag, and can't see fork state).
      const bankr = await claimableFees(loan.token, vault, true).catch((e: Error) => ({ error: e.message.split("\n")[0] }));
      const r = await w.write({ ...v, functionName: "collect" });
      addEvent(ctx.db, loanId, "collected", r.hash, { fees0Raw: f0.toString(), fees1Raw: f1.toString(), bankrClaimable: bankr });
    });
  }

  if (status === S.Active) {
    const outstanding = () => ctx.pub.readContract({ ...v, functionName: "debtOutstanding" });
    // 2. WETH → USDC through Uniswap Trading API (vault = swapper, SwapProxy, on-chain minOut). Only what the debt needs.
    await step("swap", async () => {
      const owed = await outstanding();
      if (owed === 0n) return;
      const held = await ctx.pub.readContract({ address: ADDR.WETH, abi: erc20, functionName: "balanceOf", args: [vault] });
      const min = parseEther(opt("MIN_SWAP_WETH", "0.002"));
      if (held < min) return;
      const px8 = await oracleEthUsd8(ctx);
      const sized = wethForDebt(owed, px8, held);
      const weth = sized < min ? min : sized; // ponytail: gas floor; any overshoot goes back to the borrower at release
      const q = await buildVaultSwap(ctx, vault, weth, px8);
      const r = await w.write({ ...v, functionName: "swapWethToUsdc", args: [q.data, weth, q.minOut] });
      const out = r.receipt.logs
        .filter((l) => l.address.toLowerCase() === vault.toLowerCase())
        .map((l) => { try { return decodeEventLog({ abi: vaultAbi, data: l.data, topics: l.topics }); } catch { return null; } })
        .find((e) => e?.eventName === "Swapped");
      const usdcOut = out?.eventName === "Swapped" ? out.args.usdcOut : null;
      addEvent(ctx.db, loanId, "swapped", r.hash, {
        via: "uniswap-trading-api", wethInRaw: weth.toString(), usdcOutRaw: usdcOut?.toString() ?? null,
        quoteOutRaw: q.quoteOut.toString(), minOutRaw: q.minOut.toString(), requestId: q.requestId,
        wethHeldRaw: held.toString(), debtBeforeRaw: owed.toString(), chainlinkEthUsd8: px8.toString(),
      });
      const d = await readDebt(ctx, vault); // USDC landing in the vault IS the repayment
      addEvent(ctx.db, loanId, "repaid", r.hash, { outstandingRaw: d.outstandingRaw, usdcInVaultRaw: d.usdcInVaultRaw, noteSupplyRaw: d.noteSupplyRaw });
    });

    // 3. Creator-token leg → USDC via Flash TWAP (mainnet only; Flash has no fork settlement). Only if WETH didn't cover
    //    the debt, and only the covering slice: the rest of the borrower's token is never sold.
    await step("flash", async () => {
      const owed = await outstanding();
      if (owed === 0n) return;
      const token = await ctx.pub.readContract({ ...v, functionName: "creatorToken" });
      const bal = await ctx.pub.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [vault] });
      if (bal === 0n) return;
      if (ctx.demoFork) return void ctx.log("keeper", `loan ${loanId}: ${bal} token leg held, ${owed} USDC owed (Flash: mainnet only)`);
      const f = await flashMod();
      if (f.hasOpenFlashOrder(ctx, loanId)) return;
      const decimals = Number(await ctx.pub.readContract({ address: token, abi: erc20, functionName: "decimals" }));
      const { priceUsd } = await f.searchToken(token);
      await f.twapSellTokenLeg(ctx, loan, tokenForDebt(owed, priceUsd, decimals, bal));
    });

    // 4. Dining draws (junior) paid from the surplus above note supply.
    await step("payDesk", async () => {
      const drawDebt = await ctx.pub.readContract({ ...v, functionName: "drawDebt" });
      if (drawDebt === 0n) return;
      const { result: paid } = await ctx.pub.simulateContract({ ...v, functionName: "payDesk", account: w.address });
      if (paid === 0n) return;
      const r = await w.write({ ...v, functionName: "payDesk" });
      addEvent(ctx.db, loanId, "desk_paid", r.hash, { paidRaw: paid.toString() });
    });

    // 5. Release the lien once notes + draws are covered (permissionless; the keeper just does it promptly).
    //    Never while a Flash token-leg order is open: release revokes the vault's Flash allowance mid-TWAP, and keeper-mode
    //    proceeds settled after release would land in a closed vault. The first tick after the order settles releases.
    await step("release", async () => {
      if (!(await ctx.pub.readContract({ ...v, functionName: "canRelease" }))) return;
      if ((await flashMod()).hasOpenFlashOrder(ctx, loanId)) return void ctx.log("keeper", `loan ${loanId}: covered; release waits for the open Flash order`);
      const r = await w.write({ ...v, functionName: "release" });
      updateLoan(ctx.db, loanId, { status: "RELEASED" }); // at once, so any settlement from here on pays the borrower
      addEvent(ctx.db, loanId, "released", r.hash, { to: loan.borrower });
    });
    status = Number(await ctx.pub.readContract({ ...v, functionName: "status" }));
  }

  if (STATUS_NAME[status] && STATUS_NAME[status] !== loan.status) updateLoan(ctx.db, loanId, { status: STATUS_NAME[status] });

  // 6. Repaid (released by us or anyone): publish the outcome to ERC-8004 (idempotent per loan). Lazy so a
  //    disabled erc8004 module never blocks servicing.
  if (status === S.Released && erc8004On())
    await step("erc8004", async () => {
      const m = (await import("../erc8004/index.ts")) as { publishLoanOutcome(ctx: Ctx, loanId: number): Promise<void> };
      await m.publishLoanOutcome(ctx, loanId);
    });
}

const SERVICED: Loan["status"][] = ["APPROVED", "PLEDGED", "AUCTION", "ACTIVE"];
const liveIds = (ctx: Ctx) => SERVICED.flatMap((s) => listLoans(ctx.db, { status: s })).filter((l) => l.vault).map((l) => l.id);
/** Released loans whose ERC-8004 outcome is not on-chain yet (a failed publish is retried next tick). */
// same rule as src/index.ts: unset or empty FEEDESK_MODULES = every module
const erc8004On = () => !process.env.FEEDESK_MODULES || process.env.FEEDESK_MODULES.split(",").map((s) => s.trim()).includes("erc8004");
const unpublishedIds = (ctx: Ctx) =>
  erc8004On()
    ? listLoans(ctx.db, { status: "RELEASED" }).filter((l) => l.vault && !ctx.db.prepare("SELECT 1 FROM kv WHERE key = ?").get(`erc8004.metadata.${l.id}`)).map((l) => l.id)
    : [];
const servicedIds = (ctx: Ctx) => [...liveIds(ctx), ...unpublishedIds(ctx)];

let running = false;
async function runAll(ctx: Ctx, ids: number[]): Promise<number[]> {
  if (running) throw new Error("keeper pass already running");
  running = true;
  const ran: number[] = [];
  try {
    for (const id of ids) {
      try { await runKeeperOnce(ctx, id); ran.push(id); } catch (e) { ctx.log("keeper", `loan ${id}: ${(e as Error).message}`); }
    }
  } finally { running = false; }
  return ran;
}

export function start(ctx: Ctx): () => void {
  const sec = Number(opt("KEEPER_INTERVAL_SEC", "300"));
  ctx.log("keeper", `loop every ${sec}s${ctx.demoFork ? " (DEMO_FORK)" : ""}; vault states: ${VAULT_STATUS.join("/")}`);
  const tick = () => { if (!running) runAll(ctx, servicedIds(ctx)).catch((e) => ctx.log("keeper", (e as Error).message)); };
  const t = setInterval(tick, sec * 1000);
  return () => clearInterval(t);
}

export function register(app: Hono, ctx: Ctx): void {
  app.post("/api/admin/keeper/run", async (c) => {
    const got = Buffer.from(c.req.header("x-admin-token") ?? ""), want = Buffer.from(need("ADMIN_TOKEN"));
    if (got.length !== want.length || !timingSafeEqual(got, want)) return c.json({ error: "bad admin token" }, 401);
    const body = await jsonBody<{ loanId?: number }>(c, true);
    if (body.loanId !== undefined && !(Number.isSafeInteger(body.loanId) && body.loanId > 0)) return c.json({ error: "loanId must be a positive integer" }, 400);
    if (body.loanId !== undefined && !getLoan(ctx.db, Number(body.loanId))) return c.json({ error: `loan ${body.loanId} not found` }, 404);
    if (running) return c.json({ error: "keeper pass already running" }, 409);
    const ids = body.loanId !== undefined ? [Number(body.loanId)] : servicedIds(ctx);
    return c.json({ ran: await runAll(ctx, ids) });
  });
}
