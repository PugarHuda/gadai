// Deterministic underwriting math (pure, no I/O). Tested in engine.test.ts.
import type { FeeInputs, Terms } from "@feedesk/shared";
import { Q96 } from "@feedesk/shared";

export const HORIZON_DAYS = 14; // principal = advanceRate × run-rate × 14d
export const MIN_HISTORY_DAYS = 7;

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

/**
 * Bankr `dailyEarnings` semantics check (COORDINATION open Q). If the all-time series sums to what this
 * beneficiary has claimed + can claim (±5%), it is already the beneficiary's share → factor 1.
 * Otherwise it is pool-level (or includes other beneficiaries) → scale by the API `share`. Conservative either way.
 */
export function beneficiaryFactor(allTimeSumWeth: number, claimedWeth: number, claimableWeth: number, sharePct: number): number {
  const own = claimedWeth + claimableWeth;
  if (own > 0 && Math.abs(allTimeSumWeth - own) <= 0.05 * own) return 1;
  return sharePct / 100;
}

/** Least-squares slope of y over x = 0..n-1 (WETH/day per day). */
export function slope(y: number[]): number {
  const n = y.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2, my = sum(y) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) (num += (i - mx) * (y[i]! - my)), (den += (i - mx) ** 2);
  return num / den;
}

/** Coefficient of variation (population stdev / mean). Infinity if mean is 0. */
export function cv(y: number[]): number {
  const m = sum(y) / (y.length || 1);
  if (m <= 0) return Infinity;
  return Math.sqrt(sum(y.map((v) => (v - m) ** 2)) / y.length) / m;
}

export type RateAnalysis = { r7: number; r30: number; rLife: number; rOwn: number; slope: number; rate: number; projected: number; rateUsed: number; cv: number };

/**
 * daily = last 30 days of Bankr dailyEarnings (oldest first). Live data shows these are CLAIM events, so r7/r30/slope/cv
 * depend on claim timing. Adding claimable to each window makes them invariant to a claim made inside the window
 * (collectFees moves X from claimable into today's bucket). rOwn = own (claimed + claimable) / ageDays caps the
 * claim-timed windows with the beneficiary's own lifetime rate, which no claim timing can move.
 */
export function analyzeRate(daily: number[], claimableWeth: number, lifetimeWeth: number, ageDays: number, ownWeth = Infinity): RateAnalysis {
  const d30 = daily.slice(-30), d7 = daily.slice(-7);
  const r7 = (sum(d7) + claimableWeth) / 7;
  const r30 = (sum(d30) + claimableWeth) / 30;
  const rLife = (lifetimeWeth + claimableWeth) / Math.max(ageDays, 1);
  const rOwn = ownWeth / Math.max(ageDays, 1);
  const rate = Math.min(r7, r30, rLife, rOwn); // decay-aware: the lowest run-rate wins
  const s = slope(d30);
  const projected = Math.max(0, rate + Math.min(0, s) * (HORIZON_DAYS / 2)); // average over the horizon if fees keep decaying linearly
  return { r7, r30, rLife, rOwn, slope: s, rate, projected, rateUsed: Math.min(rate, projected), cv: cv(d30) };
}

export type TermsResult = { terms: Terms; analysis: RateAnalysis; usdPerDay: number; formula: string };

/**
 * Terms for one persona. principalUsdc (from an LLM memo) may only lower the engine cap, never raise it.
 * Returns null terms reason when the cap rounds below $1.
 */
