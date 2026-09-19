// Blackbird Flynet dining concierge (docs/integrations/flynet.md; live docs https://docs.flynet.org).
// What the approved "hackathon" app may do (GET /app allowed_scopes, 2026-09-19): read restaurants/locations/hours,
// specials, challenges, the anonymized venue feed, its own balance, and, with member OAuth, profile/wallets/check-ins.
// It has NO write:rewards and no payment-intent access, so this module never moves FLY or USDC: the loan's drawLimit is a
// planning budget, and the member pays in the Blackbird app. See the DECISION line in docs/COORDINATION.md.
import { createHash, randomBytes } from "node:crypto";
import { HTTPException } from "hono/http-exception";
import type { Context, Hono } from "hono";
import { AUTH_BASE_BY_ENV, FlynetOAuth } from "@flynetdev/core";
import {
  API, flynetLinkMessage,
  type DineChallenge, type DineHour, type DinePassport, type DinePick, type DinePlace, type DinePlaceDetail, type DinePlaceList,
  type DinePlan, type DinePlanRequest, type DineSource, type DineSpecial, type DineState, type FlynetStatus, type Hex, type Loan,
} from "@feedesk/shared";
import type { Ctx } from "../ctx.ts";
import { jsonBody, need, opt, posInt } from "../ctx.ts";
import { getLoan, now, useNonce } from "../db/index.ts";
import { llmChat, LlmNoCredits } from "../bankr/index.ts";

type R = Record<string, any>;
const SCOPES = ["read:profile", "read:wallets", "read:user_checkins"]; // what the app is allowed; read:memberships is not
const env = () => (opt("FLYNET_ENV", "staging") === "production" ? "production" : "staging");
const base = () => (env() === "production" ? API.FLYNET_PROD : API.FLYNET_STAGING);
export const PAYMENTS = {
  enabled: false as const,
  reason: "Paying with FLY needs Blackbird partner access (write:rewards / payment intents). This app is read-only, so Gadai books no draw and moves no FLY or USDC: the member pays at the venue in the Blackbird app.",
};
const TTL = { catalog: 6 * 3600_000, hours: 6 * 3600_000, offers: 3600_000, app: 3600_000 };

// ─── Flynet HTTP (API key: `x-api-key`; member routes: Bearer) ───
class FlyError extends Error { status: number; constructor(status: number, msg: string) { super(msg); this.status = status; } }
async function flyGet<T = R>(path: string, bearer?: string, retried = false): Promise<T> {
  const headers: Record<string, string> = bearer ? { authorization: `Bearer ${bearer}` } : { "x-api-key": need("FLYNET_API_KEY") };
  const r = await fetch(base() + path, { headers, signal: AbortSignal.timeout(15_000) })
    .catch((e) => { throw new FlyError(0, `Flynet unreachable (${(e as Error).message})`); });
  const text = await r.text();
  if (r.status === 429 && !retried) { // Flynet rate limit ("Retry after N seconds"): wait once, then give up loudly
    await new Promise((ok) => setTimeout(ok, Math.min(5, Number(r.headers.get("retry-after")) || 1) * 1000));
    return flyGet<T>(path, bearer, true);
  }
  if (!r.ok) {
    let why = r.headers.get("www-authenticate") ?? "";
    try { const j = JSON.parse(text); why = j.error?.message ?? j.message ?? j.error_description ?? why; } catch { /* empty 401 body */ }
    throw new FlyError(r.status, `Flynet GET ${path.split("?")[0]} → ${r.status}${why ? ` ${why}` : ""}`);
  }
  return JSON.parse(text) as T;
}
/** Flynet failure → HTTP: its 404 stays 404, everything else is a 502 that names Flynet's status. */
const toHttp = (e: unknown): never => {
  if (e instanceof HTTPException) throw e;
  const st = (e as FlyError).status;
  throw new HTTPException(st === 404 ? 404 : 502, { message: (e as Error).message });
};

