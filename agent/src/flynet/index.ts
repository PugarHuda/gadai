// "Dine on your fees" — Blackbird Flynet (docs/integrations/flynet.md, @flynetdev/core@0.8.1).
// Only documented calls: member OAuth+PKCE, Discovery (locations, open hours, specials, challenges), rewards.getBalance /
// issueReward (app wallet → member FLY), member wallets/check-ins/memberships, payment intents to OUR merchant.
// The member pays the restaurant in the Blackbird app (no partner API pays a venue). The draw is on-chain debt (vault.addDraw),
// repaid from the fee stream through FeeVault.payDesk.
import { HTTPException } from "hono/http-exception";
import type { Hono } from "hono";
import { parseAbi, parseEventLogs } from "viem";
import { ENVIRONMENTS, FlynetDiscoveryClient, FlynetMemberClient, FlynetOAuth, type FlynetEnvironment, type models } from "@flynetdev/core";
import {
  ADDR, ERC20_ABI, FEE_VAULT_ABI, drawMessage, flynetLinkMessage,
  type Address, type DineMember, type DineState, type Draw, type DrawRequest, type Hex, type Loan, type Recommendation,
} from "@feedesk/shared";
import type { Ctx } from "../ctx.ts";
import { need, opt } from "../ctx.ts";
import { addEvent, getLoan, now, useNonce } from "../db/index.ts";
import { llmChat } from "../bankr/index.ts";

const vaultAbi = parseAbi(FEE_VAULT_ABI);
const erc20Abi = parseAbi(ERC20_ABI);
const SCOPES = ["read:profile", "read:wallets", "read:user_checkins", "read:memberships"];
type R = Record<string, any>;

// ─── clients (fail loudly on missing env) ───
function env(): FlynetEnvironment {
  const e = opt("FLYNET_ENV", "staging");
  if (!(ENVIRONMENTS as readonly string[]).includes(e)) throw new Error(`FLYNET_ENV must be one of ${ENVIRONMENTS.join("|")}`);
  return e as FlynetEnvironment;
}
let disco: FlynetDiscoveryClient | undefined;
const discovery = () => (disco ??= new FlynetDiscoveryClient({ apiKey: need("FLYNET_API_KEY"), environment: env() }));
let oa: FlynetOAuth | undefined;
const oauth = () =>
  (oa ??= new FlynetOAuth({
    clientId: need("FLYNET_CLIENT_ID"), clientSecret: need("FLYNET_CLIENT_SECRET"), redirectUri: need("FLYNET_REDIRECT_URI"),
    audience: need("FLYNET_AUDIENCE"), scopes: SCOPES, environment: env(),
  }));

/** Wrap a Flynet call so failures surface as 502 with the Flynet status/code (403 = missing scope on the app/key). */
async function fly<T>(what: string, p: Promise<T>): Promise<T> {
  try { return await p; } catch (e) {
    const x = e as { status?: number | null; code?: string; message?: string };
    throw new HTTPException(502, { message: `Flynet ${what} failed: ${x.status ?? "network"} ${x.code ?? ""} ${x.message ?? e}`.trim() });
  }
}

// ─── member tokens (refresh tokens are single-use + rotating → dedupe concurrent refreshes) ───
type Link = { loan_id: number; member_id: string; access_token: string; refresh_token: string; expires_at: string };
const getLink = (ctx: Ctx, loanId: number) => ctx.db.prepare("SELECT * FROM flynet_links WHERE loan_id = ?").get(loanId) as Link | undefined;
const refreshing = new Map<number, Promise<string>>();

async function accessToken(ctx: Ctx, loanId: number): Promise<string> {
  const l = getLink(ctx, loanId);
  if (!l) throw new HTTPException(409, { message: "connect Blackbird first (GET /api/flynet/connect)" });
  if (Date.parse(l.expires_at) - Date.now() > 60_000) return l.access_token;
  if (!l.refresh_token) throw new HTTPException(409, { message: "Blackbird session expired and no refresh token was issued; reconnect" });
  let p = refreshing.get(loanId);
  if (!p) {
    p = (async () => {
      const t = await fly("token refresh", oauth().refresh({ refreshToken: l.refresh_token }));
      ctx.db.prepare("UPDATE flynet_links SET access_token=?, refresh_token=?, expires_at=? WHERE loan_id=?")
        .run(t.access_token, t.refresh_token ?? l.refresh_token, new Date(Date.now() + t.expires_in * 1000).toISOString(), loanId);
      return t.access_token;
    })().finally(() => refreshing.delete(loanId));
    refreshing.set(loanId, p);
  }
  return p;
}
const member = (ctx: Ctx, loanId: number) => new FlynetMemberClient({ accessToken: () => accessToken(ctx, loanId), environment: env() });