export function computeTerms(inp: FeeInputs, advanceRatePct: number, capUsdc: number, principalUsdc?: number): TermsResult | { error: string; analysis: RateAnalysis; formula: string } {
  const claimable = Number(BigInt(inp.claimableWethRaw)) / 1e18;
  const daily = inp.dailyWeth.map((d) => d.weth);
  const a = analyzeRate(daily, claimable, inp.wethLifetime, inp.lifetimeDays, inp.wethOwn);
  const usdPerDay = a.rateUsed * inp.ethUsd;
  const maxUsdc = Math.min(capUsdc, (advanceRatePct / 100) * usdPerDay * HORIZON_DAYS);
  const maxCents = Math.floor(maxUsdc * 100 + 1e-9);
  const f = (n: number, d = 6) => Number(n.toFixed(d));
  const rateLine =
    `r7=(Σ7d ${f(sum(daily.slice(-7)))} + claimable ${f(claimable)})/7=${f(a.r7)} · r30=(Σ30d ${f(sum(daily.slice(-30)))} + claimable)/30=${f(a.r30)} · ` +
    `rLife=(lifetime ${f(inp.wethLifetime)} + claimable)/${inp.lifetimeDays}d=${f(a.rLife)} · ` +
    `rOwn=(own claimed+claimable ${inp.wethOwn === undefined ? "n/a" : f(inp.wethOwn)})/${inp.lifetimeDays}d=${Number.isFinite(a.rOwn) ? f(a.rOwn) : "n/a"} WETH/day → rate=min=${f(a.rate)} ` +
    `(dailyEarnings are claim events: slope/cv are claim-timed); ` +
    `slope30d=${f(a.slope, 8)} → projected over ${HORIZON_DAYS}d=${f(a.projected)} → used ${f(a.rateUsed)} WETH/day × ETH $${f(inp.ethUsd, 2)} = $${f(usdPerDay, 2)}/day; ` +
    `maxPrincipal=min(cap $${capUsdc}, ${advanceRatePct}% × $${f(usdPerDay, 2)} × ${HORIZON_DAYS}d)=$${(maxCents / 100).toFixed(2)}`;
  if (maxCents < 100) return { error: `max principal $${(maxCents / 100).toFixed(2)} is below $1`, analysis: a, formula: rateLine };

  const cents = principalUsdc === undefined ? maxCents : Math.floor(principalUsdc * 100 + 1e-9);
  if (cents > maxCents) throw new Error(`principal $${principalUsdc} exceeds engine cap $${(maxCents / 100).toFixed(2)}`);
  if (cents < 100) return { error: `principal $${(cents / 100).toFixed(2)} is below $1`, analysis: a, formula: rateLine };

  const feeRateNominal = 5 + 10 * Math.min(1, a.cv / 3); // Infinity cv (no fees) → 15%
  // Floor on the 0.01 CCA tick grid, rounded DOWN; face rounded UP so floor × face ≥ principal (auction can graduate at floor).
  const floorCents = Math.floor(100 / (1 + feeRateNominal / 100) + 1e-9);
  const principalRaw = BigInt(cents) * 10_000n;
  // ceil against the ON-CHAIN floor (floorCents × ⌊Q96/100⌋ is a hair under floorCents/100): FeeVault.startAuction requires
  // floorPriceQ96 × face ≥ principal × Q96, and a principal that divides evenly (e.g. 236.50 / 0.86 = 275) would miss it by 1 wei.
  const floorQ96 = BigInt(floorCents) * (Q96 / 100n);
  const faceRaw = (principalRaw * Q96 + floorQ96 - 1n) / floorQ96;
  const face = Number(faceRaw) / 1e6;
  const principal = cents / 100;
  const feeRatePct = f((face / principal - 1) * 100, 2);
  const drawCents = Math.min(Math.floor(cents / 10), 5000);
  const termDays = f(face / usdPerDay, 2);
  const terms: Terms = {
    principalRaw: principalRaw.toString(),
    faceValueRaw: faceRaw.toString(),
    feeRatePct,
    floorPrice: floorCents / 100,
    floorPriceQ96: floorQ96.toString(), // CCA grid: price % tickSpacing == 0 (cca TICK_Q96)
    tickSpacingQ96: (Q96 / 100n).toString(),
    termDays,
    drawLimitRaw: (BigInt(drawCents) * 10_000n).toString(),
    advanceRatePct,
    maxPrincipalRaw: (BigInt(maxCents) * 10_000n).toString(),
  };
  const formula =
    `${rateLine}; principal=$${principal.toFixed(2)}; cv30d=${Number.isFinite(a.cv) ? f(a.cv, 3) : "∞"} → fee=5+10·min(1,cv/3)=${f(feeRateNominal, 2)}% → ` +
    `floorPrice=${floorCents / 100} USDC/note (0.01 grid, rounded down) → face=ceil(principal/floor)=$${face.toFixed(6)} (effective fee ${feeRatePct}%); ` +
    `termDays=face/usdPerDay=${termDays}; drawLimit=min(10%·principal, $50)=$${(drawCents / 100).toFixed(2)}`;
  return { terms, analysis: a, usdPerDay, formula };
}

