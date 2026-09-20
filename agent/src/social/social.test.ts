// Cheap checks for the money/security paths of flash + social (no network). Run: node --test src/social/social.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { ADDR, FLASH_EIP712_DOMAIN, type Memo, type Quote } from "@feedesk/shared";
import type { Ctx } from "../ctx.ts";
import { insertLoan, openDb } from "../db/index.ts";
import { assertVaultOrder, hasOpenFlashOrder } from "../flash/index.ts";
import { applyWebhook, hasDelegation, verifyWebhook } from "./delegation.ts";
import { publishSignals, quoteMirror, validateFollow } from "./index.ts";
import { RULES_MODEL } from "../underwriter/engine.ts";

const mkCtx = (): Ctx => ({ db: openDb(":memory:"), log: () => {} } as unknown as Ctx);
const VAULT = "0x1074393effFCf1A15e306cD3931F48eDA9ABcd55", TOKEN = "0x5f980dcfc4c0fa3911554cf5ab288ed0eb13dba3";

test("assertVaultOrder: only 'sell token from vault, USDC back to vault, ≤ amount' passes", () => {
  const td = (m: object, d: object = {}) => ({ domain: { ...FLASH_EIP712_DOMAIN, ...d }, primaryType: "FlashOrder", types: {},
    message: { swapper: VAULT, recipient: VAULT, fromToken: TOKEN, toToken: ADDR.USDC, fromAmount: 100n, ...m } }) as any;
  assert.doesNotThrow(() => assertVaultOrder(td({}), VAULT, TOKEN, 100n));
  assert.throws(() => assertVaultOrder(td({ recipient: "0x000000000000000000000000000000000000dEaD" }), VAULT, TOKEN, 100n), /recipient/);
  assert.throws(() => assertVaultOrder(td({ toToken: ADDR.WETH }), VAULT, TOKEN, 100n), /tokens/);
  assert.throws(() => assertVaultOrder(td({ fromAmount: 101n }), VAULT, TOKEN, 100n), /fromAmount/);
  assert.throws(() => assertVaultOrder(td({}, { chainId: 1 }), VAULT, TOKEN, 100n), /domain/);
});

test("hasOpenFlashOrder: keeper order stays open until SETTLED; vault1271 until terminal", () => {
  const ctx = mkCtx();
  const put = (id: string, loan: number, mode: string, status: string) => ctx.db.prepare(
    "INSERT INTO flash_orders (id,loan_id,mode,funder,token,amount_raw,status,usdc_out_raw,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
  ).run(id, loan, mode, VAULT, TOKEN, "1", status, "0", "t", "t");
  put("a", 1, "keeper", "ORDER_STATUS_FILLED"); assert.equal(hasOpenFlashOrder(ctx, 1), true);
  put("b", 2, "keeper", "SETTLING"); assert.equal(hasOpenFlashOrder(ctx, 2), true);
  put("c", 3, "keeper", "SETTLED"); assert.equal(hasOpenFlashOrder(ctx, 3), false);
  put("d", 4, "vault1271", "ORDER_STATUS_FILLED"); assert.equal(hasOpenFlashOrder(ctx, 4), false);
  put("e", 5, "vault1271", "ORDER_STATUS_ACCEPTED"); assert.equal(hasOpenFlashOrder(ctx, 5), true);
});

test("verifyWebhook: raw and re-serialized HMAC accepted, anything else rejected", () => {
  const raw = '{"a": 1}', h = (p: string) => "sha256=" + createHmac("sha256", "s").update(p).digest("hex");
  assert.equal(verifyWebhook(raw, h(raw), "s"), true);
  assert.equal(verifyWebhook(raw, h('{"a":1}'), "s"), true);
  assert.equal(verifyWebhook(raw, h(raw), "other"), false);
  assert.equal(verifyWebhook(raw, undefined, "s"), false);
  assert.equal(verifyWebhook(raw, "sha256=00", "s"), false);
});

