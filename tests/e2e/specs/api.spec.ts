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
    for (const loanId of ["abc", "1", 0, -1, 1.5]) await expectError(await request.post(`${AGENT}/api/admin/keeper/run`, { headers: h, data: { loanId } }), 400, /positive integer/);
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

test.describe("agent API: Flynet (dine concierge)", () => {
  test("GET /api/flynet/status: read-only app, payments disabled with a reason", async ({ request }) => {
    const r = await request.get(`${AGENT}/api/flynet/status`);
    expect(r.status()).toBe(200);
    const s = await r.json();
    expect(Array.isArray(s.allowedScopes)).toBeTruthy();
    expect(s.payments.enabled).toBe(false);
    expect(s.payments.reason).toMatch(/FLY/);
    expect(typeof s.memberLogin.available).toBe("boolean");
  });

  test("GET /api/loans/1/dine is DineState: budget, no draws, honest payment + save-to-list notes", async ({ request }) => {
    const d = await (await request.get(`${AGENT}/api/loans/1/dine`)).json();
    expect(d.loanId).toBe(1);
    expect(d.budgetRaw).toMatch(/^\d+$/);
    expect(typeof d.linked).toBe("boolean");
    expect(d.payments.enabled).toBe(false);
    expect(d.payments.reason).toMatch(/moves no FLY or USDC/);
    expect(d.saveToList.available).toBe(false);
    expect(d.saveToList.reason).toMatch(/nothing was saved/);
    expect(d).not.toHaveProperty("draws");
    expect(d).not.toHaveProperty("drawLimitRaw");
  });

  test("dine: unknown loan 404, malformed id 400 (not 'loan NaN')", async ({ request }) => {
    await expectError(await request.get(`${AGENT}/api/loans/999999/dine`), 404);
    const r = await request.get(`${AGENT}/api/loans/abc/dine`);
    expect(r.status()).toBe(400);
    expect((await r.json()).error).not.toContain("NaN");
  });

  test("FLY dining draws are gone: dine/draw and dine/settle are 404", async ({ request }) => {
    await expectError(await request.post(`${AGENT}/api/loans/1/dine/draw`, { data: { amountUsdCents: 100 } }), 404, /no route/);
    await expectError(await request.post(`${AGENT}/api/loans/1/dine/settle`, { data: {} }), 404, /no route/);
  });

  test("GET /api/flynet/restaurants + trending validate their query", async ({ request }) => {
    await expectError(await request.get(`${AGENT}/api/flynet/restaurants?price=9`), 400, /price must be 1..4/);
    await expectError(await request.get(`${AGENT}/api/flynet/restaurants?page=-1`), 400, /page/);
    await expectError(await request.get(`${AGENT}/api/flynet/restaurants?query=${"x".repeat(201)}`), 400, /query too long/);
    await expectError(await request.get(`${AGENT}/api/flynet/restaurants?loanId=999999`), 404, /not found/);
    await expectError(await request.get(`${AGENT}/api/flynet/restaurants?loanId=abc`), 400);
    await expectError(await request.get(`${AGENT}/api/flynet/restaurants/nope`), 400, /UUID/);
    await expectError(await request.get(`${AGENT}/api/flynet/trending?region=${"x".repeat(81)}`), 400, /region too long/);
  });

  test("GET /api/flynet/restaurants + trending return live venues (or a stale copy)", async ({ request }) => {
    test.setTimeout(120_000);
    const r = await request.get(`${AGENT}/api/flynet/restaurants?page=0`, { timeout: 90_000 });
    expect(r.status(), await r.text()).toBe(200);
    const l = await r.json();
    expect(l.total).toBeGreaterThan(0);
    expect(l.places.length).toBeGreaterThan(0);
    expect(l.places[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(typeof l.source.fetchedAt).toBe("string");
    const t = await request.get(`${AGENT}/api/flynet/trending`, { timeout: 90_000 });
    expect(t.status(), await t.text()).toBe(200);
    const tj = await t.json();
    expect(Array.isArray(tj.places)).toBeTruthy();
    expect(tj.sample.size).toBeGreaterThanOrEqual(0);
  });

  test("POST dine/plan validates the body", async ({ request }) => {
    const plan = (data: unknown) => request.post(`${AGENT}/api/loans/1/dine/plan`, { data });
    await expectError(await plan({}), 400, /request must be 1..500/);
    await expectError(await plan({ request: "x".repeat(501) }), 400, /request must be 1..500/);
    await expectError(await plan({ request: "burgers", partySize: 0 }), 400, /partySize/);
    await expectError(await plan({ request: "burgers", partySize: 21 }), 400, /partySize/);
    await expectError(await plan({ request: "burgers", time: "25:00" }), 400, /time must be/);
    await expectError(await plan({ request: "burgers", near: { lat: 200, lng: 0 } }), 400, /near/);
    await expectError(await request.post(`${AGENT}/api/loans/1/dine/plan`, { headers: json, data: Buffer.from("{bad") }), 400, /JSON/);
    await expectError(await request.post(`${AGENT}/api/loans/999999/dine/plan`, { data: { request: "burgers" } }), 404);
    await expectError(await request.post(`${AGENT}/api/loans/abc/dine/plan`, { data: { request: "burgers" } }), 400);
  });

  // One live concierge call (the agent caches a plan for 10 min; the /dine/1 UI test sends the same body).
  test("POST dine/plan returns ranked picks, each with reasons", async ({ request }) => {
    test.setTimeout(180_000);
    const r = await request.post(`${AGENT}/api/loans/1/dine/plan`, { data: { request: "somewhere in NYC for four, open late, burgers", partySize: 4 }, timeout: 150_000 });
    expect(r.status(), await r.text()).toBe(200);
    const p = await r.json();
    expect(p.loanId).toBe(1);
    expect(["deterministic", "bankr-llm"]).toContain(p.ranker);
    expect(Array.isArray(p.notes)).toBeTruthy();
    if (p.picks.length === 0) {
      // Flynet rate limit (429) / outage: the plan must say why instead of an empty shrug.
      expect(p.notes.length).toBeGreaterThan(0);
      return;
    }
    for (const x of p.picks) {
      expect(x.place.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(x.reasons.length, x.place.name).toBeGreaterThan(0);
    }
    // Loan 1 is not ACTIVE, so the plan must say the budget is a plan only.
    expect(p.notes.join(" ")).toMatch(/plan until the loan is funded/);
  });

  test("member routes need a Blackbird session (401); save-to-list is never faked", async ({ request }) => {
    await expectError(await request.get(`${AGENT}/api/loans/1/dine/passport`), 401, /session required/);
    await expectError(await request.post(`${AGENT}/api/loans/1/dine/save`, { data: { restaurantId: "00000000-0000-0000-0000-000000000000" } }), 401, /session required/);
    await expectError(await request.post(`${AGENT}/api/loans/1/dine/save`, { data: { session: "forged" } }), 401);
    await expectError(await request.delete(`${AGENT}/api/loans/1/dine/member`), 401);
    await expectError(await request.get(`${AGENT}/api/loans/999999/dine/passport`), 404);
  });

  test("GET /api/flynet/connect: missing params is 400, bad signature is 401", async ({ request }) => {
    const r = await request.get(`${AGENT}/api/flynet/connect`, { maxRedirects: 0 });
    expect(r.status()).toBe(400);
    expect((await r.json()).error).not.toContain("NaN");
    await expectError(await request.get(`${AGENT}/api/flynet/connect?loanId=1&nonce=abcdefgh&sig=0x00`, { maxRedirects: 0 }), 401, /signature/);
  });

  test("GET /api/flynet/callback with a forged state is 400", async ({ request }) => {
    await expectError(await request.get(`${AGENT}/api/flynet/callback?code=x&state=y`, { maxRedirects: 0 }), 400, /state/);
  });
});

test.describe("agent API: DEMO_FORK safety", () => {
  const app = { token: POOL.token, borrower: POOL.beneficiary, nonce: "12345678", signature: "0x00" };

  test("POST /api/loans via bankr-skill (or no via) is refused 409 on the fork", async ({ request }) => {
    await expectError(await request.post(`${AGENT}/api/loans`, { data: { ...app, via: "bankr-skill" } }), 409, /DEMO fork/);
    await expectError(await request.post(`${AGENT}/api/loans`, { data: app }), 409, /DEMO fork/);
    await expectError(await request.post(`${AGENT}/api/loans`, { data: { ...app, via: "telegram" } }), 400, /via must be/);
  });

  test("loan payloads are tagged fork:true + warning and never carry the Bankr chat pledge phrase", async ({ request }) => {
    const list = await (await request.get(`${AGENT}/api/loans`)).json();
    for (const l of list) {
      expect(l.fork, `loan ${l.id}`).toBe(true);
      expect(l.warning).toMatch(/DEMO FORK.*ONLY to the fork/);
      expect(l.pledgeChatText ?? null).toBeNull();
    }
    const d = await (await request.get(`${AGENT}/api/loans/${list[0].id}`)).json();
    expect(d.fork).toBe(true);
    expect(d.warning).toMatch(/unrecoverable/);
    expect(d.pledgeChatText ?? null).toBeNull();
  });
});

test.describe("agent API: risk (x402 verdicts)", () => {
  test("GET /api/risk/:token is a read-only cached verdict; bad token 400", async ({ request }) => {
    const r = await request.get(`${AGENT}/api/risk/${POOL.token}`);
    expect(r.status()).toBe(200);
    const v = await r.json();
    expect(v.token.toLowerCase()).toBe(POOL.token.toLowerCase());
    if (v.verdict === null) {
      expect(v.note).toMatch(/no verdict/);
      expect(v.spentTodayRaw).toMatch(/^\d+$/);
    }
    await expectError(await request.get(`${AGENT}/api/risk/0xabc`), 400, /0x address/);
  });

  test("POST /api/admin/risk/:token (a paid purchase) is admin-gated", async ({ request }) => {
    await expectError(await request.post(`${AGENT}/api/admin/risk/${POOL.token}`), 401);
    await expectError(await request.post(`${AGENT}/api/admin/risk/${POOL.token}`, { headers: { "x-admin-token": "wrong" } }), 401);
  });
});

test.describe("agent API: signal cards", () => {
  test("GET /api/signals/1 is a SignalCard; bad id 400, unknown 404", async ({ request }) => {
    const c = await (await request.get(`${AGENT}/api/signals/1`)).json();
    expect(c.id).toBe(1);
    expect(["approve", "decline"]).toContain(c.decision);
    expect(typeof c.personaName).toBe("string");
    await expectError(await request.get(`${AGENT}/api/signals/abc`), 400, /positive integer/);
    await expectError(await request.get(`${AGENT}/api/signals/999999`), 404, /not found/);
  });
});
