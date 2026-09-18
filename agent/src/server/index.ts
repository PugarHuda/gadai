// Hono REST server + orchestration of flows A (apply/underwrite) and B (pledge). SPEC §3, §7.
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { serve } from "@hono/node-server";
import { timingSafeEqual } from "node:crypto";
import { encodeFunctionData, isAddress, isAddressEqual, isHash, parseAbi, getAddress, recoverMessageAddress, zeroAddress } from "viem";
import type { Address, ApplyRequest, DebtState, DeskInfo, Hex, Loan, LoanDetail, LoanStatus, Memo, PledgeRequest, Quote, Signal, Terms, TxRequest } from "@feedesk/shared";
import { applyMessage, CHAIN_ID_BASE, FEE_DESK_ABI, FEE_VAULT_ABI, FEES_MANAGER_ABI, VAULT_STATUS } from "@feedesk/shared";
import type { Ctx } from "../ctx.ts";
import { need, opt } from "../ctx.ts";
import * as db from "../db/index.ts";
import { assertPledgeTx, buildTransferBeneficiary, claimableFees, creatorFees } from "../bankr/index.ts";
import { PERSONAS, quote, underwrite } from "../underwriter/index.ts";

const bad = (msg: string, status: 400 | 401 | 404 | 409 | 422 | 502 | 503 = 400) => new HTTPException(status, { message: msg });
const addr = (v: unknown, name: string): Address => {
  if (typeof v !== "string" || !isAddress(v)) throw bad(`${name} must be a 0x address`);
  return getAddress(v);
};
const vaultAbi = parseAbi(FEE_VAULT_ABI);
const deskAbi = parseAbi(FEE_DESK_ABI);

/** EIP-191 personal_sign by `signer`: EOA via ecrecover (offline), else ERC-1271/6492 via the RPC. */
export async function verifySigner(ctx: Pick<Ctx, "pub">, signer: Address, message: string, signature: unknown): Promise<boolean> {
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) return false;
  const sig = signature as Hex;
  const eoa = await recoverMessageAddress({ message, signature: sig }).catch(() => null);
  if (eoa && isAddressEqual(eoa, signer)) return true;
  return ctx.pub.verifyMessage({ address: signer, message, signature: sig }).catch(() => false);
}

/** Lazy cross-module call: modules are loaded by src/index.ts; a missing one fails loudly by name. */
async function mod<T>(name: string): Promise<T> {
  try {
    return (await import(`../${name}/index.ts`)) as T;
  } catch (e) {
    throw bad(`agent module "${name}" unavailable: ${(e as Error).message}`, 503);
  }
}
type Keeper = {
  createLoanOnchain(ctx: Ctx, a: { borrower: Address; poolId: Hex; feesManager: Address; creatorToken: Address; symbol: string; terms: Terms }): Promise<{ onchainId: number; vault: Address; note: Address; txHash: Hex }>;
  confirmPledge(ctx: Ctx, loan: Loan): Promise<Hex>;
  readDebt(ctx: Ctx, vault: Address): Promise<DebtState>;
};
type Cca = { launchAuction(ctx: Ctx, loan: Loan): Promise<{ auction: Address; txHash: Hex }> };
type Social = { publishSignals(ctx: Ctx, loanId: number, memos: Memo[], quote: Quote): Signal[] };

const STATUS_BY_VAULT: Record<(typeof VAULT_STATUS)[number], LoanStatus> = {
  Created: "APPROVED", Pledged: "PLEDGED", Auction: "AUCTION", Active: "ACTIVE", Released: "RELEASED", Cancelled: "CANCELLED",
};

/** Chain is the source of truth for status once a vault exists. */
async function syncStatus(ctx: Ctx, loan: Loan): Promise<Loan> {
  if (!loan.vault || loan.status === "DECLINED") return loan;
  const s = VAULT_STATUS[Number(await ctx.pub.readContract({ address: loan.vault, abi: vaultAbi, functionName: "status" }))]!;
  const status = STATUS_BY_VAULT[s];
  if (status !== loan.status) {
    db.updateLoan(ctx.db, loan.id, { status });
    ctx.log("server", `loan ${loan.id} status ${loan.status} → ${status} (on-chain ${s})`);
    return { ...loan, status };
  }
  return loan;
}