// ─── LLM memo validation (fail closed) ───
export type ParsedMemo = { decision: "approve" | "decline"; principalUsdc: number; maxNotePrice: number; confidence: number; rationale: string; risks: string[] };

/** Extracts the JSON object from an LLM reply and validates it against the engine bounds. Throws on anything off-spec. */
export function parseMemo(text: string, maxPrincipalUsdc: number, floorPrice: number): ParsedMemo {
  const i = text.indexOf("{"), j = text.lastIndexOf("}");
  if (i < 0 || j <= i) throw new Error("memo: no JSON object in reply");
  const o = JSON.parse(text.slice(i, j + 1)) as Record<string, unknown>;
  const num = (k: string) => {
    const v = o[k];
    if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`memo: ${k} must be a finite number`);
    return v;
  };
  if (o.decision !== "approve" && o.decision !== "decline") throw new Error(`memo: decision must be approve|decline, got ${String(o.decision)}`);
  if (typeof o.rationale !== "string" || !o.rationale.trim()) throw new Error("memo: rationale must be a non-empty string");
  if (!Array.isArray(o.risks) || !o.risks.every((r) => typeof r === "string")) throw new Error("memo: risks must be string[]");
  const confidence = num("confidence");
  if (confidence < 0 || confidence > 1) throw new Error(`memo: confidence ${confidence} outside 0..1`);
  const base = { decision: o.decision, confidence, rationale: o.rationale.trim(), risks: o.risks as string[] } as const;
  if (o.decision === "decline") return { ...base, principalUsdc: 0, maxNotePrice: 0 };
  const principalUsdc = num("principalUsdc"), maxNotePrice = num("maxNotePrice");
  if (principalUsdc < 1 || principalUsdc > maxPrincipalUsdc + 1e-9) throw new Error(`memo: principalUsdc ${principalUsdc} outside [1, ${maxPrincipalUsdc}]`);
  if (maxNotePrice < floorPrice - 1e-9 || maxNotePrice > 1) throw new Error(`memo: maxNotePrice ${maxNotePrice} outside [${floorPrice}, 1]`);
  return { ...base, principalUsdc, maxNotePrice };
}

// ─── rules-only persona memos (Bankr LLM out of credits AND UNDERWRITER_ENGINE_ONLY=1) ───
// Each persona's `style` as a deterministic rule set over the engine analysis. These are NOT LLM output: the memo
// model is labeled RULES_MODEL and the rationale names the rule that fired with its numbers.
export const RULES_MODEL = "rules (Bankr LLM unavailable)";
/** True when an LLM wrote the memo (not the rules fallback, nor the legacy "engine-only" label). */
export const writtenByLlm = (m: { model: string }) => m.model !== RULES_MODEL && !m.model.startsWith("engine-only");
/** Prudent declines when the 30d claim series is one lump: cv of 30 days maxes at √29 ≈ 5.39 (all fees on one day). */
export const PRUDENT_MAX_CV = 5;
/** Skeptic declines history shorter than this. */
export const SKEPTIC_MIN_HISTORY_DAYS = 30;
const RULES_CONFIDENCE = 0.5; // no model judgement behind it: neither confident nor doubtful

/**
 * r = computeTerms(inp, advanceRatePct, capUsdc) for this persona (its max principal at its advance rate).
 * - prudent:  approve at the engine terms unless cv30d is non-finite (no 30d fees) or ≥ PRUDENT_MAX_CV.
 * - momentum: decline when fees are decaying (slope30d < 0 AND r7 < r30), else approve at the engine terms.
 * - skeptic:  assume fees halve → principal = min(cap, advance × usdPerDay/2 × 14d); decline if history < 30d or that < $1.
 * Unknown persona ids throw (fail closed).
 */
