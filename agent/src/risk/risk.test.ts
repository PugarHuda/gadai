// x402 risk purchase: 402 parsing, payment header construction, budget cap, underwriter lowering rules. No network.
// The 402 fixture is the real response of the live Bankr x402 Cloud endpoint (captured 2026-09-19).
// UNIT TESTS ONLY: a local viem account stands in for the Dynamic MPC wallet (same AgentWallet.signTypedData(json) path).
// Run: node --test src/risk/risk.test.ts
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { verifyTypedData, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ADDR, type Address, type FeeInputs, type Quote } from "@feedesk/shared";
import type { Ctx } from "../ctx.ts";
import { openDb } from "../db/index.ts";
import { buyRiskVerdict, dynamicSigner, parse402, payingFetch, riskFactor, RISK_URL, spentToday } from "./index.ts";
import { PERSONAS, lowerRun, runPersona } from "../underwriter/index.ts";

const HDR = "eyJ4NDAyVmVyc2lvbiI6MiwiZXJyb3IiOiJQYXltZW50IFJlcXVpcmVkIiwiYWNjZXB0cyI6W3sic2NoZW1lIjoiZXhhY3QiLCJuZXR3b3JrIjoiZWlwMTU1Ojg0NTMiLCJtYXhBbW91bnRSZXF1aXJlZCI6IjUwMDAwIiwiYW1vdW50IjoiNTAwMDAiLCJyZXNvdXJjZSI6Imh0dHBzOi8veDQwMi5iYW5rci5ib3QvMHhmMzFmNTllN2I4YjU4NTU1Zjc4NzFmNzE5NzNhMzk0YzhmMWJmZmU1L2hvbmV5cG90LWNoZWNrIiwiZGVzY3JpcHRpb24iOiJEZXRlY3QgaG9uZXlwb3Qgb3IgcnVnIHB1bGwgdG9rZW4gY29udHJhY3RzIGJlZm9yZSBidXlpbmcg4oCUIFNBRkUgLyBTVVNQSUNJT1VTIC8gSE9ORVlQT1QgdmVyZGljdCIsIm1pbWVUeXBlIjoiIiwicGF5VG8iOiIweDhBRUU2MjEwMzVEOTNEZWIzQzBDMTE3N2ZhYzI1MmRDMmRkNTAxYTAiLCJtYXhUaW1lb3V0U2Vjb25kcyI6NjAsImFzc2V0IjoiMHg4MzM1ODlmQ0Q2ZURiNkUwOGY0YzdDMzJENGY3MWI1NGJkQTAyOTEzIiwiZXh0cmEiOnsibmFtZSI6IlVTRCBDb2luIiwidmVyc2lvbiI6IjIifX1dLCJmYWNpbGl0YXRvciI6Imh0dHBzOi8vYXBpLmJhbmtyLmJvdC9mYWNpbGl0YXRvciJ9";
const BODY = Buffer.from(HDR, "base64").toString("utf8");
const PAY_TO = "0x8AEE621035D93Deb3C0C1177fac252dC2dd501a0";
const TX = `0x${"ab".repeat(32)}` as Hex;
const res402 = (hdr = HDR, body = BODY) => new Response(body, { status: 402, headers: { "PAYMENT-REQUIRED": hdr, "content-type": "application/json" } });
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");

/** Local-key stand-in for the Dynamic AgentWallet (UNIT TESTS ONLY): signTypedData(json) exactly like wallet/index.ts. */
function localWallet() {
  const acct = privateKeyToAccount(generatePrivateKey());
  return { acct, w: { address: acct.address as Address, signTypedData: (json: string) => acct.signTypedData(JSON.parse(json)) } };
}
/** Fake x402 server: 402 on an unpaid request, 200 + PAYMENT-RESPONSE on a paid one. Records every request. */
function fakeService(verdict = "SAFE", hdr = HDR) {
  const seen: Request[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    seen.push(req.clone());
    const sig = req.headers.get("PAYMENT-SIGNATURE");
    if (!sig) return res402(hdr, Buffer.from(hdr, "base64").toString());
    const p = JSON.parse(Buffer.from(sig, "base64").toString());
    return new Response(JSON.stringify({ isHoneypot: verdict === "HONEYPOT", verdict, riskScore: 10, indicators: [], safeToTrade: verdict === "SAFE" }), {
      status: 200, headers: { "PAYMENT-RESPONSE": b64({ success: true, transaction: TX, network: "eip155:8453", payer: p.payload.authorization.from }) },
    });
  }) as typeof fetch;
  return { f, seen };
}
const mkCtx = (): Ctx => ({ db: openDb(":memory:"), log: () => {}, wallet: () => { throw new Error("no Dynamic wallet in unit tests"); } }) as unknown as Ctx;