async function detail(ctx: Ctx, id: number): Promise<LoanDetail> {
  let loan = db.getLoan(ctx.db, id);
  if (!loan) throw bad(`loan ${id} not found`, 404);
  loan = await syncStatus(ctx, loan);
  let debt: DebtState | null = null;
  if (loan.vault && ["AUCTION", "ACTIVE", "RELEASED", "PLEDGED"].includes(loan.status)) {
    try {
      debt = await (await mod<Keeper>("keeper")).readDebt(ctx, loan.vault);
    } catch (e) {
      ctx.log("server", `loan ${id}: readDebt unavailable`, (e as Error).message); // show the loan anyway, debt: null
    }
  }
  return { ...loan, debt, events: db.listEvents(ctx.db, id), signals: db.listLoanSignals(ctx.db, id), memos: db.listMemos(ctx.db, id) };
}

const OPEN: LoanStatus[] = ["APPROVED", "PLEDGED", "AUCTION", "ACTIVE"];
const DECLINE_COOLDOWN_MS = 24 * 3600_000; // re-underwriting re-publishes signals (and mirror buys): at most once a day

/** Flow A: underwrite → store memos → signals → (approve) createLoan on-chain via Dynamic wallet → pledge tx. */
async function apply(ctx: Ctx, req: ApplyRequest): Promise<LoanDetail> {
  const token = addr(req.token, "token"), borrower = addr(req.borrower, "borrower");
  const controller = req.controller ? addr(req.controller, "controller") : borrower;
  const via = req.via === "bankr-skill" ? "bankr-skill" : "web";
  // Only the fee beneficiary can apply (and name a controller, which may later authorize dining draws).
  if (typeof req.nonce !== "string" || req.nonce.length < 8 || req.nonce.length > 128)
    throw bad("nonce (8..128 chars) and signature over applyMessage(token, borrower, controller, nonce) required", 401);
  if (!(await verifySigner(ctx, borrower, applyMessage(token, borrower, controller, req.nonce), req.signature)))
    throw bad(`signature is not the borrower's (${borrower}) over applyMessage(token, borrower, controller, nonce)`, 401);
  const mine = db.listLoans(ctx.db, { borrower }).filter((l) => l.token.toLowerCase() === token.toLowerCase());
  const open = mine.find((l) => OPEN.includes(l.status));
  if (open) throw bad(`loan ${open.id} for this token is already ${open.status}`, 409);
  const declined = mine.find((l) => l.status === "DECLINED" && Date.now() - Date.parse(l.createdAt) < DECLINE_COOLDOWN_MS);
  if (declined) throw bad(`loan ${declined.id} for this token was declined at ${declined.createdAt}; re-apply after 24h`, 409);
  if (!db.useNonce(ctx.db, req.nonce)) throw bad("nonce already used", 409);

  const u = await underwrite(ctx, token, borrower); // 422 ineligible / 502 lead memo failure → nothing stored
  const inp = u.quote.inputs!;
  const approved = u.lead.decision === "approve";
  const id = db.insertLoan(ctx.db, {
    status: approved ? "APPROVED" : "DECLINED", via, borrower, controller, token, symbol: inp.symbol, poolId: inp.poolId,
    feesManager: inp.feesManager, terms: approved ? u.terms : u.quote.terms, quote: u.quote, leadMemo: u.lead,
  });
  db.addEvent(ctx.db, id, "applied", null, { via, formula: u.quote.formula });
  for (const m of u.memos) {
    db.insertMemo(ctx.db, id, m, u.rawText[m.personaId] ?? null);
    db.addEvent(ctx.db, id, "memo", null, { personaId: m.personaId, model: m.model, decision: m.decision, principalRaw: m.principalRaw, maxNotePrice: m.maxNotePrice });
  }
  try {
    (await mod<Social>("social")).publishSignals(ctx, id, u.memos, u.quote);
  } catch (e) {
    db.addEvent(ctx.db, id, "error", null, { step: "publishSignals", error: (e as Error).message });
    ctx.log("server", `loan ${id}: publishSignals failed`, (e as Error).message);
  }
  if (!approved) {
    db.addEvent(ctx.db, id, "declined", null, { personaId: u.lead.personaId, rationale: u.lead.rationale });
    return detail(ctx, id);
  }

  // Dynamic agent wallet signs createLoan right after the lead memo's decision.
  let created;
  try {
    created = await (await mod<Keeper>("keeper")).createLoanOnchain(ctx, { borrower, poolId: inp.poolId, feesManager: inp.feesManager, creatorToken: token, symbol: inp.symbol, terms: u.terms });
  } catch (e) {
    db.addEvent(ctx.db, id, "error", null, { step: "createLoanOnchain", error: (e as Error).message });
    created = await adoptVault(ctx, inp.poolId, borrower).catch(() => null); // the tx may have mined (receipt timeout, log parse)
    if (!created) {
      db.updateLoan(ctx.db, id, { status: "CANCELLED" });
      throw bad(`approved, but createLoan on-chain failed: ${(e as Error).message}`, 502);
    }
    ctx.log("server", `loan ${id}: createLoan threw but vault ${created.vault} exists on-chain for this borrower; adopted`);
  }
  db.updateLoan(ctx.db, id, { onchainId: created.onchainId, vault: created.vault, note: created.note });
  db.addEvent(ctx.db, id, "loan_created", created.txHash, { onchainId: created.onchainId, vault: created.vault, note: created.note, terms: u.terms });

  try {
    const pledgeTx = await buildTransferBeneficiary({ tokenAddress: token, currentBeneficiary: borrower, newBeneficiary: created.vault });
    assertPledgeTx(pledgeTx, { feesManager: inp.feesManager, poolId: inp.poolId, vault: created.vault });
    db.updateLoan(ctx.db, id, { pledgeTx });
  } catch (e) {
    db.addEvent(ctx.db, id, "error", null, { step: "buildTransferBeneficiary", error: (e as Error).message });
    ctx.log("server", `loan ${id}: pledge tx build failed (retry via GET /api/loans/${id}/pledge-tx)`, (e as Error).message);
  }
  return detail(ctx, id);
}

