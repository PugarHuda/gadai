// Aggregation tests on REAL Bankr API responses, captured by curl on 2026-09-19 (fixtures-captured-2026-09-19/).
// ETH/USD below is the live Uniswap Trading API quote observed during that capture.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { TokenFees } from "../bankr/index.ts";
import { aggregate, buildRow, dust, type AgentProfile, type LlmUsage, type ProfilesPage } from "./index.ts";

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

test("non-Base profiles exist in the live page (filtered before fetching)", () => {
  const p: AgentProfile | undefined = page.profiles.find((x) => x.tokenChainId !== "base");
  assert.ok(p, "expected at least one non-Base profile in the captured page");
});
