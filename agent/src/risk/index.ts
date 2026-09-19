// Paid token risk check: before the desk approves a loan, the Dynamic agent wallet BUYS a honeypot/rug verdict from a
// third-party x402 service (Bankr x402 Cloud) and the underwriter uses it (HONEYPOT declines, SUSPICIOUS halves the line).
// Client: the documented x402 v2 stack (@x402/fetch wrapFetchWithPaymentFromConfig + @x402/evm ExactEvmScheme). The signer
// is the Dynamic MPC wallet's signTypedData: an EIP-3009 transferWithAuthorization, no gas, the facilitator settles.
// THE ONE MAINNET ACTION: payment is real USDC on Base mainnet (chainId 8453) even in DEMO_FORK, where everything else
// hits the Anvil fork. The typed data is chain-independent, so the fork-bound wallet client signs it as-is.
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { createPublicClient, getAddress, http, isAddress, parseAbi } from "viem";
import { base } from "viem/chains";
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader, x402Client, x402HTTPClient, type PaymentRequired, type PaymentRequirements } from "@x402/fetch";
import { ExactEvmScheme, type ClientEvmSigner } from "@x402/evm";
import { ADDR, ERC20_ABI, type Address, type Hex, type RiskCheck, type RiskVerdict } from "@feedesk/shared";
import { opt, type AgentWallet, type Ctx } from "../ctx.ts";

export const RISK_URL = "https://x402.bankr.bot/0xf31f59e7b8b58555f7871f71973a394c8f1bffe5/honeypot-check";
export const NETWORK = "eip155:8453" as const;
export const PRICE_RAW = 50_000n; // $0.05 USDC (6 dp), as quoted by the service's 402
const USDC = ADDR.USDC;
const CACHE_MS = 24 * 3600_000;

// ─── pure pieces (unit-tested) ───

/** Only pay exactly what we expect: exact scheme, Base mainnet, native USDC with its MAINNET EIP-712 domain, ≤ maxRaw. */
export const riskPolicy = (maxRaw: bigint, onPick?: (r: PaymentRequirements) => void) => (_v: number, reqs: PaymentRequirements[]) => {
  const ok = reqs.filter((r) =>
    r.scheme === "exact" && r.network === NETWORK && isAddress(r.asset) && getAddress(r.asset) === USDC &&
    r.extra?.name === "USD Coin" && r.extra?.version === "2" && BigInt(r.amount) <= maxRaw);
  if (ok[0]) onPick?.(ok[0]); // x402's default selector takes the first remaining option
  return ok;
};

/** Adapts the Dynamic AgentWallet to x402's ClientEvmSigner. AgentWallet.signTypedData takes JSON (goes through the
 *  wallet's serial queue + Dynamic re-auth), so bigints travel as decimal strings; viem hashes them identically. */
export function dynamicSigner(w: Pick<AgentWallet, "address" | "signTypedData">): ClientEvmSigner {
  return { address: w.address, signTypedData: (td) => w.signTypedData(JSON.stringify(td, (_k, v) => (typeof v === "bigint" ? v.toString() : v))) };
}

/** fetch that pays the 402 with `signer`, restricted by riskPolicy and x402's own spend controls. */
export const payingFetch = (signer: ClientEvmSigner, fetchImpl: typeof fetch = fetch, maxRaw = PRICE_RAW, onPick?: (r: PaymentRequirements) => void) =>
  wrapFetchWithPaymentFromConfig(fetchImpl, {
    schemes: [{ network: NETWORK, client: new ExactEvmScheme(signer) }],
    policies: [riskPolicy(maxRaw, onPick)],
    spendControls: { maxAmountPerPayment: `$${Number(maxRaw) / 1e6}` },
  });

/** Parses a 402 with the x402 core client (v2: base64 PAYMENT-REQUIRED header; the body is only read for v1). */
export async function parse402(res: Response): Promise<PaymentRequired> {
  const text = await res.text();
  return new x402HTTPClient(new x402Client()).getPaymentRequiredResponse((n) => res.headers.get(n), text ? JSON.parse(text) : undefined);
}

/** Unpaid probe: what the service asks for right now (no signature, no money). */
export async function requirements(fetchImpl: typeof fetch = fetch): Promise<PaymentRequired> {
  const res = await fetchImpl(RISK_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: USDC }) });
  if (res.status !== 402) throw new Error(`expected 402 from ${RISK_URL}, got ${res.status}`);
  return parse402(res);
}

