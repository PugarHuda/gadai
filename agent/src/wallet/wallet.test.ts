// Wallet queue + Dynamic re-auth rules (no SDK needed). Run: pnpm --filter @feedesk/agent test
import { test } from "node:test";
import assert from "node:assert/strict";
import { isDynamicAuthErr, jwtExpMs, txQueue } from "./index.ts";

const dyn401 = Object.assign(new Error("Unauthorized (Authorization header present)"), { name: "WalletApiError", status: 401 });

test("isDynamicAuthErr: only Dynamic's own 401, through viem's cause chain", () => {
  assert.equal(isDynamicAuthErr(dyn401), true);
  assert.equal(isDynamicAuthErr(Object.assign(new Error("tx failed"), { cause: dyn401 })), true);
  assert.equal(isDynamicAuthErr({ isAxiosError: true, response: { status: 401 } }), true);
  // RPC 401 (viem HttpRequestError) and an `Unauthorized()` contract revert must NOT trigger a re-login + resend
  assert.equal(isDynamicAuthErr(Object.assign(new Error("HTTP request failed. Status: 401"), { name: "HttpRequestError", status: 401 })), false);
  assert.equal(isDynamicAuthErr(new Error('The contract function "collect" reverted. Error: Unauthorized()')), false);
  assert.equal(isDynamicAuthErr(Object.assign(new Error("x"), { name: "WalletApiError", status: 500 })), false);
});

test("txQueue: jobs run one at a time, in order, even when one fails", async () => {
  const q = txQueue({ ensureFresh: async () => {}, login: async () => {} });
  const log: string[] = [];
  const job = (n: string, ms: number, fail = false) => q.serial(async () => {
    log.push(`start ${n}`);
    await new Promise((r) => setTimeout(r, ms));
    log.push(`end ${n}`);
    if (fail) throw new Error(n);
    return n;
  });
  const r = await Promise.allSettled([job("a", 20, true), job("b", 1), job("c", 5)]);
  assert.deepEqual(log, ["start a", "end a", "start b", "end b", "start c", "end c"]);
  assert.deepEqual(r.map((x) => x.status), ["rejected", "fulfilled", "fulfilled"]);
});

test("txQueue.authed: re-login + one retry on a Dynamic 401, nothing else retried", async () => {
  let logins = 0;
  const q = txQueue({ ensureFresh: async () => {}, login: async () => { logins++; } });
  let calls = 0;
  assert.equal(await q.authed(async () => { if (++calls === 1) throw dyn401; return "0xhash"; }), "0xhash");
  assert.deepEqual([calls, logins], [2, 1]);
  calls = 0;
  await assert.rejects(q.authed(async () => { calls++; throw new Error("HTTP request failed. Status: 401"); }));
  assert.deepEqual([calls, logins], [1, 1]);
  calls = 0;
  await assert.rejects(q.authed(async () => { calls++; throw dyn401; }), /Unauthorized/); // second 401: give up
  assert.deepEqual([calls, logins], [2, 2]);
});

test("jwtExpMs reads the exp claim", () => {
  const jwt = (p: object) => `h.${Buffer.from(JSON.stringify(p)).toString("base64url")}.s`;
  assert.equal(jwtExpMs(jwt({ exp: 1_800_000_000 })), 1_800_000_000_000);
  assert.equal(jwtExpMs(jwt({ sub: "x" })), undefined);
  assert.equal(jwtExpMs("garbage"), undefined);
});