/** The desk's open vault for this pool, if it belongs to this borrower and no loan row tracks it (recovers a mined createLoan). */
async function adoptVault(ctx: Ctx, poolId: Hex, borrower: Address): Promise<{ onchainId: number; vault: Address; note: Address; txHash: null } | null> {
  const vault = (await ctx.pub.readContract({ address: ctx.deskAddress, abi: deskAbi, functionName: "activeVaultByPool", args: [poolId] })) as Address;
  if (vault === zeroAddress || db.listLoans(ctx.db).some((l) => l.vault && isAddressEqual(l.vault, vault))) return null;
  const v = { address: vault, abi: vaultAbi } as const;
  const [b, loanId, note] = await Promise.all([
    ctx.pub.readContract({ ...v, functionName: "borrower" }),
    ctx.pub.readContract({ ...v, functionName: "loanId" }),
    ctx.pub.readContract({ ...v, functionName: "note" }),
  ]);
  return isAddressEqual(b as Address, borrower) ? { onchainId: Number(loanId), vault, note: note as Address, txHash: null } : null;
}

/** Pledge tx (re)build via the Bankr builder, checked byte-for-byte. Served ONLY while the vault is Created (APPROVED):
 * FeeVault cannot return shares pledged to a Cancelled/Released vault, so the chain status is re-read right before. */
async function pledgeTx(ctx: Ctx, loan: Loan): Promise<TxRequest> {
  const vault = loan.vault;
  if (!vault) throw bad("loan has no vault", 409);
  loan = await syncStatus(ctx, loan);
  if (loan.status !== "APPROVED") throw bad(`loan ${loan.id} is ${loan.status}: pledging is only possible while APPROVED (vault Created)`, 409);
  const tx = loan.pledgeTx ?? (await buildTransferBeneficiary({ tokenAddress: loan.token, currentBeneficiary: loan.borrower, newBeneficiary: vault }));
  assertPledgeTx(tx, { feesManager: loan.feesManager, poolId: loan.poolId, vault });
  if (!loan.pledgeTx) db.updateLoan(ctx.db, loan.id, { pledgeTx: tx });
  return tx;
}

const pledging = new Set<number>(); // ponytail: in-process lock (one agent process)

/** Flow B: verify shares moved on-chain → confirmPledge (agent wallet) → launch FeeNote CCA. Retry-safe. */
async function pledge(ctx: Ctx, id: number, req: PledgeRequest): Promise<LoanDetail> {
  if (pledging.has(id)) throw bad(`pledge for loan ${id} is already being processed; GET /api/loans/${id} shortly`, 409);
  pledging.add(id);
  try {
    return await pledgeLocked(ctx, id, req);
  } finally {
    pledging.delete(id);
  }
}

