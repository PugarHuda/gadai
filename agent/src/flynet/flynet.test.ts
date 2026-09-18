import { test } from "node:test";
import assert from "node:assert/strict";
import { isOpenNow } from "./index.ts";

const h = (dayOfWeek: string, openTime: string, closeTime: string) => ({ object: "open_hour", dayOfWeek, openTime, closeTime }) as any;

test("isOpenNow: same-day, overnight spill, no hours", () => {
  const tz = "America/New_York";
  const fri2000 = new Date("2026-09-18T20:00:00-04:00"); // Friday 20:00 NY
  const sat0100 = new Date("2026-09-19T01:00:00-04:00"); // Saturday 01:00 NY
  assert.equal(isOpenNow([h("friday", "17:00", "22:00")], tz, fri2000), true);
  assert.equal(isOpenNow([h("friday", "11:00", "15:00")], tz, fri2000), false);
  assert.equal(isOpenNow([h("friday", "18:00:00", "02:00:00")], tz, sat0100), true); // closes past midnight
  assert.equal(isOpenNow([h("friday", "18:00", "00:30")], tz, sat0100), false);
  assert.equal(isOpenNow([], tz, fri2000), null);
});

import { openDb } from "../db/index.ts";
import { isRevert, priceOf, reconcilePending, settleAmounts } from "./index.ts";
import type { Ctx } from "../ctx.ts";

const bal = (wei: bigint, usd: number) => ({ balance: { value: wei.toString() }, balanceUsd: { value: usd } }) as any;

test("priceOf: needs >= $1 of FLY so cent rounding can't skew the rate", () => {
  assert.equal(priceOf(bal(10n ** 18n, 1.49)), null); // 1.49 cents would round to 1: rejected
  assert.equal(priceOf(bal(0n, 500)), null);
  assert.deepEqual(priceOf(bal(10n ** 20n, 250.4)), { wei: 10n ** 20n, cents: 250n });
});

test("settleAmounts: at draw rate, capped by lent-unsettled FLY, member balance and draw debt", () => {
  const issued = [{ flyWei: "1000", amountRaw: "100" }, { flyWei: "1000", amountRaw: "100" }]; // 10 fly wei per usdc raw
  assert.deepEqual(settleAmounts(issued, 0n, 5000n, 1000n), { pull: 2000n, usdcRaw: 200n }); // cap: lent FLY
  assert.deepEqual(settleAmounts(issued, 1500n, 5000n, 1000n), { pull: 500n, usdcRaw: 50n }); // minus already settled
  assert.deepEqual(settleAmounts(issued, 0n, 300n, 1000n), { pull: 300n, usdcRaw: 30n }); // member balance
  assert.deepEqual(settleAmounts(issued, 0n, 5000n, 70n), { pull: 700n, usdcRaw: 70n }); // never more than the debt
  assert.deepEqual(settleAmounts([], 0n, 5000n, 70n), { pull: 0n, usdcRaw: 0n });
});

test("isRevert: clean reverts are final, timeouts are not", () => {
  assert.equal(isRevert(new Error('The contract function "addDraw" reverted with the following reason: OverDrawLimit()')), true);
  assert.equal(isRevert(new Error("tx 0xabc reverted")), true);
  assert.equal(isRevert(new Error("Timed out while waiting for transaction with hash 0xabc to be confirmed.")), false);
  assert.equal(isRevert(new Error("fetch failed")), false);
});

test("reconcilePending: a mined-but-unconfirmed addDraw is booked once, never re-sent", async () => {
  const db = openDb(":memory:");
  const ctx = { db, log: () => {} } as unknown as Ctx;
  const ins = (amt: string, status: string, ageMin: number) =>
    Number(db.prepare("INSERT INTO draws (loan_id,amount_raw,fly_wei,status,created_at) VALUES (1,?,?,?,?)")
      .run(amt, amt, status, new Date(Date.now() - ageMin * 60_000).toISOString()).lastInsertRowid);
  const st = (id: number) => (db.prepare("SELECT status FROM draws WHERE id = ?").get(id) as { status: string }).status;
  const resent: number[] = [];
  const resend = async (_: Ctx, id: number) => void resent.push(id);

  ins("100", "issued", 60);
  const p = ins("50", "pending", 10);
  await reconcilePending(ctx, 1, 150n, resend); // drawn() already includes it → recorded, no resend
  assert.equal(st(p), "recorded");
  assert.deepEqual(resent, []);
  await reconcilePending(ctx, 1, 150n, resend); // idempotent
  assert.equal(st(p), "recorded");

  const q = ins("25", "pending", 1); // young & not on-chain: wait
  await reconcilePending(ctx, 1, 150n, resend);
  assert.equal(st(q), "pending");
  db.prepare("UPDATE draws SET created_at = ? WHERE id = ?").run(new Date(Date.now() - 6 * 60_000).toISOString(), q);
  await reconcilePending(ctx, 1, 150n, resend); // 6 min & not on-chain: dropped → resend
  assert.deepEqual(resent, [q]);
  db.prepare("UPDATE draws SET created_at = ? WHERE id = ?").run(new Date(Date.now() - 31 * 60_000).toISOString(), q);
  await reconcilePending(ctx, 1, 150n, resend); // 31 min: final failure, no debt
  assert.equal(st(q), "failed");
  assert.deepEqual(resent, [q]);
});