// ─── helpers ───
function loanOr404(ctx: Ctx, id: number): Loan {
  const l = getLoan(ctx.db, id);
  if (!l) throw new HTTPException(404, { message: `loan ${id} not found` });
  return l;
}
/** EIP-191 signature from the BORROWER only (viem verifyMessage also handles 1271/6492 smart wallets).
 *  loan.controller is not accepted: it is caller-supplied at apply time, and FLY draws spend the borrower's pledged fees. */
async function assertBorrower(ctx: Ctx, loan: Loan, message: string, signature: Hex) {
  if (!/^0x[0-9a-fA-F]+$/.test(signature ?? "")) throw new HTTPException(400, { message: "signature required" });
  if (await ctx.pub.verifyMessage({ address: loan.borrower, message, signature }).catch(() => false)) return;
  throw new HTTPException(401, { message: `signature is not from the loan's borrower ${loan.borrower}` });
}
function spendNonce(ctx: Ctx, nonce: string) {
  if (!nonce || nonce.length < 8) throw new HTTPException(400, { message: "nonce (≥8 chars) required" });
  if (!useNonce(ctx.db, nonce)) throw new HTTPException(409, { message: "nonce already used" });
}
const readV = <T>(ctx: Ctx, vault: Address, fn: string) => ctx.pub.readContract({ address: vault, abi: vaultAbi, functionName: fn as any }) as Promise<T>;

/** FLY price as (wei, cents) from a Flynet AccountBalance (docs: no price endpoint). Needs ≥ minCents of value so
 *  whole-cent rounding of balanceUsd can't skew the rate (1.49¢ → 1¢ would be a 49% error). */
export const priceOf = (b: models.AccountBalance, minCents = 100) => {
  const wei = BigInt(b.balance.value), cents = BigInt(Math.round(b.balanceUsd.value));
  return wei > 0n && cents >= BigInt(minCents) ? { wei, cents } : null;
};
const rowToDraw = (r: R): Draw => ({
  id: Number(r.id), loanId: Number(r.loan_id), amountRaw: r.amount_raw, flyWei: r.fly_wei, locationId: r.location_id,
  flynetRewardId: r.flynet_reward_id, txHash: r.tx_hash, status: r.status, error: r.error, createdAt: r.created_at,
});
const listDraws = (ctx: Ctx, loanId: number) =>
  (ctx.db.prepare("SELECT * FROM draws WHERE loan_id = ? ORDER BY id").all(loanId) as R[]).map(rowToDraw);

// ─── restaurants ───
let locCache: { at: number; locs: models.Location[] } | undefined;
async function allLocations(): Promise<models.Location[]> {
  if (locCache && Date.now() - locCache.at < 10 * 60_000) return locCache.locs;
  const locs: models.Location[] = [];
  for (let page = 0; page < 20; page++) { // server-side filters are not implemented (docs §8) → fetch all, filter here
    const r = await fly("listLocations", discovery().locations.listLocations({ page, pageSize: 50 }));
    locs.push(...r.locations);
    if (r.pagination.nextPage == null) break;
  }
  locCache = { at: Date.now(), locs };
  return locs;
}

/** Open right now in the venue's time zone; null when no hours are published. Handles past-midnight closes. */
export function isOpenNow(hours: models.OpenHour[], timeZone: string, at = new Date()): boolean | null {
  if (!hours.length) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(at).map((p) => [p.type, p.value]));
  const day = String(parts.weekday).toLowerCase();
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const yesterday = days[(days.indexOf(day) + 6) % 7];
  const t = `${parts.hour}:${parts.minute}`;
  const hm = (s: string) => s.slice(0, 5);
  return hours.some((h) => {
    const o = hm(h.openTime), c = hm(h.closeTime);
    if (h.dayOfWeek === day) return c > o ? t >= o && t < c : t >= o; // overnight: open part today
    if (h.dayOfWeek === yesterday) return c <= o && t < c; // overnight spill from yesterday
    return false;
  });
}

