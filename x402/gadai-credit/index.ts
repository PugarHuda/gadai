/**
 * gadai-credit — paid x402 credit report for any Bankr Doppler token on Base.
 *
 * Live data: Bankr public API GET /public/doppler/token-fees/{token}?days=30 (no key) + Coinbase ETH-USD spot, CoinGecko fallback (no keys).
 * Math: the Gadai underwriting engine (lead persona "prudent", 30% advance, $250 cap), same inputs as
 * agent/src/board/index.ts buildRow(). No on-chain reads: claimable comes from the Bankr API, so this is a
 * pre-approval report, not a binding quote (the agent re-checks claimable-fees + open vault at apply time).
 *
 * Self-contained on purpose: x402 Cloud bundles one handler, no workspace imports.
 */

type Address = `0x${string}`;

// ─── from shared/src/index.ts (Q96, FeeInputs, Terms) ───
const Q96 = 2n ** 96n;
const WETH = "0x4200000000000000000000000000000000000006";
type FeeInputs = {
  token: Address; symbol: string; name: string; poolId: string; feesManager: Address; sharePct: number; numeraire: Address;
  tokenIsToken0: boolean; claimableWethRaw: string; claimableTokenRaw: string; weth30d: number; wethLifetime: number;
  wethOwn?: number; lifetimeDays: number; dailyWeth: { date: string; weth: number }[]; ethUsd: number;
};
type Terms = {
  principalRaw: string; faceValueRaw: string; feeRatePct: number; floorPrice: number; floorPriceQ96: string; tickSpacingQ96: string;
  termDays: number; drawLimitRaw: string; advanceRatePct: number; maxPrincipalRaw: string;
};

// ════════ VERBATIM COPY: agent/src/underwriter/engine.ts lines 5-112 @ commit 81d9712c3537f3896cfd90e717d59ec8343ee81f ════════
// (only `export` keywords and doc comments dropped). Keep in sync: any change there must be copied here.
const HORIZON_DAYS = 14; // principal = advanceRate × run-rate × 14d
const MIN_HISTORY_DAYS = 7;

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

function beneficiaryFactor(allTimeSumWeth: number, claimedWeth: number, claimableWeth: number, sharePct: number): number {
  const own = claimedWeth + claimableWeth;
  if (own > 0 && Math.abs(allTimeSumWeth - own) <= 0.05 * own) return 1;
  return sharePct / 100;
}

function slope(y: number[]): number {
  const n = y.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2, my = sum(y) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) (num += (i - mx) * (y[i]! - my)), (den += (i - mx) ** 2);
  return num / den;
}

function cv(y: number[]): number {
  const m = sum(y) / (y.length || 1);
  if (m <= 0) return Infinity;
  return Math.sqrt(sum(y.map((v) => (v - m) ** 2)) / y.length) / m;
}

type RateAnalysis = { r7: number; r30: number; rLife: number; rOwn: number; slope: number; rate: number; projected: number; rateUsed: number; cv: number };

