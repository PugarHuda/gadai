// Follow the Desk (SPEC §3.H, §7): every persona memo is a public, scored signal; followers mirror approvals with
// Definitive Flash orders — market entry + attached Bracket (TP/SL), or DCA as a long Flash TWAP.
// One-click: browser signs the MirrorQuote. Auto: agent signs through the follower's Dynamic delegation.
import type { Hono } from "hono";
import { createPublicClient, http, isAddress, maxUint256, parseAbi, parseUnits, encodeFunctionData, type PublicClient } from "viem";
import { base } from "viem/chains";
import {
  ADDR, CHAIN_ID_BASE, ERC20_ABI, FEE_VAULT_ABI, flashCancelMessage, followMessage, unfollowMessage,
  type Address, type Follow, type FollowSigned, type Hex, type LeaderboardRow, type Memo, type MirrorOrder, type MirrorQuote,
  type MirrorStatus, type MirrorSubmit, type Quote, type TxRequest,
} from "@feedesk/shared";
import { addrParam, jsonBody, opt, posInt, type Ctx } from "../ctx.ts";
import { getLoan, now, toSignal, useNonce, type SignalRow } from "../db/index.ts";
import { attributionFields, decStr, feeFields, flash, parseTypedData, searchToken } from "../flash/index.ts";
import { PERSONAS } from "../underwriter/index.ts";
import { writtenByLlm } from "../underwriter/engine.ts";
import { applyWebhook, delegatedSigner, hasDelegation, missingDelegationEnv, verifyWebhook } from "./delegation.ts";
import { leaderboardRow, mirrorPnl, noteOutstanding, rankRows, type LoanOutcome, type PersonaStats } from "./score.ts";

const erc20 = parseAbi(ERC20_ABI);
const vaultAbi = parseAbi(FEE_VAULT_ABI);
const MAX_IMPACT = 0.03; // SPEC: estimatedPriceImpact ≤ 3%
type R = Record<string, any>;

// Mirror orders are real Base mainnet trades even in DEMO_FORK (signals reference real tokens; Flash is mainnet-only).
let mainPubMemo: PublicClient | undefined;
const mainPub = (ctx: Ctx): PublicClient =>
  ctx.demoFork ? (mainPubMemo ??= createPublicClient({ chain: base, transport: http(opt("BASE_RPC_URL", "https://base-rpc.publicnode.com")) }) as PublicClient) : ctx.pub;

