// Credit Line Board: a live, engine-computed credit limit for every Bankr agent profile on Base.
// Data: Bankr public APIs (agent-profiles, token-launches/{token}/fees, agent-profiles/{slug}/llm-usage) + Uniswap ETH/USD.
// Terms: the same deterministic engine + lead persona as underwriter quote(); on-chain checks (open vault,
// claimable-fees eligibility) run at apply time, so a board row is a pre-approval, not a binding quote.
import type { Hono } from "hono";
import { parseUnits } from "viem";
import type { Address, FeeInputs } from "@feedesk/shared";
import { ADDR, API } from "@feedesk/shared";
import type { Ctx } from "../ctx.ts";
import { opt } from "../ctx.ts";
import { dust, type TokenFees } from "../bankr/index.ts";
import { PERSONAS } from "../underwriter/index.ts";
import { MIN_HISTORY_DAYS, beneficiaryFactor, computeTerms } from "../underwriter/engine.ts";

// ─── live API shapes (verified by curl 2026-09-19) ───
export type AgentProfile = {
  slug: string; projectName: string; tokenAddress: Address; tokenChainId: string; tokenSymbol: string; tokenName: string;
  marketCapUsd: number; weeklyRevenueWeth: string;
};
export type ProfilesPage = { profiles: AgentProfile[]; total: number; limit: number; offset: number };
export type LlmUsage = { days: number; totals: { totalRequests: number; totalTokens: number } };

export type BoardRow = {
  slug: string; name: string; token: Address; symbol: string; beneficiary: Address | null; sharePct: number | null;
  lifetimeWeth: number | null; claimableWeth: number | null; weeklyWeth: number;
  llmTokens30d: number | null; llmRequests30d: number | null;
  maxLoanUsdc: number; feeRatePct: number | null; floorPrice: number | null;
  eligible: boolean; reason: string | null;
  error: string | null; // fetch failure for this row (fees or llm-usage); never silently dropped
};
export type Board = {
  generatedAt: string; ethUsd: number;
  totals: { agents: number; eligible: number; totalCreditUsdc: number; lifetimeFeesWeth: number; claimableWeth: number; llmTokens30d: number; failed: number; nonBase: number };
  rows: BoardRow[];
};

const lc = (s: string) => s.toLowerCase();
const r6 = (n: number) => Number(n.toFixed(6));
export { dust }; // lives in bankr/ (shared with underwriter quote())