function analyzeRate(daily: number[], claimableWeth: number, lifetimeWeth: number, ageDays: number, ownWeth = Infinity): RateAnalysis {
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

type TermsResult = { terms: Terms; analysis: RateAnalysis; usdPerDay: number; formula: string };

function computeTerms(inp: FeeInputs, advanceRatePct: number, capUsdc: number, principalUsdc?: number): TermsResult | { error: string; analysis: RateAnalysis; formula: string } {
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
  const faceRaw = (principalRaw * 100n + BigInt(floorCents) - 1n) / BigInt(floorCents);
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
    floorPriceQ96: (BigInt(floorCents) * (Q96 / 100n)).toString(), // CCA grid: price % tickSpacing == 0 (cca TICK_Q96)
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
// ════════ END VERBATIM COPY ════════

// Desk parameters, same defaults as the agent: PERSONAS[0] "prudent" advance 30%, DESK_MAX_LOAN_USDC 250.
const ADVANCE_RATE_PCT = 30;
const CAP_USDC = 250;
const SOURCE = "Gadai underwriting engine, https://github.com/PugarHuda/gadai";
const BANKR = "https://api.bankr.bot";

type TokenEntry = {
  tokenAddress: Address; name: string; symbol: string; poolId: string; initializer: Address; feesContract?: Address;
  share: string; numeraire: Address; tokenIsToken0: boolean; claimable: { token0: string; token1: string }; source: string; chain: string;
};
type DailyWeth = { date: string; weth: string };
type TokenFees = {
  address: Address; tokens: TokenEntry[]; dailyEarnings: DailyWeth[]; allTimeDailyEarnings: DailyWeth[];
  lifetimeEarnedWeth: string; totals: { claimableWeth: string; claimedWeth: string };
};

/** Bankr fee APIs return "<0.000001" for dust: count as 0 (agent/src/bankr/index.ts dust()). */
const dust = (s: string) => (s.startsWith("<") ? "0" : s);
/** viem parseUnits(s, 18) for the API's plain decimal strings. */
const toWei = (s: string) => {
  const [i = "0", d = ""] = s.split(".");
  return (BigInt(i || "0") * 10n ** 18n + BigInt((d + "0".repeat(18)).slice(0, 18))).toString();
};
const lc = (s: string) => s.toLowerCase();
const r6 = (n: number) => Number(n.toFixed(6));
const isAddr = (s: string | null): s is Address => !!s && /^0x[0-9a-fA-F]{40}$/.test(s);
const bad = (status: number, error: string) => Response.json({ error, source: SOURCE }, { status });

async function getJson<T>(url: string): Promise<{ status: number; body: T | null }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { accept: "application/json" } });
  if (res.status === 404) return { status: 404, body: null };
  if (!res.ok) throw new Error(`${url.split("?")[0]} → HTTP ${res.status}`);
  return { status: res.status, body: (await res.json()) as T };
}