/** Public endpoint → cache per loan (one Bankr LLM call + ~37 Flynet calls per miss) and share in-flight runs. */
const recCache = new Map<number, { at: number; p: Promise<Recommendation[]> }>();
export function recommend(ctx: Ctx, loanId: number): Promise<Recommendation[]> {
  loanOr404(ctx, loanId);
  const hit = recCache.get(loanId);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = recommendFresh(ctx, loanId);
  recCache.set(loanId, { at: Date.now(), p });
  p.catch(() => recCache.delete(loanId));
  return p;
}

async function recommendFresh(ctx: Ctx, loanId: number): Promise<Recommendation[]> {
  const locs = (await allLocations()).filter((l) => l.paymentsEnabled && !(l.coordinate && !l.coordinate.latitude && !l.coordinate.longitude));
  if (!locs.length) throw new HTTPException(502, { message: "Flynet returned no Blackbird Pay-enabled locations" });

  // member context (optional: works before the borrower connects Blackbird)
  const visits = new Map<string, number>(), tiers = new Map<string, { tier: string; checkIns: number }>();
  if (getLink(ctx, loanId)) {
    const m = member(ctx, loanId);
    const [ci, ms] = await Promise.all([fly("listCheckIns", m.listCheckIns({ pageSize: 50 })), fly("listMemberships", m.listMemberships({ pageSize: 50 }))]);
    for (const c of ci.checkIns) visits.set(c.location.id, (visits.get(c.location.id) ?? 0) + 1);
    for (const x of ms.memberships) tiers.set(x.restaurantId, { tier: x.membershipTier.name, checkIns: x.checkInCount });
  }
  const affinity = (l: models.Location) => (visits.get(l.id) ?? 0) * 2 + (tiers.get(l.restaurant.id)?.checkIns ?? 0);
  const top = [...locs].sort((a, b) => affinity(b) - affinity(a)).slice(0, 12); // ponytail: affinity pre-rank, no geo (member location not in API)

  const restIds = [...new Set(top.map((l) => l.restaurant.id))];
  const [hours, specials, challenges] = await Promise.all([
    Promise.all(top.map((l) => fly("listLocationOpenHours", discovery().locations.listLocationOpenHours({ id: l.id })))),
    Promise.all(restIds.map((id) => fly("listSpecials (scope read:restaurant_specials)", discovery().specials.listSpecials({ restaurant: id, pageSize: 10 })))),
    Promise.all(restIds.map((id) => fly("listChallenges (scope read:restaurant_challenges)", discovery().challenges.listChallenges({ restaurant: id, pageSize: 10 })))),
  ]);
  const specBy = new Map(restIds.map((id, i) => [id, specials[i]!.specials.map((s) => `${s.emoji} ${s.label}`.trim())]));
  const chalBy = new Map(restIds.map((id, i) => [id, challenges[i]!.challenges.map((c) => c.title)]));
  const cands = top.map((l, i) => ({
    locationId: l.id, restaurantId: l.restaurant.id, name: l.name || l.restaurant.name, cuisine: l.restaurant.cuisine, price: l.restaurant.price ?? null,
    neighborhood: l.neighborhood?.name ?? null, address: [l.address.street, l.address.city].filter(Boolean).join(", "),
    reservationUrl: l.reservationUrl ?? null, openNow: isOpenNow(hours[i]!.openHours, l.timeZone),
    specials: specBy.get(l.restaurant.id) ?? [], challenges: chalBy.get(l.restaurant.id) ?? [],
    memberVisits: visits.get(l.id) ?? 0, membership: tiers.get(l.restaurant.id) ?? null,
  }));

  const raw = await llmChat([
    { role: "system", content: 'You are the Fee Desk dining concierge. The borrower pays with FLY (Blackbird Pay) drawn against their pledged token fees. Pick up to 5 venues from the candidates: prefer open now, member history/tier, and specials/challenges that earn FLY back. Reasons are shown publicly: never mention visit counts, tier, check-ins or any personal history. Reply with ONLY JSON: {"picks":[{"locationId":"...","reason":"one sentence"}]}' },
    { role: "user", content: JSON.stringify(cands) },
  ], { model: opt("BANKR_LLM_MODEL", "claude-sonnet-4.6"), maxTokens: 800 });
  const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  let picks: { locationId: string; reason: string }[];
  try { picks = JSON.parse(json).picks; } catch { throw new HTTPException(502, { message: `Bankr LLM returned unparseable picks: ${raw.slice(0, 200)}` }); }
  const byId = new Map(cands.map((c) => [c.locationId, c]));
  const out = (Array.isArray(picks) ? picks : []).filter((p) => byId.has(p?.locationId) && typeof p.reason === "string").slice(0, 5).map((p): Recommendation => {
    const c = byId.get(p.locationId)!;
    return { locationId: c.locationId, restaurantId: c.restaurantId, name: c.name, address: c.address, reservationUrl: c.reservationUrl, openNow: c.openNow, specials: c.specials, reason: p.reason };
  });
  if (!out.length) throw new HTTPException(502, { message: `Bankr LLM picked no valid locations: ${raw.slice(0, 200)}` });
  return out;
}

