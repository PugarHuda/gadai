// Server flow guards on an in-memory db with a stub RPC (no network): apply auth/nonce/cooldown, pledge-tx gating,
// Bankr pledge calldata check, admin guard. Run: node --test src/server/server.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData, parseAbi } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { applyMessage, FEES_MANAGER_ABI, TEST_POOL, VAULT_STATUS, type Address } from "@feedesk/shared";
import type { Ctx } from "../ctx.ts";
import * as db from "../db/index.ts";
import { assertClaimTx, assertPledgeTx } from "../bankr/index.ts";
import { checkRpc, createApp, register, RPC_MAX_BATCH } from "./index.ts";
import * as cca from "../cca/index.ts";
import * as flynet from "../flynet/index.ts";
import * as keeper from "../keeper/index.ts";
import * as social from "../social/index.ts";

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
  wallet: async () => { if (walletDown) throw walletDown; return {}; },
} as unknown as Ctx;
let walletDown: (Error & { retryInSec?: number }) | null = null;
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

  // Dynamic 429: 503 before anything is stored, and the nonce stays usable
  walletDown = Object.assign(new Error("Dynamic sign-in rate-limited (429); retry in 42s"), { retryInSec: 42 });
  const before = db.listLoans(ctx.db).length, req = await signedApply();
  r = await post("/api/loans", req);
  assert.equal(r.status, 503);
  assert.match((await r.json()).error, /desk wallet temporarily rate-limited, retry in 42s/);
  assert.equal(db.listLoans(ctx.db).length, before);
  assert.equal(db.useNonce(ctx.db, req.nonce), true);
  walletDown = null;
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

test("assertClaimTx: exact collectFees(poolId) on the fees manager only", () => {
  const e = { feesManager: TEST_POOL.feesManager as Address, poolId: TEST_POOL.poolId as `0x${string}` };
  const data = encodeFunctionData({ abi: parseAbi(FEES_MANAGER_ABI), functionName: "collectFees", args: [e.poolId] });
  const ok = { to: e.feesManager, data, chainId: 8453 };
  assertClaimTx(ok, e);
  assert.ok(data.startsWith("0x817db73b")); // selector Bankr build-claim returns (docs/integrations/bankr.md)
  assert.throws(() => assertClaimTx({ ...ok, data: encodeFunctionData({ abi: parseAbi(FEES_MANAGER_ABI), functionName: "updateBeneficiary", args: [e.poolId, VAULT] }) }, e), /calldata/);
  assert.throws(() => assertClaimTx({ ...ok, to: VAULT }, e), /fees manager/);
  assert.throws(() => assertClaimTx({ ...ok, chainId: 1 }, e), /chainId/);
});

test("malformed or non-object JSON bodies → 400 {error} on every POST route, never 500", async () => {
  process.env.ADMIN_TOKEN = "s3cret-admin";
  const all = createApp(ctx);
  register(all, ctx);
  for (const m of [cca, flynet, keeper, social]) m.register(all, ctx);
  const id = db.insertLoan(ctx.db, { borrower: borrower.address, token, symbol: "G", poolId: TEST_POOL.poolId, feesManager: TEST_POOL.feesManager, status: "AUCTION", vault: VAULT, auction: VAULT });
  const routes = ["/api/loans", `/api/loans/${id}/pledge`, `/api/loans/${id}/auction/bid-plan`, `/api/loans/${id}/auction/exit-plan`,
    `/api/loans/${id}/dine/draw`, `/api/loans/${id}/dine/settle`, "/api/admin/keeper/run", "/api/follows", "/api/mirrors/1/submit", "/api/mirrors/1/cancel"];
  ctx.db.prepare(`INSERT INTO follows (id,follower,persona_id,mode,size_usdc,tp_pct,sl_pct,dca_days,auto,active,created_at) VALUES (1,'0x01','prudent','bracket',5,50,20,0,0,1,'t')`).run();
  ctx.db.prepare(`INSERT INTO mirror_orders (id,follow_id,signal_id,follower,token,symbol,mode,size_usdc,status,flash_order_id,created_at,updated_at)
    VALUES (1,1,1,'0x01',?,'G','bracket',5,'pending_signature','f1','t','t')`).run(token);
  for (const path of routes) {
    for (const body of ["{bad json", "null", "[1]"]) {
      const r = await all.request(path, { method: "POST", headers: { "content-type": "application/json", "x-admin-token": "s3cret-admin" }, body });
      assert.equal(r.status, 400, `${path} ${body} → ${r.status}`);
      assert.match((await r.json()).error, /JSON/);
    }
  }
  const del = await all.request("/api/follows/1", { method: "DELETE", body: "{nope" });
  assert.equal(del.status, 400);
});

