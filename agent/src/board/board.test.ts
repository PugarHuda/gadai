// Aggregation tests on REAL Bankr API responses, captured by curl on 2026-09-19 (fixtures-captured-2026-09-19/).
// ETH/USD below is the live Uniswap Trading API quote observed during that capture.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { TokenFees } from "../bankr/index.ts";
import {
  INDICATIVE, RH_WETH, aggregate, buildRobinhoodRow, buildRow, dust, quotePx,
  type AgentProfile, type LlmUsage, type ProfilesPage, type QuotePx, type QuoteToken, type UniQuote,
} from "./index.ts";

const ETH_USD = 2637.958232;
const CAP = 250;
const fx = <T>(f: string): T => JSON.parse(readFileSync(new URL(`./fixtures-captured-2026-09-19/${f}.json`, import.meta.url), "utf8")) as T;
const page = fx<ProfilesPage>("agent-profiles-offset0");
const profile = (slug: string) => page.profiles.find((p) => p.slug === slug)!;
const row = (slug: string) => buildRow(profile(slug), fx<TokenFees>(`fees-${slug}`), fx<LlmUsage>(`llm-usage-${slug}`), ETH_USD, CAP);
const SLUGS = ["setz", "gitlawb", "surplus-intelligence", "atlas-forge", "manfred-macx"];

test("dust strings from the live API parse as 0", () => {
  assert.equal(dust("<0.000001"), "0");
  assert.equal(dust("4.998764"), "4.998764");
});

test("eligible rows carry engine terms; llm usage is copied from the API totals", () => {
  const s = row("setz");
  assert.equal(s.eligible, true, s.reason ?? "");
  assert.equal(s.maxLoanUsdc, CAP); // engine cap binds
  assert.ok(s.feeRatePct! > 5 && s.feeRatePct! <= 17.7);
  assert.ok(s.floorPrice! > 0 && s.floorPrice! < 1);
  const g = row("gitlawb");
  assert.equal(g.eligible, true, g.reason ?? "");
  assert.ok(g.maxLoanUsdc >= 1 && g.maxLoanUsdc <= CAP);
  assert.equal(g.llmTokens30d, fx<LlmUsage>("llm-usage-gitlawb").totals.totalTokens);
  assert.equal(g.beneficiary, fx<TokenFees>("fees-gitlawb").address);
});

test("engine rejects and non-Doppler launches become 'not eligible: <reason>' with 0 credit", () => {
  const m = row("manfred-macx");
  assert.equal(m.eligible, false);
  assert.equal(m.reason, "not eligible: not a Base Doppler token (clanker launch)");
  for (const slug of ["surplus-intelligence", "atlas-forge"]) {
    const r = row(slug);
    if (!r.eligible) assert.match(r.reason!, /^not eligible: /);
    assert.ok(Number.isFinite(r.lifetimeWeth) && Number.isFinite(r.claimableWeth), `${slug} has NaN`);
  }
  assert.equal(row("atlas-forge").claimableWeth, 0); // API said "<0.000001"
});

test("aggregate: totals are row sums, failures counted not dropped, sorted by credit", () => {
  const rows = SLUGS.map(row);
  rows.push(buildRow(profile("ratspeak"), new Error("timeout after 15s"), new Error("503 upstream"), ETH_USD, CAP));
  const b = aggregate(rows, ETH_USD, 1, "2026-09-19T00:00:00.000Z");
  assert.equal(b.totals.agents, 6);
  assert.equal(b.rows.length, 6);
  assert.equal(b.totals.failed, 1);
  const bad = b.rows.find((r) => r.slug === "ratspeak")!;
  assert.equal(bad.eligible, false);
  assert.match(bad.error!, /fees: timeout after 15s; llm-usage: 503 upstream|llm-usage: 503 upstream; fees: timeout after 15s/);
  assert.equal(b.totals.eligible, rows.filter((r) => r.eligible).length);
  assert.equal(b.totals.totalCreditUsdc, Number(rows.reduce((s, r) => s + r.maxLoanUsdc, 0).toFixed(2)));
  assert.equal(b.totals.llmTokens30d, rows.reduce((s, r) => s + (r.llmTokens30d ?? 0), 0));
  assert.ok(b.totals.lifetimeFeesWeth > 0);
  for (let i = 1; i < b.rows.length; i++) assert.ok(b.rows[i - 1]!.maxLoanUsdc >= b.rows[i]!.maxLoanUsdc);
  assert.equal(b.totals.nonBase, 1);
});

test("non-Base profiles in the live page are Robinhood Chain", () => {
  const p: AgentProfile | undefined = page.profiles.find((x) => x.tokenChainId !== "base");
  assert.ok(p, "expected at least one non-Base profile in the captured page");
  assert.ok(page.profiles.filter((x) => x.tokenChainId !== "base").every((x) => x.tokenChainId === "robinhood"));
});

