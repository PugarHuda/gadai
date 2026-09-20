// Fixtures in ./fixtures are REAL Flynet production responses captured 2026-09-19 (see each file's captured_on/source),
// except member_openapi_examples.json: member-token routes copied from the official OpenAPI examples (captured_on: null).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { insertLoan, listEvents, openDb } from "../db/index.ts";
import type { Ctx } from "../ctx.ts";
import {
  cached, describeCues, register, employersOf, isOpenNow, listPayments, listPlaces, openAt, parseRequest, payIdempotencyKey, paymentsFrom,
  prefilter, SAVE_TO_LIST, SCOPES, toChallenges, toHours, tokenScopes, tokenSub, toMembership, toPlace, toSpecials, trendingFrom, validatePlan,
} from "./index.ts";

const fx = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), "utf8"));
const places = (fx("locations").locations as Record<string, unknown>[]).map(toPlace);

test("fixtures are labelled captures", () => {
  for (const n of ["locations", "open_hours", "specials", "challenges", "app", "check_ins_recent", "check_ins_week_count"]) assert.equal(fx(n).captured_on, "2026-09-19");
  for (const n of ["member_openapi_examples", "payment_intents_openapi"]) assert.equal(fx(n).captured_on, null); // documented shapes, not captures
  assert.ok(!fx("app").allowed_scopes.includes("write:rewards")); // why payments are off
});

test("OAuth asks for exactly member scopes the app holds (Blackbird rejects any other with invalid_request)", () => {
  const allowed: string[] = fx("app").allowed_scopes;
  assert.equal(fx("app").name, "hackathon 2");
  for (const s of SCOPES) assert.ok(allowed.includes(s), s);
  for (const s of ["read:memberships", "read:tags", "write:save_to_list"]) assert.ok(SCOPES.includes(s), s);
  assert.equal(SAVE_TO_LIST.available, false); // granted scope, no published endpoint: never guess one
});

test("tokenScopes reads the JWT scope claim; non-JWT → null", () => {
  const jwt = ["e30", Buffer.from(JSON.stringify({ sub: "u", scope: "read:profile read:tags" })).toString("base64url"), "sig"].join(".");
  assert.deepEqual(tokenScopes(jwt), ["read:profile", "read:tags"]);
  assert.equal(tokenScopes("opaque-token"), null);
});

test("network check-ins: trending groups the real feed by venue; week count is pagination.total_count", () => {
  const cis = fx("check_ins_recent").check_ins as Record<string, any>[];
  assert.ok(cis.every((c) => !("user" in c))); // anonymized feed, per the OpenAPI
  const t = trendingFrom(cis);
  assert.equal(t.rows.reduce((n, r) => n + r.recentCheckIns, 0), cis.filter((c) => c.location?.id).length);
  assert.ok(t.rows[0]!.recentCheckIns >= t.rows.at(-1)!.recentCheckIns);
  assert.ok(t.from! <= t.to!);
  assert.ok(t.rows.every((r) => !r.place.cuisine.includes("10X Coffee Club")));
  const ny = trendingFrom(cis, "New York, NY");
  assert.ok(ny.rows.length > 0 && ny.rows.every((r) => r.place.region === "New York, NY"));
  assert.deepEqual(trendingFrom([], "Denver, CO"), { rows: [], from: null, to: null });
  assert.equal(typeof fx("check_ins_week_count").pagination.total_count, "number");
});

test("memberships + industry tags (OpenAPI example shapes) personalize the ranking with reasons", () => {
  const ex = fx("member_openapi_examples");
  const m = toMembership(ex.memberships.memberships[0]);
  assert.deepEqual([m.tier, m.checkIns, m.restaurantId], ["Member", 1, "2cb56d03-4417-4b60-afe3-be819ecde8ac"]);
  assert.deepEqual(employersOf(ex.tags.tags), ["flybar"]);
  assert.deepEqual(employersOf([]), []);
  const c = parseRequest("burgers in NYC", places);
  const plain = prefilter(places, c, { partySize: 1, budgetUsd: 1000 }).candidates;
  const target = plain.at(-1)!.p; // boost the last-ranked brand
  const card = { ...m, restaurantId: target.restaurantId, tier: "VIP", checkIns: 7 };
  const r = prefilter(places, c, { partySize: 1, budgetUsd: 1000, memberships: new Map([[target.restaurantId, card]]), employers: [target.name.toLowerCase()] }).candidates;
  const hit = r.find((s) => s.p.restaurantId === target.restaurantId)!;
  assert.ok(hit.score > plain.find((s) => s.p.restaurantId === target.restaurantId)!.score);
  assert.ok(hit.reasons.some((x) => x.includes(`"VIP" membership`) && x.includes("7 check-ins")));
  assert.ok(hit.reasons.some((x) => x.includes("industry tag")));
  assert.equal(hit.membership?.tier, "VIP");
  const fresh = prefilter(places, parseRequest("burgers in NYC, somewhere new", places), { partySize: 1, budgetUsd: 1000, memberships: new Map([[target.restaurantId, card]]) }).candidates;
  assert.ok(!fresh.find((s) => s.p.restaurantId === target.restaurantId)!.reasons.some((x) => x.includes("membership")));
});