export function parseVerdict(body: unknown): RiskVerdict {
  const v = String((body as { verdict?: unknown })?.verdict ?? "").trim().toUpperCase();
  if (v !== "SAFE" && v !== "SUSPICIOUS" && v !== "HONEYPOT") throw new Error(`risk service returned no SAFE/SUSPICIOUS/HONEYPOT verdict: ${JSON.stringify(body).slice(0, 200)}`);
  return v;
}

/** Underwriting multiplier. May only lower: HONEYPOT 0 (decline), SUSPICIOUS 0.5, SAFE / not purchased 1. */
export function riskFactor(r: Pick<RiskCheck, "verdict" | "note" | "paid" | "cached">): { factor: number; note: string } {
  const how = r.paid ? ` (bought via x402 for $${r.paid.amountUsd} USDC on Base mainnet${r.paid.txHash ? `, settlement ${r.paid.txHash}` : ""}${r.cached ? ", cached ≤24h" : ""})` : "";
  switch (r.verdict) {
    case "HONEYPOT": return { factor: 0, note: `honeypot-check verdict HONEYPOT${how} → decline` };
    case "SUSPICIOUS": return { factor: 0.5, note: `honeypot-check verdict SUSPICIOUS${how} → principal ×0.5` };
    case "SAFE": return { factor: 1, note: `honeypot-check verdict SAFE${how} → no change` };
    default: return { factor: 1, note: `honeypot-check ${r.note} → no change` };
  }
}

// ─── state: 24h verdict cache + daily budget (kv table) ───
const kvGet = (ctx: Ctx, k: string) => (ctx.db.prepare("SELECT value FROM kv WHERE key = ?").get(k) as { value: string } | undefined)?.value;
const kvSet = (ctx: Ctx, k: string, v: string) =>
  ctx.db.prepare("INSERT INTO kv (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").run(k, v, new Date().toISOString());
const cacheKey = (t: Address) => `risk.verdict.${t.toLowerCase()}`;
const spentKey = (d = new Date()) => `risk.spentRaw.${d.toISOString().slice(0, 10)}`; // UTC day
export const spentToday = (ctx: Ctx) => BigInt(kvGet(ctx, spentKey()) ?? "0");
export const budgetRaw = () => BigInt(Math.round(Number(opt("RISK_MAX_USDC_PER_DAY", "1")) * 1e6));

export function cachedVerdict(ctx: Ctx, token: Address): RiskCheck | null {
  const s = kvGet(ctx, cacheKey(token));
  if (!s) return null;
  const r = JSON.parse(s) as RiskCheck;
  return Date.now() - Date.parse(r.checkedAt) < CACHE_MS ? { ...r, cached: true } : null;
}

const mainnet = () => createPublicClient({ chain: base, transport: http(opt("BASE_RPC_URL", "https://base-rpc.publicnode.com")) });
/** USDC the desk wallet holds on Base MAINNET (never the fork: the payment settles on mainnet). */
export const mainnetUsdc = (a: Address) => mainnet().readContract({ address: USDC, abi: parseAbi(ERC20_ABI), functionName: "balanceOf", args: [a] }) as Promise<bigint>;

export type RiskDeps = { signer: ClientEvmSigner; fetchImpl?: typeof fetch; balance?: (a: Address) => Promise<bigint> };

let lock: Promise<unknown> = Promise.resolve(); // ponytail: global lock so two applies can't both pass the budget check

/**
 * Buy (or reuse a ≤24h cached) verdict for `token`. Never throws for "can't buy" cases: returns verdict null + a note
 * (RISK_CHECK=off, insufficient mainnet USDC, daily budget reached, service/payment error). Never fakes a verdict.
 */
export function buyRiskVerdict(ctx: Ctx, token: Address, o: { force?: boolean; deps?: RiskDeps } = {}): Promise<RiskCheck> {
  const run = lock.then(() => buyLocked(ctx, getAddress(token), o));
  lock = run.catch(() => {});
  return run;
}