test("applyWebhook: duplicate eventId and a late 'created' cannot undo a revoke", () => {
  const ctx = mkCtx(), addr = "0x00000000000000000000000000000000000000aa";
  const created = (eventId: string, timestamp: string) => ({ eventName: "wallet.delegation.created", eventId, timestamp, userId: "u",
    data: { chain: "EVM", publicKey: addr, walletId: "w1", encryptedDelegatedShare: {}, encryptedWalletApiKey: {} } });
  const revoked = (eventId: string, timestamp: string) => ({ eventName: "wallet.delegation.revoked", eventId, timestamp, data: { walletId: "w1" } });
  assert.equal(applyWebhook(ctx, created("e1", "2026-09-19T01:00:00Z")), "stored");
  assert.equal(hasDelegation(ctx, addr), true);
  assert.equal(applyWebhook(ctx, revoked("e2", "2026-09-19T02:00:00Z")), "revoked");
  assert.equal(hasDelegation(ctx, addr), false);
  assert.match(applyWebhook(ctx, created("e1", "2026-09-19T01:00:00Z")), /duplicate/); // replay
  assert.match(applyWebhook(ctx, created("e3", "2026-09-19T01:30:00Z")), /older than a revoke/); // late delivery
  assert.equal(hasDelegation(ctx, addr), false);
  assert.equal(applyWebhook(ctx, created("e4", "2026-09-19T03:00:00Z")), "stored"); // genuine re-grant
  assert.equal(hasDelegation(ctx, addr), true);
  assert.match(applyWebhook(ctx, { eventName: "wallet.delegation.revoked", data: { walletId: "w1" } }), /missing/);
});

test("validateFollow: bounds and mode-specific fields", () => {
  const ok = { follower: VAULT, personaId: "prudent", mode: "bracket", sizeUsdc: 5, tpPct: 50, slPct: 20, dcaDays: 0, auto: false };
  assert.equal(validateFollow(ok).tpPct, 50);
  assert.equal(validateFollow({ ...ok, mode: "dca", dcaDays: 3 }).tpPct, 0);
  for (const bad of [{ follower: "nope" }, { personaId: "x" }, { sizeUsdc: 10_001 }, { sizeUsdc: 0 }, { slPct: 100 }, { mode: "dca", dcaDays: 1 }, { mode: "dca", dcaDays: 2.5 }])
    assert.throws(() => validateFollow({ ...ok, ...bad }));
  assert.equal(validateFollow({ ...ok, auto: "true" }).auto, false); // only literal true enables delegated spending
});

test("publishSignals: approvals queue one mirror per follow, re-approvals of the same token within 24h are deduped", () => {
  const ctx = mkCtx();
  const follow = (persona: string, follower: string) => ctx.db.prepare(`INSERT INTO follows (follower,persona_id,mode,size_usdc,tp_pct,sl_pct,dca_days,auto,active,created_at)
    VALUES (?,?,'bracket',5,50,20,0,1,1,'t')`).run(follower, persona, );
  follow("prudent", "0x01"); follow("prudent", "0x02"); follow("skeptic", "0x03");
  const loan = () => insertLoan(ctx.db, { status: "APPROVED", borrower: VAULT as any, token: TOKEN as any, symbol: "GITLAWB", poolId: "0x01" as any, feesManager: VAULT as any });
  const memo: Memo = { personaId: "prudent", model: "m", decision: "approve", principalRaw: "1", maxNotePrice: 0.9, confidence: 0.7, rationale: "r", risks: [] };
  const quote = { inputs: { token: TOKEN, symbol: "GITLAWB" } } as unknown as Quote;
  const mirrors = () => Number((ctx.db.prepare("SELECT COUNT(*) n FROM mirror_orders").get() as any).n);

  const sigs = publishSignals(ctx, loan(), [memo, { ...memo, personaId: "skeptic", decision: "decline" }], quote);
  assert.equal(sigs.length, 2);
  assert.equal(mirrors(), 2); // two prudent followers; the skeptic declined
  publishSignals(ctx, loan(), [memo], quote); // same token re-applied → no new buys
  assert.equal(mirrors(), 2);
  ctx.db.prepare("UPDATE mirror_orders SET status = 'failed' WHERE follower = '0x01'").run();
  publishSignals(ctx, loan(), [memo], quote); // a failed mirror does not block a retry
  assert.equal(mirrors(), 3);
  ctx.db.prepare("UPDATE mirror_orders SET created_at = '2000-01-01T00:00:00.000Z'").run();
  publishSignals(ctx, loan(), [memo], quote); // after 24h the signal counts again
  assert.equal(mirrors(), 5);
});