/** One row from raw API data. Mirrors underwriter quote() input construction; math is the shared engine. */
export function buildRow(p: AgentProfile, fees: TokenFees | Error, llm: LlmUsage | Error, ethUsd: number, capUsdc: number): BoardRow {
  const errors: string[] = [];
  const row: BoardRow = {
    slug: p.slug, name: p.projectName, token: p.tokenAddress, symbol: p.tokenSymbol, beneficiary: null, sharePct: null,
    lifetimeWeth: null, claimableWeth: null, weeklyWeth: Number(p.weeklyRevenueWeth) || 0,
    llmTokens30d: null, llmRequests30d: null, maxLoanUsdc: 0, feeRatePct: null, floorPrice: null, eligible: false, reason: null, error: null,
  };
  if (llm instanceof Error) errors.push(`llm-usage: ${llm.message}`);
  else (row.llmTokens30d = llm.totals.totalTokens), (row.llmRequests30d = llm.totals.totalRequests);
  if (fees instanceof Error) {
    errors.push(`fees: ${fees.message}`);
    row.error = errors.join("; ");
    row.reason = "fee data unavailable";
    return row;
  }
  if (errors.length) row.error = errors.join("; ");

  const t = fees.tokens.find((x) => lc(x.tokenAddress) === lc(p.tokenAddress) && x.chain === "base" && x.source === "doppler");
  if (!t) {
    const other = fees.tokens.find((x) => lc(x.tokenAddress) === lc(p.tokenAddress));
    return { ...row, reason: `not eligible: not a Base Doppler token${other ? ` (${other.source} launch)` : ""}` };
  }
  const reasons: string[] = [];
  if (lc(t.numeraire) !== lc(ADDR.WETH)) reasons.push(`numeraire ${t.numeraire} is not WETH`);
  const wethIs0 = !t.tokenIsToken0;
  const claimable = dust(wethIs0 ? t.claimable.token0 : t.claimable.token1);
  const allTimeSum = fees.allTimeDailyEarnings.reduce((s, d) => s + Number(dust(d.weth)), 0);
  const factor = beneficiaryFactor(allTimeSum, Number(dust(fees.totals.claimedWeth)), Number(dust(fees.totals.claimableWeth)), parseFloat(t.share));
  const ageDays = fees.allTimeDailyEarnings.length;
  const inputs: FeeInputs = {
    token: t.tokenAddress, symbol: t.symbol, name: t.name, poolId: t.poolId,
    feesManager: t.feesContract ?? t.initializer, sharePct: parseFloat(t.share), numeraire: t.numeraire, tokenIsToken0: t.tokenIsToken0,
    claimableWethRaw: parseUnits(claimable, 18).toString(),
    claimableTokenRaw: "0", // ponytail: unused by computeTerms; quote() reads decimals on-chain at apply time
    weth30d: fees.dailyEarnings.reduce((s, d) => s + Number(dust(d.weth)), 0) * factor,
    wethLifetime: Number(dust(fees.lifetimeEarnedWeth)) * factor,
    wethOwn: Number(dust(fees.totals.claimedWeth)) + Number(dust(fees.totals.claimableWeth)),
    lifetimeDays: ageDays,
    dailyWeth: fees.dailyEarnings.map((d) => ({ date: d.date, weth: Number(dust(d.weth)) * factor })),
    ethUsd,
  };
  Object.assign(row, { beneficiary: fees.address, sharePct: inputs.sharePct, lifetimeWeth: r6(inputs.wethLifetime), claimableWeth: Number(claimable) });
  if (ageDays < MIN_HISTORY_DAYS) reasons.push(`fee history ${ageDays}d < ${MIN_HISTORY_DAYS}d`);
  const r = computeTerms(inputs, PERSONAS[0]!.advanceRatePct, capUsdc);
  if (r.analysis.rateUsed === 0) reasons.push("fee rate is 0");
  else if ("error" in r) reasons.push(r.error);
  if ("terms" in r) (row.feeRatePct = r.terms.feeRatePct), (row.floorPrice = r.terms.floorPrice);
  row.eligible = reasons.length === 0;
  row.maxLoanUsdc = row.eligible && "terms" in r ? Number(r.terms.maxPrincipalRaw) / 1e6 : 0;
  row.reason = reasons.length ? `not eligible: ${reasons.join("; ")}` : null;
  return row;
}

export function aggregate(rows: BoardRow[], ethUsd: number, nonBase: number, generatedAt = new Date().toISOString()): Board {
  const sum = (f: (r: BoardRow) => number | null) => rows.reduce((s, r) => s + (f(r) ?? 0), 0);
  const sorted = [...rows].sort((a, b) => b.maxLoanUsdc - a.maxLoanUsdc || (b.lifetimeWeth ?? 0) - (a.lifetimeWeth ?? 0));
  return {
    generatedAt, ethUsd,
    totals: {
      agents: rows.length,
      eligible: rows.filter((r) => r.eligible).length,
      totalCreditUsdc: Number(sum((r) => r.maxLoanUsdc).toFixed(2)),
      lifetimeFeesWeth: r6(sum((r) => r.lifetimeWeth)),
      claimableWeth: r6(sum((r) => r.claimableWeth)),
      llmTokens30d: sum((r) => r.llmTokens30d),
      failed: rows.filter((r) => r.error).length,
      nonBase,
    },
    rows: sorted,
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
  const baseProfiles = all.filter((p) => p.tokenChainId === "base" && p.tokenAddress);
  const px = await ethUsd();
  const cap = Number(opt("DESK_MAX_LOAN_USDC", "250"));
  const rows = await pool(baseProfiles, CONCURRENCY, async (p) => {
    const [fees, llm] = await Promise.all([
      get<TokenFees>(`/token-launches/${lc(p.tokenAddress)}/fees?days=30`).catch(asErr),
      get<LlmUsage>(`/agent-profiles/${encodeURIComponent(p.slug)}/llm-usage?days=30`).catch(asErr),
    ]);
    try {
      return buildRow(p, fees, llm, px, cap);
    } catch (e) { // an unexpected API shape fails this row, not the board
      return { ...buildRow(p, new Error(`unparseable: ${(e as Error).message.slice(0, 120)}`), llm, px, cap) };
    }
  });
  return aggregate(rows, px, all.length - baseProfiles.length);
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
    if (Date.now() - t0 > 1000) ctx.log("board", `built ${board.totals.agents} rows (${board.totals.failed} failed) in ${Date.now() - t0}ms`);
    return c.json(board);
  });
}
