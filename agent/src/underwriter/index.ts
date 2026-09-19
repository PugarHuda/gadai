// Underwriter: Bankr fee data → deterministic engine (engine.ts) → one credit memo per persona via Bankr LLM Gateway.
// The lead persona (PERSONAS[0]) is binding. The LLM (or, engine-only, its rule set) may only decline or lower the principal.
import { HTTPException } from "hono/http-exception";
import { parseAbi, parseUnits, zeroAddress } from "viem";
import type { Address, FeeInputs, Memo, Persona, Quote, Terms } from "@feedesk/shared";
import { ADDR, ERC20_ABI, FEE_DESK_ABI } from "@feedesk/shared";
import type { Ctx } from "../ctx.ts";
import { opt } from "../ctx.ts";
import { claimableFees, dust, llmChat, LlmNoCredits, tokenFees } from "../bankr/index.ts";
import { HORIZON_DAYS, MIN_HISTORY_DAYS, RULES_MODEL, beneficiaryFactor, computeTerms, parseMemo, reputationFactor, ruleMemo, type Reputation, type TermsResult } from "./engine.ts";

export const PERSONAS: Persona[] = [
  { id: "prudent", name: "Prudent", model: opt("BANKR_LLM_MODEL", "claude-sonnet-4.6"), advanceRatePct: 30, style: "lifetime-weighted, penalizes decay" },
  { id: "momentum", name: "Momentum", model: "gemini-3-flash", advanceRatePct: 45, style: "weights the last 7 days and volume trend" },
  { id: "skeptic", name: "Skeptic", model: "gpt-5.4-mini", advanceRatePct: 20, style: "assumes fees halve; declines thin history" },
];
const lead = PERSONAS[0]!;
const capUsdc = () => Number(opt("DESK_MAX_LOAN_USDC", "250"));
const lc = (s: string) => s.toLowerCase();
const isErr = (r: ReturnType<typeof computeTerms>): r is Exclude<typeof r, TermsResult> => "error" in r;

async function ethUsd(): Promise<number> {
  const m = (await import("../uniswap/index.ts").catch((e) => {
    throw new HTTPException(503, { message: `uniswap module unavailable (needed for ETH/USD): ${e.message}` });
  })) as { ethUsd: () => Promise<number> };
  return m.ethUsd();
}

/** Engine-only quote (no LLM). Hard rejects are returned as eligible:false + reasons, never thrown. */
export async function quote(ctx: Ctx, token: Address, borrower: Address): Promise<Quote> {
  const reasons: string[] = [];
  // Bankr 404s "Token fee data not found" for anything it never launched (e.g. WETH, USDC): ineligible, not a 500
  const fees = await tokenFees(token, 30).catch((e: Error & { status?: number }) => { if (e.status === 404) return null; throw e; });
  const t = fees?.tokens.find((x) => lc(x.tokenAddress) === lc(token) && x.chain === "base" && x.source === "doppler");
  if (!fees || !t) return { eligible: false, reasons: ["not a Base Doppler token (Bankr token-launches fees)"], inputs: null, terms: null, formula: "" };
  if (lc(t.numeraire) !== lc(ADDR.WETH)) reasons.push(`numeraire ${t.numeraire} is not WETH`);
  if (lc(fees.address) !== lc(borrower)) reasons.push(`fee history belongs to beneficiary ${fees.address}, not ${borrower}`);

  const [claim, ethPx, decimals, activeVault] = await Promise.all([
    claimableFees(token, borrower, true),
    ethUsd(),
    ctx.pub.readContract({ address: token, abi: parseAbi(ERC20_ABI), functionName: "decimals" }),
    ctx.pub.readContract({ address: ctx.deskAddress, abi: parseAbi(FEE_DESK_ABI), functionName: "activeVaultByPool", args: [t.poolId] }),
  ]);
  if (!claim.eligible) reasons.push(`borrower ${borrower} is not an eligible beneficiary (claimable-fees eligible:false)`);
  if (activeVault !== zeroAddress) reasons.push(`pool already has an open loan (vault ${activeVault})`);

  const wethIs0 = !t.tokenIsToken0;
  const cf = claim.eligible ? claim.claimableFees : { token0: "0", token1: "0" };
  const claimableWeth = dust(wethIs0 ? cf.token0 : cf.token1);
  const claimableTok = dust(wethIs0 ? cf.token1 : cf.token0);
  const claimedW = Number(dust(fees.totals.claimedWeth)), claimableW = Number(dust(fees.totals.claimableWeth));
  const allTimeSum = fees.allTimeDailyEarnings.reduce((s, d) => s + Number(dust(d.weth)), 0);
  const factor = beneficiaryFactor(allTimeSum, claimedW, claimableW, parseFloat(t.share));
  const ageDays = fees.allTimeDailyEarnings.length; // calendar days of history (API lifetimeDays counts only nonzero days)

  const inputs: FeeInputs = {
    token: t.tokenAddress, symbol: t.symbol, name: t.name, poolId: t.poolId,
    feesManager: t.feesContract ?? t.initializer, sharePct: parseFloat(t.share), numeraire: t.numeraire, tokenIsToken0: t.tokenIsToken0,
    claimableWethRaw: parseUnits(claimableWeth, 18).toString(),
    claimableTokenRaw: parseUnits(claimableTok, Number(decimals)).toString(),
    weth30d: fees.dailyEarnings.reduce((s, d) => s + Number(dust(d.weth)), 0) * factor,
    wethLifetime: Number(dust(fees.lifetimeEarnedWeth)) * factor,
    wethOwn: claimedW + claimableW, // already this beneficiary's: no share factor
    lifetimeDays: ageDays,
    dailyWeth: fees.dailyEarnings.map((d) => ({ date: d.date, weth: Number(dust(d.weth)) * factor })),
    ethUsd: ethPx,
  };
  if (ageDays < MIN_HISTORY_DAYS) reasons.push(`fee history ${ageDays}d < ${MIN_HISTORY_DAYS}d`);

  const shareNote = factor === 1
    ? `dailyEarnings Σall-time ${allTimeSum.toFixed(6)} ≈ claimed+claimable → already beneficiary share`
    : `dailyEarnings Σall-time ${allTimeSum.toFixed(6)} ≠ claimed+claimable ${(claimedW + claimableW).toFixed(6)} → scaled by share ${t.share}`;
  const r = computeTerms(inputs, lead.advanceRatePct, capUsdc());
  if (r.analysis.rateUsed === 0) reasons.push("fee rate is 0");
  else if (isErr(r)) reasons.push(r.error);
  return { eligible: reasons.length === 0, reasons, inputs, terms: isErr(r) ? null : r.terms, formula: `${shareNote}; ${r.formula}` };
}