test("publishSignals: rules-only (non-LLM) memos publish signals but never queue follower orders", () => {
  const ctx = mkCtx();
  ctx.db.prepare(`INSERT INTO follows (follower,persona_id,mode,size_usdc,tp_pct,sl_pct,dca_days,auto,active,created_at)
    VALUES ('0x01','momentum','bracket',5,50,20,0,1,1,'t')`).run();
  const loan = () => insertLoan(ctx.db, { status: "APPROVED", borrower: VAULT as any, token: TOKEN as any, symbol: "GITLAWB", poolId: "0x01" as any, feesManager: VAULT as any });
  const m = (personaId: string, model: string): Memo => ({ personaId, model, decision: "approve", principalRaw: "1", maxNotePrice: 0.9, confidence: 0.5, rationale: "r", risks: [] });
  const quote = { inputs: { token: TOKEN, symbol: "GITLAWB" } } as unknown as Quote;
  const mirrors = () => Number((ctx.db.prepare("SELECT COUNT(*) n FROM mirror_orders").get() as any).n);

  const sigs = publishSignals(ctx, loan(), [m("prudent", RULES_MODEL), m("momentum", "gemini-3-flash")], quote);
  assert.equal(mirrors(), 0); // LLM momentum memo, but the binding lead memo came from rules
  assert.deepEqual(sigs.map((s) => s.mirrorable), [false, false]);
  assert.match(sigs[1]!.mirrorNote!, /lead memo not written by an LLM/);
  const own = publishSignals(ctx, loan(), [m("prudent", "claude-sonnet-4.6"), m("momentum", RULES_MODEL)], quote);
  assert.equal(mirrors(), 0); // LLM lead, but this persona's own memo came from rules
  assert.match(own[1]!.mirrorNote!, /memo not written by an LLM/);
  const ok = publishSignals(ctx, loan(), [m("prudent", "claude-sonnet-4.6"), m("momentum", "gemini-3-flash")], quote);
  assert.equal(mirrors(), 1);
  assert.equal(ok[1]!.mirrorable, true);
  assert.equal(ok[1]!.mirrorNote, null);
});

test("quoteMirror: a failed risk gate is recorded but not terminal (unauthenticated route)", async () => {
  const ctx = mkCtx(), realFetch = globalThis.fetch, realKey = process.env.FLASH_API_KEY;
  process.env.FLASH_API_KEY ||= "dpka_test";
  ctx.db.prepare(`INSERT INTO follows (id,follower,persona_id,mode,size_usdc,tp_pct,sl_pct,dca_days,auto,active,created_at)
    VALUES (1,'0x01','prudent','bracket',5,50,20,0,0,1,'t')`).run();
  ctx.db.prepare(`INSERT INTO mirror_orders (id,follow_id,signal_id,follower,token,symbol,mode,size_usdc,status,created_at,updated_at)
    VALUES (1,1,1,'0x01',?,'GITLAWB','bracket',5,'pending_signature','t','t')`).run(TOKEN);
  globalThis.fetch = (async () => Response.json({ assets: [{ address: TOKEN, price: "0.01", riskFlagged: true, decimals: 18, symbol: "G", liquidity: "1" }] })) as typeof fetch;
  try {
    await assert.rejects(quoteMirror(ctx, 1), /riskFlagged/);
    const row = ctx.db.prepare("SELECT status, error FROM mirror_orders WHERE id = 1").get() as any;
    assert.equal(row.status, "pending_signature");
    assert.match(row.error, /riskFlagged/);
  } finally {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.FLASH_API_KEY; else process.env.FLASH_API_KEY = realKey;
  }
});