// ─── Robinhood Chain: fees in tokenized stocks. Uniswap quotes + quote-tokens captured live 2026-09-19. ───
const RH_ETH_USD = Number(fx<UniQuote>("uniswap-quote-8453-weth-usdc").quote.output.amount) / 1e6; // 1 WETH → USDC on Base
const LIST = fx<{ quoteTokens: QuoteToken[] }>("quote-tokens-robinhood").quoteTokens;
const addr = (sym: string) => LIST.find((q) => q.symbol === sym)!.address.toLowerCase();
const PRICES = new Map<string, QuotePx | Error>([
  ...["SPY", "TSLA", "MSTR"].map((s) => [addr(s), quotePx(addr(s), LIST, RH_ETH_USD, fx<UniQuote>(`uniswap-quote-4663-${s}-weth`))] as const),
  [RH_WETH, quotePx(RH_WETH, LIST, RH_ETH_USD)],
]);
const rh = (slug: string, prices = PRICES) => buildRobinhoodRow(profile(slug), fx<TokenFees>(`fees-${slug}`), fx<LlmUsage>(`llm-usage-${slug}`), prices, CAP);

test("quote prices: stock → WETH on chain 4663 × ETH/USD; WETH is ETH/USD", () => {
  const spy = PRICES.get(addr("SPY")) as QuotePx;
  assert.equal(spy.symbol, "SPY");
  assert.equal(spy.stock, true);
  assert.ok(spy.wethPerUnit > 0.2 && spy.wethPerUnit < 0.4, `SPY ${spy.wethPerUnit} WETH`); // live: 0.28902
  assert.ok(Math.abs(spy.usd - spy.wethPerUnit * RH_ETH_USD) < 1e-3);
  const w = PRICES.get(RH_WETH) as QuotePx;
  assert.deepEqual([w.symbol, w.stock, w.usd], ["WETH", false, RH_ETH_USD]);
  assert.throws(() => quotePx(addr("SPY"), LIST, RH_ETH_USD), /no Uniswap quote for SPY/);
});

test("EARN (fees in SPY): same engine in shares, indicative line, never lendable", () => {
  const r = rh("earn");
  assert.equal(r.quote?.symbol, "SPY");
  assert.equal(r.eligible, false);
  assert.equal(r.maxLoanUsdc, 0);
  assert.equal(r.reason, INDICATIVE);
  assert.equal(r.claimableQuote, 1.755627); // SPY, straight from the API's quote-side claimable
  assert.ok(r.indicativeUsdc >= 1 && r.indicativeUsdc <= CAP);
  assert.ok(r.feeRatePct! > 5 && r.feeRatePct! <= 17.7);
  assert.ok(Math.abs(r.usdPerDay! - r.ratePerDayQuote! * r.quote!.usd) < 0.01 + r.quote!.usd * 1e-6);
  // Bankr's "weth" series is a WETH-equivalent; converted back to shares it must be near the 31.747529 + 1.755627 SPY the
  // beneficiary actually claimed + can claim. Skipping the conversion would give ~12.4 (the WETH-equivalent), outside this band.
  const ownSpy = 31.747529 + 1.755627;
  assert.ok(r.lifetimeQuote! > 0.5 * ownSpy && r.lifetimeQuote! < 3 * ownSpy, `lifetime ${r.lifetimeQuote} SPY`);
});

test("other equity rows run the engine and give a reason; WETH-quoted Robinhood rows are not equities", () => {
  for (const [slug, sym] of [["teslr", "TSLA"], ["based-mining-co", "MSTR"]] as const) {
    const r = rh(slug);
    assert.equal(r.quote?.symbol, sym);
    assert.equal(r.eligible, false);
    assert.ok(r.reason === INDICATIVE || /^not eligible: /.test(r.reason!), r.reason!);
    assert.ok(Number.isFinite(r.lifetimeQuote) && Number.isFinite(r.claimableQuote), `${slug} has NaN`);
  }
  const q = rh("quotient");
  assert.deepEqual([q.quote?.symbol, q.quote?.stock], ["WETH", false]);
  assert.equal(q.claimableQuote, 0.044358);
});

test("a failed quote price is an error row, not a silent zero", () => {
  const r = rh("earn", new Map([[addr("SPY"), new Error("uniswap /quote 404: NoRouteFoundError")]]));
  assert.equal(r.indicativeUsdc, 0);
  assert.equal(r.reason, "quote token price unavailable");
  assert.match(r.error!, /quote price: uniswap \/quote 404/);
});

test("aggregate: equity totals cover stock-quoted Robinhood rows only and never add to lendable credit", () => {
  const base = SLUGS.map(row);
  const rhs = ["earn", "teslr", "based-mining-co", "quotient"].map((s) => rh(s));
  const b = aggregate(base, RH_ETH_USD, 4, "2026-09-19T00:00:00.000Z", rhs);
  const eq = rhs.filter((r) => r.quote?.stock);
  assert.equal(b.totals.equityAgents, 3);
  assert.equal(b.totals.robinhoodAgents, 4);
  assert.equal(b.totals.indicativeEquityCreditUsdc, Number(eq.reduce((s, r) => s + r.indicativeUsdc, 0).toFixed(2)));
  assert.equal(b.totals.equityFeesUsd, Number(eq.reduce((s, r) => s + r.lifetimeQuote! * r.quote!.usd, 0).toFixed(2)));
  assert.ok(b.totals.equityFeesUsd > 0);
  assert.equal(b.totals.totalCreditUsdc, Number(base.reduce((s, r) => s + r.maxLoanUsdc, 0).toFixed(2)));
  assert.equal(b.totals.agents, base.length);
  for (let i = 1; i < b.robinhood.length; i++) assert.ok(b.robinhood[i - 1]!.indicativeUsdc >= b.robinhood[i]!.indicativeUsdc);
});
