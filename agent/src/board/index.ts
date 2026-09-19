// Credit Line Board: a live, engine-computed credit limit for every Bankr agent profile on Base, plus indicative
// (priced, not lendable) lines for Robinhood Chain agents, whose fees often accrue in tokenized stocks (SPY, TSLA, ...).
// Data: Bankr public APIs (agent-profiles, token-launches/{token}/fees, agent-profiles/{slug}/llm-usage, token-launches/quote-tokens)
// + Uniswap Trading API quotes (ETH/USD on Base; quote token → WETH on Robinhood Chain 4663).
// Terms: the same deterministic engine + lead persona as underwriter quote(); on-chain checks (open vault,
// claimable-fees eligibility) run at apply time, so a board row is a pre-approval, not a binding quote.
import type { Hono } from "hono";
import { parseUnits } from "viem";
import type { Address, FeeInputs } from "@feedesk/shared";
import { ADDR, API, TEST_POOL } from "@feedesk/shared";
import type { Ctx } from "../ctx.ts";
import { opt } from "../ctx.ts";
import { dust, type BankrTokenEntry, type TokenFees } from "../bankr/index.ts";
import { PERSONAS } from "../underwriter/index.ts";
import { MIN_HISTORY_DAYS, beneficiaryFactor, computeTerms } from "../underwriter/engine.ts";

// ─── live API shapes (verified by curl 2026-09-19) ───
export type AgentProfile = {
  slug: string; projectName: string; tokenAddress: Address; tokenChainId: string; tokenSymbol: string; tokenName: string;
  marketCapUsd: number; weeklyRevenueWeth: string;
};
export type ProfilesPage = { profiles: AgentProfile[]; total: number; limit: number; offset: number };
export type LlmUsage = { days: number; totals: { totalRequests: number; totalTokens: number } };
/** GET /token-launches/quote-tokens?chain=robinhood → quoteTokens[] (kind "stock" = Robinhood tokenized stock/ETF). */
export type QuoteToken = { address: Address; symbol: string; name: string; kind: string; isDefault: boolean };
export type UniQuote = { quote: { output: { amount: string } } };

export type BoardRow = {
  slug: string; name: string; token: Address; symbol: string; beneficiary: Address | null; sharePct: number | null;
  lifetimeWeth: number | null; claimableWeth: number | null; weeklyWeth: number;
  llmTokens30d: number | null; llmRequests30d: number | null;
  maxLoanUsdc: number; feeRatePct: number | null; floorPrice: number | null;
  eligible: boolean; reason: string | null;
  error: string | null; // fetch failure for this row (fees or llm-usage); never silently dropped
};
/** USD price of a pool's quote token (numeraire): `wethPerUnit` from a live Uniswap quote on Robinhood Chain × ETH/USD. */
export type QuotePx = { symbol: string; address: Address; stock: boolean; wethPerUnit: number; usd: number; source: string };
/** Robinhood Chain row: the same engine, run in quote-token units (shares, for a stock) priced at `quote.usd`. */
export type RobinhoodRow = BoardRow & {
  chain: "robinhood"; quote: QuotePx | null;
  lifetimeQuote: number | null; claimableQuote: number | null; // beneficiary share, in quote units
  ratePerDayQuote: number | null; usdPerDay: number | null; // engine rateUsed (quote units/day) and its USD value
  indicativeUsdc: number; // engine max principal; maxLoanUsdc stays 0 because the desk cannot lend against it yet
};
export type Board = {
  generatedAt: string; ethUsd: number;
  totals: {
    agents: number; eligible: number; totalCreditUsdc: number; lifetimeFeesWeth: number; claimableWeth: number; llmTokens30d: number;
    failed: number; // rows with a fetch/price error, Base + Robinhood
    nonBase: number; // profiles not on Base; the Robinhood Chain ones are priced in `robinhood`, never lent against
    robinhoodAgents: number; indicativeCreditUsdc: number;
    equityAgents: number; equityFeesUsd: number; indicativeEquityCreditUsdc: number; // Robinhood rows whose fees accrue in a tokenized stock
  };
  rows: BoardRow[];
  robinhood: RobinhoodRow[];
};

/** Why a Robinhood Chain line is only indicative. The fee rights use the same Doppler FeesManager interface there
 *  (checked on-chain, see README); what is missing is Gadai's side: FeeDesk/FeeVault/FeeNote are deployed on Base only
 *  and the vault only sells WETH → USDC against Chainlink ETH/USD. */