test("/api/rpc: read-only allowlist + eth_sendRawTransaction; anvil/debug/evm/signing rejected; batches ≤ 20", async () => {
  const ok = (b: unknown) => { const r = checkRpc(b); assert.ok(!("error" in r), JSON.stringify(r)); return r; };
  const no = (b: unknown, status: number) => { const r = checkRpc(b); assert.ok("error" in r && r.status === status, JSON.stringify(r)); };
  for (const method of ["eth_chainId", "eth_blockNumber", "eth_call", "eth_getBalance", "eth_getCode", "eth_getLogs", "eth_getTransactionReceipt",
    "eth_getTransactionByHash", "eth_getBlockByNumber", "eth_estimateGas", "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_feeHistory", "net_version",
    "eth_getTransactionCount", "eth_sendRawTransaction"]) ok({ jsonrpc: "2.0", id: 1, method, params: [] });
  for (const method of ["anvil_setBalance", "anvil_impersonateAccount", "hardhat_setCode", "evm_mine", "evm_snapshot", "debug_traceTransaction",
    "eth_sendTransaction", "eth_sign", "eth_signTypedData_v4", "personal_sign", "admin_peers", "eth_accounts"]) no({ jsonrpc: "2.0", id: 1, method }, 403);
  no([{ id: 1, method: "eth_chainId" }, { id: 2, method: "anvil_mine" }], 403); // one bad call rejects the batch
  assert.equal((ok(Array.from({ length: RPC_MAX_BATCH }, (_, i) => ({ id: i, method: "eth_chainId" }))) as any).calls.length, RPC_MAX_BATCH);
  no(Array.from({ length: RPC_MAX_BATCH + 1 }, (_, i) => ({ id: i, method: "eth_chainId" })), 400);
  no([], 400);
  no({ id: 1, method: "eth_call", params: "x" }, 400);
  no({ id: {}, method: "eth_call" }, 400);
  no("eth_chainId", 400);

  // route: forwards only sanitized calls to ctx.rpcUrl, never to anything else
  const realFetch = globalThis.fetch, seen: { url: string; body: any }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    seen.push({ url, body });
    return Response.json(Array.isArray(body) ? body.map((c: any) => ({ jsonrpc: "2.0", id: c.id, result: "0x2105" })) : { jsonrpc: "2.0", id: body.id, result: "0x2105" });
  }) as typeof fetch;
  try {
    const rctx = { ...ctx, rpcUrl: "http://fork.internal:8545" } as Ctx;
    const a = createApp(rctx);
    register(a, rctx);
    let r = await a.request("/api/rpc", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "eth_chainId", extra: "dropped" }) });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { jsonrpc: "2.0", id: 7, result: "0x2105" });
    assert.deepEqual(seen.at(-1), { url: "http://fork.internal:8545", body: { jsonrpc: "2.0", id: 7, method: "eth_chainId" } });
    r = await a.request("/api/rpc", { method: "POST", body: JSON.stringify([{ id: 1, method: "eth_blockNumber" }, { id: 2, method: "eth_chainId" }]) });
    assert.equal((await r.json()).length, 2);
    const n = seen.length;
    r = await a.request("/api/rpc", { method: "POST", body: JSON.stringify({ id: 1, method: "anvil_setBalance", params: ["0x01", "0xffff"] }) });
    assert.equal(r.status, 403);
    assert.match((await r.json()).error, /anvil_setBalance is not allowed/);
    assert.equal((await a.request("/api/rpc", { method: "POST", body: "{nope" })).status, 400);
    assert.equal(seen.length, n); // rejected requests never reach the RPC
  } finally { globalThis.fetch = realFetch; }
});