test("GET /api/signals/:id and /flash-quote: validation → 400, missing → 404, declines → 409, card fields", async () => {
  const { Hono } = await import("hono");
  const { register } = await import("./index.ts");
  const ctx = mkCtx(), app = new Hono();
  register(app, ctx);
  const loanId = insertLoan(ctx.db, { status: "APPROVED", borrower: VAULT as any, token: TOKEN as any, symbol: "GITLAWB", poolId: "0x01" as any, feesManager: VAULT as any });
  ctx.db.prepare(`INSERT INTO memos (loan_id,persona_id,model,decision,principal_raw,max_note_price,confidence,rationale,risks_json,created_at)
    VALUES (?,'prudent',?,'approve','5000000',0.9,0.7,'r','[]','t')`).run(loanId, RULES_MODEL);
  const m = (personaId: string, decision: "approve" | "decline"): Memo => ({ personaId, model: RULES_MODEL, decision, principalRaw: "5000000", maxNotePrice: 0.9, confidence: 0.7, rationale: "r", risks: [] });
  const [a, d] = publishSignals(ctx, loanId, [m("prudent", "approve"), m("skeptic", "decline")], { inputs: { token: TOKEN, symbol: "GITLAWB" } } as unknown as Quote);
  const get = async (p: string) => { const r = await app.request(p); return { status: r.status, body: await r.json() as any }; };

  for (const p of ["/api/signals/abc", "/api/signals/0", `/api/signals/abc/flash-quote`]) assert.equal((await get(p)).status, 400, p);
  for (const q of ["sizeUsdc=0", "sizeUsdc=x", "tpPct=0", "slPct=100"]) assert.equal((await get(`/api/signals/${a!.id}/flash-quote?funder=${VAULT}&${q}`)).status, 400, q);
  assert.equal((await get(`/api/signals/${a!.id}/flash-quote?funder=nope`)).status, 400);
  assert.equal((await get("/api/signals/999")).status, 404);
  assert.equal((await get("/api/signals/999/flash-quote")).status, 404);
  assert.equal((await get(`/api/signals/${d!.id}/flash-quote?funder=${VAULT}`)).status, 409);

  const card = (await get(`/api/signals/${a!.id}`)).body;
  assert.equal(card.personaName, "Prudent");
  assert.equal(card.lead, true);
  assert.equal(card.llm, false); // rules memo: labeled, never passed off as LLM
  assert.equal(card.model, RULES_MODEL);
  assert.deepEqual(card.loan, { status: "APPROVED", repaidPct: null });
  assert.deepEqual(card.mirrors, { total: 0, placed: 0, filled: 0, spentUsdc: 0, pnlUsd: null });
});

test("signalFlashQuote: quotes the mirror's bracket (TP/SL off Flash spot), never places an order, caches 30s", async () => {
  const { signalFlashQuote } = await import("./index.ts");
  const ctx = mkCtx(), realFetch = globalThis.fetch, realKey = process.env.FLASH_API_KEY;
  process.env.FLASH_API_KEY ||= "dpka_test";
  const loanId = insertLoan(ctx.db, { status: "APPROVED", borrower: VAULT as any, token: TOKEN as any, symbol: "GITLAWB", poolId: "0x01" as any, feesManager: VAULT as any });
  const memo: Memo = { personaId: "prudent", model: "m", decision: "approve", principalRaw: "1", maxNotePrice: 0.9, confidence: 0.7, rationale: "r", risks: [] };
  const [s] = publishSignals(ctx, loanId, [memo], { inputs: { token: TOKEN, symbol: "GITLAWB" } } as unknown as Quote);
  const calls: { url: string; body: any }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    return String(url).includes("/search") ? Response.json({ assets: [{ address: TOKEN, price: "0.002", riskFlagged: false, decimals: 18, symbol: "G", liquidity: "1" }] })
      : Response.json({ quoteId: "q1", to: { amount: "2400", notional: "4.9" }, fees: { estimatedFeeNotional: "0.08" }, estimatedPriceImpact: "-0.012" });
  }) as typeof fetch;
  try {
    const q = await signalFlashQuote(ctx, s!.id, { funder: VAULT, sizeUsdc: "5", tpPct: "50", slPct: "20" });
    const quote = calls.find((c) => c.url.endsWith("/quote"))!;
    assert.ok(!calls.some((c) => c.url.endsWith("/order")));
    assert.equal(quote.body.orderType, "market");
    assert.equal(quote.body.funderAddress, VAULT);
    assert.deepEqual(quote.body.attachedBracket, { takeProfit: { notionalPrice: "0.003" }, stopLoss: { notionalPrice: "0.0016" } });
    assert.equal(q.tpPriceUsd, 0.003);
    assert.equal(q.priceImpactPct, 1.2);
    assert.equal(q.withinImpactGate, true);
    const n = calls.length;
    await signalFlashQuote(ctx, s!.id, { funder: VAULT, sizeUsdc: "5", tpPct: "50", slPct: "20" });
    assert.equal(calls.length, n); // cached
  } finally {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.FLASH_API_KEY; else process.env.FLASH_API_KEY = realKey;
  }
});

test("auto-mirror executor does not run on DEMO_FORK unless AUTO_MIRROR_ON_FORK=1", async () => {
  const { start } = await import("./index.ts");
  const logs: string[] = [];
  const ctx = { demoFork: true, db: { prepare: () => ({ all: () => { throw new Error("must not query on a fork"); } }) }, log: (_m: string, msg: string) => logs.push(msg) } as never;
  const stop = start(ctx);
  await new Promise((r) => setTimeout(r, 50));
  stop();
  assert.ok(logs.some((l) => l.includes("auto-mirror executor disabled on DEMO_FORK")));
});