export const INDICATIVE = "indicative: desk contracts are deployed on Base; this line is priced but not yet lendable";
export const CHAIN_ID_ROBINHOOD = 4663;
export const RH_WETH: Address = "0x0bd7d308f8e1639fab988df18a8011f41eacad73"; // Robinhood Chain WETH (quote-tokens default)
// ponytail: 0.1 unit, because on 2026-09-19 a 1-share SPY/TSLA/MSTR → WETH quote on 4663 returned NoRouteFoundError while 0.1 routed.
export const PROBE_UNITS = 0.1;

const lc = (s: string) => s.toLowerCase();
const r6 = (n: number) => Number(n.toFixed(6));
export { dust }; // lives in bankr/ (shared with underwriter quote())

type Priced = { row: BoardRow; found: boolean; units: { lifetime: number; claimable: number }; rateUsed: number | null; unitUsd: number; maxUsdc: number; engineOk: boolean };

/**
 * Shared by Base and Robinhood rows. Bankr's fee API reports every amount as "weth", even when the pool is quoted in a
 * stock: those are WETH-equivalents (live 2026-09-19: EARN claimed 31.747529 SPY ↔ totals.claimedWeth 9.1857, claimable
 * 1.755626 SPY ↔ 0.507964, both 0.28934 WETH/SPY). k = Bankr's WETH per quote unit, read from the same response, turns
 * the series back into quote units; the engine then runs in quote units priced at unitUsd (ETH/USD when the quote is WETH).
 */
function priceRow(p: AgentProfile, fees: TokenFees | Error, llm: LlmUsage | Error, chain: "base" | "robinhood", unitUsd: (t: BankrTokenEntry) => number | Error, capUsdc: number): Priced {
  const errors: string[] = [];
  const row: BoardRow = {
    slug: p.slug, name: p.projectName, token: p.tokenAddress, symbol: p.tokenSymbol, beneficiary: null, sharePct: null,
    lifetimeWeth: null, claimableWeth: null, weeklyWeth: Number(p.weeklyRevenueWeth) || 0,
    llmTokens30d: null, llmRequests30d: null, maxLoanUsdc: 0, feeRatePct: null, floorPrice: null, eligible: false, reason: null, error: null,
  };
  const out: Priced = { row, found: false, units: { lifetime: 0, claimable: 0 }, rateUsed: null, unitUsd: 0, maxUsdc: 0, engineOk: false };
  if (llm instanceof Error) errors.push(`llm-usage: ${llm.message}`);
  else (row.llmTokens30d = llm.totals.totalTokens), (row.llmRequests30d = llm.totals.totalRequests);
  if (fees instanceof Error) {
    errors.push(`fees: ${fees.message}`);
    row.error = errors.join("; ");
    row.reason = "fee data unavailable";
    return out;
  }
  if (errors.length) row.error = errors.join("; ");

  const t = fees.tokens.find((x) => lc(x.tokenAddress) === lc(p.tokenAddress) && x.chain === chain && x.source === "doppler");
  if (!t) {
    const other = fees.tokens.find((x) => lc(x.tokenAddress) === lc(p.tokenAddress));
    row.reason = `not eligible: not a ${chain === "base" ? "Base" : "Robinhood Chain"} Doppler token${other ? ` (${other.source} launch)` : ""}`;
    return out;
  }
  const reasons: string[] = [];
  const quoteIsWeth = lc(t.numeraire) === lc(chain === "base" ? ADDR.WETH : RH_WETH);
  if (chain === "base" && !quoteIsWeth) reasons.push(`numeraire ${t.numeraire} is not WETH`);
  const px = unitUsd(t);
  if (px instanceof Error) {
    row.error = [row.error, `quote price: ${px.message}`].filter(Boolean).join("; ");
    row.reason = "quote token price unavailable";
    return out;
  }
  out.found = true;
  out.unitUsd = px;
  const quoteIs0 = !t.tokenIsToken0;
  const claimable = dust(quoteIs0 ? t.claimable.token0 : t.claimable.token1); // quote units
  const claimedQ = Number(dust(quoteIs0 ? t.claimed.token0 : t.claimed.token1));
  const claimedW = Number(dust(fees.totals.claimedWeth)), claimableW = Number(dust(fees.totals.claimableWeth));
  // WETH-equivalent per quote unit, from whichever pair has more digits (the API rounds to 6 decimals). 0 claimed and 0 claimable → no fees.
  const k = quoteIsWeth || chain === "base" ? 1 : claimedQ >= Number(claimable) ? claimedW / claimedQ : claimableW / Number(claimable);
  const toUnits = Number.isFinite(k) && k > 0 ? 1 / k : 0;
  const allTimeSum = fees.allTimeDailyEarnings.reduce((s, d) => s + Number(dust(d.weth)), 0);
  const factor = beneficiaryFactor(allTimeSum, claimedW, claimableW, parseFloat(t.share));
  const ageDays = fees.allTimeDailyEarnings.length;
  const inputs: FeeInputs = {
    token: t.tokenAddress, symbol: t.symbol, name: t.name, poolId: t.poolId,
    feesManager: t.feesContract ?? t.initializer, sharePct: parseFloat(t.share), numeraire: t.numeraire, tokenIsToken0: t.tokenIsToken0,
    claimableWethRaw: parseUnits(claimable, 18).toString(), // engine reads it /1e18; every quote token seen (WETH, SPY, TSLA, MSTR, AMZN) is 18-dec
    claimableTokenRaw: "0", // ponytail: unused by computeTerms; quote() reads decimals on-chain at apply time
    weth30d: fees.dailyEarnings.reduce((s, d) => s + Number(dust(d.weth)), 0) * factor * toUnits,
    wethLifetime: Number(dust(fees.lifetimeEarnedWeth)) * factor * toUnits,
    wethOwn: (claimedW + claimableW) * toUnits,
    lifetimeDays: ageDays,
    dailyWeth: fees.dailyEarnings.map((d) => ({ date: d.date, weth: Number(dust(d.weth)) * factor * toUnits })),
    ethUsd: px, // USD per quote unit
  };
  Object.assign(row, { beneficiary: fees.address, sharePct: inputs.sharePct });
  out.units = { lifetime: inputs.wethLifetime, claimable: Number(claimable) };
  if (ageDays < MIN_HISTORY_DAYS) reasons.push(`fee history ${ageDays}d < ${MIN_HISTORY_DAYS}d`);
  const r = computeTerms(inputs, PERSONAS[0]!.advanceRatePct, capUsdc);
  out.rateUsed = r.analysis.rateUsed;
  if (r.analysis.rateUsed === 0) reasons.push("fee rate is 0");
  else if ("error" in r) reasons.push(r.error);
  if ("terms" in r) (row.feeRatePct = r.terms.feeRatePct), (row.floorPrice = r.terms.floorPrice);
  out.engineOk = reasons.length === 0;
  out.maxUsdc = out.engineOk && "terms" in r ? Number(r.terms.maxPrincipalRaw) / 1e6 : 0;
  row.reason = reasons.length ? `not eligible: ${reasons.join("; ")}` : null;
  return out;
}