export function ruleMemo(personaId: string, inp: FeeInputs, r: TermsResult, advanceRatePct: number, capUsdc: number): ParsedMemo {
  const a = r.analysis, max = Number(r.terms.maxPrincipalRaw) / 1e6, floor = r.terms.floorPrice;
  const f = (n: number, d = 6) => (Number.isFinite(n) ? Number(n.toFixed(d)) : "∞");
  const nums = `r7=${f(a.r7)} r30=${f(a.r30)} rLife=${f(a.rLife)} WETH/day, slope30d=${f(a.slope, 8)}, cv30d=${f(a.cv, 3)}, ` +
    `history ${inp.lifetimeDays}d, $${f(r.usdPerDay, 2)}/day, maxPrincipal $${max.toFixed(2)}`;
  const approve = (principalUsdc: number, rule: string, risks: string[]): ParsedMemo =>
    ({ decision: "approve", principalUsdc, maxNotePrice: floor, confidence: RULES_CONFIDENCE, rationale: `${rule}. ${nums}.`, risks: ["no LLM review", ...risks] });
  const decline = (rule: string, risks: string[]): ParsedMemo =>
    ({ decision: "decline", principalUsdc: 0, maxNotePrice: 0, confidence: RULES_CONFIDENCE, rationale: `${rule}. ${nums}.`, risks: ["no LLM review", ...risks] });

  switch (personaId) {
    case "prudent":
      if (!Number.isFinite(a.cv) || a.cv >= PRUDENT_MAX_CV)
        return decline(`Rule prudent/extreme-cv fired: cv30d ${f(a.cv, 3)} ≥ ${PRUDENT_MAX_CV} (30d fees are one lump or none)`, ["fee stream too lumpy to underwrite"]);
      return approve(max, `Rule prudent/approve fired: cv30d ${f(a.cv, 3)} < ${PRUDENT_MAX_CV}, approving the engine terms at ${advanceRatePct}% advance`, ["claim-timed fee history"]);
    case "momentum":
      if (a.slope < 0 && a.r7 < a.r30)
        return decline(`Rule momentum/decay fired: slope30d ${f(a.slope, 8)} < 0 and r7 ${f(a.r7)} < r30 ${f(a.r30)}`, ["fee volume decaying"]);
      return approve(max, `Rule momentum/approve fired: no decay (slope30d ${f(a.slope, 8)}, r7 ${f(a.r7)} vs r30 ${f(a.r30)}), approving at ${advanceRatePct}% advance`, ["momentum can reverse"]);
    case "skeptic": {
      if (inp.lifetimeDays < SKEPTIC_MIN_HISTORY_DAYS)
        return decline(`Rule skeptic/thin-history fired: history ${inp.lifetimeDays}d < ${SKEPTIC_MIN_HISTORY_DAYS}d`, ["thin fee history"]);
      const halved = Math.floor(Math.min(capUsdc, max, (advanceRatePct / 100) * (r.usdPerDay / 2) * HORIZON_DAYS) * 100 + 1e-9) / 100;
      if (halved < 1)
        return decline(`Rule skeptic/halved-too-small fired: at half the fee rate ($${f(r.usdPerDay / 2, 2)}/day) principal is $${halved.toFixed(2)} < $1`, ["fees halve"]);
      return approve(halved, `Rule skeptic/halved fired: assuming fees halve to $${f(r.usdPerDay / 2, 2)}/day, principal = ${advanceRatePct}% × that × ${HORIZON_DAYS}d = $${halved.toFixed(2)}`, ["fees halve"]);
    }
    default:
      throw new Error(`ruleMemo: no rule set for persona ${personaId}`);
  }
}

// ─── ERC-8004 repayment reputation (what THIS desk said about the borrower's agent). It may only LOWER a line. ───
export type Reputation = { agentId: string; count: number; summaryValue: string; summaryValueDecimals: number };
/** Multiplier on every approved principal: count 0 (no history with us) = 1; else average feedback / 100, clamped to [0, 1]
 *  (100 = every loan repaid). 0 means decline. Never above 1: reputation can't raise a limit. */
export function reputationFactor(r: Reputation | null): { factor: number; note: string } {
  if (!r || r.count === 0) return { factor: 1, note: r ? `ERC-8004 agent #${r.agentId}: no Gadai feedback yet → no change` : "" };
  const avg = Number(r.summaryValue) / 10 ** r.summaryValueDecimals;
  const factor = Math.min(1, Math.max(0, avg / 100));
  return { factor, note: `ERC-8004 agent #${r.agentId}: ${r.count} Gadai feedback, avg ${avg} → principal ×${Number(factor.toFixed(4))}` };
}
