// Fixtures in ./fixtures are REAL Flynet production responses captured 2026-09-19 (see each file's captured_on/source).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openDb } from "../db/index.ts";
import type { Ctx } from "../ctx.ts";
import {
  cached, describeCues, isOpenNow, listPlaces, openAt, parseRequest, prefilter, toChallenges, toHours, toPlace, toSpecials, validatePlan,
} from "./index.ts";

const fx = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), "utf8"));
const places = (fx("locations").locations as Record<string, unknown>[]).map(toPlace);

test("fixtures are labelled captures", () => {
  for (const n of ["locations", "open_hours", "specials", "challenges", "app"]) assert.equal(fx(n).captured_on, "2026-09-19");
  assert.ok(!fx("app").allowed_scopes.includes("write:rewards")); // why payments are off
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
