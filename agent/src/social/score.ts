// Pure leaderboard math (SPEC §7). No I/O so it is unit-tested in score.test.ts.
import type { LeaderboardRow, Persona } from "@feedesk/shared";

/** One loan a persona approved that reached Active/Released, with on-chain debt figures (USDC raw). */
export type LoanOutcome = {
  loanId: number;
  faceRaw: bigint;
  noteOutstandingRaw: bigint; // senior note debt still unpaid (0 once Released)
  daysToRepay: number | null; // disbursed → released, null while open
};

/** A mirror order's fill snapshot (decimal USD / token units as Flash reports them). */
export type MirrorFill = {
  spentUsdc: number; // entry contraAmount
  boughtTokens: number; // entry targetAmount
  soldTokens: number; // bracket exit targetAmount
  exitUsdc: number; // bracket exit contraAmount
};

/** Realized + marked PnL: tokens still held at current price, plus bracket exit proceeds, minus USDC spent. */
export const mirrorPnl = (f: MirrorFill, priceUsd: number): number =>
  Math.max(0, f.boughtTokens - f.soldTokens) * priceUsd + f.exitUsdc - f.spentUsdc;

/** Senior note debt still owed: debtOutstanding includes junior drawDebt, which is paid last. */
export const noteOutstanding = (debtOutstanding: bigint, drawDebt: bigint): bigint =>
  debtOutstanding > drawDebt ? debtOutstanding - drawDebt : 0n;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export type PersonaStats = {
  approvals: number;
  declines: number;
  loans: LoanOutcome[];
  mirrors: { spentUsdc: number; pnlUsd: number }[]; // only mirrors with a fill
  followers: number;
};

/** score = round(60·repaidPct/100 + 40·clamp(0.5 + followerPnlPct/100, 0, 1)); null when nothing is realized yet. */
export function leaderboardRow(p: Persona, s: PersonaStats): LeaderboardRow {
  const face = s.loans.reduce((a, l) => a + l.faceRaw, 0n);
  const owed = s.loans.reduce((a, l) => a + (l.noteOutstandingRaw > l.faceRaw ? l.faceRaw : l.noteOutstandingRaw), 0n);
  const repaidPct = face > 0n ? Number(((face - owed) * 10_000n) / face) / 100 : 0;
  const done = s.loans.map((l) => l.daysToRepay).filter((d): d is number => d !== null);
  const spent = s.mirrors.reduce((a, m) => a + m.spentUsdc, 0);
  const pnl = s.mirrors.reduce((a, m) => a + m.pnlUsd, 0);
  const pnlPct = spent > 0 ? (pnl / spent) * 100 : 0;
  const realized = s.loans.length > 0 || s.mirrors.length > 0;
  return {
    personaId: p.id, name: p.name, model: p.model,
    approvals: s.approvals, declines: s.declines, fundedLoans: s.loans.length,
    repaidPct,
    avgDaysToRepay: done.length ? done.reduce((a, d) => a + d, 0) / done.length : null,
    followerPnlUsd: Math.round(pnl * 100) / 100,
    followers: s.followers,
    score: realized ? Math.round(60 * (repaidPct / 100) + 40 * clamp(0.5 + pnlPct / 100, 0, 1)) : null,
  };
}

/** Highest score first; unscored ("no realized data yet") last, then by approvals. */
export const rankRows = <T extends { score: number | null; approvals: number }>(rows: T[]): T[] =>
  [...rows].sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.approvals - a.approvals);