test("toPlace: brand name over street-address location name, {0,0} coordinate → null, maps link", () => {
  const p = places.find((x) => x.id === "aec582dc-5f47-40c3-ab10-1da436d69e2e")!;
  assert.equal(p.name, "Bareburger");
  assert.equal(p.region, "New York, NY");
  assert.ok(p.image?.startsWith("https://images.blackbird.xyz/"));
  assert.ok(p.mapsUrl?.includes("place_id:"));
  const zero = (fx("locations").locations as any[]).find((l) => !l.coordinate?.latitude);
  assert.equal(toPlace(zero).lat, null);
  assert.ok(places.every((x) => !x.cuisine.includes("10X Coffee Club"))); // loyalty tag, not a cuisine
});

test("open hours: real overnight close (Fri 12:00–02:30) and same-day windows", () => {
  const h = toHours(fx("open_hours"));
  assert.equal(h.length, 7);
  assert.equal(openAt(h, "friday", "23:30"), true);
  assert.equal(openAt(h, "saturday", "02:00"), true); // Friday spill
  assert.equal(openAt(h, "saturday", "03:00"), false);
  assert.equal(openAt(h, "monday", "22:30"), false); // Sunday closes 22:00, no spill
  assert.equal(openAt([], "monday", "12:00"), null);
  assert.equal(isOpenNow(h, "America/New_York", new Date("2026-09-19T01:00:00-04:00")), true); // Sat 01:00 NY
});

test("specials dedupe (Flynet returns the same special twice); empty challenges parse", () => {
  const s = toSpecials(fx("specials"));
  assert.equal(fx("specials").specials.length, 2);
  assert.equal(s.length, 1);
  assert.equal(s[0]!.label, "Earn 10X back in Fly");
  assert.deepEqual(toChallenges(fx("challenges")), []);
});

test("parseRequest reads city, cuisine, late, party cues", () => {
  const c = parseRequest("somewhere in NYC for four, open late, burgers", places);
  assert.equal(c.region, "New York, NY");
  assert.ok(c.cuisines.includes("Burgers"));
  assert.equal(c.late, true);
  assert.equal(parseRequest("cheap drinks in SF", places).maxPrice, 2);
  assert.equal(parseRequest("a table in la for a birthday", places).region, "Los Angeles, CA");
  assert.equal(parseRequest("a place for salad", places).region, null); // "la" inside words must not match
  assert.ok(describeCues(c, 4).includes("party of 4"));
});

test("prefilter: region + cuisine filters, one venue per brand, budget fit", () => {
  const c = parseRequest("burgers in NYC", places);
  const r = prefilter(places, c, { partySize: 4, budgetUsd: 100 });
  assert.ok(r.candidates.length > 0);
  assert.ok(r.candidates.every((s) => s.p.region === "New York, NY" && s.p.cuisine.includes("Burgers")));
  const brands = r.candidates.map((s) => s.p.restaurantId);
  assert.equal(new Set(brands).size, brands.length); // Bareburger appears once, not 4×
  const two = r.candidates.find((s) => s.p.price === 2);
  if (two) assert.equal(two.fits, false); // $35 × 4 = $140 > $100
  const none = prefilter(places, parseRequest("ethiopian in Denver", places), { partySize: 2, budgetUsd: 100 });
  assert.ok(none.candidates.every((s) => s.p.region === "Denver, CO"));
});

test("prefilter personalization: 'somewhere new' demotes visited venues", () => {
  const c = parseRequest("burgers in NYC, somewhere new", places);
  const first = prefilter(places, parseRequest("burgers in NYC", places), { partySize: 1, budgetUsd: 1000 }).candidates[0]!;
  const visits = new Map([[first.p.id, 3]]);
  const r = prefilter(places, c, { partySize: 1, budgetUsd: 1000, visits });
  assert.notEqual(r.candidates[0]!.p.id, first.p.id);
});

