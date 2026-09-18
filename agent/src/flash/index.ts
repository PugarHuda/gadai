// Definitive Flash client + keeper token-leg TWAP (docs/integrations/flash.md, OpenAPI https://flash.definitive.fi/v1/openapi.json).
// Mode vault1271: FeeVault is the Flash funder (EIP-1271, keeper pre-authorizes the exact FlashOrder hash on-chain).
// Mode keeper:    vault sends the token leg to the Dynamic agent wallet, which runs the TWAP and returns USDC (+ unsold) to the vault.
import { decodeEventLog, formatUnits, hashTypedData, parseAbi, parseEventLogs, parseUnits, type TypedDataDefinition } from "viem";
import { ADDR, API, ERC20_ABI, FEE_VAULT_ABI, FLASH_EIP712_DOMAIN, flashTypedData, type Address, type Hex, type Loan } from "@feedesk/shared";
import { need, opt, type AgentWallet, type Ctx } from "../ctx.ts";
import { addEvent, getLoan, now } from "../db/index.ts";

const vaultAbi = parseAbi(FEE_VAULT_ABI);
const erc20 = parseAbi(ERC20_ABI);
const TERMINAL = ["ORDER_STATUS_FILLED", "ORDER_STATUS_CANCELLED", "ORDER_STATUS_REJECTED", "ORDER_STATUS_TERMINATED"];
const lc = (a: string) => a.toLowerCase();

