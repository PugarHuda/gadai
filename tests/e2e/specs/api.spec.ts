// Agent REST API (SPEC.md §7), hit directly with the request fixture. Read-only except for idempotent
// admin/keeper calls; nothing here signs or moves funds.
import { test, expect } from "@playwright/test";
import { AGENT, DESK, NOBODY, POOL, WETH, adminToken, fundedLoanId, NO_FUNDED } from "../fixtures";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const json = { "content-type": "application/json" };

/** Every error is JSON `{error: string}` with a proper status (SPEC §7). */
async function expectError(res: import("@playwright/test").APIResponse, status: number, msg?: RegExp) {
  expect(res.status(), await res.text()).toBe(status);
  const j = await res.json();
  expect(typeof j.error).toBe("string");
  if (msg) expect(j.error).toMatch(msg);
}

test.describe("agent API: core", () => {
  test("GET /api/health reports the fork and a block", async ({ request }) => {
    const j = await (await request.get(`${AGENT}/api/health`)).json();
    expect(j).toMatchObject({ ok: true, demoFork: true });
    expect(j.block).toBeGreaterThan(0);
  });

  test("GET /api/desk returns DeskInfo with 3 personas", async ({ request }) => {
    const r = await request.get(`${AGENT}/api/desk`);
    expect(r.ok()).toBeTruthy();
    const d = await r.json();
    expect(d.chainId).toBe(8453);
    expect(d.desk.toLowerCase()).toBe(DESK.toLowerCase());
    expect(d.agentWallet).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(d.treasury).not.toBe(d.agentWallet); // RUNBOOK §4: treasury must differ from the keeper
    expect(d.personas.map((p: { id: string }) => p.id)).toEqual(["prudent", "momentum", "skeptic"]);
    expect(d.personas[0].wallet).toBe(d.agentWallet);
  });

  test("GET /api/quote for the test pool is an engine quote", async ({ request }) => {
    const q = await (await request.get(`${AGENT}/api/quote?token=${POOL.token}&borrower=${POOL.beneficiary}`, { timeout: 60_000 })).json();
    expect(typeof q.eligible).toBe("boolean");
    expect(q.inputs.symbol).toBe("GITLAWB");
    expect(q.inputs.dailyWeth.length).toBeGreaterThan(0);
    expect(q.formula).toContain("WETH/day");
    if (q.eligible) expect(BigInt(q.terms.maxPrincipalRaw)).toBeGreaterThan(0n);
  });

  test("GET /api/quote for a non-beneficiary is eligible:false with reasons", async ({ request }) => {
    const q = await (await request.get(`${AGENT}/api/quote?token=${POOL.token}&borrower=${NOBODY}`, { timeout: 60_000 })).json();
    expect(q.eligible).toBe(false);
    expect(q.reasons.join(" ")).toMatch(/not an eligible beneficiary|belongs to beneficiary/);
  });

  test("GET /api/quote with an invalid token address is 400", async ({ request }) => {
    await expectError(await request.get(`${AGENT}/api/quote?token=0xabc&borrower=${POOL.beneficiary}`), 400, /token must be a 0x address/);
    await expectError(await request.get(`${AGENT}/api/quote`), 400);
    await expectError(await request.get(`${AGENT}/api/quote?token=${POOL.token}&borrower=nope`), 400, /borrower/);
  });

  // quote() promises "Hard rejects are returned as eligible:false + reasons, never thrown".
  for (const [name, tok] of [["WETH", WETH], ["USDC", USDC]] as const) {
    test(`GET /api/quote for a non-Doppler token (${name}) is eligible:false, not a 500`, async ({ request }) => {
      const r = await request.get(`${AGENT}/api/quote?token=${tok}&borrower=${POOL.beneficiary}`, { timeout: 60_000 });
      expect(r.status(), await r.text()).toBe(200);
      const q = await r.json();
      expect(q.eligible).toBe(false);
      expect(q.reasons.join(" ")).toMatch(/not a Base Doppler token/);
    });
  }

  test("GET /api/creator-tokens lists Base Doppler tokens; bad wallet is 400", async ({ request }) => {
    const r = await request.get(`${AGENT}/api/creator-tokens?wallet=${POOL.beneficiary}`, { timeout: 60_000 });
    expect(r.ok()).toBeTruthy();
    const list = await r.json();
    expect(Array.isArray(list)).toBeTruthy();
    for (const t of list) {
      expect(t.token).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(typeof t.sharePct).toBe("number");
      expect(Number.isFinite(t.claimableWeth)).toBeTruthy();
    }
    await expectError(await request.get(`${AGENT}/api/creator-tokens?wallet=nope`), 400, /wallet/);
    await expectError(await request.get(`${AGENT}/api/creator-tokens`), 400, /wallet/);
  });

  test("GET /api/loans lists loans with debt:null; filters work", async ({ request }) => {
    const all = await (await request.get(`${AGENT}/api/loans`)).json();
    expect(all.length).toBeGreaterThan(0);
    for (const l of all) {
      expect(l.debt ?? null).toBeNull();
      expect(["APPROVED", "DECLINED", "PLEDGED", "AUCTION", "ACTIVE", "RELEASED", "CANCELLED"]).toContain(l.status);
    }
    const released = await (await request.get(`${AGENT}/api/loans?status=RELEASED`)).json();
    expect(released.every((l: { status: string }) => l.status === "RELEASED")).toBeTruthy();
    const mine = await (await request.get(`${AGENT}/api/loans?borrower=${POOL.beneficiary}`)).json();
    expect(mine.length).toBeGreaterThan(0);
    const none = await (await request.get(`${AGENT}/api/loans?borrower=${NOBODY}`)).json();
    expect(none).toEqual([]);
    await expectError(await request.get(`${AGENT}/api/loans?borrower=xyz`), 400, /borrower/);
  });

  test("GET /api/loans?status=<unknown> is 400, not a silent empty list", async ({ request }) => {
    await expectError(await request.get(`${AGENT}/api/loans?status=BOGUS`), 400);
  });

  test("GET /api/loans/:funded is a LoanDetail with on-chain debt, memos, events", async ({ request }) => {
    const id = await fundedLoanId();
    test.skip(id === null, NO_FUNDED);
    const l = await (await request.get(`${AGENT}/api/loans/${id}`)).json();
    expect(l.id).toBe(id);
    expect(l.memos.length).toBe(3);
    expect(l.events.length).toBeGreaterThan(0);
    expect(l.debt).not.toBeNull();
    for (const k of ["noteSupplyRaw", "drawDebtRaw", "usdcInVaultRaw", "outstandingRaw"]) expect(l.debt[k]).toMatch(/^\d+$/);
    expect(l.vault).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  test("GET /api/loans/:id unknown is 404, malformed is 400", async ({ request }) => {
    await expectError(await request.get(`${AGENT}/api/loans/999999`), 404, /not found/);
    for (const bad of ["abc", "0", "-1", "1.5"]) await expectError(await request.get(`${AGENT}/api/loans/${bad}`), 400, /positive integer/);
  });

  test("GET /api/loans/:id/pledge-tx: 404 unknown, 409 once no longer APPROVED", async ({ request }) => {
    await expectError(await request.get(`${AGENT}/api/loans/999999/pledge-tx`), 404);
    const id = await fundedLoanId();
    if (id !== null) await expectError(await request.get(`${AGENT}/api/loans/${id}/pledge-tx`), 409, /only possible while APPROVED/);
  });

  test("POST /api/loans/:id/pledge unknown loan is 404", async ({ request }) => {
    await expectError(await request.post(`${AGENT}/api/loans/999999/pledge`, { data: {} }), 404);
  });

  test("POST /api/loans/:id/pledge on a funded loan does not re-pledge", async ({ request }) => {
    const id = await fundedLoanId();
    test.skip(id === null, NO_FUNDED);
    const before = (await (await request.get(`${AGENT}/api/loans/${id}`)).json()).status;
    const r = await request.post(`${AGENT}/api/loans/${id}/pledge`, { data: {} });
    // SPEC: PLEDGED→AUCTION, 409 if shares aren't moved. A released loan must not be re-pledged; returning the detail
    // unchanged is acceptable, a state change is not.
    if (r.ok()) expect((await r.json()).status).toBe(before);
    else expect(r.status()).toBe(409);
  });

  test("GET /api/loans/:id/release-tx: 404 unknown, 409 when !canRelease", async ({ request }) => {
    await expectError(await request.get(`${AGENT}/api/loans/999999/release-tx`), 404);
    const id = await fundedLoanId();
    test.skip(id === null, NO_FUNDED);
    const r = await request.get(`${AGENT}/api/loans/${id}/release-tx`);
    expect([200, 409]).toContain(r.status());
    if (r.status() === 200) expect((await r.json()).data).toMatch(/^0x/);
  });

  test("POST /api/loans rejects malformed JSON, missing fields and unsigned applications", async ({ request }) => {
    await expectError(await request.post(`${AGENT}/api/loans`, { headers: json, data: Buffer.from("{bad json") }), 400, /JSON/);
    await expectError(await request.post(`${AGENT}/api/loans`, { data: {} }), 400);
    const unsigned = await request.post(`${AGENT}/api/loans`, {
      data: { token: POOL.token, borrower: POOL.beneficiary, controller: POOL.beneficiary, via: "web", nonce: "x", signature: "0x" + "00".repeat(65) },
      timeout: 60_000,
    });
    expect([400, 401]).toContain(unsigned.status());
    expect(typeof (await unsigned.json()).error).toBe("string");
  });

  test("POST /api/admin/keeper/run: 401 without / with a bad token", async ({ request }) => {
    await expectError(await request.post(`${AGENT}/api/admin/keeper/run`), 401);
    await expectError(await request.post(`${AGENT}/api/admin/keeper/run`, { headers: { "x-admin-token": "wrong" } }), 401);
    await expectError(await request.post(`${AGENT}/api/admin/keeper/run`, { headers: { "x-admin-token": adminToken() + "x" } }), 401);
  });

  test("POST /api/admin/keeper/run with the admin token", async ({ request }) => {
    test.skip(!adminToken(), "ADMIN_TOKEN not available");
    const h = { "x-admin-token": adminToken() };
    await expectError(await request.post(`${AGENT}/api/admin/keeper/run`, { headers: h, data: { loanId: 999999 } }), 404);
    const r = await request.post(`${AGENT}/api/admin/keeper/run`, { headers: h, data: {}, timeout: 120_000 });
    expect([200, 409]).toContain(r.status()); // 409 = a pass is already running
    if (r.ok()) expect(Array.isArray((await r.json()).ran)).toBeTruthy();
  });

  test("unknown route is a JSON 404", async ({ request }) => {
    await expectError(await request.get(`${AGENT}/api/nope`), 404, /no route/);
  });

  test("CORS allows the web origins and x-admin-token", async ({ request }) => {
    for (const origin of ["http://localhost:3000", "https://gadai-six.vercel.app"]) {
      const r = await request.fetch(`${AGENT}/api/loans`, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST" } });
      expect(r.headers()["access-control-allow-origin"], origin).toBe(origin);
    }
    const evil = await request.fetch(`${AGENT}/api/loans`, { method: "OPTIONS", headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "GET" } });
    expect(evil.headers()["access-control-allow-origin"] ?? "").not.toBe("https://evil.example");
  });
});

test.describe("agent API: auction (cca)", () => {
  test("GET /api/loans/:funded/auction is AuctionState", async ({ request }) => {
    const id = await fundedLoanId();
    test.skip(id === null, NO_FUNDED);
    const a = await (await request.get(`${AGENT}/api/loans/${id}/auction`)).json();
    expect(a.loanId).toBe(id);
    expect(a.endBlock).toBeGreaterThan(a.startBlock);
    expect(Array.isArray(a.bids)).toBeTruthy();
    expect(a.bids.length).toBeGreaterThan(0);
  });

  test("auction endpoints: unknown loan is 404", async ({ request }) => {
    await expectError(await request.get(`${AGENT}/api/loans/999999/auction`), 404);
    await expectError(await request.post(`${AGENT}/api/loans/999999/auction/bid-plan`, { data: {} }), 404);
    await expectError(await request.post(`${AGENT}/api/loans/999999/auction/exit-plan`, { data: {} }), 404);
  });

  test("auction endpoints: malformed loan id is 400", async ({ request }) => {
    await expectError(await request.get(`${AGENT}/api/loans/abc/auction`), 400);
  });

  test("POST bid-plan / exit-plan with malformed JSON is 400, not 500", async ({ request }) => {
    await expectError(await request.post(`${AGENT}/api/loans/1/auction/bid-plan`, { headers: json, data: Buffer.from("{bad") }), 400);
    await expectError(await request.post(`${AGENT}/api/loans/1/auction/exit-plan`, { headers: json, data: Buffer.from("{bad") }), 400);
  });

  test("POST bid-plan with invalid fields is 4xx", async ({ request }) => {
    const id = await fundedLoanId();
    test.skip(id === null, NO_FUNDED);
    const r = await request.post(`${AGENT}/api/loans/${id}/auction/bid-plan`, { data: { bidder: "nope", amountRaw: "-1", maxPrice: 7 } });
    expect(r.status(), await r.text()).toBeGreaterThanOrEqual(400);
    expect(r.status()).toBeLessThan(500);
  });

  test("POST exit-plan unknown bid is 404", async ({ request }) => {
    const id = await fundedLoanId();
    test.skip(id === null, NO_FUNDED);
    await expectError(await request.post(`${AGENT}/api/loans/${id}/auction/exit-plan`, { data: { bidId: "99999" } }), 404, /bid 99999/);
  });
});

test.describe("agent API: social (Follow the Desk)", () => {
  test("GET /api/signals and filters", async ({ request }) => {
    const all = await (await request.get(`${AGENT}/api/signals?limit=60`)).json();
    expect(all.length).toBeGreaterThan(0);
    const one = await (await request.get(`${AGENT}/api/signals?limit=1`)).json();
    expect(one.length).toBe(1);
    const pr = await (await request.get(`${AGENT}/api/signals?personaId=prudent`)).json();
    expect(pr.every((s: { personaId: string }) => s.personaId === "prudent")).toBeTruthy();
    expect(await (await request.get(`${AGENT}/api/signals?personaId=nope`)).json()).toEqual([]);
  });

  test("GET /api/signals?limit=abc is 400 (not silently ignored)", async ({ request }) => {
    await expectError(await request.get(`${AGENT}/api/signals?limit=abc`), 400);
  });

  test("GET /api/leaderboard ranks 3 personas", async ({ request }) => {
    const lb = await (await request.get(`${AGENT}/api/leaderboard`)).json();
    expect(lb.length).toBe(3);
    for (const r of lb) {
      expect(r.score === null || typeof r.score === "number").toBeTruthy();
      expect(r.repaidPct).toBeGreaterThanOrEqual(0);
    }
  });

  test("GET /api/follows / mirrors require a follower address", async ({ request }) => {
    await expectError(await request.get(`${AGENT}/api/follows`), 400, /follower/);
    await expectError(await request.get(`${AGENT}/api/mirrors`), 400, /follower/);
    expect(await (await request.get(`${AGENT}/api/follows?follower=${NOBODY}`)).json()).toEqual([]);
    expect(await (await request.get(`${AGENT}/api/mirrors?follower=${NOBODY}`)).json()).toEqual([]);
  });

  test("GET /api/follows / mirrors with a non-address follower is 400", async ({ request }) => {
    await expectError(await request.get(`${AGENT}/api/follows?follower=bad`), 400);
    await expectError(await request.get(`${AGENT}/api/mirrors?follower=bad`), 400);
  });

  test("POST /api/follows validates the body and signature", async ({ request }) => {
    await expectError(await request.post(`${AGENT}/api/follows`, { data: {} }), 400, /follower/);
    await expectError(await request.post(`${AGENT}/api/follows`, { headers: json, data: Buffer.from("{bad") }), 400);
    const r = await request.post(`${AGENT}/api/follows`, {
      data: { follower: NOBODY, personaId: "prudent", mode: "bracket", sizeUsdc: 5, tpPct: 50, slPct: 20, dcaDays: 0, auto: false, nonce: "n", signature: "0x" + "11".repeat(65) },
    });
    expect([400, 401]).toContain(r.status());
  });

  test("DELETE /api/follows/:id unknown is 404", async ({ request }) => {
    await expectError(await request.delete(`${AGENT}/api/follows/999999`, { data: {} }), 404);
  });

  test("mirror endpoints: unknown mirror is 404", async ({ request }) => {
    await expectError(await request.post(`${AGENT}/api/mirrors/999999/quote`), 404, /mirror not found/);
    await expectError(await request.post(`${AGENT}/api/mirrors/999999/submit`, { data: {} }), 404, /mirror not found/);
    await expectError(await request.post(`${AGENT}/api/mirrors/999999/cancel`, { data: {} }), 404, /mirror not found/);
  });

  test("POST /api/dynamic/webhook without a valid HMAC is rejected (401, or 503 naming the missing secret)", async ({ request }) => {
    const r = await request.post(`${AGENT}/api/dynamic/webhook`, { data: {}, headers: { "x-dynamic-signature-256": "sha256=00" } });
    expect([401, 503]).toContain(r.status());
    if (r.status() === 503) expect((await r.json()).error).toMatch(/Missing env DYNAMIC_WEBHOOK_SECRET/);
  });
});

test.describe("agent API: Flynet (dine)", () => {
  test("GET /api/loans/1/dine is DineState", async ({ request }) => {
    const d = await (await request.get(`${AGENT}/api/loans/1/dine`)).json();
    expect(d.loanId).toBe(1);
    expect(typeof d.linked).toBe("boolean");
    expect(d.drawLimitRaw).toMatch(/^\d+$/);
    expect(Array.isArray(d.draws)).toBeTruthy();
  });

  test("dine: unknown loan 404, malformed id 400 (not 'loan NaN')", async ({ request }) => {
    await expectError(await request.get(`${AGENT}/api/loans/999999/dine`), 404);
    const r = await request.get(`${AGENT}/api/loans/abc/dine`);
    expect(r.status()).toBe(400);
    expect((await r.json()).error).not.toContain("NaN");
  });

  test("GET /api/flynet/connect: missing params is 400, bad signature is 401", async ({ request }) => {
    const r = await request.get(`${AGENT}/api/flynet/connect`, { maxRedirects: 0 });
    expect(r.status()).toBe(400);
    expect((await r.json()).error).not.toContain("NaN");
    await expectError(await request.get(`${AGENT}/api/flynet/connect?loanId=1&nonce=x&sig=0x00`, { maxRedirects: 0 }), 401, /signature/);
  });

  test("GET /api/flynet/callback with a forged state is 400", async ({ request }) => {
    await expectError(await request.get(`${AGENT}/api/flynet/callback?code=x&state=y`, { maxRedirects: 0 }), 400, /state/);
  });

  test("GET /api/flynet/restaurants: missing loanId 400; unconfigured Flynet names the env var", async ({ request }) => {
    const miss = await request.get(`${AGENT}/api/flynet/restaurants`);
    expect(miss.status()).toBe(400);
    const r = await request.get(`${AGENT}/api/flynet/restaurants?loanId=1`, { timeout: 60_000 });
    if (r.status() === 503) expect((await r.json()).error).toMatch(/Missing env FLYNET_/);
    else expect([200, 409]).toContain(r.status());
  });

  test("POST dine/draw + settle validate their bodies", async ({ request }) => {
    await expectError(await request.post(`${AGENT}/api/loans/1/dine/draw`, { data: {} }), 400, /amountUsdCents/);
    await expectError(await request.post(`${AGENT}/api/loans/1/dine/settle`, { data: {} }), 400, /signature/);
  });

  test("POST dine/draw + settle with malformed JSON is 400, not 500", async ({ request }) => {
    await expectError(await request.post(`${AGENT}/api/loans/1/dine/draw`, { headers: json, data: Buffer.from("{bad") }), 400);
    await expectError(await request.post(`${AGENT}/api/loans/1/dine/settle`, { headers: json, data: Buffer.from("{bad") }), 400);
  });
});