async function pledgeLocked(ctx: Ctx, id: number, req: PledgeRequest): Promise<LoanDetail> {
  let loan = db.getLoan(ctx.db, id);
  if (!loan) throw bad(`loan ${id} not found`, 404);
  loan = await syncStatus(ctx, loan);
  if (!loan.vault) throw bad(`loan ${id} is ${loan.status} (no vault)`, 409);
  if (req.txHash !== undefined) {
    if (!isHash(req.txHash)) throw bad("txHash must be a 32-byte hex hash");
    const rc = await ctx.pub.waitForTransactionReceipt({ hash: req.txHash, timeout: 20_000 }).catch((e) => {
      throw bad(`pledge tx ${req.txHash} not confirmed: ${(e as Error).message}`, 409);
    });
    if (rc.status !== "success") throw bad(`pledge tx ${req.txHash} reverted`, 409);
  }

  if (loan.status === "APPROVED") {
    const fm = { address: loan.feesManager, abi: parseAbi(FEES_MANAGER_ABI), functionName: "getShares" } as const;
    const [vaultShares, borrowerShares] = await Promise.all([
      ctx.pub.readContract({ ...fm, args: [loan.poolId, loan.vault] }),
      ctx.pub.readContract({ ...fm, args: [loan.poolId, loan.borrower] }),
    ]);
    if (vaultShares === 0n || borrowerShares !== 0n)
      throw bad(`fee rights not moved yet: getShares(vault)=${vaultShares}, getShares(borrower)=${borrowerShares}. Submit pledgeTx first.`, 409);
    // Soft check only: on-chain getShares above is authoritative (and FeeVault.confirmPledge re-checks it on-chain).
    const bankrSees = ctx.demoFork ? null : await claimableFees(loan.token, loan.vault, true).then((c) => c.eligible, () => null);
    if (!bankrSees) ctx.log("server", `loan ${id}: Bankr claimable-fees eligible=${bankrSees} for vault (${ctx.demoFork ? "DEMO_FORK: API reads mainnet" : "indexer lag or contract beneficiary not indexed"}); proceeding on on-chain shares`);
    const keeper = await mod<Keeper>("keeper");
    let hash: Hex | null = null;
    try {
      hash = await keeper.confirmPledge(ctx, loan);
    } catch (e) {
      loan = await syncStatus(ctx, loan); // an earlier/concurrent confirmPledge may have landed
      if (loan.status === "APPROVED") throw e;
    }
    if (hash) {
      db.updateLoan(ctx.db, id, { status: "PLEDGED" });
      db.addEvent(ctx.db, id, "pledged", hash, { vaultShares: vaultShares.toString(), pledgeTxHash: req.txHash ?? null, bankrIndexedVault: bankrSees });
      loan = { ...loan, status: "PLEDGED" };
    }
  }
  if (loan.status === "PLEDGED") {
    try {
      const a = await (await mod<Cca>("cca")).launchAuction(ctx, loan);
      db.updateLoan(ctx.db, id, { status: "AUCTION", auction: a.auction });
      db.addEvent(ctx.db, id, "auction_started", a.txHash, { auction: a.auction });
    } catch (e) {
      db.addEvent(ctx.db, id, "error", null, { step: "launchAuction", error: (e as Error).message });
      throw bad(`pledge confirmed, but auction launch failed (POST again to retry): ${(e as Error).message}`, 502);
    }
  }
  return detail(ctx, id);
}

export function createApp(ctx: Ctx): Hono {
  const app = new Hono();
  app.use("/api/*", cors({ origin: ctx.webUrl, allowHeaders: ["content-type", "x-admin-token"], allowMethods: ["GET", "POST", "DELETE", "OPTIONS"] }));
  app.use("/api/admin/*", async (c, next) => {
    const got = Buffer.from(c.req.header("x-admin-token") ?? ""), want = Buffer.from(need("ADMIN_TOKEN"));
    if (got.length !== want.length || !timingSafeEqual(got, want)) return c.json({ error: "bad or missing x-admin-token" }, 401);
    await next();
  });
  app.onError((e, c) => {
    if (e instanceof HTTPException) return c.json({ error: e.message }, e.status);
    // Config errors are safe to show and are the #1 setup question: say which key is missing instead of a bare 500.
    const cfg = /^(Missing env [A-Z0-9_]+.*|Dynamic MPC SDK has no Windows binaries.*)$/m.exec((e as Error).message ?? "");
    if (cfg) return c.json({ error: cfg[1] }, 503);
    ctx.log("server", `${c.req.method} ${c.req.path} failed`, (e as Error).stack ?? String(e));
    return c.json({ error: `internal error on ${c.req.method} ${c.req.path}; see agent log` }, 500); // raw viem errors can embed the RPC URL (and its key)
  });
  return app;
}

