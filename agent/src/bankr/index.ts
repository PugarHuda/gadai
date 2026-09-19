// Bankr public Doppler fee APIs (no auth) + Bankr LLM Gateway. Verified: docs/integrations/bankr.md §1, §4.
import { HTTPException } from "hono/http-exception";
import { encodeFunctionData, isAddressEqual, parseAbi } from "viem";
import type { Address, Hex, TxRequest } from "@feedesk/shared";
import { API, CHAIN_ID_BASE, FEES_MANAGER_ABI } from "@feedesk/shared";
import { opt } from "../ctx.ts";

const base = () => opt("BANKR_API_BASE", API.BANKR);

// ─── response shapes (live-verified 2026-09-18) ───
export type BankrTokenEntry = {
  tokenAddress: Address; name: string; symbol: string; poolId: Hex; initializer: Address; feesContract?: Address;
  share: string; token0Label: string; token1Label: string; numeraire: Address; tokenIsToken0: boolean;
  claimable: { token0: string; token1: string }; claimed: { token0: string; token1: string; count: number };
  source: string; chain: string;
};
export type DailyWeth = { date: string; weth: string };
/** Bankr fee APIs return "<0.000001" for dust amounts (claimable.*, totals.*, daily weth): count as 0 (conservative).
 *  Wrap every fee-API decimal string with this before parseUnits/Number. */
export const dust = (s: string) => (s.startsWith("<") ? "0" : s);
export type TokenFees = {
  address: Address; // beneficiary the history belongs to
  chain: string; days: number; tokens: BankrTokenEntry[];
  dailyEarnings: DailyWeth[]; allTimeDailyEarnings: DailyWeth[];
  lifetimeEarnedWeth: string; lifetimeDays: number; // lifetimeDays = number of days with nonzero earnings
  totals: { claimableWeth: string; claimedWeth: string; claimCount: number };
};
export type CreatorFees = Omit<TokenFees, "tokens"> & { tokens: BankrTokenEntry[] };
export type ClaimableFees =
  | { eligible: true; tokenAddress: Address; share: string; claimableFees: { token0: string; token1: string; token0Label: string; token1Label: string } }
  | { eligible: false; tokenAddress: Address };

// ─── rate limit (live header RateLimit-Policy: 20;w=60) + 2-min cache for GET fee reads ───
const LIMIT = 20;
const hits: number[] = [];
const MAX_WAITERS = 10; // ponytail: global cap, so spam on public /api/quote gets 429 instead of an unbounded queue; per-IP buckets if abused
let waiters = 0;
async function slot() {
  const t0 = Date.now();
  while (hits.length && t0 - hits[0]! > 60_000) hits.shift();
  if (hits.length >= LIMIT && waiters >= MAX_WAITERS) throw new HTTPException(429, { message: "Bankr API rate limit (20/min) saturated, retry in a minute" });
  waiters++;
  try { await waitSlot(); } finally { waiters--; }
}
async function waitSlot() {
  for (;;) {
    const t = Date.now();
    while (hits.length && t - hits[0]! > 60_000) hits.shift();
    if (hits.length < LIMIT) return void hits.push(t);
    await new Promise((r) => setTimeout(r, 60_000 - (t - hits[0]!) + 50));
  }
}
const cache = new Map<string, { at: number; v: unknown }>(); // ponytail: unbounded in-memory; fine for a desk-sized working set

async function call<T>(path: string, body?: unknown, cacheMs = 0): Promise<T> {
  const key = path + (body ? JSON.stringify(body) : "");
  const hit = cache.get(key);
  if (cacheMs && hit && Date.now() - hit.at < cacheMs) return hit.v as T;
  await slot();
  const res = await fetch(base() + path, body
    ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
    : undefined);
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error(`Bankr ${body ? "POST" : "GET"} ${path} → ${res.status}: ${text.slice(0, 300)}`), { status: res.status });
  const v = JSON.parse(text) as T;
  if (cacheMs) cache.set(key, { at: Date.now(), v });
  return v;
}
const FEE_CACHE = 120_000;
const lc = (a: string) => a.toLowerCase();

/** Preferred (non-deprecated) route: GET /token-launches/{token}/fees?days=N (1..90). */
export const tokenFees = (token: Address, days = 30) => call<TokenFees>(`/token-launches/${lc(token)}/fees?days=${days}`, undefined, FEE_CACHE);
export const creatorFees = (wallet: Address, days = 30) => call<CreatorFees>(`/public/doppler/creator-fees/${lc(wallet)}?days=${days}`, undefined, FEE_CACHE);
export const claimableFees = (token: Address, beneficiary: Address, fresh = false) =>
  call<ClaimableFees>(`/public/doppler/claimable-fees/${lc(token)}?beneficiary=${lc(beneficiary)}`, undefined, fresh ? 0 : FEE_CACHE);