// ─── dine state / draw / settle ───
/** Public (GET /dine is unauthenticated): only the FLY balance, which is the loan's own drawn funds. No name/wallet. */
async function memberWallets(ctx: Ctx, loanId: number) {
  return fly("listWallets", member(ctx, loanId).listWallets());
}

export async function dineState(ctx: Ctx, loanId: number): Promise<DineState> {
  const loan = loanOr404(ctx, loanId);
  const linked = !!getLink(ctx, loanId);
  const [w, onchain] = await Promise.all([
    linked ? memberWallets(ctx, loanId) : null,
    loan.vault ? Promise.all([readV<bigint>(ctx, loan.vault, "drawLimit"), readV<bigint>(ctx, loan.vault, "drawn")]) : null,
  ]);
  const dm: DineMember | null = w
    ? { name: null, spendingWallet: null, flyBalanceWei: w.balance.balance.value, flyBalanceUsdCents: Math.round(w.balance.balanceUsd.value) }
    : null;
  return {
    loanId, linked, member: dm,
    drawLimitRaw: onchain ? onchain[0].toString() : (loan.terms?.drawLimitRaw ?? "0"),
    drawnRaw: onchain ? onchain[1].toString() : "0",
    draws: listDraws(ctx, loanId),
  };
}

// Draw lifecycle. Debt first, FLY second, so FLY is never out without on-chain debt behind it:
//   pending  : row written, vault.addDraw sent
//   recorded : addDraw mined (drawn/drawDebt include it), FLY not yet issued
//   issued   : Flynet issueReward done
//   failed   : addDraw reverted or never mined (no debt, no FLY), or FLY permanently refused and the desk offset the debt in USDC
const drawRow = (ctx: Ctx, id: number) => ctx.db.prepare("SELECT * FROM draws WHERE id = ?").get(id) as R;
const setDraw = (ctx: Ctx, id: number, f: { status?: string; tx_hash?: string | null; flynet_reward_id?: string; error?: string | null }) => {
  const keys = Object.keys(f);
  ctx.db.prepare(`UPDATE draws SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`)
    .run(...keys.map((k) => ((f as R)[k] ?? null) as string | null), id);
};
const errMsg = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 400);
/** Did the tx certainly NOT change state? Simulation revert = never sent; mined revert = no effect. */
export const isRevert = (e: unknown) => /revert/i.test(errMsg(e)) && !/timed? ?out|timeout/i.test(errMsg(e));
const drawing = new Set<number>(); // one draw/settle per loan at a time (in-process)