// ─── row mappers ───
const toFollow = (r: R): Follow => ({
  id: Number(r.id), follower: r.follower, personaId: r.persona_id, mode: r.mode, sizeUsdc: r.size_usdc, tpPct: r.tp_pct,
  slPct: r.sl_pct, dcaDays: Number(r.dca_days), auto: !!r.auto, createdAt: r.created_at,
});
const toMirror = (r: R): MirrorOrder => ({
  id: Number(r.id), followId: Number(r.follow_id), signalId: Number(r.signal_id), follower: r.follower, token: r.token, symbol: r.symbol,
  mode: r.mode, sizeUsdc: r.size_usdc, status: r.status, flashOrderId: r.flash_order_id, bracketStatus: r.bracket_status,
  filledTokenRaw: r.filled_token_raw, avgPriceUsd: r.avg_price_usd, pnlUsd: r.pnl_usd, error: r.error, createdAt: r.created_at,
  bracketOrderId: r.quote_json ? JSON.parse(r.quote_json).bracketOrderId ?? null : null,
});
const mirrorRow = (ctx: Ctx, id: number) => ctx.db.prepare("SELECT * FROM mirror_orders WHERE id = ?").get(id) as R | undefined;
const setMirror = (ctx: Ctx, id: number, patch: Record<string, string | number | null>) => {
  const keys = Object.keys(patch);
  ctx.db.prepare(`UPDATE mirror_orders SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).run(...Object.values(patch), now(), id);
};
const failMirror = (ctx: Ctx, id: number, error: string) => { setMirror(ctx, id, { status: "failed", error }); return toMirror(mirrorRow(ctx, id)!); };

// ─── signals ───
let kick: (() => void) | undefined; // wakes the auto-mirror executor

/**
 * One public signal per memo. An approval queues a pending mirror order for each active follower of that persona, but only
 * when both the lead memo and this memo were written by an LLM: rules-only memos (Bankr LLM out of credits) are still
 * published as signals, marked mirrorable:false with the reason, and never move follower money.
 */
export function publishSignals(ctx: Ctx, loanId: number, memos: Memo[], quote: Quote): SignalRow[] {
  const loan = getLoan(ctx.db, loanId);
  const token = (quote.inputs?.token ?? loan?.token) as Address | undefined;
  const symbol = quote.inputs?.symbol ?? loan?.symbol;
  if (!token || !symbol) throw new Error(`publishSignals: loan ${loanId} has no token`);
  const lead = memos.find((m) => m.personaId === PERSONAS[0]!.id);
  const ins = ctx.db.prepare(`INSERT INTO signals (loan_id,persona_id,token,symbol,decision,score,principal_raw,max_note_price,rationale,mirrorable,mirror_note,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  // At most one live mirror per (follow, token) per 24h: re-underwriting the same token (re-applies, repeat approvals)
  // must not make followers buy it again and again.
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const queue = ctx.db.prepare(`INSERT INTO mirror_orders (follow_id,signal_id,follower,token,symbol,mode,size_usdc,status,created_at,updated_at)
    SELECT ?,?,?,?,?,?,?,'pending_signature',?,? WHERE NOT EXISTS (SELECT 1 FROM mirror_orders
      WHERE follow_id = ?1 AND lower(token) = lower(?4) AND status <> 'failed' AND created_at > ?10)`);
  const out: SignalRow[] = [];
  for (const m of memos) {
    const note = m.decision !== "approve" ? "decline: nothing to mirror"
      : !lead || !writtenByLlm(lead) ? `lead memo not written by an LLM (${lead?.model ?? "missing"}): no follower orders`
      : !writtenByLlm(m) ? `memo not written by an LLM (${m.model}): no follower orders`
      : null;
    const id = Number(ins.run(loanId, m.personaId, token, symbol, m.decision, Math.round(m.confidence * 100), m.principalRaw, m.maxNotePrice, m.rationale, note ? 0 : 1, note, now()).lastInsertRowid);
    out.push(toSignal(ctx.db.prepare("SELECT * FROM signals WHERE id = ?").get(id) as R));
    if (note) {
      if (m.decision === "approve") ctx.log("social", `signal ${id} (${m.personaId} approves ${symbol}) not mirrored: ${note}`);
      continue;
    }
    const follows = ctx.db.prepare("SELECT * FROM follows WHERE persona_id = ? AND active = 1").all(m.personaId) as R[];
    let queued = 0;
    for (const f of follows) queued += Number(queue.run(f.id, id, f.follower, token, symbol, f.mode, f.size_usdc, now(), now(), since).changes);
    if (follows.length) ctx.log("social", `signal ${id} (${m.personaId} approves ${symbol}) → ${queued}/${follows.length} mirror orders queued (rest deduped, 24h)`);
  }
  kick?.();
  return out;
}

// ─── leaderboard ───
let lbCache: { at: number; rows: LeaderboardRow[] } | undefined;

export async function leaderboard(ctx: Ctx): Promise<LeaderboardRow[]> {
  if (lbCache && Date.now() - lbCache.at < 30_000) return lbCache.rows;
  const counts = ctx.db.prepare("SELECT persona_id, decision, COUNT(*) n FROM signals GROUP BY persona_id, decision").all() as R[];
  const followers = ctx.db.prepare("SELECT persona_id, COUNT(DISTINCT follower) n FROM follows WHERE active = 1 GROUP BY persona_id").all() as R[];
  const funded = ctx.db.prepare(`SELECT DISTINCT s.persona_id, l.id loan_id, l.vault FROM signals s JOIN loans l ON l.id = s.loan_id
    WHERE s.decision = 'approve' AND l.status IN ('ACTIVE','RELEASED') AND l.vault IS NOT NULL`).all() as R[];
  const vaults = [...new Set(funded.map((r) => r.vault as Address))];
  const outcome = new Map<string, Omit<LoanOutcome, "loanId" | "daysToRepay">>();
  if (vaults.length) {
    const res = await ctx.pub.multicall({
      contracts: vaults.flatMap((v) => (["faceValue", "debtOutstanding", "drawDebt"] as const).map((fn) => ({ address: v, abi: vaultAbi, functionName: fn }))),
    });
    vaults.forEach((v, i) => {
      const [a, b, c] = res.slice(i * 3, i * 3 + 3);
      if (a?.status !== "success" || b?.status !== "success" || c?.status !== "success") return ctx.log("social", `leaderboard: vault ${v} unreadable, skipped`);
      outcome.set(v, { faceRaw: a.result as bigint, noteOutstandingRaw: noteOutstanding(b.result as bigint, c.result as bigint) });
    });
  }
  const ev = (loanId: number, kind: string) => (ctx.db.prepare("SELECT created_at FROM loan_events WHERE loan_id = ? AND kind = ? ORDER BY id LIMIT 1").get(loanId, kind) as R | undefined)?.created_at;
  const days = (loanId: number) => {
    const a = ev(loanId, "disbursed"), b = ev(loanId, "released");
    return a && b ? (Date.parse(b) - Date.parse(a)) / 86_400_000 : null;
  };
  const mirrors = ctx.db.prepare(`SELECT f.persona_id, m.pnl_usd, m.quote_json FROM mirror_orders m JOIN follows f ON f.id = m.follow_id
    WHERE m.pnl_usd IS NOT NULL`).all() as R[];
  const rows = PERSONAS.map((p) => {
    const n = (d: string) => Number(counts.find((c) => c.persona_id === p.id && c.decision === d)?.n ?? 0);
    const s: PersonaStats = {
      approvals: n("approve"), declines: n("decline"),
      followers: Number(followers.find((f) => f.persona_id === p.id)?.n ?? 0),
      loans: funded.filter((r) => r.persona_id === p.id && outcome.has(r.vault)).map((r) => ({ loanId: Number(r.loan_id), ...outcome.get(r.vault)!, daysToRepay: days(Number(r.loan_id)) })),
      mirrors: mirrors.filter((m) => m.persona_id === p.id).map((m) => ({ spentUsdc: JSON.parse(m.quote_json).fill?.spentUsdc ?? 0, pnlUsd: m.pnl_usd })),
    };
    return leaderboardRow(p, s);
  });
  lbCache = { at: Date.now(), rows: rankRows(rows) };
  return lbCache.rows;
}

// ─── shareable signal cards ───
/** A signal plus what a share card needs: who wrote it (LLM or rules), whether it binds, and what actually happened. */
export type SignalCard = SignalRow & {
  personaName: string;
  model: string | null; // model that wrote the memo (null: memo row missing)
  llm: boolean; // false = rule-based memo, no LLM review
  lead: boolean; // lead persona: its decision binds the loan
  loan: { status: string; repaidPct: number | null } | null; // repaidPct: on-chain senior note repaid (null: not funded / unreadable)
  mirrors: { total: number; placed: number; filled: number; spentUsdc: number; pnlUsd: number | null };
};

const notFound = (what: string) => Object.assign(new Error(`${what} not found`), { status: 404 });
const signalRow = (ctx: Ctx, id: number) => {
  const r = ctx.db.prepare("SELECT * FROM signals WHERE id = ?").get(id) as R | undefined;
  if (!r) throw notFound("signal");
  return toSignal(r);
};

export async function signalCard(ctx: Ctx, id: number): Promise<SignalCard> {
  const s = signalRow(ctx, id);
  const memo = ctx.db.prepare("SELECT model FROM memos WHERE loan_id = ? AND persona_id = ? ORDER BY id DESC LIMIT 1").get(s.loanId, s.personaId) as R | undefined;
  const loan = getLoan(ctx.db, s.loanId);
  let repaidPct: number | null = loan?.status === "RELEASED" ? 100 : null;
  if (loan?.status === "ACTIVE" && loan.vault) {
    try {
      const [face, debt, draw] = await Promise.all((["faceValue", "debtOutstanding", "drawDebt"] as const).map((fn) =>
        ctx.pub.readContract({ address: loan.vault!, abi: vaultAbi, functionName: fn }) as Promise<bigint>));
      const owed = noteOutstanding(debt!, draw!);
      if (face! > 0n) repaidPct = Number(((face! - (owed > face! ? face! : owed)) * 10_000n) / face!) / 100;
    } catch (e) { ctx.log("social", `signal ${id}: vault ${loan.vault} unreadable: ${(e as Error).message}`); }
  }
  const ms = ctx.db.prepare("SELECT status, flash_order_id, pnl_usd, quote_json FROM mirror_orders WHERE signal_id = ?").all(id) as R[];
  const priced = ms.filter((m) => m.pnl_usd != null);
  return {
    ...s,
    personaName: PERSONAS.find((p) => p.id === s.personaId)?.name ?? s.personaId,
    model: memo?.model ?? null,
    llm: memo ? writtenByLlm({ model: memo.model }) : false,
    lead: s.personaId === PERSONAS[0]!.id,
    loan: loan ? { status: loan.status, repaidPct } : null,
    mirrors: {
      total: ms.length,
      placed: ms.filter((m) => m.flash_order_id).length,
      filled: ms.filter((m) => m.status === "filled" || m.status === "partially_filled").length,
      spentUsdc: priced.reduce((a, m) => a + (JSON.parse(m.quote_json).fill?.spentUsdc ?? 0), 0),
      pnlUsd: priced.length ? Math.round(priced.reduce((a, m) => a + m.pnl_usd, 0) * 100) / 100 : null,
    },
  };
}

/** Live Flash /quote (no order) for the bracket a mirror of this signal would place. */
export type SignalFlashQuote = {
  signalId: number; token: Address; symbol: string; funder: Address;
  sizeUsdc: number; tpPct: number; slPct: number;
  spotUsd: number; riskFlagged: boolean; tpPriceUsd: number; slPriceUsd: number;
  estTokenOut: string; estOutUsd: number; estFeeUsd: number; priceImpactPct: number; withinImpactGate: boolean;
  integratorFeeBps: number; quoteId: string; quotedAt: string;
};
const sfqCache = new Map<string, { at: number; v: SignalFlashQuote }>();

export async function signalFlashQuote(ctx: Ctx, id: number, q: { sizeUsdc?: string; tpPct?: string; slPct?: string; funder?: string }): Promise<SignalFlashQuote> {
  const s = signalRow(ctx, id);
  if (s.decision !== "approve") throw Object.assign(new Error("declined signal: there is no mirror order to quote"), { status: 409 });
  const funder = q.funder ?? process.env.AGENT_WALLET_ADDRESS;
  if (!funder) throw Object.assign(new Error("pass funder=0x… (Flash needs a funder to quote a bracket) or set AGENT_WALLET_ADDRESS"), { status: 400 });
  // Same bounds as a follow; defaults = the /desk follow form defaults.
  const f = validateFollow({ follower: funder, personaId: s.personaId, mode: "bracket", sizeUsdc: q.sizeUsdc ?? 5, tpPct: q.tpPct ?? 50, slPct: q.slPct ?? 20 });
  const key = [id, s.token, f.sizeUsdc, f.tpPct, f.slPct, f.follower.toLowerCase()].join(":");
  const hit = sfqCache.get(key);
  if (hit && Date.now() - hit.at < 30_000) return hit.v; // ponytail: public route, 30s cache keeps us inside Flash's 5 req/s
  try {
    const asset = await searchToken(s.token);
    const order = bracketBuy(s.token, f.sizeUsdc, f.follower, asset.priceUsd, f.tpPct, f.slPct);
    const fq = await flash("/quote", order);
    const impact = Math.abs(Number(fq.estimatedPriceImpact ?? 0));
    const v: SignalFlashQuote = {
      signalId: id, token: s.token, symbol: s.symbol, funder: f.follower, sizeUsdc: f.sizeUsdc, tpPct: f.tpPct, slPct: f.slPct,
      spotUsd: asset.priceUsd, riskFlagged: asset.riskFlagged,
      tpPriceUsd: Number(order.attachedBracket.takeProfit.notionalPrice), slPriceUsd: Number(order.attachedBracket.stopLoss.notionalPrice),
      estTokenOut: fq.to?.amount ?? "0", estOutUsd: Number(fq.to?.notional ?? 0), estFeeUsd: Number(fq.fees?.estimatedFeeNotional ?? 0),
      priceImpactPct: impact * 100, withinImpactGate: impact <= MAX_IMPACT && !asset.riskFlagged,
      integratorFeeBps: integratorFeeBps(), quoteId: fq.quoteId, quotedAt: new Date().toISOString(),
    };
    sfqCache.set(key, { at: Date.now(), v });
    return v;
  } catch (e) {
    throw Object.assign(new Error((e as Error).message), { status: 502 });
  }
}

const integratorFeeBps = () => Number(feeFields().flashIntegratorFeeBps ?? 0) || 0;

/** What /desk needs to explain mirror execution honestly: fee setting and whether any mirror has ever hit Flash. */
export function flashInfo(ctx: Ctx) {
  const c = ctx.db.prepare(`SELECT COUNT(*) total, COUNT(flash_order_id) placed,
    SUM(CASE WHEN status IN ('filled','partially_filled') THEN 1 ELSE 0 END) filled FROM mirror_orders`).get() as R;
  return {
    integratorFeeBps: integratorFeeBps(), integratorFeeSet: !!process.env.FLASH_INTEGRATOR_FEE_BPS,
    mainnetOnly: true, demoFork: !!ctx.demoFork, maxPriceImpactPct: MAX_IMPACT * 100,
    mirrors: { total: Number(c.total), placed: Number(c.placed), filled: Number(c.filled ?? 0) },
  };
}

// ─── mirror orders (Flash) ───
const buy = (token: string, sizeUsdc: number, funder: string): R => ({
  targetChain: "base", contraChain: "base", targetAsset: token, contraAsset: ADDR.USDC, side: "buy", qty: String(sizeUsdc), funderAddress: funder, ...feeFields(),
});
/** The order a bracket mirror places: Flash market entry + attached Bracket (TP/SL notional prices off the Flash spot). */
export const bracketBuy = (token: string, sizeUsdc: number, funder: string, px: number, tpPct: number, slPct: number): R => ({
  ...buy(token, sizeUsdc, funder), orderType: "market",
  attachedBracket: { takeProfit: { notionalPrice: decStr(px * (1 + tpPct / 100)) }, stopLoss: { notionalPrice: decStr(px * (1 - slPct / 100)) } },
});
const txReq = (to: Address, data: Hex, label: string): TxRequest => ({ to, data, value: "0", chainId: CHAIN_ID_BASE, label });

/** Approvals the follower still needs for one Flash order: Flash's approveTx (to the settlement) and/or ERC20→Permit2 for a permit. */
async function approvalsFor(pub: PublicClient, owner: Address, evm: { approveTx?: { to: Address; data: Hex } | null; permitTypedData?: string | null; orderTypedData: string }, label: string) {
  const o = parseTypedData(evm.orderTypedData).message;
  const need: TxRequest[] = [];
  const allowance = (spender: Address) => pub.readContract({ address: o.fromToken, abi: erc20, functionName: "allowance", args: [owner, spender] }) as Promise<bigint>;
  if (evm.permitTypedData) {
    if ((await allowance(ADDR.PERMIT2)) < o.fromAmount) need.push(txReq(o.fromToken, encodeFunctionData({ abi: erc20, functionName: "approve", args: [ADDR.PERMIT2, maxUint256] }), `${label}: approve Permit2`));
  } else if (evm.approveTx?.to && (await allowance(ADDR.FLASH_SETTLEMENT)) < o.fromAmount) {
    need.push(txReq(evm.approveTx.to, evm.approveTx.data, `${label}: approve Flash`));
  }
  return need;
}

/**
 * Fresh Flash quote for a pending mirror. Runs the SPEC risk gates (riskFlagged, impact ≤ 3%). Gate failures are
 * NON-terminal (recorded in `error`, mirror stays pending): this route is unauthenticated, so a quote by anyone must not
 * kill someone else's mirror, and impact/risk flags change with the market. Auto mode still fails it (executor catch).
 */
export async function quoteMirror(ctx: Ctx, id: number): Promise<MirrorQuote> {
  const m = mirrorRow(ctx, id);
  if (!m) throw Object.assign(new Error("mirror not found"), { status: 404 });
  if (m.status !== "pending_signature") throw Object.assign(new Error(`mirror is ${m.status}`), { status: 409 });
  const f = ctx.db.prepare("SELECT * FROM follows WHERE id = ?").get(m.follow_id) as R;
  if (!f?.active) { failMirror(ctx, id, "follow was removed"); throw Object.assign(new Error("follow was removed"), { status: 409 }); }
  const asset = await searchToken(m.token);
  if (asset.riskFlagged) { setMirror(ctx, id, { error: "Flash /search riskFlagged this token (re-quote later)" }); throw Object.assign(new Error("token is riskFlagged by Flash"), { status: 409 }); }
  const px = asset.priceUsd;
  const order: R = m.mode === "bracket" ? bracketBuy(m.token, m.size_usdc, m.follower, px, f.tp_pct, f.sl_pct)
    : { ...buy(m.token, m.size_usdc, m.follower), orderType: "twap", twapBucketCount: Number(f.dca_days) };
  const q = await flash("/quote", m.mode === "dca" ? { ...order, durationSeconds: Number(f.dca_days) * 86_400 } : order);
  const impact = Math.abs(Number(q.estimatedPriceImpact ?? 0));
  if (impact > MAX_IMPACT) {
    setMirror(ctx, id, { error: `price impact ${(impact * 100).toFixed(2)}% > 3% (re-quote later)` });
    throw Object.assign(new Error(`price impact ${(impact * 100).toFixed(2)}% > 3%`), { status: 409 });
  }
  if (!q.evm?.orderTypedData) throw new Error("Flash quote returned no orderTypedData (funderAddress missing?)");
  const pub = mainPub(ctx);
  const qb = q.attachedBracket;
  const res: MirrorQuote = {
    mirrorId: id, quoteId: q.quoteId,
    approveTxs: await approvalsFor(pub, m.follower, q.evm, "entry"),
    permitTypedData: q.evm.permitTypedData || null,
    orderTypedData: q.evm.orderTypedData,
    bracket: qb ? { orderTypedData: qb.evm.orderTypedData, permitTypedData: qb.evm.permitTypedData || null, approveTxs: await approvalsFor(pub, m.follower, qb.evm, "bracket exit") } : null,
    preview: {
      spendUsdc: m.size_usdc, estTokenOut: q.to?.amount ?? "0", priceImpact: impact * 100,
      ...(m.mode === "bracket" ? { tpPriceUsd: Number(order.attachedBracket.takeProfit.notionalPrice), slPriceUsd: Number(order.attachedBracket.stopLoss.notionalPrice) } : {}),
    },
  };
  // Keep the last few quotes by quoteId: submit pairs signatures with the exact quote they were made over, so a
  // re-quote by anyone else cannot invalidate a signature in flight.
  const prev = m.quote_json ? JSON.parse(m.quote_json).recent ?? {} : {};
  const recent = Object.fromEntries([...Object.entries(prev).slice(-4), [q.quoteId, { order, q }]]);
  setMirror(ctx, id, { quote_json: JSON.stringify({ order, q, px, decimals: asset.decimals, recent }), error: null });
  return res;
}

/** Post the signed order to Flash. `order` is echoed without durationSeconds (quote-only field). */
export async function submitMirror(ctx: Ctx, id: number, s: MirrorSubmit): Promise<MirrorOrder> {
  const m = mirrorRow(ctx, id);
  if (!m) throw Object.assign(new Error("mirror not found"), { status: 404 });
  if (m.status !== "pending_signature" || !m.quote_json) throw Object.assign(new Error("quote the mirror first"), { status: 409 });
  if (!/^0x[0-9a-fA-F]+$/.test(s.userSignature ?? "")) throw Object.assign(new Error("userSignature required"), { status: 400 });
  if (typeof s.quoteId !== "string") throw Object.assign(new Error("quoteId required (the MirrorQuote.quoteId you signed)"), { status: 400 });
  const stored = JSON.parse(m.quote_json);
  const picked = stored.recent?.[s.quoteId];
  if (!picked) throw Object.assign(new Error("unknown or expired quoteId: re-quote and sign again"), { status: 409 });
  const { order, q } = picked;
  const body: R = { ...order, quoteId: q.quoteId, userSignature: s.userSignature, evmOrderTypedData: q.evm.orderTypedData, ...attributionFields() };
  if (q.evm.permitTypedData) {
    if (!s.evmPermitSignature) throw Object.assign(new Error("evmPermitSignature required"), { status: 400 });
    Object.assign(body, { evmPermitTypedData: q.evm.permitTypedData, evmPermitSignature: s.evmPermitSignature });
  }
  if (order.attachedBracket) {
    const qb = q.attachedBracket;
    if (!s.bracketUserSignature) throw Object.assign(new Error("bracketUserSignature required"), { status: 400 });
    if (qb.evm.permitTypedData && !s.bracketPermitSignature) throw Object.assign(new Error("bracketPermitSignature required"), { status: 400 });
    body.attachedBracket = {
      ...order.attachedBracket, userSignature: s.bracketUserSignature, deadline: qb.deadline, signedMaxFromAmount: qb.signedMaxFromAmount,
      ...(qb.salt ? { salt: qb.salt } : {}),
      ...(qb.evm.permitTypedData ? { evmPermitTypedData: qb.evm.permitTypedData, evmPermitSignature: s.bracketPermitSignature } : {}),
    };
  }
  try {
    const r = await flash("/order", body);
    setMirror(ctx, id, {
      status: "submitted", flash_order_id: r.orderId, bracket_status: r.attachedBracket?.status ?? null, error: null,
      quote_json: JSON.stringify({ order, q, px: stored.px, decimals: stored.decimals }), // the quote actually placed
    });
    ctx.log("social", `mirror ${id} → Flash order ${r.orderId}`);
  } catch (e) {
    // Flash rejected (bad sig, stale quote, …): stay pending so the follower can re-quote and re-sign.
    setMirror(ctx, id, { error: (e as Error).message });
    throw Object.assign(new Error((e as Error).message), { status: 502 });
  }
  return toMirror(mirrorRow(ctx, id)!);
}

/** Auto mode: agent signs approvals + typed data with the follower's Dynamic delegation. */
async function executeAuto(ctx: Ctx, id: number) {
  const m = mirrorRow(ctx, id)!;
  const missing = missingDelegationEnv();
  if (missing.length) return failMirror(ctx, id, `auto-mirror needs env ${missing.join(", ")} (see .env.example)`);
  if (!hasDelegation(ctx, m.follower)) return failMirror(ctx, id, "no active Dynamic delegation for follower");
  const signer = await delegatedSigner(ctx, m.follower, mainPub(ctx));
  const mq = await quoteMirror(ctx, id);
  for (const tx of [...mq.approveTxs, ...(mq.bracket?.approveTxs ?? [])]) await signer.send({ to: tx.to, data: tx.data });
  return submitMirror(ctx, id, {
    quoteId: mq.quoteId,
    userSignature: await signer.signTypedData(mq.orderTypedData),
    ...(mq.permitTypedData ? { evmPermitSignature: await signer.signTypedData(mq.permitTypedData) } : {}),
    ...(mq.bracket ? { bracketUserSignature: await signer.signTypedData(mq.bracket.orderTypedData) } : {}),
    ...(mq.bracket?.permitTypedData ? { bracketPermitSignature: await signer.signTypedData(mq.bracket.permitTypedData) } : {}),
  });
}

const TERMINAL = ["ORDER_STATUS_FILLED", "ORDER_STATUS_CANCELLED", "ORDER_STATUS_REJECTED", "ORDER_STATUS_TERMINATED"];
const num = (s: string | null | undefined) => Number(s || 0);

/** Refresh fills, bracket exits and PnL (tokens held × current Flash price + exit USDC − spent). */
export async function pollMirrors(ctx: Ctx): Promise<void> {
  const rows = ctx.db.prepare(`SELECT * FROM mirror_orders WHERE flash_order_id IS NOT NULL AND status <> 'failed'
    AND NOT (status = 'cancelled' AND COALESCE(filled_token_raw,'0') = '0') AND COALESCE(bracket_status,'') NOT LIKE 'exited:%'`).all() as R[];
  const prices = new Map<string, number>();
  const price = async (token: string) => {
    if (!prices.has(token)) prices.set(token, (await searchToken(token as Address)).priceUsd);
    return prices.get(token)!;
  };
  for (const m of rows) {
    try {
      const stored = JSON.parse(m.quote_json);
      // Closed entry with no bracket (filled market/DCA, cancelled-with-fill): the fill is final, only re-mark PnL.
      // ponytail: saves the Flash /orders budget for live orders; one /search per token per cycle remains.
      if ((m.status === "filled" || m.status === "cancelled") && !m.bracket_status && stored.fill) {
        const pnl = mirrorPnl(stored.fill, await price(m.token));
        setMirror(ctx, m.id, { pnl_usd: Math.round(pnl * 1e4) / 1e4 });
        continue;
      }
      const { order } = await flash(`/orders/${m.flash_order_id}?funderAddress=${m.follower}`);
      const bought = num(order.filled?.targetAmount), spent = num(order.filled?.contraAmount);
      const status: MirrorStatus =
        order.status === "ORDER_STATUS_FILLED" ? "filled"
        : order.status === "ORDER_STATUS_PARTIALLY_FILLED" ? "partially_filled"
        : order.status === "ORDER_STATUS_REJECTED" ? "failed"
        : order.status === "ORDER_STATUS_CANCELLED" || order.status === "ORDER_STATUS_TERMINATED" ? "cancelled"
        : "submitted";
      let bracketStatus: string | null = order.attachedBracket?.status ?? m.bracket_status;
      let sold = 0, exitUsdc = 0;
      const bid = order.attachedBracket?.bracketOrderId;
      if (bid) {
        const { order: b } = await flash(`/orders/${bid}?funderAddress=${m.follower}`);
        sold = num(b.filled?.targetAmount); exitUsdc = num(b.filled?.contraAmount);
        bracketStatus = TERMINAL.includes(b.status) ? `exited:${b.status}` : `${order.attachedBracket.status}:${b.status}`;
      } else if (bracketStatus === "never_activated" && TERMINAL.includes(order.status)) bracketStatus = "exited:never_activated";
      let pnl: number | null = null;
      if (spent > 0) pnl = Math.round(mirrorPnl({ spentUsdc: spent, boughtTokens: bought, soldTokens: sold, exitUsdc }, await price(m.token)) * 1e4) / 1e4;
      setMirror(ctx, m.id, {
        status, bracket_status: bracketStatus, pnl_usd: pnl,
        filled_token_raw: parseUnits(order.filled?.targetAmount || "0", stored.decimals).toString(),
        avg_price_usd: order.filled?.averageNotionalPrice ? Number(order.filled.averageNotionalPrice) : null,
        error: status === "failed" ? order.closeReason ?? "rejected by Flash" : null,
        quote_json: JSON.stringify({ ...stored, bracketOrderId: bid ?? stored.bracketOrderId ?? null, fill: { spentUsdc: spent, boughtTokens: bought, soldTokens: sold, exitUsdc } }),
      });
    } catch (e) {
      ctx.log("social", `poll mirror ${m.id} failed: ${(e as Error).message}`);
    }
  }
}

// ─── routes ───
const bad = (msg: string) => Object.assign(new Error(msg), { status: 400 });

async function verifySig(ctx: Ctx, address: Address, message: string, nonce: unknown, signature: unknown) {
  if (typeof nonce !== "string" || nonce.length < 8 || typeof signature !== "string") throw bad("nonce (≥8 chars) and signature required");
  const ok = await mainPub(ctx).verifyMessage({ address, message, signature: signature as Hex });
  if (!ok) throw Object.assign(new Error("signature does not match follower"), { status: 401 });
  if (!useNonce(ctx.db, nonce)) throw Object.assign(new Error("nonce already used"), { status: 409 });
}

export function validateFollow(b: any): Omit<Follow, "id" | "createdAt"> {
  if (!isAddress(b?.follower ?? "")) throw bad("follower must be an address");
  if (!PERSONAS.some((p) => p.id === b.personaId)) throw bad(`personaId must be one of ${PERSONAS.map((p) => p.id).join(", ")}`);
  if (b.mode !== "bracket" && b.mode !== "dca") throw bad("mode must be bracket|dca");
  const size = Number(b.sizeUsdc);
  if (!(size >= 1 && size <= 10_000)) throw bad("sizeUsdc must be 1..10000");
  const tp = Number(b.tpPct), sl = Number(b.slPct), days = Number(b.dcaDays);
  if (b.mode === "bracket" && !(tp > 0 && tp <= 1000 && sl > 0 && sl < 100)) throw bad("bracket needs tpPct 0..1000 and slPct 0..100");
  if (b.mode === "dca" && !(Number.isInteger(days) && days >= 2 && days <= 365)) throw bad("dca needs integer dcaDays 2..365 (Flash twapBucketCount ≥ 2)");
  return { follower: b.follower, personaId: b.personaId, mode: b.mode, sizeUsdc: size, tpPct: b.mode === "bracket" ? tp : 0,
    slPct: b.mode === "bracket" ? sl : 0, dcaDays: b.mode === "dca" ? days : 0, auto: b.auto === true };
}

export function register(app: Hono, ctx: Ctx) {
  const wrap = (fn: (c: any) => Promise<Response>) => async (c: any) => {
    try { return await fn(c); } catch (e: any) {
      if (e?.status) return c.json({ error: e.message }, e.status);
      throw e;
    }
  };

  app.get("/api/signals", (c) => {
    const pid = c.req.query("personaId"), q = c.req.query("limit"), limit = Math.min(200, q === undefined ? 50 : posInt(q, "limit"));
    const rows = (pid ? ctx.db.prepare("SELECT * FROM signals WHERE persona_id = ? ORDER BY id DESC LIMIT ?").all(pid, limit)
      : ctx.db.prepare("SELECT * FROM signals ORDER BY id DESC LIMIT ?").all(limit)) as R[];
    return c.json(rows.map(toSignal));
  });

  app.get("/api/signals/:id", wrap(async (c) => c.json(await signalCard(ctx, posInt(c.req.param("id"), "signal id")))));

  app.get("/api/signals/:id/flash-quote", wrap(async (c) => {
    const id = posInt(c.req.param("id"), "signal id");
    const { sizeUsdc, tpPct, slPct, funder } = c.req.query();
    return c.json(await signalFlashQuote(ctx, id, { sizeUsdc, tpPct, slPct, funder }));
  }));

  app.get("/api/flash/info", (c) => c.json(flashInfo(ctx)));

  app.get("/api/leaderboard", async (c) => c.json(await leaderboard(ctx)));

  app.get("/api/follows", (c) => {
    const f = c.req.query("follower");
    if (!f) return c.json({ error: "follower required (per-persona follower counts are on /api/leaderboard)" }, 400);
    return c.json((ctx.db.prepare("SELECT * FROM follows WHERE active = 1 AND follower = ? ORDER BY id DESC").all(addrParam(f, "follower")) as R[]).map(toFollow));
  });

  app.post("/api/follows", wrap(async (c) => {
    const b = await jsonBody<FollowSigned>(c);
    const f = validateFollow(b);
    if (f.auto) {
      const missing = missingDelegationEnv();
      if (missing.length) return c.json({ error: `auto-mirror unavailable: missing env ${missing.join(", ")} (see .env.example)` }, 503);
    }
    await verifySig(ctx, f.follower, followMessage(b!, b!.nonce), b!.nonce, b!.signature); // exactly what the client signed
    const id = Number(ctx.db.prepare(`INSERT INTO follows (follower,persona_id,mode,size_usdc,tp_pct,sl_pct,dca_days,auto,active,created_at)
      VALUES (?,?,?,?,?,?,?,?,1,?)`).run(f.follower.toLowerCase(), f.personaId, f.mode, f.sizeUsdc, f.tpPct, f.slPct, f.dcaDays, f.auto ? 1 : 0, now()).lastInsertRowid);
    lbCache = undefined;
    return c.json(toFollow(ctx.db.prepare("SELECT * FROM follows WHERE id = ?").get(id) as R));
  }));

  app.delete("/api/follows/:id", wrap(async (c) => {
    const id = posInt(c.req.param("id"), "follow id");
    const row = ctx.db.prepare("SELECT * FROM follows WHERE id = ? AND active = 1").get(id) as R | undefined;
    if (!row) return c.json({ error: "follow not found" }, 404);
    const b = await jsonBody<{ nonce: string; signature: string }>(c); // verifySig type-checks both
    await verifySig(ctx, row.follower, unfollowMessage(id, b.nonce), b.nonce, b.signature);
    ctx.db.prepare("UPDATE follows SET active = 0 WHERE id = ?").run(id);
    ctx.db.prepare("UPDATE mirror_orders SET status = 'failed', error = 'follow was removed', updated_at = ? WHERE follow_id = ? AND status = 'pending_signature'").run(now(), id);
    lbCache = undefined;
    return c.json({ ok: true });
  }));

  app.get("/api/mirrors", (c) => {
    const f = c.req.query("follower");
    if (!f) return c.json({ error: "follower required" }, 400);
    return c.json((ctx.db.prepare("SELECT * FROM mirror_orders WHERE follower = ? ORDER BY id DESC LIMIT 200").all(addrParam(f, "follower")) as R[]).map(toMirror));
  });

  // Auto mirrors are quoted + signed only by the executor; the public one-click routes must not touch them.
  const oneClick = (id: number) => {
    const row = ctx.db.prepare("SELECT f.auto FROM mirror_orders m JOIN follows f ON f.id = m.follow_id WHERE m.id = ?").get(id) as R | undefined;
    if (!row) throw Object.assign(new Error("mirror not found"), { status: 404 });
    if (row.auto) throw Object.assign(new Error("auto-mirrored: the desk signs this order via your Dynamic delegation"), { status: 409 });
    return id;
  };
  app.post("/api/mirrors/:id/quote", wrap(async (c) => c.json(await quoteMirror(ctx, oneClick(posInt(c.req.param("id"), "mirror id"))))));

  app.post("/api/mirrors/:id/submit", wrap(async (c) => c.json(await submitMirror(ctx, oneClick(posInt(c.req.param("id"), "mirror id")), await jsonBody<MirrorSubmit>(c)))));

  /** body {userSignature, leg?: "entry"|"bracket"}: sign flashCancelMessage(entry flashOrderId | bracketOrderId). */
  app.post("/api/mirrors/:id/cancel", wrap(async (c) => {
    const id = posInt(c.req.param("id"), "mirror id");
    const m = mirrorRow(ctx, id);
    if (!m) return c.json({ error: "mirror not found" }, 404);
    if (!m.flash_order_id) return c.json({ error: "mirror has no Flash order" }, 409);
    const { userSignature, leg = "entry" } = await jsonBody<{ userSignature?: string; leg?: string }>(c);
    const orderId = leg === "bracket" ? toMirror(m).bracketOrderId : m.flash_order_id;
    if (!orderId) return c.json({ error: "bracket is not active yet (no bracketOrderId)" }, 409);
    await flash(`/orders/${orderId}/cancel`, { cancelMessage: flashCancelMessage(orderId), userSignature });
    // Entry cancel is final here; a bracket cancel is picked up by pollMirrors (bracket_status → exited:ORDER_STATUS_CANCELLED).
    if (leg !== "bracket") setMirror(ctx, id, { status: "cancelled" });
    return c.json(toMirror(mirrorRow(ctx, id)!));
  }));

  app.post("/api/dynamic/webhook", async (c) => {
    const secret = process.env.DYNAMIC_WEBHOOK_SECRET;
    if (!secret) return c.json({ error: "Missing env DYNAMIC_WEBHOOK_SECRET (see .env.example)" }, 503);
    const raw = await c.req.text();
    if (!verifyWebhook(raw, c.req.header("x-dynamic-signature-256"), secret)) return c.json({ error: "bad signature" }, 401);
    const result = applyWebhook(ctx, JSON.parse(raw));
    ctx.log("social", `dynamic webhook: ${result}`);
    return c.json({ ok: true });
  });
}

// ─── loops ───
export function start(ctx: Ctx): () => void {
  let autoBusy = false, pollBusy = false;
  // Auto mirrors settle on Base MAINNET (mainPub), so a DEMO_FORK desk must not fire them: a follower's
  // delegated wallet would place a real Flash order off a fork-only credit decision. AUTO_MIRROR_ON_FORK=1 overrides.
  const autoBlocked = ctx.demoFork && process.env.AUTO_MIRROR_ON_FORK !== "1";
  if (autoBlocked) ctx.log("social", "auto-mirror executor disabled on DEMO_FORK (set AUTO_MIRROR_ON_FORK=1 to allow real mainnet orders)");
  const runAuto = async () => {
    if (autoBusy || autoBlocked) return;
    autoBusy = true;
    try {
      const rows = ctx.db.prepare(`SELECT m.id FROM mirror_orders m JOIN follows f ON f.id = m.follow_id
        WHERE m.status = 'pending_signature' AND f.auto = 1 AND f.active = 1 ORDER BY m.id`).all() as R[];
      for (const { id } of rows) {
        try { await executeAuto(ctx, Number(id)); } catch (e) {
          const cur = mirrorRow(ctx, Number(id));
          if (cur?.status === "pending_signature") failMirror(ctx, Number(id), `auto-mirror: ${(e as Error).message}`);
        }
      }
    } finally { autoBusy = false; }
  };
  kick = () => void runAuto();
  const a = setInterval(runAuto, 20_000);
  const p = setInterval(async () => {
    if (pollBusy) return;
    pollBusy = true;
    try { await pollMirrors(ctx); lbCache = undefined; } finally { pollBusy = false; }
  }, 30_000);
  return () => { clearInterval(a); clearInterval(p); kick = undefined; };
}