// ─── cache: memory + kv table, TTL; serves the last good copy (marked stale) when Flynet fails ───
const mem = new Map<string, { at: number; v: unknown }>();
const inflight = new Map<string, Promise<{ at: number; v: unknown }>>();
export async function cached<T>(ctx: Ctx, key: string, ttlMs: number, load: () => Promise<T>): Promise<{ v: T; at: number; stale: boolean }> {
  let hit = mem.get(key);
  if (!hit) {
    const row = ctx.db.prepare("SELECT value FROM kv WHERE key = ?").get(`flynet:cache:${key}`) as R | undefined;
    if (row) { hit = JSON.parse(row.value); mem.set(key, hit!); }
  }
  if (hit && Date.now() - hit.at < ttlMs) return { v: hit.v as T, at: hit.at, stale: false };
  let p = inflight.get(key);
  if (!p) {
    p = load().then((v) => {
      const e = { at: Date.now(), v };
      mem.set(key, e);
      ctx.db.prepare("INSERT INTO kv (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at")
        .run(`flynet:cache:${key}`, JSON.stringify(e), now());
      return e;
    }).finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  try { const e = await p; return { v: e.v as T, at: e.at, stale: false }; } catch (e) {
    if (hit) { ctx.log("flynet", `serving stale ${key}: ${(e as Error).message}`); return { v: hit.v as T, at: hit.at, stale: true }; }
    throw e;
  }
}
const src = (c: { at: number; stale: boolean }): DineSource => ({ fetchedAt: new Date(c.at).toISOString(), stale: c.stale });

// ─── catalog: every Blackbird location (the restaurant list has brands with empty names and no venue data) ───
export function toPlace(l: R): DinePlace {
  const r = l.restaurant ?? {}, a = l.address ?? {}, c = l.coordinate;
  const hasCoord = c && (c.latitude || c.longitude); // Flynet uses {0,0} for "unknown"
  return {
    id: l.id, restaurantId: r.id, name: r.name || l.name || "Unnamed venue", branch: l.name ?? "", slug: l.slug ?? "",
    cuisine: (r.cuisine ?? []).filter((x: string) => x && x !== "10X Coffee Club"), cohort: r.cohort ?? "", price: r.price ?? null,
    neighborhood: l.neighborhood?.name ?? null, region: l.neighborhood?.region ?? null,
    address: [a.street, a.street2, a.city, a.state].filter(Boolean).join(", "),
    lat: hasCoord ? c.latitude : null, lng: hasCoord ? c.longitude : null, timeZone: l.time_zone || "UTC",
    image: r.asset?.web_2x || r.asset?.preview_1x || null, website: r.website_url ?? null,
    mapsUrl: l.google_place_id ? `https://www.google.com/maps/place/?q=place_id:${l.google_place_id}` : null,
    reservationUrl: l.reservation_url ?? null, reservationsEnabled: !!l.reservations_enabled,
    paymentsEnabled: !!l.payments_enabled, isClub: !!l.is_club,
  };
}
async function catalog(ctx: Ctx) {
  return cached(ctx, "catalog", TTL.catalog, async () => {
    const out: DinePlace[] = [];
    for (let page = 0; page < 100; page++) { // sequential on purpose: ~34 pages, once per 6h
      const r = await flyGet(`/locations?page=${page}&page_size=50`);
      out.push(...(r.locations as R[]).map(toPlace));
      if (r.pagination?.next_page == null) break;
    }
    if (!out.length) throw new FlyError(502, "Flynet returned no locations");
    return out;
  }).catch(toHttp);
}

export const toHours = (r: R): DineHour[] => (r.open_hours as R[]).map((h) => ({ day: h.day_of_week, open: h.open_time.slice(0, 5), close: h.close_time.slice(0, 5) }));
export const toSpecials = (r: R): DineSpecial[] => {
  const seen = new Set<string>(); // Flynet returns the same special twice for some brands
  return (r.specials as R[]).filter((s) => !seen.has(s.label + s.description) && seen.add(s.label + s.description))
    .map((s) => ({ label: String(s.label).trim(), description: String(s.description).trim(), emoji: s.emoji ?? "", flyRewardBips: s.fly_reward_bips ?? null, checkInThreshold: s.check_in_threshold ?? null }));
};
export const toChallenges = (r: R): DineChallenge[] => (r.challenges as R[]).map((c) => ({
  title: c.title, description: c.description, flyReward: c.fly_reward?.value ?? null, endTime: c.end_time ?? null,
}));
const hoursOf = (ctx: Ctx, id: string) => cached(ctx, `hours:${id}`, TTL.hours, async () => toHours(await flyGet(`/locations/${id}/open_hours`)));
const specialsOf = (ctx: Ctx, rid: string) => cached(ctx, `specials:${rid}`, TTL.offers, async () => toSpecials(await flyGet(`/specials?restaurant=${rid}&page_size=20`)));
const challengesOf = (ctx: Ctx, rid: string) => cached(ctx, `challenges:${rid}`, TTL.offers, async () => toChallenges(await flyGet(`/challenges?restaurant=${rid}&page_size=20`)));
/** Settle a batch of cached Flynet reads with bounded concurrency; failures become null + a readable note. */
async function gentle<T, U>(items: T[], fn: (x: T) => Promise<U>, errors: string[], n = 3): Promise<(U | null)[]> {
  const out: (U | null)[] = new Array(items.length).fill(null);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      try { out[k] = await fn(items[k]!); } catch (e) { errors.push((e as Error).message); }
    }
  }));
  return out;
}

// ─── time ───
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
/** Weekday + HH:MM of an instant in a venue's time zone. */
export function localDayTime(timeZone: string, at: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(at).map((x) => [x.type, x.value]));
  return { day: String(p.weekday).toLowerCase(), hm: `${p.hour}:${p.minute}` };
}
/** Open at (day, HH:MM)? null when no hours are published. Handles closes past midnight (close <= open). */
export function openAt(hours: DineHour[], day: string, hm: string): boolean | null {
  if (!hours.length) return null;
  const yesterday = DAYS[(DAYS.indexOf(day) + 6) % 7];
  return hours.some((h) => {
    if (h.day === day) return h.close > h.open ? hm >= h.open && hm < h.close : hm >= h.open;
    return h.day === yesterday && h.close <= h.open && hm < h.close;
  });
}
export const isOpenNow = (hours: DineHour[], timeZone: string, at = new Date()) => { const t = localDayTime(timeZone, at); return openAt(hours, t.day, t.hm); };
/** Late = today's close is 22:00 or later, or past midnight. */
const closesLate = (h: DineHour | undefined) => !!h && (h.close <= h.open || h.close >= "22:00");