test("listPlaces: search, filters, pagination, facet lists", () => {
  const all = listPlaces(places, { page: 0 }, 10);
  assert.equal(all.total, places.length);
  assert.equal(all.places.length, 10);
  assert.ok(all.regions.includes("New York, NY"));
  const q = listPlaces(places, { query: "bareburger", page: 0 });
  assert.ok(q.total >= 1 && q.places.every((p) => p.name === "Bareburger"));
  assert.equal(listPlaces(places, { region: "Denver, CO", price: 4, page: 0 }).places.every((p) => p.price === 4), true);
});

test("validatePlan: 400s on bad input", () => {
  const bad = (b: object) => assert.throws(() => validatePlan(b as any), (e: any) => e.status === 400);
  bad({});
  bad({ request: "x".repeat(501) });
  bad({ request: "tacos", partySize: 0 });
  bad({ request: "tacos", partySize: 2.5 });
  bad({ request: "tacos", time: "25:00" });
  bad({ request: "tacos", near: { lat: 200, lng: 0 } });
  assert.deepEqual(validatePlan({ request: " tacos ", partySize: 4, time: "21:30" }), { request: "tacos", partySize: 4, time: "21:30", near: undefined });
});

test("cached: TTL, kv persistence, stale copy when Flynet fails", async () => {
  const ctx = { db: openDb(":memory:"), log: () => {} } as unknown as Ctx;
  let calls = 0;
  const a = await cached(ctx, "t1", 60_000, async () => ++calls);
  const b = await cached(ctx, "t1", 60_000, async () => ++calls);
  assert.equal(a.v, 1); assert.equal(b.v, 1); assert.equal(calls, 1);
  const s = await cached(ctx, "t1", 0, async () => { throw new Error("Flynet down"); });
  assert.equal(s.stale, true); assert.equal(s.v, 1);
  await assert.rejects(cached(ctx, "t2", 0, async () => { throw new Error("Flynet down"); }), /Flynet down/);
});

test("POST /dine/save: 400/401/403 guards, then an honest 501 (no published save-to-list endpoint)", async () => {
  const ctx = { db: openDb(":memory:"), log: () => {} } as unknown as Ctx;
  const app = new Hono();
  app.onError((e, c) => c.json({ error: e.message }, e instanceof HTTPException ? e.status : 500));
  register(app, ctx);
  const id = insertLoan(ctx.db, { status: "ACTIVE", borrower: "0x0000000000000000000000000000000000000001", token: "0x0000000000000000000000000000000000000002", symbol: "T", poolId: "0x00" as never, feesManager: "0x0000000000000000000000000000000000000003" });
  // a linked member whose (unsigned, local-only) access token carries the scopes; nothing here reaches Flynet
  const jwt = (scope: string) => ["e30", Buffer.from(JSON.stringify({ sub: "m", scope })).toString("base64url"), "s"].join(".");
  const link = (scope: string) => ctx.db.prepare("INSERT OR REPLACE INTO flynet_links (loan_id,member_id,access_token,refresh_token,expires_at,created_at) VALUES (?,?,?,?,?,?)")
    .run(id, "m", jwt(scope), "", new Date(Date.now() + 3600_000).toISOString(), new Date().toISOString());
  ctx.db.prepare("INSERT INTO kv (key,value,updated_at) VALUES (?,?,?)").run(`flynet:view:${id}`, createHash("sha256").update("sess").digest("hex"), "now");
  const post = (b: object) => app.request(`/api/loans/${id}/dine/save`, { method: "POST", body: JSON.stringify(b), headers: { "content-type": "application/json" } });
  const rid = "dbd98153-257f-4293-97b9-df3174fd2753";
  link("read:profile write:save_to_list");
  assert.equal((await post({ session: "sess", restaurantId: "nope" })).status, 400);
  assert.equal((await post({ session: "wrong", restaurantId: rid })).status, 401);
  const r = await post({ session: "sess", restaurantId: rid });
  assert.equal(r.status, 501);
  assert.match((await r.json()).error, /has not published the save-to-list endpoint/);
  link("read:profile");
  assert.equal((await post({ session: "sess", restaurantId: rid })).status, 403);
});