export async function buildTransferBeneficiary(p: { tokenAddress: Address; currentBeneficiary: Address; newBeneficiary: Address }): Promise<TxRequest> {
  const r = await call<{ to: Address; data: Hex; chainId: number; description?: string }>("/public/doppler/build-transfer-beneficiary", p);
  if (r.chainId !== CHAIN_ID_BASE || !r.data.startsWith("0xd44f6738")) throw new Error(`build-transfer-beneficiary returned unexpected tx ${JSON.stringify(r)}`);
  return { to: r.to, data: r.data, chainId: r.chainId, label: r.description ?? "Pledge fee rights (updateBeneficiary)" };
}

/** The user signs this third-party calldata: it must be exactly FeesManager.updateBeneficiary(poolId, vault) on Base. */
export function assertPledgeTx(tx: TxRequest, e: { feesManager: Address; poolId: Hex; vault: Address }): void {
  const fail = (why: string) => { throw new Error(`pledge tx rejected: ${why} (${JSON.stringify(tx)})`); };
  if (tx.chainId !== CHAIN_ID_BASE) fail(`chainId ${tx.chainId}`);
  if (!isAddressEqual(tx.to, e.feesManager)) fail(`to ${tx.to} ≠ fees manager ${e.feesManager}`);
  if (tx.value !== undefined && BigInt(tx.value) !== 0n) fail("nonzero value");
  const want = encodeFunctionData({ abi: parseAbi(FEES_MANAGER_ABI), functionName: "updateBeneficiary", args: [e.poolId, e.vault] });
  if (tx.data.toLowerCase() !== want.toLowerCase()) fail(`calldata ≠ updateBeneficiary(${e.poolId}, ${e.vault}) = ${want}`);
}

/** Claim-first tx the borrower may sign before pledging: must be exactly FeesManager.collectFees(poolId) on Base. */
export function assertClaimTx(tx: TxRequest, e: { feesManager: Address; poolId: Hex }): void {
  const fail = (why: string) => { throw new Error(`claim tx rejected: ${why} (${JSON.stringify(tx)})`); };
  if (tx.chainId !== CHAIN_ID_BASE) fail(`chainId ${tx.chainId}`);
  if (!isAddressEqual(tx.to, e.feesManager)) fail(`to ${tx.to} ≠ fees manager ${e.feesManager}`);
  if (tx.value !== undefined && BigInt(tx.value) !== 0n) fail("nonzero value");
  const want = encodeFunctionData({ abi: parseAbi(FEES_MANAGER_ABI), functionName: "collectFees", args: [e.poolId] });
  if (tx.data.toLowerCase() !== want.toLowerCase()) fail(`calldata ≠ collectFees(${e.poolId}) = ${want}`);
}

export async function buildClaim(beneficiary: Address, tokens: Address[]): Promise<{ txs: TxRequest[]; errors: unknown[] }> {
  const r = await call<{ transactions: { to: Address; data: Hex; chainId: number; description?: string }[]; errors: unknown[] }>(
    "/public/doppler/build-claim", { beneficiaryAddress: beneficiary, tokenAddresses: tokens });
  return { txs: r.transactions.map((t) => ({ to: t.to, data: t.data, chainId: t.chainId, label: t.description })), errors: r.errors };
}

// ─── LLM Gateway (OpenAI-compatible) ───
/** 402 / insufficient_credits only. The underwriter may fall back to rules on this (and nothing else) when opted in. */
export class LlmNoCredits extends Error {}
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export async function llmChat(messages: ChatMessage[], o: { model: string; maxTokens?: number }): Promise<string> {
  const key = process.env.BANKR_LLM_KEY || process.env.BANKR_API_KEY;
  if (!key) throw new Error("Missing env BANKR_LLM_KEY (see .env.example)");
  const res = await fetch(`${API.BANKR_LLM}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-API-Key": key },
    body: JSON.stringify({ model: o.model, messages, max_tokens: o.maxTokens ?? 1200, temperature: 0 }),
  });
  const text = await res.text();
  if (res.status === 401) throw new Error(`Bankr LLM key rejected (401): ${text.slice(0, 300)}`); // bad key: never a fallback case
  if (res.status === 402 || (!res.ok && /insufficient_credits/.test(text))) throw new LlmNoCredits(`Bankr LLM out of credits (${res.status}): ${text.slice(0, 300)}`);
  if (!res.ok) throw new Error(`Bankr LLM ${o.model} → ${res.status}: ${text.slice(0, 300)}`);
  const content = JSON.parse(text)?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error(`Bankr LLM ${o.model}: no message content in ${text.slice(0, 300)}`);
  return content;
}