export async function draw(ctx: Ctx, loanId: number, req: DrawRequest): Promise<Draw> {
  const loan = loanOr404(ctx, loanId);
  const cents = Number(req.amountUsdCents);
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new HTTPException(400, { message: "amountUsdCents must be a positive integer" });
  await assertBorrower(ctx, loan, drawMessage(loanId, cents, req.nonce), req.signature);
  if (!loan.vault) throw new HTTPException(409, { message: "loan has no vault" });
  if (!getLink(ctx, loanId)) throw new HTTPException(409, { message: "connect Blackbird first" });
  const open = ctx.db.prepare("SELECT id FROM draws WHERE loan_id = ? AND status IN ('pending','recorded')").all(loanId);
  if (drawing.has(loanId) || open.length) throw new HTTPException(409, { message: "a previous draw is still being processed; retry in a minute" });
  drawing.add(loanId);
  try {
    spendNonce(ctx, req.nonce);
    const amountRaw = BigInt(cents) * 10_000n; // USDC 6 dec
    const [status, limit, drawn] = await Promise.all([
      readV<number>(ctx, loan.vault, "status"), readV<bigint>(ctx, loan.vault, "drawLimit"), readV<bigint>(ctx, loan.vault, "drawn"),
    ]);
    if (status !== 3) throw new HTTPException(409, { message: "dining draws open once the loan is Active (funded)" });
    if (drawn + amountRaw > limit) throw new HTTPException(409, { message: `draw exceeds the line: drawn ${drawn} + ${amountRaw} > limit ${limit} (USDC raw)` });

    // FLY/USD: the desk's app wallet first (not borrower-controlled); the member balance only if it is worth at least $1
    const appBal = await fly("rewards.getBalance (scope read:balance)", discovery().rewards.getBalance());
    const px = priceOf(appBal) ?? priceOf((await memberWallets(ctx, loanId)).balance);
    if (!px) throw new HTTPException(409, { message: "cannot price FLY: neither the app wallet nor the member holds $1+ of FLY" });
    const flyWei = (BigInt(cents) * px.wei) / px.cents;
    if (BigInt(appBal.balance.value) < flyWei) throw new HTTPException(409, { message: `desk FLY float insufficient: app wallet ${appBal.balance.value} wei < ${flyWei}` });

    const id = Number(ctx.db.prepare("INSERT INTO draws (loan_id,amount_raw,fly_wei,location_id,flynet_reward_id,tx_hash,status,error,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(loanId, amountRaw.toString(), flyWei.toString(), req.locationId ?? null, null, null, "pending", null, now()).lastInsertRowid);
    await recordDrawOnchain(ctx, id);
    if (drawRow(ctx, id).status === "recorded") await issueDrawFly(ctx, id);
    const d = rowToDraw(drawRow(ctx, id));
    if (d.status === "failed") throw new HTTPException(409, { message: `draw failed: ${d.error}` });
    return d; // pending/recorded: the loop finishes it
  } finally { drawing.delete(loanId); }
}

/** Step 1: vault.addDraw by the Dynamic agent wallet. Clean revert: failed. Anything else stays pending for reconcile. */
async function recordDrawOnchain(ctx: Ctx, drawId: number) {
  const d = drawRow(ctx, drawId);
  const loan = getLoan(ctx.db, Number(d.loan_id))!;
  try {
    const w = await ctx.wallet();
    const r = await w.write({ address: loan.vault!, abi: vaultAbi, functionName: "addDraw", args: [BigInt(d.amount_raw)] });
    setDraw(ctx, drawId, { status: "recorded", tx_hash: r.hash, error: null });
    addEvent(ctx.db, loan.id, "draw", r.hash, { drawId, amountRaw: d.amount_raw, flyWei: d.fly_wei, locationId: d.location_id });
  } catch (e) {
    setDraw(ctx, drawId, isRevert(e) ? { status: "failed", error: `addDraw reverted, nothing charged: ${errMsg(e)}` } : { error: `addDraw unconfirmed: ${errMsg(e)}` });
    ctx.log("flynet", `addDraw for draw ${drawId}: ${errMsg(e)}`);
  }
}

/** Pending draws whose addDraw outcome is unknown (e.g. receipt timeout): on-chain drawn() vs the sum of booked draws decides.
 *  ponytail: assumes only this module calls addDraw and at most 1 pending draw per loan (enforced in draw()). */
export async function reconcilePending(ctx: Ctx, loanId: number, drawnOnchain: bigint, resend = recordDrawOnchain) {
  const rows = ctx.db.prepare("SELECT * FROM draws WHERE loan_id = ? AND status IN ('pending','recorded','issued') ORDER BY id").all(loanId) as R[];
  let booked = rows.filter((r) => r.status !== "pending").reduce((s, r) => s + BigInt(r.amount_raw), 0n);
  for (const r of rows.filter((x) => x.status === "pending")) {
    const age = Date.now() - Date.parse(r.created_at);
    if (drawnOnchain - booked >= BigInt(r.amount_raw)) {
      booked += BigInt(r.amount_raw);
      setDraw(ctx, Number(r.id), { status: "recorded", error: null });
      addEvent(ctx.db, loanId, "draw", r.tx_hash ?? null, { drawId: Number(r.id), amountRaw: r.amount_raw, flyWei: r.fly_wei, reconciled: true });
    } else if (age > 30 * 60_000) setDraw(ctx, Number(r.id), { status: "failed", error: `${r.error ?? ""}; addDraw never landed on-chain (no debt, no FLY)` });
    // ponytail: the wallet sends txs serially with a 180s receipt wait, so an addDraw still unmined after 5 min was dropped: resend
    else if (age > 5 * 60_000) await resend(ctx, Number(r.id));
  }
}

/** Step 2: FLY to the member (idempotent per draw row). Permanent Flynet refusal: the desk offsets the recorded debt in USDC. */
async function issueDrawFly(ctx: Ctx, drawId: number) {
  const d = drawRow(ctx, drawId);
  const loan = getLoan(ctx.db, Number(d.loan_id))!;
  const link = getLink(ctx, loan.id);
  try {
    if (!link) throw Object.assign(new Error("Blackbird account unlinked"), { status: 404 });
    const reward = await discovery().rewards.issueReward({
      userId: link.member_id, amount: { value: d.fly_wei, currency: "FLY" },
      description: `Fee Desk dining draw, loan #${loan.id}`, idempotencyKey: `feedesk-draw-${drawId}`,
      metadata: { loanId: String(loan.id), drawId: String(drawId), locationId: d.location_id ?? "" },
    });
    setDraw(ctx, drawId, { status: "issued", flynet_reward_id: reward.id, error: null });
  } catch (e) {
    const st = (e as { status?: number }).status ?? 0;
    const msg = `issue_reward: ${st || "network"} ${errMsg(e)} (needs scope write:rewards + funded app wallet)`;
    ctx.log("flynet", `draw ${drawId}: ${msg}`);
    if (!(st >= 400 && st < 500 && st !== 408 && st !== 429)) return void setDraw(ctx, drawId, { error: msg }); // transient: loop retries, same idempotency key
    const w = await ctx.wallet(); // permanent: undo the borrower's debt with desk USDC
    const vaultActive = (await readV<number>(ctx, loan.vault!, "status")) === 3;
    const r = await w.write({ address: ADDR.USDC, abi: erc20Abi, functionName: "transfer", args: [vaultActive ? loan.vault! : loan.borrower, BigInt(d.amount_raw)] });
    setDraw(ctx, drawId, { status: "failed", error: `${msg}; debt offset by desk USDC tx ${r.hash}` });
    addEvent(ctx.db, loan.id, "repaid", r.hash, { source: "flynet_draw_refund", drawId, usdcRaw: d.amount_raw, to: vaultActive ? "vault" : "borrower" });
  }
}

// ─── settle: return unused drawn FLY, credit its USD value against the draw debt ───
const kvGet = (ctx: Ctx, k: string) => (ctx.db.prepare("SELECT value FROM kv WHERE key = ?").get(k) as R | undefined)?.value as string | undefined;
const kvSet = (ctx: Ctx, k: string, v: string) =>
  ctx.db.prepare("INSERT INTO kv (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").run(k, v, now());
const creditKey = (loanId: number) => `flynet:credit-due:${loanId}`;
const minB = (...xs: bigint[]) => xs.reduce((a, b) => (b < a ? b : a));

/** How much drawn FLY to pull back and the USDC credit for it, at the draws' own rate (never a live, member-influenced price). */
export function settleAmounts(issued: { flyWei: string; amountRaw: string }[], settledWei: bigint, memberWei: bigint, drawDebt: bigint) {
  const fly = issued.reduce((s, d) => s + BigInt(d.flyWei), 0n), usdc = issued.reduce((s, d) => s + BigInt(d.amountRaw), 0n);
  if (fly === 0n || usdc === 0n) return { pull: 0n, usdcRaw: 0n };
  const pull = minB(memberWei, fly - settledWei, (drawDebt * fly) / usdc); // never more than we lent, nor more than is still owed
  return pull > 0n ? { pull, usdcRaw: (pull * usdc) / fly } : { pull: 0n, usdcRaw: 0n };
}

export async function settle(ctx: Ctx, loanId: number, body: { nonce: string; signature: Hex }): Promise<DineState> {
  const loan = loanOr404(ctx, loanId);
  await assertBorrower(ctx, loan, drawMessage(loanId, 0, body.nonce), body.signature);
  if (!loan.vault) throw new HTTPException(409, { message: "loan has no vault" });
  if (drawing.has(loanId)) throw new HTTPException(409, { message: "a draw/settle is in progress; retry in a minute" });
  drawing.add(loanId);
  try {
    spendNonce(ctx, body.nonce);
    const [status, debt] = await Promise.all([readV<number>(ctx, loan.vault, "status"), readV<bigint>(ctx, loan.vault, "drawDebt")]);
    if (status !== 3) throw new HTTPException(409, { message: `settle works while the loan is Active (vault status ${status})` });
    if (debt === 0n) throw new HTTPException(409, { message: "no dining debt outstanding" });
    const settledKey = `flynet:settled:${loanId}`;
    const settled = BigInt(kvGet(ctx, settledKey) ?? "0");
    const bal = BigInt((await memberWallets(ctx, loanId)).balance.balance.value);
    const { pull, usdcRaw } = settleAmounts(listDraws(ctx, loanId).filter((d) => d.status === "issued"), settled, bal, debt);
    if (pull <= 0n || usdcRaw <= 0n) throw new HTTPException(409, { message: "no leftover drawn FLY to settle" });
    const w = await ctx.wallet();
    const deskUsdc = await ctx.pub.readContract({ address: ADDR.USDC, abi: erc20Abi, functionName: "balanceOf", args: [w.address] });
    if (deskUsdc < usdcRaw) throw new HTTPException(503, { message: `desk wallet USDC ${deskUsdc} < credit ${usdcRaw}; try later` });

    const m = member(ctx, loanId);
    const link = getLink(ctx, loanId)!;
    const pi = await fly("createPaymentIntent", m.createPaymentIntent({
      customerUserId: link.member_id, amount: { value: pull.toString(), currency: "FLY" },
      description: `Fee Desk: return unused dining FLY, loan #${loanId}`, idempotencyKey: `settle-${loanId}-${body.nonce}`,
    }));
    const paid = await fly("confirmPaymentIntent", m.confirmPaymentIntent({ id: pi.id, body: { userId: link.member_id } }));
    if (paid.status !== "paid") throw new HTTPException(502, { message: `payment intent ${pi.id} status ${paid.status}` });
    // FLY is ours now: book the owed credit before any chain call, so a failed transfer is retried by the loop, never lost
    kvSet(ctx, settledKey, (settled + pull).toString());
    kvSet(ctx, creditKey(loanId), (BigInt(kvGet(ctx, creditKey(loanId)) ?? "0") + usdcRaw).toString());
    ctx.log("flynet", `loan ${loanId}: pulled back ${pull} FLY wei (pi ${pi.id}), crediting ${usdcRaw} USDC raw`);
    await payCredit(ctx, loanId).catch((e) => ctx.log("flynet", `credit loan ${loanId} failed, loop retries: ${errMsg(e)}`));
    return dineState(ctx, loanId);
  } finally { drawing.delete(loanId); }
}

/** Owed settle credit: USDC into the vault + payDesk (reduces drawDebt). If the vault already closed, to the borrower. */
export async function payCredit(ctx: Ctx, loanId: number) {
  const due = BigInt(kvGet(ctx, creditKey(loanId)) ?? "0");
  if (due === 0n) return;
  const loan = getLoan(ctx.db, loanId)!;
  const w = await ctx.wallet();
  const active = (await readV<number>(ctx, loan.vault!, "status")) === 3;
  // ponytail: a transfer that mines but whose receipt wait fails is re-sent (desk overpays the borrower, never underpays)
  const r = await w.write({ address: ADDR.USDC, abi: erc20Abi, functionName: "transfer", args: [active ? loan.vault! : loan.borrower, due] });
  kvSet(ctx, creditKey(loanId), "0");
  let deskPaidRaw: string | null = null;
  if (active) {
    const p = await w.write({ address: loan.vault!, abi: vaultAbi, functionName: "payDesk" }).catch(() => null); // anyone can call it later too
    const ev = p ? parseEventLogs({ abi: vaultAbi, logs: p.receipt.logs, eventName: "DeskPaid" })[0] : undefined;
    deskPaidRaw = (ev?.args as { amount?: bigint } | undefined)?.amount?.toString() ?? null;
  }
  addEvent(ctx.db, loanId, "repaid", r.hash, { source: "flynet_settle", usdcRaw: due.toString(), to: active ? "vault" : "borrower", deskPaidRaw });
}

// ─── routes + loop ───
export function register(app: Hono, ctx: Ctx) {
  app.get("/api/flynet/connect", async (c) => {
    const loanId = Number(c.req.query("loanId")), nonce = c.req.query("nonce") ?? "", sig = (c.req.query("sig") ?? "") as Hex;
    const loan = loanOr404(ctx, loanId);
    await assertBorrower(ctx, loan, flynetLinkMessage(loanId, nonce), sig);
    spendNonce(ctx, nonce);
    const { url, state, codeVerifier } = await fly("authorize url", oauth().getAuthorizeUrl());
    ctx.db.prepare("INSERT INTO oauth_states (state, loan_id, code_verifier, created_at) VALUES (?,?,?,?)").run(state, loanId, codeVerifier, now());
    return c.redirect(url, 302);
  });
  app.get("/api/flynet/callback", async (c) => {
    const code = c.req.query("code"), state = c.req.query("state");
    if (c.req.query("error")) throw new HTTPException(400, { message: `Blackbird consent: ${c.req.query("error")} ${c.req.query("error_description") ?? ""}` });
    const st = ctx.db.prepare("SELECT * FROM oauth_states WHERE state = ?").get(state ?? "") as R | undefined;
    if (!code || !st || Date.now() - Date.parse(st.created_at) > 15 * 60_000) throw new HTTPException(400, { message: "invalid or expired OAuth state" });
    ctx.db.prepare("DELETE FROM oauth_states WHERE state = ?").run(state!);
    const t = await fly("code exchange", oauth().exchangeCode({ code, codeVerifier: st.code_verifier }));
    const profile = await fly("getProfile", new FlynetMemberClient({ accessToken: t.access_token, environment: env() }).getProfile());
    ctx.db.prepare(`INSERT INTO flynet_links (loan_id,member_id,access_token,refresh_token,expires_at,created_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(loan_id) DO UPDATE SET member_id=excluded.member_id, access_token=excluded.access_token, refresh_token=excluded.refresh_token, expires_at=excluded.expires_at`)
      .run(st.loan_id, profile.id, t.access_token, t.refresh_token ?? "", new Date(Date.now() + t.expires_in * 1000).toISOString(), now());
    return c.redirect(`${ctx.webUrl}/dine/${st.loan_id}`, 302);
  });
  app.get("/api/flynet/restaurants", async (c) => c.json(await recommend(ctx, Number(c.req.query("loanId")))));
  app.get("/api/loans/:id/dine", async (c) => c.json(await dineState(ctx, Number(c.req.param("id")))));
  app.post("/api/loans/:id/dine/draw", async (c) => c.json(await draw(ctx, Number(c.req.param("id")), await c.req.json())));
  app.post("/api/loans/:id/dine/settle", async (c) => c.json(await settle(ctx, Number(c.req.param("id")), await c.req.json())));
}

export function start(ctx: Ctx): () => void {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const step = (what: string, p: Promise<unknown>) => p.catch((e) => ctx.log("flynet", `${what}: ${errMsg(e)}`));
      for (const { loan_id } of ctx.db.prepare("SELECT DISTINCT loan_id FROM draws WHERE status = 'pending'").all() as R[]) {
        const loan = getLoan(ctx.db, Number(loan_id));
        if (loan?.vault && !drawing.has(loan.id)) await step(`reconcile loan ${loan.id}`, readV<bigint>(ctx, loan.vault, "drawn").then((d) => reconcilePending(ctx, loan.id, d)));
      }
      for (const d of ctx.db.prepare("SELECT id, loan_id FROM draws WHERE status = 'recorded'").all() as R[]) {
        if (!drawing.has(Number(d.loan_id))) await step(`issue FLY draw ${d.id}`, issueDrawFly(ctx, Number(d.id)));
      }
      for (const { key } of ctx.db.prepare("SELECT key FROM kv WHERE key LIKE 'flynet:credit-due:%' AND value != '0'").all() as R[]) {
        const loanId = Number(String(key).split(":").pop());
        if (!drawing.has(loanId)) await step(`credit loan ${loanId}`, payCredit(ctx, loanId));
      }
      for (const l of ctx.db.prepare("SELECT loan_id, expires_at FROM flynet_links WHERE refresh_token != ''").all() as R[]) {
        if (Date.parse(l.expires_at) - Date.now() < 5 * 60_000) await accessToken(ctx, Number(l.loan_id)).catch((e) => ctx.log("flynet", `refresh loan ${l.loan_id}: ${e.message}`));
      }
    } catch (e) { ctx.log("flynet", `loop: ${(e as Error).message}`); } finally { busy = false; }
  };
  const t = setInterval(tick, 60_000);
  return () => clearInterval(t);
}