/** One Base row from raw API data. Mirrors underwriter quote() input construction; math is the shared engine. */
export function buildRow(p: AgentProfile, fees: TokenFees | Error, llm: LlmUsage | Error, ethUsd: number, capUsdc: number): BoardRow {
  const o = priceRow(p, fees, llm, "base", () => ethUsd, capUsdc);
  if (o.found) (o.row.lifetimeWeth = r6(o.units.lifetime)), (o.row.claimableWeth = o.units.claimable);
  o.row.eligible = o.engineOk;
  o.row.maxLoanUsdc = o.maxUsdc;
  return o.row;
}

/** One Robinhood Chain row: same engine and lead persona, fee stream in quote units × the quote's USD price. Never lendable. */
export function buildRobinhoodRow(p: AgentProfile, fees: TokenFees | Error, llm: LlmUsage | Error, prices: Map<string, QuotePx | Error>, capUsdc: number): RobinhoodRow {
  let quote: QuotePx | null = null;
  const o = priceRow(p, fees, llm, "robinhood", (t) => {
    const q = prices.get(lc(t.numeraire)) ?? new Error(`no price for quote token ${t.numeraire}`);
    if (q instanceof Error) return q;
    quote = q;
    return q.usd;
  }, capUsdc);
  const ok = o.found && o.rateUsed != null;
  return {
    ...o.row, chain: "robinhood", quote, eligible: false, maxLoanUsdc: 0,
    reason: o.row.reason ?? INDICATIVE,
    lifetimeQuote: ok ? r6(o.units.lifetime) : null, claimableQuote: ok ? o.units.claimable : null,
    ratePerDayQuote: ok ? r6(o.rateUsed!) : null, usdPerDay: ok ? Number((o.rateUsed! * o.unitUsd).toFixed(2)) : null,
    indicativeUsdc: o.maxUsdc,
  };
}