// ─── FLY checkout ───
// Every Flynet response below is a recorded shape from the official OpenAPI (fixtures/payment_intents_openapi.json,
// captured_on: null), served by a stubbed fetch. No test here reaches the network, let alone a payment route.
const fxp = fx("payment_intents_openapi");
function stubFetch(handler: (url: string, method: string, body: any) => { status: number; body: unknown }) {
  const calls: { method: string; url: string; body: any }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (u: unknown, init: any = {}) => {
    const url = String(u), method = init.method ?? "GET", body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, url, body });
    const r = handler(url, method, body);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = real; } };
}
const ONE_FLY = String(10n ** 18n);
/** A loan with a linked Blackbird member whose (unsigned, local-only) JWT carries `sub`, plus a valid view session. */
function payFixture() {
  process.env.FLYNET_API_KEY = "test-key";
  process.env.FLYNET_MAX_PAY_FLY = "2";
  const ctx = { db: openDb(":memory:"), log: () => {} } as unknown as Ctx;
  const app = new Hono();
  app.onError((e, c) => c.json({ error: e.message }, e instanceof HTTPException ? e.status : 500));
  register(app, ctx);
  const id = insertLoan(ctx.db, { status: "ACTIVE", borrower: "0x0000000000000000000000000000000000000001", token: "0x0000000000000000000000000000000000000002", symbol: "T", poolId: "0x00" as never, feesManager: "0x0000000000000000000000000000000000000003" });
  const jwt = ["e30", Buffer.from(JSON.stringify({ sub: "member-sub-1", scope: "read:profile read:wallets" })).toString("base64url"), "s"].join(".");
  ctx.db.prepare("INSERT INTO flynet_links (loan_id,member_id,access_token,refresh_token,expires_at,created_at) VALUES (?,?,?,?,?,?)")
    .run(id, "stored-member-id", jwt, "", new Date(Date.now() + 3600_000).toISOString(), new Date().toISOString());
  ctx.db.prepare("INSERT INTO kv (key,value,updated_at) VALUES (?,?,?)").run(`flynet:view:${id}`, createHash("sha256").update("sess").digest("hex"), "now");
  const call = (path: string, method: string, b?: object) =>
    app.request(path, { method, body: b === undefined ? undefined : JSON.stringify(b), headers: { "content-type": "application/json" } });
  return { ctx, app, id, call, pay: (b: object) => call(`/api/loans/${id}/dine/pay`, "POST", b) };
}
const dineEvents = (ctx: Ctx, id: number) => listEvents(ctx.db, id).filter((e) => e.kind === "dine_payment").map((e) => e.data as any);

test("payments state is read from the app's own allowed_scopes, never assumed", () => {
  const app = fx("app");
  const p = paymentsFrom(app);
  assert.equal(p.state, "pending-review"); // "hackathon 2" holds no payment scope today
  assert.equal(p.enabled, false);
  assert.match(p.reason, /pending Blackbird review/);
  assert.match(p.reason, /403/);
  const live = paymentsFrom({ name: "later", allowed_scopes: [...app.allowed_scopes, "write:payments"] });
  assert.equal(live.state, "enabled");
  assert.equal(live.enabled, true);
  assert.equal(paymentsFrom(null).state, "unknown");
  assert.equal(paymentsFrom({ name: "x" }).enabled, false);
});

test("idempotency key is stable inside one UTC minute and moves with loan, restaurant, amount, minute", () => {
  const at = new Date("2026-09-20T12:34:56Z");
  const k = payIdempotencyKey(7, "r1", ONE_FLY, at);
  assert.match(k, /^gadai-7-[0-9a-f]{32}$/);
  assert.equal(k, payIdempotencyKey(7, "r1", ONE_FLY, new Date("2026-09-20T12:34:01Z"))); // same minute → same key
  for (const other of [
    payIdempotencyKey(7, "r1", ONE_FLY, new Date("2026-09-20T12:35:00Z")),
    payIdempotencyKey(8, "r1", ONE_FLY, at), payIdempotencyKey(7, "r2", ONE_FLY, at),
    payIdempotencyKey(7, "r1", String(2n * 10n ** 18n), at), payIdempotencyKey(7, null, ONE_FLY, at),
  ]) assert.notEqual(k, other);
});

test("tokenSub reads the JWT sub; an opaque token has none (the stored member id is the fallback)", () => {
  assert.equal(tokenSub(["e30", Buffer.from(JSON.stringify({ sub: "u1" })).toString("base64url"), "s"].join(".")), "u1");
  assert.equal(tokenSub("opaque"), null);
});

