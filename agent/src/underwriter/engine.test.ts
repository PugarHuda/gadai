import { test } from "node:test";
import assert from "node:assert/strict";
import type { FeeInputs } from "@feedesk/shared";
import { Q96 } from "@feedesk/shared";
import { analyzeRate, beneficiaryFactor, computeTerms, cv, parseMemo, slope } from "./engine.ts";

const inputs = (daily: number[], o: Partial<FeeInputs> = {}): FeeInputs => ({
  token: "0x5f980dcfc4c0fa3911554cf5ab288ed0eb13dba3", symbol: "T", name: "T",
  poolId: "0xec33256bf1ded407a57fd3c1965e7556e42ac14db09bc4e6fef57d5e2eb0b0b9",
  feesManager: "0xD59cE43E53D69F190E15d9822Fb4540dCcc91178", sharePct: 57,
  numeraire: "0x4200000000000000000000000000000000000006", tokenIsToken0: false,
  claimableWethRaw: "0", claimableTokenRaw: "0",
  weth30d: daily.reduce((a, b) => a + b, 0), wethLifetime: 100, lifetimeDays: 100,
  dailyWeth: daily.map((weth, i) => ({ date: `d${i}`, weth })), ethUsd: 4000, ...o,
});
const flat = (v: number) => Array(30).fill(v) as number[];

test("helpers: slope, cv, beneficiaryFactor", () => {
  assert.equal(slope([1, 2, 3, 4]), 1);
  assert.equal(slope([5, 5, 5]), 0);
  assert.equal(cv([2, 2, 2]), 0);
  assert.equal(cv([0, 0]), Infinity);
  assert.ok(Math.abs(cv([0, 2]) - 1) < 1e-12);
  assert.equal(beneficiaryFactor(2.5725, 2.5728, 0, 57), 1); // series already the beneficiary's share
  assert.equal(beneficiaryFactor(108.17, 5.2, 0.1, 57), 0.57); // pool-level history → scale by share
  assert.equal(beneficiaryFactor(1, 0, 0, 95), 0.95);
});

test("rate = min(r7, r30, lifetime); claimable counts in recent windows", () => {
  const a = analyzeRate(flat(1), 0, 1000, 100); // lifetime 10/day is not binding
  assert.equal(a.r7, 1);
  assert.equal(a.r30, 1);
  assert.equal(a.rate, 1);
  const b = analyzeRate(flat(1), 3, 10, 100); // lifetime (10+3)/100 binds
  assert.ok(Math.abs(b.rate - 0.13) < 1e-12);
  assert.ok(Math.abs(b.r7 - 10 / 7) < 1e-12);
});

test("decay: a falling series is haircut by the 30d slope over the horizon", () => {
  const falling = Array.from({ length: 30 }, (_, i) => 2 - i * (2 / 29)); // 2 → 0
  const a = analyzeRate(falling, 0, 1e9, 1);
  assert.ok(a.slope < 0);
  assert.ok(a.r7 < a.r30);
  assert.equal(a.rate, a.r7);
  assert.ok(a.rateUsed < a.rate); // projected below the 7d rate
  assert.ok(a.rateUsed >= 0);
  const rising = analyzeRate([...falling].reverse(), 0, 1e9, 1);
  assert.equal(rising.rateUsed, rising.rate); // no bonus for a rising trend
});

test("terms: limit = 30% × rate × $ETH × 14d, capped by desk max", () => {
  // 0.01 WETH/day × $4000 = $40/day → 30% × 40 × 14 = $168
  const r = computeTerms(inputs(flat(0.01)), 30, 250);
  assert.ok(!("error" in r));
  assert.equal(r.terms.maxPrincipalRaw, "168000000");
  assert.equal(r.terms.principalRaw, "168000000");
  // flat series → cv 0 → 5% fee → floor 0.95 (floor(100/1.05)=95)
  assert.equal(r.terms.floorPrice, 0.95);
  assert.equal(BigInt(r.terms.floorPriceQ96) % BigInt(r.terms.tickSpacingQ96), 0n); // on the CCA grid
  assert.equal(r.terms.floorPriceQ96, (95n * (Q96 / 100n)).toString());
  const face = BigInt(r.terms.faceValueRaw);
  assert.equal(face, 176842106n); // ceil(168e6 / 0.95)
  assert.ok((face * 95n) / 100n >= 168_000_000n); // selling all notes at floor raises ≥ principal
  assert.equal(r.terms.drawLimitRaw, "16800000"); // 10% of principal
  assert.ok(Math.abs(r.terms.termDays - 176.842106 / 40) < 0.01);

  const capped = computeTerms(inputs(flat(1)), 30, 250);
  assert.ok(!("error" in capped));
  assert.equal(capped.terms.maxPrincipalRaw, "250000000");
  assert.equal(capped.terms.drawLimitRaw, "25000000");
  const big = computeTerms(inputs(flat(1)), 30, 10_000);
  assert.ok(!("error" in big));
  assert.equal(big.terms.drawLimitRaw, "50000000"); // draw limit caps at $50
});

