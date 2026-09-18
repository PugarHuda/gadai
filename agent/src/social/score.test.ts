import { test } from "node:test";
import assert from "node:assert/strict";
import type { Persona } from "@feedesk/shared";
import { leaderboardRow, mirrorPnl, noteOutstanding, rankRows } from "./score.ts";

const P: Persona = { id: "prudent", name: "Prudent", model: "m", advanceRatePct: 30, style: "" };
const base = { approvals: 3, declines: 1, followers: 2, loans: [], mirrors: [] };

test("no realized data -> score null", () => {
  const r = leaderboardRow(P, base);
  assert.equal(r.score, null);
  assert.equal(r.repaidPct, 0);
  assert.equal(r.avgDaysToRepay, null);
});

test("fully repaid loans, no fills -> 60 + 40*0.5 = 80", () => {
  const r = leaderboardRow(P, { ...base, loans: [
    { loanId: 1, faceRaw: 110_000_000n, noteOutstandingRaw: 0n, daysToRepay: 10 },
    { loanId: 2, faceRaw: 55_000_000n, noteOutstandingRaw: 0n, daysToRepay: 20 },
  ] });
  assert.equal(r.repaidPct, 100);
  assert.equal(r.score, 80);
  assert.equal(r.avgDaysToRepay, 15);
  assert.equal(r.fundedLoans, 2);
});

test("partial repayment is face-weighted", () => {
  const r = leaderboardRow(P, { ...base, loans: [
    { loanId: 1, faceRaw: 100n, noteOutstandingRaw: 100n, daysToRepay: null }, // 0 repaid
    { loanId: 2, faceRaw: 300n, noteOutstandingRaw: 0n, daysToRepay: 5 }, // all repaid
  ] });
  assert.equal(r.repaidPct, 75);
  assert.equal(r.score, Math.round(60 * 0.75 + 20)); // 65
});

test("follower pnl moves the 40-point leg and clamps", () => {
  const loans = [{ loanId: 1, faceRaw: 100n, noteOutstandingRaw: 0n, daysToRepay: 1 }];
  assert.equal(leaderboardRow(P, { ...base, loans, mirrors: [{ spentUsdc: 10, pnlUsd: 5 }] }).score, 60 + 40); // +50% -> clamp 1
  assert.equal(leaderboardRow(P, { ...base, loans, mirrors: [{ spentUsdc: 10, pnlUsd: -2.5 }] }).score, 60 + 10); // -25% -> 0.25
  assert.equal(leaderboardRow(P, { ...base, loans, mirrors: [{ spentUsdc: 10, pnlUsd: -20 }] }).score, 60); // clamp 0
  const onlyFills = leaderboardRow(P, { ...base, mirrors: [{ spentUsdc: 20, pnlUsd: 2 }] });
  assert.equal(onlyFills.score, Math.round(40 * 0.6)); // 24, no funded loans
  assert.equal(onlyFills.followerPnlUsd, 2);
});

test("outstanding above face is capped (never negative repaid)", () => {
  const r = leaderboardRow(P, { ...base, loans: [{ loanId: 1, faceRaw: 100n, noteOutstandingRaw: 500n, daysToRepay: null }] });
  assert.equal(r.repaidPct, 0);
});

test("noteOutstanding strips junior draw debt", () => {
  assert.equal(noteOutstanding(150n, 50n), 100n);
  assert.equal(noteOutstanding(30n, 50n), 0n); // vault USDC already covers notes
  assert.equal(noteOutstanding(0n, 0n), 0n);
});

test("mirrorPnl: marked holdings + bracket exit - spent", () => {
  assert.equal(mirrorPnl({ spentUsdc: 5, boughtTokens: 200_000, soldTokens: 0, exitUsdc: 0 }, 0.00003), 1);
  assert.equal(mirrorPnl({ spentUsdc: 5, boughtTokens: 200_000, soldTokens: 200_000, exitUsdc: 7.5 }, 0.00001), 2.5);
  assert.equal(mirrorPnl({ spentUsdc: 5, boughtTokens: 100, soldTokens: 150, exitUsdc: 4 }, 1), -1); // oversold clamps held to 0
});

test("rankRows: scored desc, nulls last", () => {
  const rows = rankRows([
    { id: "a", score: null, approvals: 9 },
    { id: "b", score: 40, approvals: 0 },
    { id: "c", score: 80, approvals: 0 },
    { id: "d", score: null, approvals: 1 },
  ]);
  assert.deepEqual(rows.map((r) => r.id), ["c", "b", "a", "d"]);
});