export function register(app: Hono, ctx: Ctx): void {
  app.get("/api/health", async (c) => c.json({ ok: true, demoFork: ctx.demoFork, block: Number(await ctx.pub.getBlockNumber()) }));

  app.get("/api/desk", async (c) => {
    const d = { address: ctx.deskAddress, abi: parseAbi(FEE_DESK_ABI) } as const;
    const [keeper, treasury] = await Promise.all([
      ctx.pub.readContract({ ...d, functionName: "keeper" }),
      ctx.pub.readContract({ ...d, functionName: "treasury" }),
    ]);
    const info: DeskInfo = {
      chainId: CHAIN_ID_BASE, demoFork: ctx.demoFork, desk: ctx.deskAddress, agentWallet: keeper, treasury,
      personas: PERSONAS.map((p, i) => (i === 0 ? { ...p, wallet: keeper } : p)), publicUrl: ctx.publicUrl,
    };
    return c.json(info);
  });

  app.get("/api/quote", async (c) => c.json(await quote(ctx, addr(c.req.query("token"), "token"), addr(c.req.query("borrower"), "borrower"))));

  // Base Doppler tokens a wallet is beneficiary on (proxied so the browser shares our rate-limited cache).
  app.get("/api/creator-tokens", async (c) => {
    const r = await creatorFees(addr(c.req.query("wallet"), "wallet"));
    return c.json(r.tokens.filter((t) => t.chain === "base" && t.source === "doppler").map((t) => ({
      token: t.tokenAddress, symbol: t.symbol, name: t.name, sharePct: parseFloat(t.share),
      claimableWeth: Number(t.tokenIsToken0 ? t.claimable.token1 : t.claimable.token0),
    })));
  });

  app.post("/api/loans", async (c) => c.json(await apply(ctx, await c.req.json<ApplyRequest>().catch(() => { throw bad("JSON body required"); }))));

  app.get("/api/loans", async (c) => {
    const status = c.req.query("status") as LoanStatus | undefined;
    const b = c.req.query("borrower");
    const loans = db.listLoans(ctx.db, { borrower: b ? addr(b, "borrower") : undefined });
    // chain is the source of truth: re-sync open loans (one status() read each) before filtering
    const synced = await Promise.all(loans.map((l) => (l.vault && OPEN.includes(l.status) ? syncStatus(ctx, l).catch(() => l) : l)));
    return c.json(status ? synced.filter((l) => l.status === status) : synced);
  });

  const idParam = (s: string) => {
    const n = Number(s);
    if (!Number.isInteger(n) || n < 1) throw bad("loan id must be a positive integer");
    return n;
  };
  app.get("/api/loans/:id", async (c) => c.json(await detail(ctx, idParam(c.req.param("id")))));

  app.get("/api/loans/:id/pledge-tx", async (c) => {
    const loan = db.getLoan(ctx.db, idParam(c.req.param("id")));
    if (!loan) throw bad("loan not found", 404);
    return c.json(await pledgeTx(ctx, loan));
  });

  app.post("/api/loans/:id/pledge", async (c) =>
    c.json(await pledge(ctx, idParam(c.req.param("id")), await c.req.json<PledgeRequest>().catch(() => ({})))));

  app.get("/api/loans/:id/release-tx", async (c) => {
    const loan = db.getLoan(ctx.db, idParam(c.req.param("id")));
    if (!loan?.vault) throw bad("loan not found or has no vault", 404);
    const ok = await ctx.pub.readContract({ address: loan.vault, abi: vaultAbi, functionName: "canRelease" });
    if (!ok) throw bad("vault.canRelease() is false: debt not fully covered yet", 409);
    const tx: TxRequest = { to: loan.vault, data: encodeFunctionData({ abi: vaultAbi, functionName: "release" }), chainId: CHAIN_ID_BASE, label: "Release fee rights (FeeVault.release)" };
    return c.json(tx);
  });

  app.notFound((c) => c.json({ error: `no route ${c.req.method} ${c.req.path}` }, 404));
}

export function listen(app: Hono, ctx: Ctx): void {
  const port = Number(opt("AGENT_PORT", "8787"));
  serve({ fetch: app.fetch, port }, () => ctx.log("server", `listening on :${port} (demoFork=${ctx.demoFork}, desk=${ctx.deskAddress})`));
}