// ponytail: one global 220 ms spacing keeps us under Flash's 5 req/s/endpoint for every endpoint at once.
let last = 0;
async function throttle() {
  const wait = last + 220 - Date.now();
  last = Math.max(Date.now(), last + 220);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

/** Raw Flash REST call. Throws with Flash's `{error:{code,message}}` on non-2xx. */
export async function flash(path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<any> {
  const key = need("FLASH_API_KEY");
  await throttle();
  const r = await fetch(`${opt("FLASH_BASE_URL", API.FLASH)}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-definitive-api-key": key },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let j: any;
  try { j = text ? JSON.parse(text) : {}; } catch { j = { error: { message: text.slice(0, 300) } }; }
  if (!r.ok) throw new Error(`Flash ${method} ${path} ${r.status}: ${JSON.stringify(j.error ?? j)}`);
  return j;
}

/** Optional integrator fee: must be identical on /quote and /order. */
export const feeFields = (): { flashIntegratorFeeBps?: string } =>
  process.env.FLASH_INTEGRATOR_FEE_BPS ? { flashIntegratorFeeBps: process.env.FLASH_INTEGRATOR_FEE_BPS } : {};
export const attributionFields = (): { erc8021AttributionCode?: string } =>
  process.env.BASE_BUILDER_CODE ? { erc8021AttributionCode: process.env.BASE_BUILDER_CODE } : {};

/** /search by address on Base. Throws if Flash does not know the token (never guesses a price). */
export async function searchToken(token: Address): Promise<{ priceUsd: number; riskFlagged: boolean; decimals: number; symbol: string; liquidityUsd: number }> {
  const { assets } = await flash(`/search?query=${token}&chain=base&limit=5`);
  const a = (assets as any[]).find((x) => lc(x.address) === lc(token));
  if (!a) throw new Error(`Flash /search has no Base asset ${token}`);
  const priceUsd = Number(a.price);
  if (!(priceUsd > 0)) throw new Error(`Flash /search returned no price for ${token}`);
  return { priceUsd, riskFlagged: Boolean(a.riskFlagged), decimals: Number(a.decimals), symbol: a.symbol, liquidityUsd: Number(a.liquidity) };
}

/** USD price as a plain decimal string (~8 significant digits, never exponent), as Flash price fields expect. */
export const decStr = (n: number) => n.toFixed(Math.max(2, 7 - Math.floor(Math.log10(n)))).replace(/0+$/, "").replace(/\.$/, "");

/** Flash typed-data JSON (string numbers) → viem-ready (numeric chainId, bigint uints). Shared so web signs identically. */
export const parseTypedData = (json: string) => flashTypedData(json) as unknown as TypedDataDefinition & { message: Record<string, any> };

/** Throws unless the Flash order struct is exactly "sell `token` from the vault, USDC back to the vault". */
export function assertVaultOrder(td: ReturnType<typeof parseTypedData>, vault: Address, token: Address, maxAmount: bigint) {
  const m = td.message, d = td.domain as any;
  const bad = (why: string) => { throw new Error(`Flash orderTypedData rejected: ${why}`); };
  if (td.primaryType !== "FlashOrder") bad(`primaryType ${td.primaryType}`);
  if (d.name !== FLASH_EIP712_DOMAIN.name || d.version !== FLASH_EIP712_DOMAIN.version) bad("domain name/version");
  if (d.chainId !== FLASH_EIP712_DOMAIN.chainId || lc(d.verifyingContract) !== lc(FLASH_EIP712_DOMAIN.verifyingContract)) bad("domain chain/contract");
  if (lc(m.swapper) !== lc(vault) || lc(m.recipient) !== lc(vault)) bad("swapper/recipient must be the vault");
  if (lc(m.fromToken) !== lc(token) || lc(m.toToken) !== lc(ADDR.USDC)) bad("tokens");
  if (m.fromAmount > maxAmount) bad(`fromAmount ${m.fromAmount} > ${maxAmount}`);
}

/** True while a token-leg order for this loan is unfinished: vault1271 until terminal; keeper until its proceeds are SETTLED
 *  (SETTLING = transfer in flight or failed: stays open until an operator resolves it, so no new leg is pulled meanwhile). */
export function hasOpenFlashOrder(ctx: Ctx, loanId: number): boolean {
  return !!ctx.db.prepare(`SELECT 1 FROM flash_orders WHERE loan_id = ? AND
    ((mode = 'keeper' AND status <> 'SETTLED') OR (mode <> 'keeper' AND status NOT IN (${TERMINAL.map(() => "?").join(",")})))`)
    .get(loanId, ...TERMINAL);
}

export const MAX_TOKEN_LEG_IMPACT = 0.05; // TWAP floor = Flash spot × (1 − this); slices below it simply don't fill

/** Sell `amount` (raw) of the loan's creator token for USDC via a Flash TWAP (1 h, 12 buckets; 24 if impact > 2%),
 *  with a documented `limitNotionalPrice` floor at spot × 0.95 so the borrower's token is never dumped below it. */
export async function twapSellTokenLeg(ctx: Ctx, loan: Loan, amount: bigint): Promise<{ orderId: string }> {
  if (ctx.demoFork) throw new Error("Flash is mainnet-only (no fork settlement): token-leg TWAP disabled in DEMO_FORK");
  if (!loan.vault) throw new Error(`loan ${loan.id} has no vault`);
  if (amount <= 0n) throw new Error("twapSellTokenLeg: amount must be > 0");
  if (hasOpenFlashOrder(ctx, loan.id)) throw new Error(`loan ${loan.id} already has an open Flash order`);
  const mode = opt("FLASH_TOKEN_LEG_MODE", "vault1271");
  if (mode !== "vault1271" && mode !== "keeper") throw new Error(`FLASH_TOKEN_LEG_MODE must be vault1271|keeper, got ${mode}`);
  const vault = loan.vault, token = loan.token;
  const w = await ctx.wallet();
  const decimals = Number(await ctx.pub.readContract({ address: token, abi: erc20, functionName: "decimals" }));

  const funder = mode === "vault1271" ? vault : w.address;
  const { priceUsd } = await searchToken(token);
  const order: Record<string, string> = {
    targetChain: "base", contraChain: "base", targetAsset: token, contraAsset: ADDR.USDC,
    side: "sell", qty: formatUnits(amount, decimals), orderType: "twap", funderAddress: funder,
    limitNotionalPrice: decStr(priceUsd * (1 - MAX_TOKEN_LEG_IMPACT)), ...feeFields(),
  };
  let buckets = 12;
  let q = await flash("/quote", { ...order, durationSeconds: 3600, twapBucketCount: buckets });
  if (Math.abs(Number(q.estimatedPriceImpact)) > 0.02) {
    buckets = 24;
    q = await flash("/quote", { ...order, durationSeconds: 3600, twapBucketCount: buckets });
  }
  if (!q.evm?.orderTypedData) throw new Error("Flash quote returned no evm.orderTypedData");
  // Quote first (works for an unfunded funder); only then move the leg, and send it straight back on any later failure.
  if (mode === "keeper") {
    const tx = await w.write({ address: vault, abi: vaultAbi, functionName: "sendTokenLegToKeeper", args: [token, amount] });
    addEvent(ctx.db, loan.id, "token_leg_sent", tx.hash, { token, amountRaw: amount.toString(), to: w.address });
  }
  try {
    return await placeTokenLegOrder(ctx, loan, w, mode, order, q, buckets, amount);
  } catch (e) {
    if (mode === "keeper") {
      try {
        const back = await w.write({ address: token, abi: erc20, functionName: "transfer", args: [vault, amount] });
        addEvent(ctx.db, loan.id, "flash_twap", back.hash, { unsoldReturnedRaw: amount.toString(), to: vault, reason: (e as Error).message });
      } catch (e2) {
        addEvent(ctx.db, loan.id, "error", null, { module: "flash", strandedRaw: amount.toString(), holder: w.address, error: (e2 as Error).message });
      }
    }
    throw e;
  }
}

async function placeTokenLegOrder(ctx: Ctx, loan: Loan, w: AgentWallet, mode: string, order: Record<string, string>, q: any, buckets: number, amount: bigint) {
  const vault = loan.vault!, token = loan.token, funder = order.funderAddress!;
  let extra: Record<string, string> = {};
  if (mode === "vault1271") {
    // Vault approves the settlement itself and whitelists this exact order hash; Flash's approveTx/permit are ignored.
    const td = parseTypedData(q.evm.orderTypedData);
    assertVaultOrder(td, vault, token, amount);
    const fromAmount = td.message.fromAmount as bigint;
    await w.write({ address: vault, abi: vaultAbi, functionName: "approveFlash", args: [token, fromAmount] });
    const auth = await w.write({ address: vault, abi: vaultAbi, functionName: "authorizeFlashOrder", args: [td.message] });
    const expected = hashTypedData(td);
    const log = auth.receipt.logs
      .filter((l) => lc(l.address) === lc(vault))
      .map((l) => { try { return decodeEventLog({ abi: vaultAbi, data: l.data, topics: l.topics }); } catch { return null; } })
      .find((e) => e?.eventName === "FlashOrderAuthorized");
    const digest = (log?.args as { digest?: Hex } | undefined)?.digest;
    if (!digest || lc(digest) !== lc(expected)) throw new Error(`vault digest ${digest} != viem hashTypedData ${expected}`);
  } else {
    if (q.evm.approveTx?.to) await w.send({ to: q.evm.approveTx.to, data: q.evm.approveTx.data });
    if (q.evm.permitTypedData) extra = { evmPermitTypedData: q.evm.permitTypedData, evmPermitSignature: await w.signTypedData(q.evm.permitTypedData) };
  }
  // vault1271: the vault ignores signature bytes (checks approvedHash); we still send the keeper's ECDSA sig as the bytes.
  const userSignature = await w.signTypedData(q.evm.orderTypedData);
  const { orderId } = await flash("/order", {
    ...order, twapBucketCount: buckets, quoteId: q.quoteId, userSignature, evmOrderTypedData: q.evm.orderTypedData, ...extra, ...attributionFields(),
  });
  ctx.db.prepare("INSERT INTO flash_orders (id,loan_id,mode,funder,token,amount_raw,status,usdc_out_raw,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(orderId, loan.id, mode, funder, token, amount.toString(), "ORDER_STATUS_PENDING", "0", now(), now());
  addEvent(ctx.db, loan.id, "flash_twap", null, {
    orderId, mode, funder, qty: order.qty, buckets, estUsdcOut: q.to?.amount, estimatedPriceImpact: q.estimatedPriceImpact, status: "submitted",
  });
  ctx.log("flash", `TWAP ${orderId} loan ${loan.id}: sell ${order.qty} ${token} (${mode}, ${buckets} buckets)`);
  return { orderId };
}

/** Poll open token-leg orders; record fills as `flash_twap` events; keeper mode settles proceeds back to the vault. */
export async function pollFlashOrders(ctx: Ctx): Promise<void> {
  const rows = ctx.db.prepare("SELECT * FROM flash_orders WHERE status NOT IN ('SETTLED','SETTLING') AND NOT (mode = 'vault1271' AND status IN (" +
    TERMINAL.map(() => "?").join(",") + "))").all(...TERMINAL) as Record<string, any>[];
  for (const r of rows) {
    try {
      const { order, fills } = await flash(`/orders/${r.id}?funderAddress=${r.funder}`);
      const usdcOut = parseUnits(order.filled?.contraAmount || "0", 6);
      if (order.status !== r.status || usdcOut.toString() !== r.usdc_out_raw) {
        ctx.db.prepare("UPDATE flash_orders SET status = ?, usdc_out_raw = ?, updated_at = ? WHERE id = ?").run(order.status, usdcOut.toString(), now(), r.id);
        addEvent(ctx.db, r.loan_id, "flash_twap", null, {
          orderId: r.id, status: order.status, soldToken: order.filled?.targetAmount ?? "0", usdcOut: order.filled?.contraAmount ?? "0",
          avgPriceUsd: order.filled?.averageNotionalPrice ?? null, closeReason: order.closeReason ?? null,
        });
      }
      if (r.mode === "keeper" && TERMINAL.includes(order.status)) await settleKeeperOrder(ctx, r, order, fills ?? []);
    } catch (e) {
      ctx.log("flash", `poll ${r.id} failed: ${(e as Error).message}`);
    }
  }
}

/** USDC that `to` actually received in the fills' settlement txs: on-chain truth, net of every Flash fee. */
export async function usdcReceivedFromFills(ctx: Ctx, fills: any[], to: Address): Promise<bigint> {
  const hashes = [...new Set(fills.filter((f) => f.status !== "CHAIN_STATUS_REORGED").map((f) => String(f.transactionId)))];
  let sum = 0n;
  for (const h of hashes) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(h)) throw new Error(`Flash fill transactionId ${h} is not a Base tx hash`);
    const rc = await ctx.pub.getTransactionReceipt({ hash: h as Hex });
    for (const l of parseEventLogs({ abi: erc20, eventName: "Transfer", logs: rc.logs.filter((x) => lc(x.address) === lc(ADDR.USDC)) }))
      if (lc((l.args as any).to) === lc(to)) sum += (l.args as any).value as bigint;
  }
  return sum;
}

/** Keeper mode: USDC proceeds + unsold tokens go back to the vault (or the borrower once the loan is closed).
 *  The row goes SETTLING before any transfer, so a crash can never pay twice; a failed USDC transfer leaves it SETTLING
 *  with an `error` event for manual retry (hasOpenFlashOrder keeps the loan blocked meanwhile). */
async function settleKeeperOrder(ctx: Ctx, r: Record<string, any>, order: any, fills: any[]) {
  const loan = getLoan(ctx.db, r.loan_id);
  if (!loan?.vault) throw new Error(`loan ${r.loan_id} missing vault`);
  const to: Address = loan.status === "RELEASED" || loan.status === "CANCELLED" ? loan.borrower : loan.vault;
  const w = await ctx.wallet();
  const decimals = Number(await ctx.pub.readContract({ address: r.token, abi: erc20, functionName: "decimals" }));
  const sold = parseUnits(order.filled?.targetAmount || "0", decimals);
  const held = (await ctx.pub.readContract({ address: r.token, abi: erc20, functionName: "balanceOf", args: [w.address] })) as bigint;
  const unsold = BigInt(r.amount_raw) - sold;
  const back = unsold > held ? held : unsold;
  const usdcOut = await usdcReceivedFromFills(ctx, fills, w.address);
  const claimed = ctx.db.prepare("UPDATE flash_orders SET status = 'SETTLING', usdc_out_raw = ?, updated_at = ? WHERE id = ? AND status NOT IN ('SETTLED','SETTLING')")
    .run(usdcOut.toString(), now(), r.id).changes;
  if (!Number(claimed)) return;
  if (usdcOut > 0n) {
    try {
      const tx = await w.write({ address: ADDR.USDC, abi: erc20, functionName: "transfer", args: [to, usdcOut] });
      addEvent(ctx.db, r.loan_id, to === loan.vault ? "repaid" : "flash_twap", tx.hash, { orderId: r.id, usdcRaw: usdcOut.toString(), to });
    } catch (e) {
      addEvent(ctx.db, r.loan_id, "error", null, { module: "flash", orderId: r.id, usdcRaw: usdcOut.toString(), to, error: `USDC settle failed; flash_orders row left SETTLING for manual retry: ${(e as Error).message}` });
      return;
    }
  }
  ctx.db.prepare("UPDATE flash_orders SET status = 'SETTLED', updated_at = ? WHERE id = ?").run(now(), r.id);
  if (back > 0n) {
    try {
      const tx = await w.write({ address: r.token, abi: erc20, functionName: "transfer", args: [to, back] });
      addEvent(ctx.db, r.loan_id, "flash_twap", tx.hash, { orderId: r.id, unsoldReturnedRaw: back.toString(), to });
    } catch (e) {
      addEvent(ctx.db, r.loan_id, "error", null, { module: "flash", orderId: r.id, unsoldRaw: back.toString(), error: (e as Error).message });
    }
  }
}

export function start(ctx: Ctx): () => void {
  if (ctx.demoFork) return () => {};
  let busy = false;
  const t = setInterval(async () => {
    if (busy) return;
    busy = true;
    try { await pollFlashOrders(ctx); } finally { busy = false; }
  }, 30_000);
  return () => clearInterval(t);
}