const realEnv = { ...process.env };
afterEach(() => { for (const k of ["RISK_CHECK", "RISK_MAX_USDC_PER_DAY", "UNDERWRITER_ENGINE_ONLY"]) { if (realEnv[k] === undefined) delete process.env[k]; else process.env[k] = realEnv[k]; } });

test("parse402: live Bankr 402 → x402 v2, exact, Base mainnet USDC $0.05, mainnet EIP-712 domain", async () => {
  const pr = await parse402(res402());
  assert.equal(pr.x402Version, 2);
  const a = pr.accepts[0]!;
  assert.deepEqual([a.scheme, a.network, a.amount, a.asset, a.payTo], ["exact", "eip155:8453", "50000", ADDR.USDC, PAY_TO]);
  assert.deepEqual(a.extra, { name: "USD Coin", version: "2" });
  // x402 v2 carries the requirements in the PAYMENT-REQUIRED header; a v2 body alone is not accepted (only v1 bodies are)
  await assert.rejects(parse402(new Response(BODY, { status: 402 })), /Invalid payment required/);
});

test("payment header: EIP-3009 transferWithAuthorization signed via the AgentWallet JSON path, recovers to the payer", async () => {
  const { acct, w } = localWallet();
  const svc = fakeService("SAFE");
  const res = await payingFetch(dynamicSigner(w), svc.f)(RISK_URL, { method: "POST", body: JSON.stringify({ token: ADDR.WETH }) });
  assert.equal(res.status, 200);
  assert.equal(svc.seen.length, 2, "one unpaid request, one paid retry");
  const paid = svc.seen[1]!;
  assert.equal(await paid.text(), JSON.stringify({ token: ADDR.WETH }), "retry carries the same body");
  const p = JSON.parse(Buffer.from(paid.headers.get("PAYMENT-SIGNATURE")!, "base64").toString());
  assert.equal(p.x402Version, 2);
  assert.equal(p.accepted.payTo, PAY_TO);
  const au = p.payload.authorization;
  assert.equal(au.from, acct.address);
  assert.equal(au.to, PAY_TO);
  assert.equal(au.value, "50000");
  const ok = await verifyTypedData({
    address: acct.address, signature: p.payload.signature,
    domain: { name: "USD Coin", version: "2", chainId: 8453, verifyingContract: ADDR.USDC },
    types: { TransferWithAuthorization: [
      { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] },
    primaryType: "TransferWithAuthorization",
    message: { from: au.from, to: au.to, value: BigInt(au.value), validAfter: BigInt(au.validAfter), validBefore: BigInt(au.validBefore), nonce: au.nonce },
  });
  assert.ok(ok, "signature is over Base MAINNET USDC's domain (USD Coin / 2 / 8453)");
});

test("policy: a pricier or non-USDC 402 is never signed", async () => {
  const { w } = localWallet();
  const pr = JSON.parse(BODY);
  for (const patch of [{ amount: "60000", maxAmountRequired: "60000" }, { asset: ADDR.WETH }, { network: "eip155:84532" }, { extra: { name: "USDC", version: "2" } }]) {
    const hdr = b64({ ...pr, accepts: [{ ...pr.accepts[0], ...patch }] });
    const svc = fakeService("SAFE", hdr);
    await assert.rejects(payingFetch(dynamicSigner(w), svc.f)(RISK_URL, { method: "POST", body: "{}" }), `must refuse ${JSON.stringify(patch)}`);
    assert.equal(svc.seen.length, 1, "no paid retry");
  }
});

test("buyRiskVerdict: pays once, caches 24h, enforces the daily budget, skips honestly when unfunded / off", async () => {
  const ctx = mkCtx();
  const { w } = localWallet();
  const svc = fakeService("SUSPICIOUS");
  const deps = { signer: dynamicSigner(w), fetchImpl: svc.f, balance: async () => 1_000_000n };
  process.env.RISK_MAX_USDC_PER_DAY = "0.1"; // two purchases

  const a = await buyRiskVerdict(ctx, ADDR.WETH, { deps });
  assert.equal(a.verdict, "SUSPICIOUS");
  assert.equal(a.paid?.txHash, TX);
  assert.equal(a.paid?.payer, w.address);
  assert.equal(a.paid?.amountRaw, "50000");
  assert.equal(spentToday(ctx), 50_000n);
  const again = await buyRiskVerdict(ctx, ADDR.WETH, { deps });
  assert.equal(again.cached, true);
  assert.equal(svc.seen.length, 2, "cache hit: no new request");

  assert.equal((await buyRiskVerdict(ctx, ADDR.WETH, { deps, force: true })).verdict, "SUSPICIOUS");
  assert.equal(spentToday(ctx), 100_000n);
  const capped = await buyRiskVerdict(ctx, ADDR.USDC, { deps });
  assert.equal(capped.verdict, null);
  assert.match(capped.note, /daily budget/);
  assert.equal(svc.seen.length, 4, "budget reached: nothing sent");

  process.env.RISK_MAX_USDC_PER_DAY = "1";
  const broke = await buyRiskVerdict(ctx, ADDR.USDC, { deps: { ...deps, balance: async () => 49_999n } });
  assert.equal(broke.verdict, null);
  assert.match(broke.note, /not purchased: insufficient USDC/);
  process.env.RISK_CHECK = "off";
  assert.match((await buyRiskVerdict(ctx, ADDR.USDC, { deps })).note, /RISK_CHECK=off/);
  assert.equal(svc.seen.length, 4);
});

test("buyRiskVerdict: a response without a SAFE/SUSPICIOUS/HONEYPOT verdict is never turned into one", async () => {
  const ctx = mkCtx();
  const { w } = localWallet();
  const svc = fakeService("maybe");
  const r = await buyRiskVerdict(ctx, ADDR.WETH, { deps: { signer: dynamicSigner(w), fetchImpl: svc.f, balance: async () => 1_000_000n } });
  assert.equal(r.verdict, null);
  assert.match(r.note, /paid but unusable/);
  assert.equal(spentToday(ctx), 50_000n, "settled payment still counts against the budget");
});

// ─── underwriter lowering rules ───
const inputs = (): FeeInputs => ({
  token: "0x5f980dcfc4c0fa3911554cf5ab288ed0eb13dba3", symbol: "T", name: "T",
  poolId: "0xec33256bf1ded407a57fd3c1965e7556e42ac14db09bc4e6fef57d5e2eb0b0b9",
  feesManager: "0xD59cE43E53D69F190E15d9822Fb4540dCcc91178", sharePct: 57,
  numeraire: "0x4200000000000000000000000000000000000006", tokenIsToken0: false,
  claimableWethRaw: "0", claimableTokenRaw: "0", weth30d: 0.3, wethLifetime: 100, lifetimeDays: 100,
  dailyWeth: Array.from({ length: 30 }, (_, i) => ({ date: `d${i}`, weth: 0.01 })), ethUsd: 4000,
});
async function approvedRun() {
  process.env.UNDERWRITER_ENGINE_ONLY = "1";
  process.env.BANKR_LLM_KEY ||= "bk_test";
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response("{}", { status: 402 })) as typeof fetch; // Bankr LLM out of credits → rules memo
  try {
    const q: Quote = { eligible: true, reasons: [], inputs: inputs(), terms: null, formula: "" };
    const run = (await runPersona(PERSONAS[0]!, q))!;
    assert.equal(run.memo.decision, "approve");
    return { run, q };
  } finally { globalThis.fetch = real; }
}
const paid = { amountUsd: 0.05, txHash: TX } as never;