const SYSTEM = (p: Persona) => `You are "${p.name}", a credit underwriter agent at Gadai. Gadai lends USDC to Bankr creators/agents against the creator-fee stream of their Doppler token on Base: the borrower pledges fee rights to a vault, fees (WETH) repay the loan, then the rights are released.
Your style: ${p.style}.
A deterministic engine already computed the maximum principal and pricing. You may APPROVE at or below maxPrincipalUsdc, or DECLINE. You can never exceed the cap.
maxNotePrice is the highest price (USDC per $1 of FeeNote face value) you would bid in the FeeNote auction that funds the loan; it must be between floorPrice and 1.
Reply with ONLY this JSON object, no prose, no code fences:
{"decision":"approve"|"decline","principalUsdc":number,"maxNotePrice":number,"confidence":number between 0 and 1,"rationale":"2-3 sentences citing the numbers","risks":["short risk", "..."]}`;

type MemoRun = { memo: Memo; raw: string; terms: Terms };

export async function runPersona(p: Persona, q: Quote): Promise<MemoRun | null> {
  const inp = q.inputs!;
  const r = computeTerms(inp, p.advanceRatePct, capUsdc());
  if (isErr(r)) return null; // this persona's advance rate yields < $1: nothing to ask
  const facts = {
    token: inp.token, symbol: inp.symbol, sharePct: inp.sharePct, ethUsd: inp.ethUsd,
    dailyWethLast30d: inp.dailyWeth, claimableWethAtPledge: Number(inp.claimableWethRaw) / 1e18,
    historyDays: inp.lifetimeDays, lifetimeWeth: inp.wethLifetime,
    r7: r.analysis.r7, r30: r.analysis.r30, rLifetime: r.analysis.rLife, rOwnLifetime: r.analysis.rOwn, ownWeth: inp.wethOwn, note: "dailyWethLast30d are claim events (claim-timed), not accrual", slope30d: r.analysis.slope, cv30d: r.analysis.cv,
    usdPerDay: r.usdPerDay, horizonDays: HORIZON_DAYS, advanceRatePct: p.advanceRatePct,
    maxPrincipalUsdc: Number(r.terms.maxPrincipalRaw) / 1e6, floorPrice: r.terms.floorPrice, feeRatePct: r.terms.feeRatePct,
    faceUsdc: Number(r.terms.faceValueRaw) / 1e6, termDays: r.terms.termDays, formula: r.formula,
  };
  let model = p.model;
  const raw = await llmChat([{ role: "system", content: SYSTEM(p) }, { role: "user", content: JSON.stringify(facts) }], { model: p.model, maxTokens: 800 })
    .catch((e: Error) => {
      // Fail closed: only "out of credits" (402/insufficient_credits) AND an explicit UNDERWRITER_ENGINE_ONLY=1 opt-in fall back
      // to the persona's deterministic rules (engine.ts ruleMemo), labeled RULES_MODEL so the UI never passes it off as LLM output.
      if (!(e instanceof LlmNoCredits) || process.env.UNDERWRITER_ENGINE_ONLY !== "1") throw e;
      model = RULES_MODEL;
      return JSON.stringify(ruleMemo(p.id, inp, r, p.advanceRatePct, capUsdc()));
    });
  const m = parseMemo(raw, facts.maxPrincipalUsdc, r.terms.floorPrice);
  const terms = m.decision === "approve" ? (computeTerms(inp, p.advanceRatePct, capUsdc(), m.principalUsdc) as TermsResult).terms : r.terms;
  return {
    raw, terms,
    memo: {
      personaId: p.id, model, decision: m.decision, principalRaw: m.decision === "approve" ? terms.principalRaw : "0",
      maxNotePrice: m.maxNotePrice, confidence: m.confidence, rationale: m.rationale, risks: m.risks,
    },
  };
}