test("POST /dine/pay guards: 404 unknown loan, 401 no session, 400 bad amount, 400 over the FLY cap — none of them call Flynet", async () => {
  const f = payFixture();
  const net = stubFetch(() => { throw new Error("a guard must reject before any Flynet call"); });
  try {
    assert.equal((await f.call("/api/loans/999999/dine/pay", "POST", { session: "sess", amountWei: ONE_FLY })).status, 404);
    assert.equal((await f.pay({ amountWei: ONE_FLY })).status, 401); // no session at all
    assert.equal((await f.pay({ session: "wrong", amountWei: ONE_FLY })).status, 401);
    for (const amountWei of [undefined, "", "0", "abc", "1.5", "-1", 1, 10 ** 18])
      assert.equal((await f.pay({ session: "sess", amountWei })).status, 400, String(amountWei));
    const over = await f.pay({ session: "sess", amountWei: String(3n * 10n ** 18n) }); // cap is 2 FLY
    assert.equal(over.status, 400);
    assert.match((await over.json()).error, /over this desk's 2 FLY cap.*FLYNET_MAX_PAY_FLY.*3 FLY/);
    assert.equal((await f.pay({ session: "sess", amountWei: ONE_FLY, restaurantId: "not-a-uuid" })).status, 400);
    assert.equal((await f.pay({ session: "sess", amountWei: ONE_FLY, description: "x".repeat(201) })).status, 400);
    assert.equal(net.calls.length, 0);
    assert.deepEqual(listPayments(f.ctx, f.id), []);
  } finally { net.restore(); }
});

test("POST /dine/pay: Blackbird's 403 (payments pending review) is surfaced verbatim, recorded, and never dressed up as paid", async () => {
  const f = payFixture();
  const net = stubFetch((url) => url.endsWith("/payment_intents") ? { status: 403, body: fxp.forbidden_403 } : { status: 200, body: fxp.balance_200 });
  let r: Response;
  try { r = await f.pay({ session: "sess", amountWei: ONE_FLY, restaurantId: "dbd98153-257f-4293-97b9-df3174fd2753" }); } finally { net.restore(); }
  assert.equal(r.status, 403); // Flynet's own status, not a blanket 502
  const err = (await r.json()).error as string;
  assert.equal(err, `Flynet POST /payment_intents → 403 ${fxp.forbidden_403.error.message}`);
  assert.equal(net.calls.filter((c) => c.method === "POST").length, 1); // no confirm after a failed create
  assert.deepEqual(listPayments(f.ctx, f.id), []); // no row: nothing was created
  const ev = dineEvents(f.ctx, f.id);
  assert.equal(ev.length, 1);
  assert.deepEqual([ev[0].action, ev[0].ok, ev[0].status, ev[0].error], ["create", false, 403, err]);
});

test("POST /dine/pay (stubbed): create → confirm sends exactly the documented fields, then persists intent, event and balance delta", async () => {
  const f = payFixture();
  const balances = ["12000000000000000000", "13000000000000000000"];
  const net = stubFetch((url, method) => {
    if (url.endsWith("/balance")) return { status: 200, body: { ...fxp.balance_200, balance: { value: balances.shift() ?? "0", currency: "fly" } } };
    if (url.endsWith("/payment_intents") && method === "POST") return { status: 201, body: fxp.create_201 };
    if (url.endsWith("/confirm")) return { status: 200, body: fxp.confirm_200 };
    throw new Error(`unexpected ${method} ${url}`);
  });
  let r: Response;
  try { r = await f.pay({ session: "sess", amountWei: ONE_FLY, restaurantId: "dbd98153-257f-4293-97b9-df3174fd2753", description: "Dinner at Bareburger" }); } finally { net.restore(); }
  assert.equal(r.status, 200);
  const out = await r.json();

  const create = net.calls.find((c) => c.url.endsWith("/payment_intents"))!;
  assert.equal(create.body.customer_user_id, "member-sub-1"); // the token's sub, not the stored id
  assert.deepEqual(create.body.amount, { value: ONE_FLY, currency: "FLY" });
  assert.equal(create.body.description, "Dinner at Bareburger");
  assert.match(create.body.idempotency_key, /^gadai-\d+-[0-9a-f]{32}$/);
  assert.deepEqual(Object.keys(create.body).sort(), ["amount", "customer_user_id", "description", "idempotency_key", "metadata"]); // flynet_merchant_id omitted: credits this app's own merchant
  const confirm = net.calls.find((c) => c.url.endsWith("/confirm"))!;
  assert.equal(confirm.url, `https://api.blackbird.xyz/flynet/v1/payment_intents/${fxp.create_201.id}/confirm`);
  assert.deepEqual(confirm.body, { user_id: "member-sub-1" });

  assert.equal(out.payment.status, "paid");
  assert.equal(out.payment.intentId, fxp.create_201.id);
  assert.equal(out.payment.amountWei, ONE_FLY);
  assert.equal(out.intent.status, "paid"); // Flynet's intent, verbatim
  assert.deepEqual([out.balanceBefore.flyWei, out.balanceAfter.flyWei], ["12000000000000000000", "13000000000000000000"]);

  const rows = listPayments(f.ctx, f.id);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0]!.status, rows[0]!.memberId, rows[0]!.restaurantId], ["paid", "member-sub-1", "dbd98153-257f-4293-97b9-df3174fd2753"]);
  const ev = dineEvents(f.ctx, f.id);
  assert.equal(ev.length, 1);
  assert.deepEqual([ev[0].action, ev[0].ok, ev[0].status, ev[0].amountWei], ["pay", true, "paid", ONE_FLY]);
  assert.equal(ev[0].balanceAfter.flyWei, "13000000000000000000");

  assert.equal((await f.call(`/api/loans/${f.id}/dine/payments`, "GET")).status, 401); // the list needs the same session
  const list = await f.call(`/api/loans/${f.id}/dine/payments?session=sess`, "GET");
  assert.deepEqual((await list.json()).map((p: any) => p.intentId), [fxp.create_201.id]);
});