async function buyLocked(ctx: Ctx, token: Address, o: { force?: boolean; deps?: RiskDeps }): Promise<RiskCheck> {
  const skip = (note: string): RiskCheck => ({ token, verdict: null, note, raw: null, paid: null, checkedAt: new Date().toISOString(), cached: false });
  if (opt("RISK_CHECK", "on") === "off") return skip("not purchased: RISK_CHECK=off");
  if (!o.force) { const c = cachedVerdict(ctx, token); if (c) return c; }
  const spent = spentToday(ctx), cap = budgetRaw();
  if (spent + PRICE_RAW > cap) return skip(`not purchased: daily budget RISK_MAX_USDC_PER_DAY=$${Number(cap) / 1e6} reached ($${Number(spent) / 1e6} spent today)`);

  let deps = o.deps;
  if (!deps) {
    try { deps = { signer: dynamicSigner(await ctx.wallet()) }; } catch (e) { return skip(`not purchased: desk wallet unavailable (${(e as Error).message.split("\n")[0]})`); }
  }
  const payer = getAddress(deps.signer.address);
  const bal = await (deps.balance ?? mainnetUsdc)(payer).catch(() => null);
  if (bal === null) return skip("not purchased: could not read the desk wallet's Base mainnet USDC balance");
  if (bal < PRICE_RAW) return skip(`not purchased: insufficient USDC (desk wallet ${payer} holds $${Number(bal) / 1e6} on Base mainnet, needs $${Number(PRICE_RAW) / 1e6})`);

  ctx.log("risk", `buying honeypot-check for ${token} via x402 ($${Number(PRICE_RAW) / 1e6} USDC, Base MAINNET) from ${payer}`);
  let res: Response, picked: PaymentRequirements | undefined;
  try {
    res = await payingFetch(deps.signer, deps.fetchImpl, PRICE_RAW, (r) => (picked = r))(RISK_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
  } catch (e) {
    return skip(`not purchased: x402 payment failed (${(e as Error).message.slice(0, 200)})`);
  }
  const hdr = res.headers.get("PAYMENT-RESPONSE") ?? res.headers.get("X-PAYMENT-RESPONSE");
  const settlement = hdr ? (() => { try { return decodePaymentResponseHeader(hdr); } catch { return null; } })() : null;
  if (settlement?.success) kvSet(ctx, spentKey(), (spentToday(ctx) + PRICE_RAW).toString()); // settled = money gone, count it even if the body is bad
  const text = await res.text();
  if (!res.ok) return skip(`not purchased: service answered ${res.status} after payment attempt (${text.slice(0, 200)})${settlement?.transaction ? `; settlement ${settlement.transaction}` : ""}`);
  let raw: unknown, verdict: RiskVerdict;
  try { raw = JSON.parse(text); verdict = parseVerdict(raw); } catch (e) {
    return skip(`paid but unusable response: ${(e as Error).message}${settlement?.transaction ? `; settlement ${settlement.transaction}` : ""}`);
  }
  const r: RiskCheck = {
    token, verdict, raw, note: `bought from ${RISK_URL}`, checkedAt: new Date().toISOString(), cached: false,
    paid: {
      service: RISK_URL, amountRaw: picked?.amount ?? PRICE_RAW.toString(), amountUsd: Number(picked?.amount ?? PRICE_RAW) / 1e6, asset: USDC, network: NETWORK,
      payTo: getAddress(picked?.payTo ?? "0x8AEE621035D93Deb3C0C1177fac252dC2dd501a0") as Address, payer: (settlement?.payer ? getAddress(settlement.payer) : payer) as Address,
      txHash: (settlement?.transaction || null) as Hex | null, settlement,
    },
  };
  kvSet(ctx, cacheKey(token), JSON.stringify(r));
  ctx.log("risk", `${token}: ${verdict}`, { settlement: r.paid!.txHash });
  return r;
}

const tokenParam = (v: string): Address => {
  if (!isAddress(v)) throw new HTTPException(400, { message: "token must be a 0x address" });
  return getAddress(v);
};

export function register(app: Hono, ctx: Ctx): void {
  // Public read: cache only, never spends (a public GET must not be able to drain the desk's USDC).
  app.get("/api/risk/:token", (c) => {
    const token = tokenParam(c.req.param("token"));
    return c.json(cachedVerdict(ctx, token) ?? { token, verdict: null, note: "no verdict bought in the last 24h", paid: null, spentTodayRaw: spentToday(ctx).toString() });
  });
  // Admin: force a fresh paid purchase (still under RISK_MAX_USDC_PER_DAY). /api/admin/* is x-admin-token gated by the server.
  app.post("/api/admin/risk/:token", async (c) => c.json(await buyRiskVerdict(ctx, tokenParam(c.req.param("token")), { force: true })));
}