test("riskFactor: HONEYPOT 0, SUSPICIOUS 0.5, SAFE 1, not purchased 1 (never above 1)", () => {
  assert.equal(riskFactor({ verdict: "HONEYPOT", note: "", paid, cached: false }).factor, 0);
  assert.equal(riskFactor({ verdict: "SUSPICIOUS", note: "", paid, cached: false }).factor, 0.5);
  assert.equal(riskFactor({ verdict: "SAFE", note: "", paid, cached: false }).factor, 1);
  const n = riskFactor({ verdict: null, note: "not purchased: insufficient USDC", paid: null, cached: false });
  assert.equal(n.factor, 1);
  assert.match(n.note, /not purchased: insufficient USDC/);
});

test("lowerRun: SUSPICIOUS halves, HONEYPOT declines with the reason, factor > 1 never raises", async () => {
  const { run, q } = await approvedRun();
  const before = BigInt(run.memo.principalRaw);
  lowerRun(run, q, 0.5, riskFactor({ verdict: "SUSPICIOUS", note: "", paid, cached: false }).note);
  assert.equal(BigInt(run.memo.principalRaw), (before / 2n / 10_000n) * 10_000n);
  assert.equal(run.terms.principalRaw, run.memo.principalRaw);
  assert.match(run.memo.rationale, /Lowered by honeypot-check verdict SUSPICIOUS/);

  const r2 = (await approvedRun()).run;
  const p2 = r2.memo.principalRaw;
  lowerRun(r2, q, 5, "bogus");
  assert.equal(r2.memo.principalRaw, p2, "clamped to 1: may only lower");

  const r3 = (await approvedRun()).run;
  lowerRun(r3, q, 0, riskFactor({ verdict: "HONEYPOT", note: "", paid, cached: false }).note);
  assert.equal(r3.memo.decision, "decline");
  assert.equal(r3.memo.principalRaw, "0");
  assert.match(r3.memo.rationale, /Declined by honeypot-check verdict HONEYPOT .*→ decline\.$/);
});