test("pricing: lumpy fees raise the fee toward 15%", () => {
  const lumpy = flat(0);
  lumpy[26] = 3; // one big day in 30 (inside the 7d window, so no decay haircut) → cv = sqrt(29) ≈ 5.39 → min(1, cv/3) = 1
  const r = computeTerms(inputs(lumpy, { claimableWethRaw: (10n ** 17n).toString() }), 30, 250);
  assert.ok(!("error" in r));
  assert.equal(r.terms.floorPrice, 0.86); // floor(100/1.15) = 86
  assert.ok(r.terms.feeRatePct >= 15);
});

test("principal override may only lower the cap; tiny limits are rejected", () => {
  const lower = computeTerms(inputs(flat(0.01)), 30, 250, 50.123);
  assert.ok(!("error" in lower));
  assert.equal(lower.terms.principalRaw, "50120000");
  assert.equal(lower.terms.maxPrincipalRaw, "168000000");
  assert.throws(() => computeTerms(inputs(flat(0.01)), 30, 250, 200), /exceeds engine cap/);
  const dust = computeTerms(inputs(flat(0.00001)), 30, 250);
  assert.ok("error" in dust);
  const zero = computeTerms(inputs(flat(0)), 30, 250);
  assert.ok("error" in zero);
  assert.equal(zero.analysis.rateUsed, 0);
});

test("memo parsing fails closed", () => {
  const ok = parseMemo('```json\n{"decision":"approve","principalUsdc":100,"maxNotePrice":0.97,"confidence":0.8,"rationale":"steady fees","risks":["decay"]}\n```', 168, 0.95);
  assert.equal(ok.principalUsdc, 100);
  assert.equal(ok.maxNotePrice, 0.97);
  const dec = parseMemo('{"decision":"decline","principalUsdc":0,"maxNotePrice":0,"confidence":0.9,"rationale":"too thin","risks":[]}', 168, 0.95);
  assert.equal(dec.decision, "decline");
  assert.equal(dec.principalUsdc, 0);
  const bad = (s: string) => assert.throws(() => parseMemo(s, 168, 0.95));
  bad("no json here");
  bad('{"decision":"approve","principalUsdc":169,"maxNotePrice":0.97,"confidence":0.8,"rationale":"x","risks":[]}'); // above cap
  bad('{"decision":"approve","principalUsdc":100,"maxNotePrice":0.9,"confidence":0.8,"rationale":"x","risks":[]}'); // below floor
  bad('{"decision":"approve","principalUsdc":100,"maxNotePrice":1.01,"confidence":0.8,"rationale":"x","risks":[]}');
  bad('{"decision":"maybe","principalUsdc":100,"maxNotePrice":0.97,"confidence":0.8,"rationale":"x","risks":[]}');
  bad('{"decision":"approve","principalUsdc":"100","maxNotePrice":0.97,"confidence":0.8,"rationale":"x","risks":[]}');
  bad('{"decision":"approve","principalUsdc":100,"maxNotePrice":0.97,"confidence":1.5,"rationale":"x","risks":[]}');
});

test("rOwn: claim-timed windows are capped by the beneficiary's own lifetime rate (live GITLAWB shape)", () => {
  // Live 2026-09-18: 30d dailyEarnings nonzero only on the 3 claim dates; own claimed 5.206226 + claimable 0.1068 over 250d.
  const daily = flat(0);
  daily[13] = 2.6334; daily[27] = 2.1565; daily[29] = 0.416315;
  const own = 5.206226 + 0.1068;
  const a = analyzeRate(daily.map((x) => x * 0.57), 0.1068, 108.1737 * 0.57, 250, own);
  assert.ok(Math.abs(a.rOwn - own / 250) < 1e-12);
  assert.equal(a.rate, a.rOwn); // ~0.0213 WETH/day, not the claim-timed r30 (~0.1)
  assert.ok(a.r30 > 4 * a.rOwn);
  // claiming inside the window does not move the rate: X leaves claimable and lands in today's bucket
  const claimed = [...daily]; claimed[29]! += 0.1068;
  const b = analyzeRate(claimed.map((x) => x * 0.57), 0, 108.1737 * 0.57, 250, own);
  assert.equal(b.rate, a.rate);
});
