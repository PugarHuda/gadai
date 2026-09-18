// Request-building tests for the Uniswap Trading API client. fetch is replaced by a recorder here (test only).
// Run: pnpm --filter @feedesk/agent test
import { test } from "node:test";
import assert from "node:assert/strict";
import { ADDR } from "@feedesk/shared";
import type { Ctx } from "../ctx.ts";
import { assertQuoteSane, assertSwapTx, buildVaultSwap, minOutFor, oracleUsdcOut, quoteBody, swapBody, wethForDebt, type SwapRes } from "./index.ts";

const PX8 = 3000n * 10n ** 8n; // Chainlink ETH/USD, 8 dec
const VAULT = "0x1111111111111111111111111111111111111111" as const;
const ctx = { log: () => {} } as unknown as Ctx;

type Call = { url: string; headers: Record<string, string>; body: any };
function recordFetch(respond: (path: string, body: any, n: number) => { status: number; json: unknown }) {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, headers: init.headers as Record<string, string>, body });
    const path = url.replace(/^.*\/v1/, "");
    const r = respond(path, body, calls.filter((c) => c.url === url).length);
    return new Response(JSON.stringify(r.json), { status: r.status });
  }) as typeof fetch;
  return calls;
}
const quoteRes = { requestId: "q1", routing: "CLASSIC", permitData: null, quote: { output: { amount: "3000000000" }, quoteId: "x" } };
const swapOk: SwapRes = { requestId: "s1", swap: { to: ADDR.UNI_SWAP_PROXY, from: VAULT, data: "0xdeadbeef", value: "0", chainId: 8453 } };

test("quoteBody pins AMM, EXACT_INPUT, vault as swapper, 0.5% slippage", () => {
  const b = quoteBody(VAULT, 10n ** 18n);
  assert.deepEqual(b, {
    type: "EXACT_INPUT", amount: "1000000000000000000", tokenInChainId: 8453, tokenOutChainId: 8453,
    tokenIn: ADDR.WETH, tokenOut: ADDR.USDC, swapper: VAULT, slippageTolerance: 0.5,
    routingPreference: "BEST_PRICE", protocols: ["V2", "V3", "V4"],
  });
  assert.equal("autoSlippage" in b, false); // API: exactly one of slippageTolerance / autoSlippage
});

test("swapBody passes quote verbatim with a 5 min deadline", () => {
  const q = { any: "thing" };
  assert.deepEqual(swapBody(q, true, 1000), { quote: q, simulateTransaction: true, deadline: 1300 });
});

test("minOutFor = quote − 0.5%", () => {
  assert.equal(minOutFor(3_000_000_000n), 2_985_000_000n);
  assert.equal(minOutFor(1n), 0n);
});

test("assertSwapTx rejects a non-SwapProxy target, empty data, value, wrong from", () => {
  assert.doesNotThrow(() => assertSwapTx(swapOk, VAULT));
  assert.throws(() => assertSwapTx({ ...swapOk, swap: { ...swapOk.swap, to: ADDR.UNIVERSAL_ROUTER_2_0 } }, VAULT), /not SwapProxy/);
  assert.throws(() => assertSwapTx({ ...swapOk, swap: { ...swapOk.swap, data: "0x" } }, VAULT), /empty calldata/);
  assert.throws(() => assertSwapTx({ ...swapOk, swap: { ...swapOk.swap, value: "1" } }, VAULT), /value/);
  assert.throws(() => assertSwapTx({ ...swapOk, swap: { ...swapOk.swap, from: ADDR.USDC } }, VAULT), /not the vault/);
});

