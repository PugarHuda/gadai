import { test } from "node:test";
import assert from "node:assert/strict";
import type { FeeInputs } from "@feedesk/shared";
import { Q96 } from "@feedesk/shared";
import { analyzeRate, beneficiaryFactor, computeTerms, cv, parseMemo, PRUDENT_MAX_CV, ruleMemo, slope, writtenByLlm, RULES_MODEL, type TermsResult } from "./engine.ts";

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

// ─── rules-only persona memos ───
const terms = (inp: FeeInputs, adv: number, cap = 250) => {
  const r = computeTerms(inp, adv, cap);
  assert.ok(!("error" in r), "fixture must produce terms");
  return r as TermsResult;
};
const rule = (id: string, inp: FeeInputs, adv: number, cap = 250) => {
  const r = terms(inp, adv, cap);
  const m = ruleMemo(id, inp, r, adv, cap);
  // every rule memo passes the same fail-closed validation as an LLM reply
  assert.deepEqual(parseMemo(JSON.stringify(m), Number(r.terms.maxPrincipalRaw) / 1e6, r.terms.floorPrice), m);
  return m;
};

test("rules/prudent: approves the engine terms; declines an extreme cv30d", () => {
  const ok = rule("prudent", inputs(flat(0.01)), 30); // $40/day → 30% × 40 × 14 = $168, cv 0
  assert.equal(ok.decision, "approve");
  assert.equal(ok.principalUsdc, 168);
  assert.equal(ok.maxNotePrice, 0.95);
  assert.match(ok.rationale, /prudent\/approve.*cv30d 0 < 5/);
  const lumpy = flat(0);
  lumpy[26] = 3; // cv = √29 ≈ 5.39
  const no = rule("prudent", inputs(lumpy, { claimableWethRaw: (10n ** 17n).toString() }), 30);
  assert.equal(no.decision, "decline");
  assert.equal(no.principalUsdc, 0);
  assert.match(no.rationale, new RegExp(`prudent/extreme-cv fired: cv30d 5\.385 ≥ ${PRUDENT_MAX_CV}`));
});

test("rules/momentum: declines decay (slope<0 and r7<r30), approves otherwise", () => {
  const falling = Array.from({ length: 30 }, (_, i) => 3 - i * (2 / 29)); // 3 → 1 WETH/day
  const inp = (d: number[]) => inputs(d, { wethLifetime: 1e9, lifetimeDays: 1 });
  const no = rule("momentum", inp(falling), 45);
  assert.equal(no.decision, "decline");
  assert.match(no.rationale, /momentum\/decay fired: slope30d -0\.0689\d* < 0 and r7 1\.\d+ < r30 2/);
  const up = rule("momentum", inp([...falling].reverse()), 45);
  assert.equal(up.decision, "approve");
  assert.equal(up.principalUsdc, 250); // capped
  const flatOk = rule("momentum", inputs(flat(0.01)), 45); // slope 0 is not decay
  assert.equal(flatOk.decision, "approve");
  assert.equal(flatOk.principalUsdc, 250); // 45% × 40 × 14 = $252, capped at $250
});

test("rules/skeptic: halves the fee rate; declines thin history or a sub-$1 halved principal", () => {
  const ok = rule("skeptic", inputs(flat(0.01)), 20); // full: 20% × 40 × 14 = $112 → halved $56
  assert.equal(ok.decision, "approve");
  assert.equal(ok.principalUsdc, 56);
  assert.match(ok.rationale, /skeptic\/halved fired: .*\$20\/day.*\$56\.00/);
  const thin = rule("skeptic", inputs(flat(0.01), { lifetimeDays: 29 }), 20);
  assert.equal(thin.decision, "decline");
  assert.match(thin.rationale, /thin-history fired: history 29d < 30d/);
  const dust = rule("skeptic", inputs(flat(0.000125)), 20); // $0.50/day: full max $1.40, halved $0.70
  assert.equal(dust.decision, "decline");
  assert.match(dust.rationale, /halved-too-small fired: .*\$0\.70 < \$1/);
  // halving is applied before the cap: a big stream still approves at most the cap
  assert.equal(rule("skeptic", inputs(flat(1)), 20).principalUsdc, 250);
});

test("rules: unknown persona fails closed; rules memos are never counted as LLM-written", () => {
  assert.throws(() => ruleMemo("yolo", inputs(flat(0.01)), terms(inputs(flat(0.01)), 30), 30, 250), /no rule set/);
  assert.equal(writtenByLlm({ model: RULES_MODEL }), false);
  assert.equal(writtenByLlm({ model: "engine-only (Bankr LLM unavailable)" }), false);
  assert.equal(writtenByLlm({ model: "claude-sonnet-4.6" }), true);
});

test("reputationFactor: only lowers; no feedback = no change; 0 = decline", async () => {
  const { reputationFactor } = await import("./engine.ts");
  const rep = (count: number, v: string, d = 0) => ({ agentId: "7", count, summaryValue: v, summaryValueDecimals: d });
  assert.equal(reputationFactor(null).factor, 1);
  assert.equal(reputationFactor(rep(0, "0")).factor, 1);
  assert.equal(reputationFactor(rep(3, "100")).factor, 1);
  assert.equal(reputationFactor(rep(3, "150")).factor, 1); // never raises
  assert.equal(reputationFactor(rep(2, "5000", 2)).factor, 0.5); // avg 50.00
  assert.equal(reputationFactor(rep(1, "-20")).factor, 0);
  assert.match(reputationFactor(rep(2, "5000", 2)).note, /avg 50 → principal ×0\.5/);
});

test("terms: floorPriceQ96 × face ≥ principal × Q96 even when principal / floor divides evenly (FeeVault.startAuction check)", () => {
  // 236.50 / 0.86 = 275 exactly; the Q96 floor is a hair under 0.86, so face must round up by 1 raw unit
  for (const usd of [95, 190, 9.5, 236.5, 86, 1.9]) {
    const r = computeTerms(inputs(flat(1)), 30, 250, usd) as TermsResult;
    assert.ok(!("error" in r));
    assert.ok(BigInt(r.terms.floorPriceQ96) * BigInt(r.terms.faceValueRaw) >= BigInt(r.terms.principalRaw) * Q96, `${usd}: ${JSON.stringify(r.terms)}`);
  }
});
