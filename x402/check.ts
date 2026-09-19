// Runnable check for x402/gadai-credit: calls the handler against live Bankr data and asserts its terms equal the
// agent's own board row (agent/src/board/index.ts buildRow → underwriter engine) for the same fees + ETH price.
// Run from repo root: node x402/check.ts
import assert from "node:assert/strict";
import handler from "./gadai-credit/index.ts";
import { buildRow } from "../agent/src/board/index.ts";

const call = async (qs: string) => {
  const res = await handler(new Request(`https://x402.local/gadai-credit?${qs}`));
  return { status: res.status, body: (await res.json()) as any };
};

// 4xx on bad input (router does not settle payment)
assert.equal((await call("token=nope")).status, 400);
assert.equal((await call("token=0x5f980dcfc4c0fa3911554cf5ab288ed0eb13dba3&borrower=0x12")).status, 400);

// non-Doppler: 200, eligible false
const weth = await call("token=0x4200000000000000000000000000000000000006");
assert.equal(weth.status, 200);
assert.equal(weth.body.eligible, false);
console.log("WETH", JSON.stringify(weth.body.reasons));

for (const [slug, token] of [
  ["gitlawb", "0x5f980dcfc4c0fa3911554cf5ab288ed0eb13dba3"],
  ["surplus-intelligence", "0xc52aedec3374422d7510e294cfaa90799595cba3"],
  ["ratspeak", "0xf1e9baa65d418a9025e1851dd2d37f1ad208bba3"],
] as const) {
  const { status, body } = await call(`token=${token}`);
  assert.equal(status, 200);
  const fees = await (await fetch(`https://api.bankr.bot/token-launches/${token}/fees?days=30`)).json();
  const row = buildRow({ slug, tokenAddress: token, tokenSymbol: body.symbol } as any, fees, new Error("skipped"), body.ethUsd, 250);
  console.log(slug, JSON.stringify({ eligible: body.eligible, terms: body.terms, reasons: body.reasons, history: body.history }));
  console.log("  agent buildRow:", JSON.stringify({ eligible: row.eligible, maxLoanUsdc: row.maxLoanUsdc, feeRatePct: row.feeRatePct, floorPrice: row.floorPrice, reason: row.reason }));
  assert.equal(body.eligible, row.eligible);
  assert.equal(body.eligible ? body.terms.maxPrincipalUsdc : 0, row.maxLoanUsdc);
  assert.equal(body.terms?.feeRatePct ?? null, row.feeRatePct);
  assert.equal(body.terms?.floorPrice ?? null, row.floorPrice);
  assert.equal(body.beneficiary, fees.address);
}

// borrower mismatch → ineligible with reason
const mis = await call("token=0x5f980dcfc4c0fa3911554cf5ab288ed0eb13dba3&borrower=0x0455408228f460722ecbe80789bcf1628b479e98");
assert.equal(mis.body.eligible, false);
assert.ok(mis.body.reasons.some((r: string) => r.includes("belongs to beneficiary")));
console.log("ok");
