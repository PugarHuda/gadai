// runKeeperOnce decisions against a stubbed chain + wallet (no RPC, no keys). Run: pnpm --filter @feedesk/agent test
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AgentWallet, Ctx } from "../ctx.ts";
import { getLoan, insertLoan, listEvents, openDb } from "../db/index.ts";
import { runKeeperOnce, tokenForDebt } from "./index.ts";

const VAULT = "0x1111111111111111111111111111111111111111" as const;
const TOKEN = "0x2222222222222222222222222222222222222222" as const;
const BORROWER = "0x3333333333333333333333333333333333333333" as const;

function setup(chain: { outstanding: bigint; canRelease: boolean; weth: bigint; token: bigint }) {
  const writes: string[] = [];
  const reads: Record<string, (a: any) => unknown> = {
    status: () => 3n, // Active
    debtOutstanding: () => chain.outstanding,
    canRelease: () => chain.canRelease,
    drawDebt: () => 0n,
    creatorToken: () => TOKEN,
    decimals: () => 18,
    balanceOf: (a) => (a.address === TOKEN ? chain.token : chain.weth),
  };
  const pub = {
    readContract: async (a: any) => {
      const f = reads[a.functionName];
      if (!f) throw new Error(`stub: unexpected read ${a.functionName}`);
      return f(a);
    },
    simulateContract: async (a: any) => {
      if (a.functionName === "collect") return { result: [0n, 0n] };
      throw new Error(`stub: unexpected simulate ${a.functionName}`);
    },
  };
  const wallet = {
    address: "0x4444444444444444444444444444444444444444",
    write: async (a: any) => { writes.push(a.functionName); return { hash: "0xab", receipt: { logs: [] } }; },
  } as unknown as AgentWallet;
  const logs: string[] = [];
  const ctx = {
    db: openDb(":memory:"), pub, demoFork: false, rpcUrl: "stub", deskAddress: VAULT, publicUrl: "", webUrl: "",
    wallet: async () => wallet, log: (_m: string, msg: string) => logs.push(msg),
  } as unknown as Ctx;
  const id = insertLoan(ctx.db, { status: "ACTIVE", borrower: BORROWER, token: TOKEN, symbol: "T", poolId: `0x${"ee".repeat(32)}`, feesManager: VAULT, vault: VAULT });
  const openFlashOrder = () => ctx.db.prepare("INSERT INTO flash_orders (id,loan_id,mode,funder,token,amount_raw,status,usdc_out_raw,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run("o1", id, "vault1271", VAULT, TOKEN, "1", "ORDER_STATUS_PENDING", "0", "t", "t");
  const errors = () => listEvents(ctx.db, id).filter((e) => e.kind === "error").map((e) => e.data as { step: string; error: string });
  return { ctx, id, writes, logs, errors, openFlashOrder };
}

const covered = { outstanding: 0n, canRelease: true, weth: 106_800_000_000_000_000n, token: 2_770_000n * 10n ** 18n };

test("debt covered: no WETH swap, no token sale, release; leftovers go back with the lien", async () => {
  const k = setup(covered);
  await runKeeperOnce(k.ctx, k.id);
  assert.deepEqual(k.errors(), []); // a swap/flash attempt would need Chainlink/FLASH_API_KEY and fail here
  assert.deepEqual(k.writes, ["release"]);
  assert.equal(getLoan(k.ctx.db, k.id)!.status, "RELEASED");
});

test("debt covered but a Flash order is open: release waits", async () => {
  const k = setup(covered);
  k.openFlashOrder();
  await runKeeperOnce(k.ctx, k.id);
  assert.deepEqual(k.errors(), []);
  assert.deepEqual(k.writes, []);
  assert.equal(getLoan(k.ctx.db, k.id)!.status, "ACTIVE");
  assert.ok(k.logs.some((l) => /release waits for the open Flash order/.test(l)));
});

test("debt open, no WETH: the token leg goes to Flash (and fails loudly without its key)", async () => {
  const k = setup({ outstanding: 11_200_000n, canRelease: false, weth: 0n, token: 2_770_000n * 10n ** 18n });
  const saved = process.env.FLASH_API_KEY;
  process.env.FLASH_API_KEY = "";
  try { await runKeeperOnce(k.ctx, k.id); } finally { if (saved === undefined) delete process.env.FLASH_API_KEY; else process.env.FLASH_API_KEY = saved; }
  assert.deepEqual(k.errors().map((e) => e.step), ["flash"]);
  assert.match(k.errors()[0]!.error, /Missing env FLASH_API_KEY/);
  assert.deepEqual(k.writes, []);
});

test("tokenForDebt sells only the covering slice (+10%), capped at the balance", () => {
  // $11.20 owed, token at $0.0001 → 112,000 tokens × 1.1 = 123,200, not the 2.77M held
  assert.equal(tokenForDebt(11_200_000n, 0.0001, 18, 2_770_000n * 10n ** 18n), 123_200n * 10n ** 18n);
  assert.equal(tokenForDebt(10n ** 15n, 0.0001, 18, 5n), 5n);
  assert.throws(() => tokenForDebt(1n, 0, 18, 5n), /price/);
});
