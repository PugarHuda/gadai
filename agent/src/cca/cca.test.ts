import { test } from "node:test";
import assert from "node:assert/strict";
import { Q96 } from "@feedesk/shared";
import { TICK_Q96, centsToQ96, exitHints, priceToCents, stepsData } from "./index.ts";

test("steps: Σ mps·blocks = 1e7, packed as (uint24 mps, uint40 blocks)", () => {
  for (const n of [2, 150, 900]) {
    const hex = stepsData(n).slice(2);
    assert.equal(hex.length, 32); // 2 steps × 8 bytes
    let sum = 0, blocks = 0;
    for (let i = 0; i < hex.length; i += 16) {
      const mps = parseInt(hex.slice(i, i + 6), 16), d = parseInt(hex.slice(i + 6, i + 16), 16);
      sum += mps * d; blocks += d;
    }
    assert.equal(sum, 1e7);
    assert.equal(blocks, n);
  }
});

test("grid: floor and bids are exact multiples of tickSpacing", () => {
  assert.equal(centsToQ96(90) % TICK_Q96, 0n);
  assert.ok(TICK_Q96 >= 2n && centsToQ96(1) > 2n ** 32n + 1n); // MIN_TICK_SPACING, MIN_FLOOR_PRICE
  assert.equal(priceToCents(0.909), 90);
  assert.equal(priceToCents(0.29), 29); // float guard
  assert.ok(centsToQ96(100) <= Q96);
});

test("exit hints follow the v2.1.0 validity rules", () => {
  const P = (c: number) => centsToQ96(c);
  const cps = [
    { block: 10n, clearingPrice: P(90), prev: 0n, next: 12n },
    { block: 12n, clearingPrice: P(91), prev: 10n, next: 15n },
    { block: 15n, clearingPrice: P(93), prev: 12n, next: 20n },
    { block: 20n, clearingPrice: P(95), prev: 15n, next: 0n },
  ];
  // bid at 0.93 placed at block 10, outbid at block 20
  assert.deepEqual(exitHints(cps, P(93), 10n), { lastFullyFilled: 12n, outbid: 20n });
  // bid exactly at final clearing → outbid 0
  assert.deepEqual(exitHints(cps, P(95), 12n), { lastFullyFilled: 15n, outbid: 0n });
  assert.throws(() => exitHints(cps, P(91), 15n));
});