/**
 * Quote + all persona memos. Throws 422 if the quote is ineligible, 502 if the lead memo fails (no loan is created).
 * `terms` = lead terms at the lead's principal (what goes on-chain); `rawText` by personaId for memos.raw_text.
 */
export async function underwrite(ctx: Ctx, token: Address, borrower: Address, opts: { erc8004AgentId?: bigint } = {}) {
  const q = await quote(ctx, token, borrower);
  if (!q.eligible) throw new HTTPException(422, { message: `not eligible: ${q.reasons.join("; ")}` });
  const runs = await Promise.allSettled(PERSONAS.map((p) => runPersona(p, q)));
  const leadRun = runs[0]!;
  if (leadRun.status === "rejected") throw new HTTPException(502, { message: `lead memo (${lead.id}/${lead.model}) failed: ${leadRun.reason?.message ?? leadRun.reason}` });
  if (!leadRun.value) throw new HTTPException(502, { message: "lead persona produced no terms" });
  const ok: MemoRun[] = [];
  runs.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value) ok.push(r.value);
    else if (r.status === "rejected") ctx.log("underwriter", `persona ${PERSONAS[i]!.id} memo skipped`, String(r.reason?.message ?? r.reason));
  });
  if (opts.erc8004AgentId !== undefined) {
    // ERC-8004: what this desk said on-chain about the borrower's agent. May only LOWER (or decline), never raise.
    const rep = await readReputation(ctx, opts.erc8004AgentId);
    const { factor, note } = reputationFactor(rep);
    q.formula = `${q.formula}; ${note}`;
    if (factor < 1) for (const run of ok) lowerRun(run, q, factor, note);
  }
  return {
    quote: q,
    memos: ok.map((r) => r.memo),
    lead: leadRun.value.memo,
    terms: leadRun.value.terms,
    rawText: Object.fromEntries(ok.map((r) => [r.memo.personaId, r.raw])) as Record<string, string>,
  };
}

export type Underwriting = Awaited<ReturnType<typeof underwrite>>;

async function readReputation(ctx: Ctx, agentId: bigint): Promise<Reputation> {
  const deskWallet = (await ctx.pub.readContract({ address: ctx.deskAddress, abi: parseAbi(FEE_DESK_ABI), functionName: "keeper" })) as Address;
  const m = (await import("../erc8004/index.ts")) as { borrowerReputation(ctx: Ctx, id: bigint, desk?: Address): Promise<Reputation> };
  return m.borrowerReputation(ctx, agentId, deskWallet); // throws → apply fails (fail closed: never skip a named reputation)
}

/** Scale an approved memo's principal by the reputation factor (floor to cents); under $1 (or factor 0) it declines. */
function lowerRun(run: MemoRun, q: Quote, factor: number, note: string) {
  const m = run.memo;
  if (m.decision !== "approve") return;
  const p = PERSONAS.find((x) => x.id === m.personaId)!;
  const cents = Math.floor((Number(m.principalRaw) / 1e6) * factor * 100);
  const r = cents >= 100 ? computeTerms(q.inputs!, p.advanceRatePct, capUsdc(), cents / 100) : null;
  if (!r || isErr(r)) {
    Object.assign(m, { decision: "decline", principalRaw: "0", rationale: `${m.rationale} Declined by ${note} (< $1).` });
    return;
  }
  run.terms = r.terms;
  Object.assign(m, { principalRaw: r.terms.principalRaw, rationale: `${m.rationale} Lowered by ${note}.` });
}