/** Keyless ETH/USD: Coinbase spot, CoinGecko if Coinbase is unreachable (some networks block exchange domains). */
async function ethUsdSpot(): Promise<{ px: number; src: string }> {
  const sources: [string, string, (b: any) => unknown][] = [
    ["Coinbase ETH-USD spot", "https://api.coinbase.com/v2/prices/ETH-USD/spot", (b) => b?.data?.amount],
    ["CoinGecko ethereum/usd", "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd", (b) => b?.ethereum?.usd],
  ];
  const errs: string[] = [];
  for (const [src, url, pick] of sources) {
    try {
      const px = Number(pick((await getJson<unknown>(url)).body));
      if (px > 0) return { px, src: `${src} (${url.split("?")[0]})` };
      errs.push(`${src}: no price`);
    } catch (e) { errs.push(`${src}: ${(e as Error).message}`); }
  }
  throw new Error(`ETH/USD unavailable (${errs.join("; ")})`);
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const borrower = url.searchParams.get("borrower");
  // 4xx → the x402 router does not settle the payment.
  if (!isAddr(token)) return bad(400, "query param `token` must be a 0x-prefixed 20-byte hex address");
  if (borrower !== null && borrower !== "" && !isAddr(borrower)) return bad(400, "query param `borrower` must be a 0x-prefixed 20-byte hex address");

  let fees: TokenFees | null, eth: { px: number; src: string };
  try {
    [{ body: fees }, eth] = await Promise.all([
      getJson<TokenFees>(`${BANKR}/public/doppler/token-fees/${lc(token)}?days=30`),
      ethUsdSpot(),
    ]);
  } catch (e) {
    return bad(502, `upstream: ${(e as Error).message}`); // 5xx → payment not settled
  }

  const report = {
    token: lc(token) as Address, symbol: null as string | null, beneficiary: null as Address | null, sharePct: null as number | null,
    history: null as null | { days: number; lifetimeWeth: number; claimableWeth: number; r7: number; r30: number; rLife: number; slope30d: number; cv30d: number | null },
    ethUsd: eth.px, ethUsdSource: eth.src,
    terms: null as null | { maxPrincipalUsdc: number; feeRatePct: number; floorPrice: number; termDays: number; drawLimitUsdc: number },
    eligible: false, reasons: [] as string[], formula: "",
    params: { advanceRatePct: ADVANCE_RATE_PCT, capUsdc: CAP_USDC, horizonDays: HORIZON_DAYS, minHistoryDays: MIN_HISTORY_DAYS },
    generatedAt: new Date().toISOString(), source: SOURCE,
  };

  // Bankr 404s "Token fee data not found" for anything it never launched (WETH, USDC): a valid report that says no.
  const t = fees?.tokens.find((x) => lc(x.tokenAddress) === lc(token) && x.chain === "base" && x.source === "doppler");
  if (!fees || !t) {
    const other = fees?.tokens.find((x) => lc(x.tokenAddress) === lc(token));
    report.reasons.push(`not a Base Doppler token (Bankr token-fees${other ? `: ${other.source} launch on ${other.chain}` : " has no fee data"})`);
    return Response.json(report);
  }

  // Same input construction as agent/src/board/index.ts buildRow().
  const reasons = report.reasons;
  if (lc(t.numeraire) !== lc(WETH)) reasons.push(`numeraire ${t.numeraire} is not WETH`);
  if (borrower && lc(fees.address) !== lc(borrower)) reasons.push(`fee history belongs to beneficiary ${fees.address}, not ${borrower}`);
  const claimable = dust(!t.tokenIsToken0 ? t.claimable.token0 : t.claimable.token1);
  const allTimeSum = fees.allTimeDailyEarnings.reduce((s, d) => s + Number(dust(d.weth)), 0);
  const sharePct = parseFloat(t.share);
  const claimedW = Number(dust(fees.totals.claimedWeth)), claimableW = Number(dust(fees.totals.claimableWeth));
  const factor = beneficiaryFactor(allTimeSum, claimedW, claimableW, sharePct);
  const ageDays = fees.allTimeDailyEarnings.length;
  const inputs: FeeInputs = {
    token: t.tokenAddress, symbol: t.symbol, name: t.name, poolId: t.poolId,
    feesManager: t.feesContract ?? t.initializer, sharePct, numeraire: t.numeraire, tokenIsToken0: t.tokenIsToken0,
    claimableWethRaw: toWei(claimable), claimableTokenRaw: "0",
    weth30d: fees.dailyEarnings.reduce((s, d) => s + Number(dust(d.weth)), 0) * factor,
    wethLifetime: Number(dust(fees.lifetimeEarnedWeth)) * factor,
    wethOwn: claimedW + claimableW,
    lifetimeDays: ageDays,
    dailyWeth: fees.dailyEarnings.map((d) => ({ date: d.date, weth: Number(dust(d.weth)) * factor })),
    ethUsd: eth.px,
  };
  if (ageDays < MIN_HISTORY_DAYS) reasons.push(`fee history ${ageDays}d < ${MIN_HISTORY_DAYS}d`);
  const r = computeTerms(inputs, ADVANCE_RATE_PCT, CAP_USDC);
  if (r.analysis.rateUsed === 0) reasons.push("fee rate is 0");
  else if ("error" in r) reasons.push(r.error);

  const a = r.analysis;
  const shareNote = factor === 1
    ? `dailyEarnings Σall-time ${allTimeSum.toFixed(6)} ≈ claimed+claimable → already beneficiary share`
    : `dailyEarnings Σall-time ${allTimeSum.toFixed(6)} ≠ claimed+claimable ${(claimedW + claimableW).toFixed(6)} → scaled by share ${t.share}`;
  Object.assign(report, {
    symbol: t.symbol, beneficiary: fees.address, sharePct,
    history: {
      days: ageDays, lifetimeWeth: r6(inputs.wethLifetime), claimableWeth: Number(claimable),
      r7: r6(a.r7), r30: r6(a.r30), rLife: r6(a.rLife), slope30d: Number(a.slope.toFixed(8)), cv30d: Number.isFinite(a.cv) ? Number(a.cv.toFixed(3)) : null,
    },
    terms: "terms" in r ? {
      maxPrincipalUsdc: Number(r.terms.maxPrincipalRaw) / 1e6, feeRatePct: r.terms.feeRatePct, floorPrice: r.terms.floorPrice,
      termDays: r.terms.termDays, drawLimitUsdc: Number(r.terms.drawLimitRaw) / 1e6,
    } : null,
    eligible: reasons.length === 0,
    formula: `${shareNote}; ${r.formula}`,
  });
  return Response.json(report);
}