/** USD price of a Robinhood Chain quote token. WETH → ETH/USD; anything else → `res` (Uniswap quote of PROBE_UNITS → WETH on 4663) × ETH/USD. */
export function quotePx(numeraire: string, list: QuoteToken[], ethUsd: number, res?: UniQuote): QuotePx {
  const e = list.find((q) => lc(q.address) === lc(numeraire));
  const symbol = e?.symbol ?? numeraire.slice(0, 10);
  if (lc(numeraire) === RH_WETH) return { symbol: "WETH", address: RH_WETH, stock: false, wethPerUnit: 1, usd: ethUsd, source: "ETH/USD: Uniswap Trading API quote on Base" };
  if (!res) throw new Error(`no Uniswap quote for ${symbol}`);
  const wethPerUnit = Number(BigInt(res.quote.output.amount)) / 1e18 / PROBE_UNITS;
  if (!(wethPerUnit > 0)) throw new Error(`Uniswap quote for ${symbol} returned ${res.quote.output.amount}`);
  return {
    symbol, address: numeraire as Address, stock: e?.kind === "stock", wethPerUnit, usd: Number((wethPerUnit * ethUsd).toFixed(4)),
    source: `Uniswap Trading API: ${PROBE_UNITS} ${symbol} → WETH on Robinhood Chain (${CHAIN_ID_ROBINHOOD}) × ETH/USD`,
  };
}

export function aggregate(rows: BoardRow[], ethUsd: number, nonBase: number, generatedAt = new Date().toISOString(), robinhood: RobinhoodRow[] = []): Board {
  const sum = <R>(xs: R[], f: (r: R) => number | null) => xs.reduce((s, r) => s + (f(r) ?? 0), 0);
  const sorted = [...rows].sort((a, b) => b.maxLoanUsdc - a.maxLoanUsdc || (b.lifetimeWeth ?? 0) - (a.lifetimeWeth ?? 0));
  const rh = [...robinhood].sort((a, b) => b.indicativeUsdc - a.indicativeUsdc || (b.usdPerDay ?? 0) - (a.usdPerDay ?? 0));
  const equity = rh.filter((r) => r.quote?.stock);
  return {
    generatedAt, ethUsd,
    totals: {
      agents: rows.length,
      eligible: rows.filter((r) => r.eligible).length,
      totalCreditUsdc: Number(sum(rows, (r) => r.maxLoanUsdc).toFixed(2)),
      lifetimeFeesWeth: r6(sum(rows, (r) => r.lifetimeWeth)),
      claimableWeth: r6(sum(rows, (r) => r.claimableWeth)),
      llmTokens30d: sum(rows, (r) => r.llmTokens30d),
      failed: rows.filter((r) => r.error).length + rh.filter((r) => r.error).length,
      nonBase,
      robinhoodAgents: rh.length,
      indicativeCreditUsdc: Number(sum(rh, (r) => r.indicativeUsdc).toFixed(2)),
      equityAgents: equity.length,
      equityFeesUsd: Number(sum(equity, (r) => (r.lifetimeQuote ?? 0) * r.quote!.usd).toFixed(2)),
      indicativeEquityCreditUsdc: Number(sum(equity, (r) => r.indicativeUsdc).toFixed(2)),
    },
    rows: sorted,
    robinhood: rh,
  };
}

// ─── live fetch ───
const TIMEOUT_MS = 15_000;
const CONCURRENCY = 6;
const TTL_MS = 10 * 60_000;

