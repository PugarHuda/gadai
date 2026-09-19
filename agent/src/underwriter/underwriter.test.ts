// Engine-only fallback gating (fail closed): only 402/insufficient_credits AND UNDERWRITER_ENGINE_ONLY=1 yield rules memos.
// Stubbed fetch, no network. Run: node --test src/underwriter/underwriter.test.ts
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { FeeInputs, Quote } from "@feedesk/shared";
import { LlmNoCredits, llmChat } from "../bankr/index.ts";
import { RULES_MODEL } from "./engine.ts";
import { PERSONAS, runPersona } from "./index.ts";

const realFetch = globalThis.fetch, realEnv = process.env.UNDERWRITER_ENGINE_ONLY;
process.env.BANKR_LLM_KEY ||= "bk_test";
process.env.DESK_MAX_LOAN_USDC = "250";
afterEach(() => {
  globalThis.fetch = realFetch;
  if (realEnv === undefined) delete process.env.UNDERWRITER_ENGINE_ONLY; else process.env.UNDERWRITER_ENGINE_ONLY = realEnv;
});
const llmReplies = (status: number, body: string) => { globalThis.fetch = (async () => new Response(body, { status })) as typeof fetch; };

const inputs = (o: Partial<FeeInputs> = {}): FeeInputs => ({
  token: "0x5f980dcfc4c0fa3911554cf5ab288ed0eb13dba3", symbol: "T", name: "T",
  poolId: "0xec33256bf1ded407a57fd3c1965e7556e42ac14db09bc4e6fef57d5e2eb0b0b9",
  feesManager: "0xD59cE43E53D69F190E15d9822Fb4540dCcc91178", sharePct: 57,
  numeraire: "0x4200000000000000000000000000000000000006", tokenIsToken0: false,
  claimableWethRaw: "0", claimableTokenRaw: "0", weth30d: 0.3, wethLifetime: 100, lifetimeDays: 100,
  dailyWeth: Array.from({ length: 30 }, (_, i) => ({ date: `d${i}`, weth: 0.01 })), ethUsd: 4000, ...o,
});
const quote = (o?: Partial<FeeInputs>): Quote => ({ eligible: true, reasons: [], inputs: inputs(o), terms: null, formula: "" });
const [prudent, , skeptic] = PERSONAS;

test("llmChat: 401 is a bad key (plain Error), 402 / insufficient_credits is LlmNoCredits", async () => {
  llmReplies(401, '{"error":"invalid api key"}');
  await assert.rejects(llmChat([], { model: "m" }), (e: Error) => !(e instanceof LlmNoCredits) && /key rejected \(401\)/.test(e.message));
  llmReplies(402, '{"error":"payment required"}');
  await assert.rejects(llmChat([], { model: "m" }), LlmNoCredits);
  llmReplies(403, '{"error":{"code":"insufficient_credits"}}');
  await assert.rejects(llmChat([], { model: "m" }), LlmNoCredits);
});

test("runPersona: no credits without UNDERWRITER_ENGINE_ONLY=1 → throws (no silent fallback)", async () => {
  delete process.env.UNDERWRITER_ENGINE_ONLY;
  llmReplies(402, "{}");
  await assert.rejects(runPersona(prudent!, quote()), LlmNoCredits);
  process.env.UNDERWRITER_ENGINE_ONLY = "0";
  await assert.rejects(runPersona(prudent!, quote()), LlmNoCredits);
});

test("runPersona: bad key or server error never falls back, even with UNDERWRITER_ENGINE_ONLY=1", async () => {
  process.env.UNDERWRITER_ENGINE_ONLY = "1";
  llmReplies(401, "{}");
  await assert.rejects(runPersona(prudent!, quote()), /key rejected/);
  llmReplies(500, "{}");
  await assert.rejects(runPersona(prudent!, quote()), /→ 500/);
});

test("runPersona: 402 + UNDERWRITER_ENGINE_ONLY=1 → labeled rules memo, real decisions", async () => {
  process.env.UNDERWRITER_ENGINE_ONLY = "1";
  llmReplies(402, "{}");
  const p = (await runPersona(prudent!, quote()))!;
  assert.equal(p.memo.model, RULES_MODEL);
  assert.equal(p.memo.decision, "approve");
  assert.equal(p.memo.principalRaw, "168000000"); // 30% × $40/day × 14d
  assert.equal(p.terms.principalRaw, "168000000");
  assert.match(p.memo.rationale, /Rule prudent\/approve fired/);
  const s = (await runPersona(skeptic!, quote({ lifetimeDays: 10 })))!;
  assert.equal(s.memo.decision, "decline");
  assert.equal(s.memo.principalRaw, "0");
  assert.match(s.memo.rationale, /thin-history/);
});

test("quote: a token Bankr never launched (fee API 404) is ineligible, not a 500", async () => {
  const { quote: q } = await import("./index.ts");
  llmReplies(404, '{"error":"Token fee data not found"}');
  const r = await q({} as never, "0x4200000000000000000000000000000000000006", "0xfdb6430011f6E4796Ca380CB39e47975b1f876Bf");
  assert.equal(r.eligible, false);
  assert.match(r.reasons[0]!, /not a Base Doppler token/);
  llmReplies(500, "boom"); // other API failures still throw
  await assert.rejects(q({} as never, "0x4200000000000000000000000000000000000007", "0xfdb6430011f6E4796Ca380CB39e47975b1f876Bf"), /→ 500/);
});

test('quote: Bankr dust strings ("<0.000001") count as 0 instead of throwing / NaN (live atlas-forge shape)', async () => {
  const { readFileSync } = await import("node:fs");
  const { quote: q } = await import("./index.ts");
  const fees = JSON.parse(readFileSync(new URL("../board/fixtures-captured-2026-09-19/fees-atlas-forge.json", import.meta.url), "utf8"));
  const t = fees.tokens[0];
  process.env.UNISWAP_API_KEY ||= "test";
  globalThis.fetch = (async (u: string | URL) => {
    const url = String(u);
    const body = url.includes("/token-launches/") ? fees
      : url.includes("/claimable-fees/") ? { eligible: true, tokenAddress: t.tokenAddress, share: t.share, claimableFees: { token0: "0.000000", token1: "<0.000001", token0Label: "T", token1Label: "WETH" } }
      : url.endsWith("/quote") ? { quote: { output: { amount: "4000000000" } } }
      : null;
    return new Response(JSON.stringify(body), { status: body ? 200 : 404 });
  }) as typeof fetch;
  const ctx = { deskAddress: "0x0000000000000000000000000000000000000001", pub: { readContract: async (a: { functionName: string }) => (a.functionName === "decimals" ? 18 : "0x0000000000000000000000000000000000000000") } };
  const r = await q(ctx as never, t.tokenAddress, fees.address);
  assert.equal(r.inputs!.claimableWethRaw, "0");
  const own = r.inputs!.wethOwn ?? NaN;
  assert.ok(Number.isFinite(own) && own > 0, `wethOwn ${own}`);
  assert.doesNotMatch(r.formula, /NaN/);
});
