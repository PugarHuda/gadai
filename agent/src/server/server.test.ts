// Server flow guards on an in-memory db with a stub RPC (no network): apply auth/nonce/cooldown, pledge-tx gating,
// Bankr pledge calldata check, admin guard. Run: node --test src/server/server.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData, parseAbi } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { applyMessage, FEES_MANAGER_ABI, TEST_POOL, VAULT_STATUS, type Address } from "@feedesk/shared";
import type { Ctx } from "../ctx.ts";
import * as db from "../db/index.ts";
import { assertPledgeTx } from "../bankr/index.ts";
import { createApp, register } from "./index.ts";

const VAULT = "0x1111111111111111111111111111111111111111" as Address;
const borrower = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());
const token = TEST_POOL.token as Address;
let vaultStatus: (typeof VAULT_STATUS)[number] = "Created";

const ctx = {
  db: db.openDb(":memory:"),
  pub: {
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "status") return VAULT_STATUS.indexOf(vaultStatus);
      throw new Error(`unexpected read ${functionName}`);
    },
    verifyMessage: async () => false, // no smart-wallet signers in these tests
  },
  demoFork: false, deskAddress: "0x2222222222222222222222222222222222222222", publicUrl: "http://x", webUrl: "http://w",
  log: () => {},
} as unknown as Ctx;
const app = createApp(ctx);
register(app, ctx);

const post = (path: string, body: unknown) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const signedApply = async (signer = borrower, nonce = crypto.randomUUID()) => ({
  token, borrower: borrower.address, nonce,
  signature: await signer.signMessage({ message: applyMessage(token, borrower.address, borrower.address, nonce) }),
});

test("POST /api/loans: borrower signature required, stranger rejected", async () => {
  assert.equal((await post("/api/loans", { token, borrower: borrower.address })).status, 401);
  const r = await post("/api/loans", await signedApply(stranger));
  assert.equal(r.status, 401);
  assert.match((await r.json()).error, /not the borrower/);
  // controller is part of the signed message: changing it invalidates the signature
  const s = await signedApply();
  assert.equal((await post("/api/loans", { ...s, controller: stranger.address })).status, 401);
});

test("POST /api/loans: open loan → 409, recent decline → 409 (before any underwriting or gas)", async () => {
  const base = { borrower: borrower.address, token, symbol: "GITLAWB", poolId: TEST_POOL.poolId, feesManager: TEST_POOL.feesManager } as const;
  const d = db.insertLoan(ctx.db, { ...base, status: "DECLINED" });
  let r = await post("/api/loans", await signedApply());
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /declined/);
  db.updateLoan(ctx.db, d, { status: "CANCELLED" });
  const open = db.insertLoan(ctx.db, { ...base, status: "APPROVED" });
  r = await post("/api/loans", await signedApply());
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /already APPROVED/);
  db.updateLoan(ctx.db, open, { status: "CANCELLED" });
  const replay = await signedApply();
  db.useNonce(ctx.db, replay.nonce);
  r = await post("/api/loans", replay);
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /nonce already used/);
});

test("pledge-tx is only served while the vault is Created; closed loans hide pledge fields", async () => {
  const pledgeTx = { to: TEST_POOL.feesManager as Address, chainId: 8453, data: encodeFunctionData({ abi: parseAbi(FEES_MANAGER_ABI), functionName: "updateBeneficiary", args: [TEST_POOL.poolId, VAULT] }) };
  const id = db.insertLoan(ctx.db, { borrower: borrower.address, token, symbol: "G", poolId: TEST_POOL.poolId, feesManager: TEST_POOL.feesManager, status: "APPROVED", vault: VAULT, pledgeTx });
  vaultStatus = "Created";
  let r = await app.request(`/api/loans/${id}/pledge-tx`);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).data, pledgeTx.data);
  vaultStatus = "Cancelled"; // keeper cancelled the unpledged vault after 24h
  r = await app.request(`/api/loans/${id}/pledge-tx`);
  assert.equal(r.status, 409);
  const l = db.getLoan(ctx.db, id)!;
  assert.equal(l.status, "CANCELLED");
  assert.equal(l.pledgeTx, null);
  assert.equal(l.pledgeChatText, null);
});

test("assertPledgeTx: exact updateBeneficiary(poolId, vault) on the fees manager only", () => {
  const e = { feesManager: TEST_POOL.feesManager as Address, poolId: TEST_POOL.poolId as `0x${string}`, vault: VAULT };
  const data = encodeFunctionData({ abi: parseAbi(FEES_MANAGER_ABI), functionName: "updateBeneficiary", args: [e.poolId, VAULT] });
  const ok = { to: e.feesManager, data, chainId: 8453 };
  assertPledgeTx(ok, e);
  assert.throws(() => assertPledgeTx({ ...ok, data: encodeFunctionData({ abi: parseAbi(FEES_MANAGER_ABI), functionName: "updateBeneficiary", args: [e.poolId, stranger.address] }) }, e), /calldata/);
  assert.throws(() => assertPledgeTx({ ...ok, data: `${data}00` }, e), /calldata/);
  assert.throws(() => assertPledgeTx({ ...ok, to: VAULT }, e), /fees manager/);
  assert.throws(() => assertPledgeTx({ ...ok, chainId: 1 }, e), /chainId/);
  assert.throws(() => assertPledgeTx({ ...ok, value: "1" }, e), /value/);
});

test("admin guard: constant-time token compare", async () => {
  process.env.ADMIN_TOKEN = "s3cret-admin";
  assert.equal((await app.request("/api/admin/x", { headers: { "x-admin-token": "nope" } })).status, 401);
  assert.equal((await app.request("/api/admin/x", { headers: { "x-admin-token": "s3cret-admin" } })).status, 404); // passes the guard
});

test("missing key → 503 naming the env var; other errors stay a generic 500", async () => {
  const app = createApp(ctx);
  app.get("/api/_t/cfg", () => { throw new Error("Missing env UNISWAP_API_KEY (see .env.example)"); });
  app.get("/api/_t/boom", () => { throw new Error("http://rpc.example/?key=SECRET failed"); });
  const r = await app.request("/api/_t/cfg");
  assert.equal(r.status, 503);
  assert.match((await r.json()).error, /UNISWAP_API_KEY/);
  const b = await app.request("/api/_t/boom");
  assert.equal(b.status, 500);
  assert.doesNotMatch((await b.json()).error, /SECRET/);
});