// ponytail: own fetch, not bankr/call(): its 20/min limiter would make a 200-call board take 10 min and starve live quotes.
async function get<T>(path: string): Promise<T> {
  const url = opt("BANKR_API_BASE", API.BANKR) + path;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 429 && attempt === 0) {
      await new Promise((r) => setTimeout(r, Math.min(30, Number(res.headers.get("retry-after")) || 5) * 1000));
      continue;
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 120)}`);
    return JSON.parse(text) as T;
  }
}

/** Uniswap Trading API /quote of PROBE_UNITS `token` → WETH on Robinhood Chain. Own fetch, not uniswap/post(): that one pins
 *  x-universal-router-version from env (2.0), which chain 4663 does not have; its default there is 2.1.1. One retry (routing timeouts seen live). */
async function uniQuoteToWeth(token: Address): Promise<UniQuote> {
  const key = process.env.UNISWAP_API_KEY;
  if (!key) throw new Error("Missing env UNISWAP_API_KEY");
  const body = JSON.stringify({
    type: "EXACT_INPUT", amount: (BigInt(PROBE_UNITS * 1e6) * 10n ** 12n).toString(), tokenInChainId: CHAIN_ID_ROBINHOOD, tokenOutChainId: CHAIN_ID_ROBINHOOD,
    tokenIn: token, tokenOut: RH_WETH, swapper: process.env.AGENT_WALLET_ADDRESS || TEST_POOL.beneficiary, // pricing only, never executed
    slippageTolerance: 0.5, routingPreference: "BEST_PRICE", protocols: ["V2", "V3", "V4"],
  });
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(API.UNISWAP_TRADE + "/quote", {
      method: "POST", body, signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "x-api-key": key, "content-type": "application/json", accept: "application/json", "x-permit2-disabled": "true" },
    });
    const text = await r.text();
    if (r.ok) return JSON.parse(text) as UniQuote;
    if (attempt >= 1) throw new Error(`uniswap /quote ${r.status}: ${text.slice(0, 160)}`);
  }
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]!); }
  }));
  return out;
}

const asErr = (e: unknown) => (e instanceof Error ? (e.name === "TimeoutError" ? new Error(`timeout after ${TIMEOUT_MS / 1000}s`) : e) : new Error(String(e)));

export async function buildBoard(ethUsd: () => Promise<number>): Promise<Board> {
  const pages = await Promise.all([0, 100].map((o) => get<ProfilesPage>(`/agent-profiles?sort=marketCap&limit=100&offset=${o}`)));
  const seen = new Set<string>();
  const all = pages.flatMap((p) => p.profiles).filter((p) => !seen.has(p.slug) && seen.add(p.slug));
  const priced = all.filter((p) => (p.tokenChainId === "base" || p.tokenChainId === "robinhood") && p.tokenAddress);
  const px = await ethUsd();
  const cap = Number(opt("DESK_MAX_LOAN_USDC", "250"));
  const [raw, list] = await Promise.all([
    pool(priced, CONCURRENCY, async (p) => {
      const [fees, llm] = await Promise.all([
        get<TokenFees>(`/token-launches/${lc(p.tokenAddress)}/fees?days=30`).catch(asErr),
        get<LlmUsage>(`/agent-profiles/${encodeURIComponent(p.slug)}/llm-usage?days=30`).catch(asErr),
      ]);
      return { p, fees, llm };
    }),
    get<{ quoteTokens: QuoteToken[] }>("/token-launches/quote-tokens?chain=robinhood").then((r) => r.quoteTokens).catch(asErr),
  ]);
  // an unexpected API shape fails that row, not the board
  const safe = <R>(f: () => R, fail: (e: Error) => R) => { try { return f(); } catch (e) { return fail(new Error(`unparseable: ${(e as Error).message.slice(0, 120)}`)); } };
  const rows = raw.filter((x) => x.p.tokenChainId === "base").map(({ p, fees, llm }) => safe(() => buildRow(p, fees, llm, px, cap), (e) => buildRow(p, e, llm, px, cap)));
  const rhRaw = raw.filter((x) => x.p.tokenChainId === "robinhood");
  const numeraires = [...new Set(rhRaw.flatMap(({ fees }) => (fees instanceof Error ? [] : fees.tokens.filter((t) => t.chain === "robinhood").map((t) => lc(t.numeraire)))))];
  const prices = new Map<string, QuotePx | Error>(await pool(numeraires, 3, async (n) => {
    if (list instanceof Error) return [n, new Error(`quote-tokens: ${list.message}`)] as const;
    try { return [n, quotePx(n, list, px, n === RH_WETH ? undefined : await uniQuoteToWeth(n as Address))] as const; } catch (e) { return [n, asErr(e)] as const; }
  }));
  const robinhood = rhRaw.map(({ p, fees, llm }) => safe(() => buildRobinhoodRow(p, fees, llm, prices, cap), (e) => buildRobinhoodRow(p, e, llm, prices, cap)));
  return aggregate(rows, px, all.length - all.filter((p) => p.tokenChainId === "base" && p.tokenAddress).length, undefined, robinhood);
}

let cached: { at: number; board: Promise<Board> } | undefined;
export function getBoard(ethUsd: () => Promise<number>): Promise<Board> {
  if (!cached || Date.now() - cached.at > TTL_MS) {
    const board = buildBoard(ethUsd);
    cached = { at: Date.now(), board };
    board.catch(() => { if (cached?.board === board) cached = undefined; }); // don't cache failures
  }
  return cached.board;
}

export function register(app: Hono, ctx: Ctx): void {
  app.get("/api/board", async (c) => {
    const { ethUsd } = (await import("../uniswap/index.ts")) as { ethUsd: () => Promise<number> };
    const t0 = Date.now();
    const board = await getBoard(ethUsd);
    if (Date.now() - t0 > 1000) ctx.log("board", `built ${board.totals.agents} rows + ${board.totals.robinhoodAgents} Robinhood (${board.totals.failed} failed) in ${Date.now() - t0}ms`);
    return c.json(board);
  });
}