// ─── request understanding (deterministic; the same cues feed the LLM) ───
const SYN: [RegExp, string[]][] = [
  [/\b(drinks?|cocktails?|bar|nightcap)\b/, ["Cocktail Bar", "Bar", "Wine Bar"]],
  [/\b(coffee|espresso|latte)\b/, ["Coffee Shop", "Cafe"]],
  [/\bsushi\b/, ["Japanese", "Sushi"]],
  [/\b(steak|steakhouse)\b/, ["Steakhouse"]],
  [/\b(brunch|breakfast)\b/, ["Breakfast & Brunch", "Brunch"]],
  [/\b(beer|brewery)\b/, ["Brewery"]],
  [/\b(tacos?)\b/, ["Mexican"]],
];
const REGION_ALIAS: [RegExp, string][] = [
  [/\b(nyc|new york|manhattan|brooklyn)\b/, "New York, NY"], [/\b(sf|san francisco)\b/, "San Francisco, CA"],
  [/\b(la|los angeles)\b/, "Los Angeles, CA"], [/\bcharleston\b/, "Charleston, SC"], [/\bdenver\b/, "Denver, CO"], [/\bhamptons\b/, "Hamptons, NY"],
];
const stem = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim().replace(/(es|s)$/, "");
const has = (text: string, phrase: string) => new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(e?s)?\\b`).test(text);

export type Cues = {
  cuisines: string[]; region: string | null; neighborhoods: string[]; late: boolean; cohort: string | null;
  maxPrice: number | null; minPrice: number | null; reservations: boolean; somewhereNew: boolean;
};
export function parseRequest(request: string, places: DinePlace[]): Cues {
  const t = ` ${request.toLowerCase().replace(/[^a-z0-9&' ]/g, " ")} `;
  const vocab = [...new Set(places.flatMap((p) => p.cuisine))];
  const cuisines = new Set(vocab.filter((c) => has(t, stem(c)) || has(t, c.toLowerCase())));
  for (const [re, cs] of SYN) if (re.test(t)) cs.filter((c) => vocab.includes(c)).forEach((c) => cuisines.add(c));
  const regions = [...new Set(places.map((p) => p.region).filter(Boolean))] as string[];
  const region = REGION_ALIAS.find(([re]) => re.test(t))?.[1] ?? regions.find((r) => t.includes(r.split(",")[0]!.toLowerCase())) ?? null;
  const hoods = [...new Set(places.map((p) => p.neighborhood).filter((n): n is string => !!n && n.length > 3))];
  return {
    cuisines: [...cuisines], region,
    neighborhoods: hoods.filter((n) => has(t, n.toLowerCase())),
    late: /\b(late|late night|after (10|11|midnight)|midnight)\b/.test(t),
    cohort: /\b(quick|grab|takeaway|to go)\b/.test(t) ? "qsr" : null,
    maxPrice: /\b(cheap|budget|inexpensive|affordable|casual)\b/.test(t) ? 2 : null,
    minPrice: /\b(fancy|upscale|fine dining|special occasion|splurge|celebrat\w*)\b/.test(t) ? 3 : null,
    reservations: /\b(book|reserv\w*|table for)\b/.test(t),
    somewhereNew: /\b(new|never been|haven't been|somewhere different)\b/.test(t),
  };
}
export function describeCues(c: Cues, partySize: number): string[] {
  return [
    `party of ${partySize}`,
    ...(c.cuisines.length ? [`cuisine: ${c.cuisines.join(", ")}`] : []),
    ...(c.region ? [`city: ${c.region}`] : []),
    ...(c.neighborhoods.length ? [`neighborhood: ${c.neighborhoods.join(", ")}`] : []),
    ...(c.late ? ["open late"] : []), ...(c.cohort === "qsr" ? ["quick service"] : []),
    ...(c.maxPrice ? [`price ≤ ${"$".repeat(c.maxPrice)}`] : []), ...(c.minPrice ? [`price ≥ ${"$".repeat(c.minPrice)}`] : []),
    ...(c.reservations ? ["takes reservations"] : []), ...(c.somewhereNew ? ["somewhere new to you"] : []),
  ];
}

// ponytail: per-head estimate from Flynet's price level; Flynet publishes no menu prices. Tune here if it reads off.
export const PER_HEAD_USD: Record<number, number> = { 1: 15, 2: 35, 3: 75, 4: 150 };
const km = (a: { lat: number; lng: number }, p: DinePlace) => {
  if (p.lat == null || p.lng == null) return null;
  const rad = Math.PI / 180, dLat = (p.lat - a.lat) * rad, dLng = (p.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(p.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
};

type Scored = { p: DinePlace; score: number; reasons: string[]; dist: number | null; est: number | null; fits: boolean | null; visits: number };
/** Stage 1 (catalog only, no extra Flynet calls): hard filters then a scored, brand-deduped candidate list. */
export function prefilter(places: DinePlace[], c: Cues, o: { partySize: number; budgetUsd: number; near?: { lat: number; lng: number }; visits?: Map<string, number>; visitedHoods?: Set<string> }) {
  const notes: string[] = [];
  let pool = places.filter((p) => p.paymentsEnabled);
  if (c.region) pool = pool.filter((p) => p.region === c.region);
  if (o.near) {
    const close = pool.filter((p) => (km(o.near!, p) ?? Infinity) <= 15);
    if (close.length) pool = close; else notes.push("No Blackbird venue within 15 km of your location; showing the best matches anywhere.");
  }
  if (c.cuisines.length) {
    const m = pool.filter((p) => p.cuisine.some((x) => c.cuisines.includes(x)));
    if (m.length) pool = m; else notes.push(`No Blackbird venue matches ${c.cuisines.join("/")} here; showing other options.`);
  }
  if (c.neighborhoods.length) {
    const m = pool.filter((p) => p.neighborhood && c.neighborhoods.includes(p.neighborhood));
    if (m.length) pool = m; else notes.push(`Nothing matching in ${c.neighborhoods.join("/")}; widened to the whole city.`);
  }
  const scored: Scored[] = pool.map((p) => {
    const reasons: string[] = [];
    let score = 0;
    const cm = p.cuisine.filter((x) => c.cuisines.includes(x));
    if (cm.length) { score += 3; reasons.push(`serves ${cm.join(", ")}`); }
    if (p.neighborhood && c.neighborhoods.includes(p.neighborhood)) { score += 2; reasons.push(`in ${p.neighborhood}`); }
    const dist = o.near ? km(o.near, p) : null;
    if (dist != null) { score += Math.max(0, 3 - dist / 2); reasons.push(`${dist.toFixed(1)} km away`); }
    const est = p.price ? PER_HEAD_USD[p.price]! * o.partySize : null;
    const fits = est == null ? null : est <= o.budgetUsd;
    if (fits === true) { score += 1; reasons.push(`~$${est} for ${o.partySize} fits the $${o.budgetUsd.toFixed(0)} dining budget`); }
    if (fits === false) score -= 3;
    if (p.price && c.maxPrice && p.price > c.maxPrice) score -= 2;
    if (p.price && c.minPrice && p.price < c.minPrice) score -= 2;
    if (c.cohort && p.cohort === c.cohort) score += 1;
    if (c.reservations && p.reservationsEnabled) { score += 1; reasons.push("takes reservations"); }
    const visits = o.visits?.get(p.id) ?? 0;
    if (visits && c.somewhereNew) score -= 3;
    else if (visits) { score += 1; reasons.push(`you have checked in here ${visits}×`); }
    else if (o.visitedHoods?.has(p.neighborhood ?? "")) { score += 1; reasons.push(`new to you, in a neighborhood you dine in`); }
    return { p, score, reasons, dist, est, fits, visits };
  });
  scored.sort((a, b) => b.score - a.score || (a.dist ?? 0) - (b.dist ?? 0) || a.p.name.localeCompare(b.p.name));
  const seen = new Set<string>(), out: Scored[] = [];
  for (const s of scored) if (!seen.has(s.p.restaurantId) && seen.add(s.p.restaurantId)) out.push(s); // one venue per brand
  return { candidates: out, considered: pool.length, notes };
}

// ─── loans ───
function loanOr404(ctx: Ctx, id: number): Loan {
  const l = getLoan(ctx.db, id);
  if (!l) throw new HTTPException(404, { message: `loan ${id} not found` });
  return l;
}
const budgetRaw = (l: Loan) => l.terms?.drawLimitRaw ?? "0";

// ─── member OAuth + PKCE (server holds client_secret; tokens bound to one loan by a borrower signature) ───
const memberLogin = () => {
  const miss = ["FLYNET_CLIENT_ID", "FLYNET_CLIENT_SECRET", "FLYNET_REDIRECT_URI"].filter((k) => !process.env[k]);
  return miss.length
    ? { available: false, reason: `Member login needs the app secret: ${miss.join(", ")} not set on the agent (regenerate it in the Make dashboard).` }
    : { available: true, reason: null };
};
let oa: FlynetOAuth | undefined;
const oauth = () => {
  const m = memberLogin();
  if (!m.available) throw new HTTPException(503, { message: m.reason! });
  // `audience` is required by the SDK but undocumented (docs omit it); send it only when FLYNET_AUDIENCE is set
  return (oa ??= new FlynetOAuth({
    clientId: need("FLYNET_CLIENT_ID"), clientSecret: need("FLYNET_CLIENT_SECRET"), redirectUri: need("FLYNET_REDIRECT_URI"),
    audience: process.env.FLYNET_AUDIENCE ?? "", scopes: SCOPES, authBaseUrl: AUTH_BASE_BY_ENV[env()],
  }));
};
type Link = { loan_id: number; member_id: string; access_token: string; refresh_token: string; expires_at: string };
const getLink = (ctx: Ctx, loanId: number) => ctx.db.prepare("SELECT * FROM flynet_links WHERE loan_id = ?").get(loanId) as Link | undefined;
const saveTokens = (ctx: Ctx, loanId: number, memberId: string, t: { access_token: string; refresh_token?: string; expires_in: number }, prevRefresh = "") =>
  ctx.db.prepare(`INSERT INTO flynet_links (loan_id,member_id,access_token,refresh_token,expires_at,created_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(loan_id) DO UPDATE SET member_id=excluded.member_id, access_token=excluded.access_token, refresh_token=excluded.refresh_token, expires_at=excluded.expires_at`)
    .run(loanId, memberId, t.access_token, t.refresh_token ?? prevRefresh, new Date(Date.now() + t.expires_in * 1000).toISOString(), now());
const refreshing = new Map<number, Promise<string>>(); // refresh tokens are single-use: share one refresh per loan
async function accessToken(ctx: Ctx, loanId: number): Promise<string> {
  const l = getLink(ctx, loanId);
  if (!l) throw new HTTPException(409, { message: "no Blackbird member linked to this loan" });
  if (Date.parse(l.expires_at) - Date.now() > 60_000) return l.access_token;
  if (!l.refresh_token) throw new HTTPException(409, { message: "Blackbird session expired and no refresh token was issued; log in again" });
  let p = refreshing.get(loanId);
  if (!p) {
    p = oauth().refresh({ refreshToken: l.refresh_token })
      .then((t) => { saveTokens(ctx, loanId, l.member_id, t, l.refresh_token); return t.access_token; })
      .catch((e) => {
        if ((e as { status?: number }).status === 400) ctx.db.prepare("DELETE FROM flynet_links WHERE loan_id = ?").run(loanId); // invalid_grant: must log in again
        throw new HTTPException(502, { message: `Blackbird token refresh failed: ${(e as Error).message}` });
      })
      .finally(() => refreshing.delete(loanId));
    refreshing.set(loanId, p);
  }
  return p;
}
// The browser proves it finished this loan's OAuth with a random session token (only its hash is stored).
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const viewKey = (loanId: number) => `flynet:view:${loanId}`;
function memberSession(ctx: Ctx, c: Context, loanId: number): boolean {
  const t = c.req.header("x-flynet-session") ?? c.req.query("session"); // query: the agent CORS allowlist has no custom headers
  if (!t || !getLink(ctx, loanId)) return false;
  const row = ctx.db.prepare("SELECT value FROM kv WHERE key = ?").get(viewKey(loanId)) as R | undefined;
  return !!row && row.value === sha(t);
}
const memberCache = new Map<number, { at: number; p: Promise<Member> }>(); // personal data: memory only, 5 min
type Member = { firstName: string; tier: string | null; wallets: R; checkIns: R[] };
function member(ctx: Ctx, loanId: number): Promise<Member> {
  const hit = memberCache.get(loanId);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.p;
  const p = (async () => {
    const tok = await accessToken(ctx, loanId);
    const [me, status, wallets, cis] = await Promise.all([
      flyGet("/users/me", tok), flyGet("/users/me/status", tok).catch((e) => (e.status === 404 ? null : Promise.reject(e))), // 404 = no status yet
      flyGet("/users/me/wallets", tok), flyGet("/users/me/check_ins?page_size=50", tok),
    ]);
    return { firstName: me.first_name ?? "", tier: status?.tier ?? null, wallets, checkIns: cis.check_ins ?? [] };
  })();
  memberCache.set(loanId, { at: Date.now(), p });
  p.catch(() => memberCache.delete(loanId));
  return p.catch(toHttp);
}
const visitsOf = (m: Member) => {
  const visits = new Map<string, number>(), hoods = new Set<string>();
  for (const ci of m.checkIns) {
    visits.set(ci.location?.id, (visits.get(ci.location?.id) ?? 0) + 1);
    if (ci.location?.neighborhood?.name) hoods.add(ci.location.neighborhood.name);
  }
  return { visits, hoods };
};

export async function passport(ctx: Ctx, loanId: number): Promise<DinePassport> {
  const m = await member(ctx, loanId);
  const { visits, hoods } = visitsOf(m);
  const places = (await catalog(ctx)).v;
  const bal = m.wallets.balance ?? {};
  return {
    firstName: m.firstName, tier: m.tier,
    flyBalanceWei: String(bal.balance?.value ?? "0"), flyBalanceUsdCents: Math.round(Number(bal.balance_usd?.value ?? 0)),
    wallets: ((m.wallets.wallets ?? []) as R[]).map((w) => ({ type: w.wallet_type, address: w.address })),
    checkIns: m.checkIns.map((ci) => ({ placeId: ci.location?.id, name: ci.location?.restaurant?.name || ci.location?.name || "venue", neighborhood: ci.location?.neighborhood?.name ?? null, region: ci.location?.neighborhood?.region ?? null, at: ci.created_at })),
    placesVisited: visits.size,
    gapsNearby: places.filter((p) => p.paymentsEnabled && p.neighborhood && hoods.has(p.neighborhood) && !visits.has(p.id)).slice(0, 6),
  };
}

// ─── public reads ───
export async function status(ctx: Ctx): Promise<FlynetStatus> {
  const app = await cached(ctx, "app", TTL.app, () => flyGet("/app")).catch(() => null);
  const cat = mem.get("catalog");
  return {
    env: env(), appName: (app?.v as R)?.name ?? null, allowedScopes: (app?.v as R)?.allowed_scopes ?? [],
    catalog: { count: (cat?.v as unknown[] | undefined)?.length ?? 0, fetchedAt: cat ? new Date(cat.at).toISOString() : null },
    memberLogin: memberLogin(), payments: PAYMENTS,
  };
}

export type ListQuery = { query?: string; region?: string; cuisine?: string; price?: number; page: number };
export function listPlaces(places: DinePlace[], q: ListQuery, pageSize = 24): Omit<DinePlaceList, "source"> {
  const words = (q.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const hay = (p: DinePlace) => `${p.name} ${p.branch} ${p.cuisine.join(" ")} ${p.neighborhood ?? ""} ${p.region ?? ""}`.toLowerCase();
  const hits = places.filter((p) => (!q.region || p.region === q.region) && (!q.cuisine || p.cuisine.includes(q.cuisine))
    && (!q.price || p.price === q.price) && words.every((w) => hay(p).includes(w)));
  const count = (xs: (string | null)[]) => [...xs.reduce((m, x) => (x ? m.set(x, (m.get(x) ?? 0) + 1) : m), new Map<string, number>())].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  return {
    places: hits.slice(q.page * pageSize, (q.page + 1) * pageSize), total: hits.length, page: q.page, pageSize,
    regions: count(places.map((p) => p.region)), cuisines: count(places.flatMap((p) => p.cuisine)).slice(0, 40),
  };
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function placeDetail(ctx: Ctx, id: string): Promise<DinePlaceDetail> {
  if (!UUID.test(id)) throw new HTTPException(400, { message: "restaurant id must be a Flynet location UUID" });
  const cat = await catalog(ctx);
  const place = cat.v.find((p) => p.id === id) ?? toPlace(await flyGet(`/locations/${id}`).catch(toHttp));
  const errors: string[] = [];
  const [h, s, ch] = await Promise.all([
    hoursOf(ctx, id).catch((e) => { errors.push(e.message); return null; }),
    specialsOf(ctx, place.restaurantId).catch((e) => { errors.push(e.message); return null; }),
    challengesOf(ctx, place.restaurantId).catch((e) => { errors.push(e.message); return null; }),
  ]);
  return {
    place, hours: h?.v ?? null, openNow: h ? isOpenNow(h.v, place.timeZone) : null, specials: s?.v ?? [], challenges: ch?.v ?? [],
    siblings: cat.v.filter((p) => p.restaurantId === place.restaurantId && p.id !== id).slice(0, 12), source: src(cat), errors,
  };
}

// ─── the concierge ───
export function validatePlan(b: R): DinePlanRequest {
  const request = typeof b.request === "string" ? b.request.trim() : "";
  if (!request || request.length > 500) throw new HTTPException(400, { message: "request must be 1..500 characters, e.g. \"somewhere in NYC for four, open late, burgers\"" });
  const partySize = Number(b.partySize ?? 2);
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > 20) throw new HTTPException(400, { message: "partySize must be an integer 1..20" });
  if (b.time != null && (typeof b.time !== "string" || !(/^([01]\d|2[0-3]):[0-5]\d$/.test(b.time) || !Number.isNaN(Date.parse(b.time)))))
    throw new HTTPException(400, { message: "time must be HH:MM (venue-local, today) or an ISO-8601 datetime" });
  let near: DinePlanRequest["near"];
  if (b.near != null) {
    const lat = Number(b.near?.lat), lng = Number(b.near?.lng);
    if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) throw new HTTPException(400, { message: "near must be {lat, lng} in degrees" });
    near = { lat, lng };
  }
  return { request, partySize, time: b.time ?? undefined, near };
}

const planCache = new Map<string, { at: number; p: Promise<DinePlan> }>();
export async function plan(ctx: Ctx, loanId: number, req: DinePlanRequest, withMember: boolean): Promise<DinePlan> {
  const loan = loanOr404(ctx, loanId);
  const key = JSON.stringify([loanId, req, withMember]);
  const hit = planCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = planFresh(ctx, loan, req, withMember);
  planCache.set(key, { at: Date.now(), p });
  p.catch(() => planCache.delete(key));
  return p;
}

async function planFresh(ctx: Ctx, loan: Loan, req: DinePlanRequest, withMember: boolean): Promise<DinePlan> {
  const cat = await catalog(ctx);
  const budgetUsd = Number(BigInt(budgetRaw(loan))) / 1e6;
  const notes: string[] = [];
  if (budgetUsd <= 0) notes.push("This loan has no dining budget (drawLimit 0), so budget fit is not checked.");
  if (loan.status !== "ACTIVE") notes.push(`Loan is ${loan.status}: the dining budget is a plan until the loan is funded (ACTIVE).`);
  const m = withMember ? await member(ctx, loan.id).catch((e) => { notes.push(`Member history unavailable: ${e.message}`); return null; }) : null;
  const mv = m ? visitsOf(m) : null;
  const cues = parseRequest(req.request, cat.v);
  const pre = prefilter(cat.v, cues, { partySize: req.partySize, budgetUsd: budgetUsd > 0 ? budgetUsd : Infinity, near: req.near, visits: mv?.visits, visitedHoods: mv?.hoods });
  notes.push(...pre.notes);
  if (!pre.candidates.length) throw new HTTPException(404, { message: "No Blackbird venue matches that request. Try a city (NYC, SF, LA, Denver, Charleston) or a cuisine." });

  // Stage 2: live hours for the top 12 (cached 6h each), then offers for the top 6 brands (cached 1h)
  const errors: string[] = [];
  const top = pre.candidates.slice(0, 12);
  const hours = await gentle(top, (s) => hoursOf(ctx, s.p.id), errors);
  const at = req.time && !/^\d\d:\d\d$/.test(req.time) ? new Date(req.time) : new Date();
  const enriched = top.map((s, i) => {
    const hs = hours[i]?.v ?? null;
    const lt = localDayTime(s.p.timeZone, at), hm = req.time && /^\d\d:\d\d$/.test(req.time) ? req.time : lt.hm;
    const today = hs?.find((h) => h.day === lt.day);
    const open = hs ? openAt(hs, lt.day, hm) : null;
    let score = s.score;
    const reasons = [...s.reasons];
    if (open === true) { score += 2; reasons.push(`open at ${hm}`); }
    if (open === false) score -= 5;
    if (open === null) reasons.push("hours not published on Flynet");
    if (cues.late && open !== false && closesLate(today)) { score += 2; reasons.push(`open late (until ${today!.close})`); }
    if (cues.late && today && !closesLate(today)) score -= 2;
    return { ...s, score, reasons, open, today };
  }).sort((a, b) => b.score - a.score);
  const short = enriched.slice(0, 6);
  const specials = await gentle(short, (s) => specialsOf(ctx, s.p.restaurantId), errors); // sequential batches: Flynet rate-limits bursts
  const challenges = await gentle(short, (s) => challengesOf(ctx, s.p.restaurantId), errors);
  const picks: DinePick[] = short.map((s, i) => {
    const sp = specials[i]?.v ?? [], chs = challenges[i]?.v ?? [];
    if (sp.length) s.reasons.push(`special: ${sp[0]!.label}`);
    if (chs.length) s.reasons.push(`challenge: ${chs[0]!.title}`);
    return {
      place: s.p, reasons: s.reasons, openAtTime: s.open, hoursToday: s.today ? `${s.today.open}–${s.today.close}` : null,
      estCostUsd: s.est, fitsBudget: budgetUsd > 0 ? s.fits : null, distanceKm: s.dist == null ? null : Math.round(s.dist * 10) / 10,
      specials: sp, challenges: chs, visits: m ? s.visits : null,
    };
  }).sort((a, b) => Number(b.openAtTime !== false) - Number(a.openAtTime !== false)); // never lead with a closed venue
  if (errors.length) notes.push(`Some Flynet reads failed and were skipped: ${[...new Set(errors)].slice(0, 3).join("; ")}`);
  if (picks.every((x) => x.openAtTime === false)) notes.push("Every match is closed at that time; try another time.");
  if (budgetUsd > 0 && picks.every((x) => x.fitsBudget === false))
    notes.push(`The $${budgetUsd.toFixed(2)} dining budget covers about $${(budgetUsd / req.partySize).toFixed(0)} a head for ${req.partySize}; none of these fit the estimate. Try a smaller party or "cheap".`);

  const base = { loanId: loan.id, request: req.request, partySize: req.partySize, at: req.time ?? at.toISOString(), budgetRaw: budgetRaw(loan),
    understood: describeCues(cues, req.partySize), considered: pre.considered, notes, personalized: !!m, source: src(cat) };
  const ranked = await llmRank(req, picks, budgetUsd).catch((e) => ({ err: e as Error }));
  if ("err" in ranked) {
    const why = ranked.err instanceof LlmNoCredits ? "Bankr LLM has no credits" : /Missing env/.test(ranked.err.message) ? "no Bankr LLM key" : `Bankr LLM failed (${ranked.err.message.slice(0, 120)})`;
    return { ...base, ranker: "deterministic", rankerNote: `Deterministic ranker: ${why}. Scores cuisine, place, budget fit, hours at your time, specials.`, picks: picks.slice(0, 5) };
  }
  return { ...base, ranker: "bankr-llm", rankerNote: "Bankr LLM ordered the live Flynet shortlist and wrote the first reason; the facts below it come from Flynet.", picks: ranked.slice(0, 5) };
}

/** Bankr LLM re-orders the already-verified picks and writes one sentence each. It can't add venues or facts. */
async function llmRank(req: DinePlanRequest, picks: DinePick[], budgetUsd: number): Promise<DinePick[]> {
  const facts = picks.map((x) => ({ id: x.place.id, name: x.place.name, cuisine: x.place.cuisine, neighborhood: x.place.neighborhood, price: x.place.price,
    openAtTime: x.openAtTime, hoursToday: x.hoursToday, estCostUsd: x.estCostUsd, distanceKm: x.distanceKm, reservations: x.place.reservationsEnabled,
    specials: x.specials.map((s) => s.label), challenges: x.challenges.map((c) => c.title), memberVisits: x.visits }));
  const raw = await llmChat([
    { role: "system", content: `You are the Gadai dining concierge. A borrower asks for a place to eat; the dining budget is $${budgetUsd.toFixed(0)} for the party. Order the candidates best-first for the request and write one plain sentence per pick using ONLY the given facts (never invent dishes, prices or hours). Put closed venues last. Reply with ONLY JSON: {"picks":[{"id":"...","why":"..."}]}` },
    { role: "user", content: JSON.stringify({ request: req.request, partySize: req.partySize, candidates: facts }) },
  ], { model: opt("BANKR_LLM_MODEL", "claude-sonnet-4.6"), maxTokens: 700 });
  const j = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { picks?: { id: string; why: string }[] };
  const byId = new Map(picks.map((x) => [x.place.id, x]));
  const out = (j.picks ?? []).filter((x) => byId.has(x.id) && typeof x.why === "string")
    .map((x) => ({ ...byId.get(x.id)!, reasons: [x.why.slice(0, 280), ...byId.get(x.id)!.reasons] }));
  if (!out.length) throw new Error("LLM returned no valid picks");
  return [...new Map(out.map((x) => [x.place.id, x])).values()];
}

export function dineState(ctx: Ctx, loanId: number): DineState {
  const loan = loanOr404(ctx, loanId);
  return { loanId, symbol: loan.symbol, loanStatus: loan.status, budgetRaw: budgetRaw(loan), linked: !!getLink(ctx, loanId), memberLogin: memberLogin(), payments: PAYMENTS };
}

// ─── routes ───
function listQuery(c: Context): ListQuery {
  const q = c.req.query();
  const price = q.price ? Number(q.price) : undefined;
  if (price !== undefined && !(Number.isInteger(price) && price >= 1 && price <= 4)) throw new HTTPException(400, { message: "price must be 1..4" });
  const page = q.page ? Number(q.page) : 0;
  if (!(Number.isInteger(page) && page >= 0 && page < 1000)) throw new HTTPException(400, { message: "page must be an integer ≥ 0" });
  if ((q.query ?? "").length > 200) throw new HTTPException(400, { message: "query too long (max 200)" });
  return { query: q.query, region: q.region || undefined, cuisine: q.cuisine || undefined, price, page };
}

export function register(app: Hono, ctx: Ctx) {
  app.get("/api/flynet/status", async (c) => c.json(await status(ctx)));
  app.get("/api/flynet/restaurants", async (c) => {
    const q = listQuery(c);
    const loanId = c.req.query("loanId");
    if (loanId) loanOr404(ctx, posInt(loanId, "loanId"));
    const cat = await catalog(ctx);
    return c.json({ ...listPlaces(cat.v, q), source: src(cat) } satisfies DinePlaceList);
  });
  app.get("/api/flynet/restaurants/:id", async (c) => c.json(await placeDetail(ctx, c.req.param("id"))));
  app.get("/api/loans/:id/dine", (c) => c.json(dineState(ctx, posInt(c.req.param("id"), "loan id"))));
  app.post("/api/loans/:id/dine/plan", async (c) => {
    const loanId = posInt(c.req.param("id"), "loan id");
    const req = validatePlan(await jsonBody(c));
    return c.json(await plan(ctx, loanId, req, memberSession(ctx, c, loanId)));
  });
  app.get("/api/loans/:id/dine/passport", async (c) => {
    const loanId = posInt(c.req.param("id"), "loan id");
    loanOr404(ctx, loanId);
    if (!memberSession(ctx, c, loanId)) throw new HTTPException(401, { message: "Blackbird member session required (log in with Blackbird on this loan's dine page)" });
    return c.json(await passport(ctx, loanId));
  });
  app.delete("/api/loans/:id/dine/member", async (c) => {
    const loanId = posInt(c.req.param("id"), "loan id");
    if (!memberSession(ctx, c, loanId)) throw new HTTPException(401, { message: "Blackbird member session required" });
    ctx.db.prepare("DELETE FROM flynet_links WHERE loan_id = ?").run(loanId);
    ctx.db.prepare("DELETE FROM kv WHERE key = ?").run(viewKey(loanId));
    memberCache.delete(loanId);
    return c.json({ ok: true });
  });

  // OAuth: borrower-signed start → Blackbird consent → callback exchanges the code server-side (client_secret + PKCE verifier)
  app.get("/api/flynet/connect", async (c) => {
    const loanId = posInt(c.req.query("loanId"), "loanId"), nonce = c.req.query("nonce") ?? "", sig = (c.req.query("sig") ?? "") as Hex;
    const loan = loanOr404(ctx, loanId);
    const o = oauth(); // 503 "needs the app secret" before asking the borrower for anything else
    if (!/^0x[0-9a-fA-F]+$/.test(sig)) throw new HTTPException(400, { message: "sig required (borrower signs flynetLinkMessage)" });
    if (nonce.length < 8) throw new HTTPException(400, { message: "nonce (≥8 chars) required" });
    if (!(await ctx.pub.verifyMessage({ address: loan.borrower, message: flynetLinkMessage(loanId, nonce), signature: sig }).catch(() => false)))
      throw new HTTPException(401, { message: `signature is not from the loan's borrower ${loan.borrower}` });
    if (!useNonce(ctx.db, nonce)) throw new HTTPException(409, { message: "nonce already used" });
    const { url, state, codeVerifier } = await o.getAuthorizeUrl();
    const u = new URL(url);
    if (!process.env.FLYNET_AUDIENCE) u.searchParams.delete("audience");
    ctx.db.prepare("INSERT INTO oauth_states (state, loan_id, code_verifier, created_at) VALUES (?,?,?,?)").run(state, loanId, codeVerifier, now());
    return c.redirect(u.toString(), 302);
  });
  app.get("/api/flynet/callback", async (c) => {
    const code = c.req.query("code"), state = c.req.query("state");
    const st = ctx.db.prepare("SELECT * FROM oauth_states WHERE state = ?").get(state ?? "") as R | undefined;
    if (!st || Date.now() - Date.parse(st.created_at) > 10 * 60_000) throw new HTTPException(400, { message: "invalid or expired OAuth state; start the Blackbird login again" });
    ctx.db.prepare("DELETE FROM oauth_states WHERE state = ?").run(state!);
    const back = `${ctx.webUrl}/dine/${st.loan_id}`;
    if (c.req.query("error") || !code) return c.redirect(`${back}#member-error=${encodeURIComponent(c.req.query("error_description") ?? c.req.query("error") ?? "no code")}`, 302);
    const t = await oauth().exchangeCode({ code, codeVerifier: st.code_verifier })
      .catch((e) => { throw new HTTPException(502, { message: `Blackbird code exchange failed: ${(e as Error).message}` }); });
    const me = await flyGet("/users/me", t.access_token).catch(toHttp);
    saveTokens(ctx, st.loan_id, me.id, t);
    memberCache.delete(st.loan_id);
    const session = randomBytes(24).toString("base64url");
    ctx.db.prepare("INSERT INTO kv (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at")
      .run(viewKey(st.loan_id), sha(session), now());
    return c.redirect(`${back}#member=${session}`, 302);
  });
}