test("refund and cancel: 401 without a session, 404 for an intent this loan never created, otherwise Flynet's new status", async () => {
  const f = payFixture();
  const paid = stubFetch((url, method) => {
    if (url.endsWith("/balance")) return { status: 200, body: fxp.balance_200 };
    if (url.endsWith("/payment_intents") && method === "POST") return { status: 201, body: fxp.create_201 };
    if (url.endsWith("/confirm")) return { status: 200, body: fxp.confirm_200 };
    throw new Error(`unexpected ${method} ${url}`);
  });
  try { await f.pay({ session: "sess", amountWei: ONE_FLY }); } finally { paid.restore(); }
  const iid = fxp.create_201.id;

  const guard = stubFetch(() => { throw new Error("a guard must reject before any Flynet call"); });
  try {
    assert.equal((await f.call(`/api/loans/${f.id}/dine/pay/${iid}/refund`, "POST", {})).status, 401);
    assert.equal((await f.call(`/api/loans/${f.id}/dine/pay/00000000-0000-4000-8000-000000000000/refund`, "POST", { session: "sess" })).status, 404);
    assert.equal((await f.call(`/api/loans/${f.id}/dine/pay/not-an-id-${"x".repeat(80)}/refund`, "POST", { session: "sess" })).status, 400);
    assert.equal((await f.call(`/api/loans/999999/dine/pay/${iid}`, "DELETE", { session: "sess" })).status, 404);
    assert.equal(guard.calls.length, 0);
  } finally { guard.restore(); }

  const net = stubFetch((url) => url.endsWith("/balance") ? { status: 200, body: fxp.balance_200 } : { status: 200, body: fxp.refund_200 });
  let r: Response;
  try { r = await f.call(`/api/loans/${f.id}/dine/pay/${iid}/refund`, "POST", { session: "sess" }); } finally { net.restore(); }
  assert.equal(r.status, 200);
  assert.equal((await r.json()).payment.status, "refunded");
  assert.equal(net.calls.find((c) => c.method === "POST")!.url, `https://api.blackbird.xyz/flynet/v1/payment_intents/${iid}/refund`);
  assert.equal(listPayments(f.ctx, f.id)[0]!.status, "refunded");
  const ev = dineEvents(f.ctx, f.id).at(-1)!;
  assert.deepEqual([ev.action, ev.was, ev.status], ["refund", "paid", "refunded"]);

  // DELETE maps to Flynet's POST /cancel, and its 400 keeps that status instead of becoming a 502
  const no = stubFetch((url) => url.endsWith("/balance") ? { status: 200, body: fxp.balance_200 } : { status: 400, body: fxp.insufficient_fly_400 });
  let c: Response;
  try { c = await f.call(`/api/loans/${f.id}/dine/pay/${iid}`, "DELETE", { session: "sess" }); } finally { no.restore(); }
  assert.equal(c.status, 400);
  assert.equal((await c.json()).error, `Flynet POST /payment_intents/${iid}/cancel → 400 ${fxp.insufficient_fly_400.error.message}`);
  assert.equal(no.calls.find((x) => x.method === "POST")!.url.endsWith("/cancel"), true);
});