test("buildVaultSwap: check_approval → quote → swap with proxy headers on every call", async () => {
  process.env.UNISWAP_API_KEY = "test-key";
  process.env.UNISWAP_UR_VERSION = "2.0";
  const calls = recordFetch((p) => ({ status: 200, json: p === "/quote" ? quoteRes : p === "/swap" ? swapOk : { requestId: "a", approval: null } }));
  const r = await buildVaultSwap(ctx, VAULT, 10n ** 18n, PX8);
  assert.deepEqual(calls.map((c) => c.url), [
    "https://trade-api.gateway.uniswap.org/v1/check_approval",
    "https://trade-api.gateway.uniswap.org/v1/quote",
    "https://trade-api.gateway.uniswap.org/v1/swap",
  ]);
  for (const c of calls) {
    assert.equal(c.headers["x-api-key"], "test-key");
    assert.equal(c.headers["x-permit2-disabled"], "true");
    assert.equal(c.headers["x-universal-router-version"], "2.0");
    assert.equal(JSON.parse(c.headers["x-agent-info"]).decision_origin, "autonomous");
  }
  assert.deepEqual(calls[0].body, { walletAddress: VAULT, token: ADDR.WETH, amount: "1000000000000000000", chainId: 8453, tokenOut: ADDR.USDC, tokenOutChainId: 8453 });
  assert.equal(calls[1].body.swapper, VAULT);
  assert.deepEqual(calls[2].body.quote, quoteRes.quote);
  assert.equal(calls[2].body.simulateTransaction, true);
  assert.equal("signature" in calls[2].body || "permitData" in calls[2].body, false);
  assert.deepEqual(r, { data: "0xdeadbeef", minOut: 2_985_000_000n, quoteOut: 3_000_000_000n, requestId: "s1" });
});

test("buildVaultSwap retries /swap once without simulation", async () => {
  process.env.UNISWAP_API_KEY = "test-key";
  const calls = recordFetch((p, body) =>
    p === "/swap" && body.simulateTransaction ? { status: 400, json: { errorCode: "SimulationFailed" } }
      : { status: 200, json: p === "/quote" ? quoteRes : p === "/swap" ? swapOk : { approval: null } });
  await buildVaultSwap(ctx, VAULT, 5n, PX8);
  assert.deepEqual(calls.filter((c) => c.url.endsWith("/swap")).map((c) => c.body.simulateTransaction), [true, false]);
});

test("buildVaultSwap refuses non-CLASSIC routing and a missing key", async () => {
  process.env.UNISWAP_API_KEY = "test-key";
  recordFetch((p) => ({ status: 200, json: p === "/quote" ? { ...quoteRes, routing: "DUTCH_V2" } : { approval: null } }));
  await assert.rejects(buildVaultSwap(ctx, VAULT, 5n, PX8), /expected CLASSIC/);
  delete process.env.UNISWAP_API_KEY;
  await assert.rejects(buildVaultSwap(ctx, VAULT, 5n, PX8), /Missing env UNISWAP_API_KEY/);
});

test("oracle guard: sizing to the debt and off-market quotes", async () => {
  assert.equal(oracleUsdcOut(10n ** 18n, PX8), 3_000_000_000n);
  // $11.2 debt at $3000 → 0.00392 WETH, not the whole 0.1068 held
  assert.equal(wethForDebt(11_200_000n, PX8, 106_800_000_000_000_000n), 3_920_000_000_000_000n);
  assert.equal(wethForDebt(10n ** 12n, PX8, 5n), 5n); // capped at the balance
  assert.doesNotThrow(() => assertQuoteSane(2_950_000_000n, 3_000_000_000n, 0.2));
  assert.throws(() => assertQuoteSane(2_900_000_000n, 3_000_000_000n, 0.2), /below Chainlink/);
  assert.throws(() => assertQuoteSane(3_000_000_000n, 3_000_000_000n, 2.5), /priceImpact/);
  process.env.UNISWAP_API_KEY = "test-key";
  recordFetch((p) => ({ status: 200, json: p === "/quote" ? quoteRes : p === "/swap" ? swapOk : { approval: null } }));
  await assert.rejects(buildVaultSwap(ctx, VAULT, 10n ** 18n, 3200n * 10n ** 8n), /below Chainlink/); // API quotes 3000, oracle 3200
});
