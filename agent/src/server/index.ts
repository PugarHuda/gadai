// Hono REST server + orchestration of flows A (apply/underwrite) and B (pledge). SPEC §3, §7.
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { serve } from "@hono/node-server";
import { timingSafeEqual } from "node:crypto";
import { encodeFunctionData, isAddress, isAddressEqual, isHash, parseAbi, getAddress, recoverMessageAddress, zeroAddress } from "viem";
import type { Address, ApplyRequest, ApplyResponse, ClaimFirst, DebtState, DeskInfo, Hex, Loan, LoanDetail, LoanStatus, Memo, PledgeRequest, Quote, Signal, Terms, TxRequest } from "@feedesk/shared";
import { applyMessage, CHAIN_ID_BASE, FEE_DESK_ABI, FEE_VAULT_ABI, FEES_MANAGER_ABI, VAULT_STATUS } from "@feedesk/shared";
import type { Ctx } from "../ctx.ts";
import { jsonBody, need, opt } from "../ctx.ts";
import * as db from "../db/index.ts";
import { assertClaimTx, assertPledgeTx, buildClaim, buildTransferBeneficiary, claimableFees, creatorFees, dust } from "../bankr/index.ts";
import { PERSONAS, quote, underwrite } from "../underwriter/index.ts";

const bad = (msg: string, status: 400 | 401 | 404 | 409 | 422 | 502 | 503 = 400) => new HTTPException(status, { message: msg });
const addr = (v: unknown, name: string): Address => {
  if (typeof v !== "string" || !isAddress(v)) throw bad(`${name} must be a 0x address`);
  return getAddress(v);
};
const vaultAbi = parseAbi(FEE_VAULT_ABI);
const deskAbi = parseAbi(FEE_DESK_ABI);

/** EIP-191 personal_sign by `signer`: EOA via ecrecover (offline), else ERC-1271/6492 via the RPC. */
export async function verifySigner(ctx: Pick<Ctx, "pub">, signer: Address, message: string, signature: unknown): Promise<boolean> {
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) return false;
  const sig = signature as Hex;
  const eoa = await recoverMessageAddress({ message, signature: sig }).catch(() => null);
  if (eoa && isAddressEqual(eoa, signer)) return true;
  return ctx.pub.verifyMessage({ address: signer, message, signature: sig }).catch(() => false);
}

/** Lazy cross-module call: modules are loaded by src/index.ts; a missing one fails loudly by name. */
async function mod<T>(name: string): Promise<T> {
  try {
    return (await import(`../${name}/index.ts`)) as T;
  } catch (e) {
    throw bad(`agent module "${name}" unavailable: ${(e as Error).message}`, 503);
  }
}
type Keeper = {
  createLoanOnchain(ctx: Ctx, a: { borrower: Address; poolId: Hex; feesManager: Address; creatorToken: Address; symbol: string; terms: Terms }): Promise<{ onchainId: number; vault: Address; note: Address; txHash: Hex }>;
  confirmPledge(ctx: Ctx, loan: Loan): Promise<Hex>;
  readDebt(ctx: Ctx, vault: Address): Promise<DebtState>;
};
type Cca = { launchAuction(ctx: Ctx, loan: Loan): Promise<{ auction: Address; txHash: Hex }> };
type Social = { publishSignals(ctx: Ctx, loanId: number, memos: Memo[], quote: Quote): Signal[] };
type Erc8004 = typeof import("../erc8004/index.ts");

const STATUS_BY_VAULT: Record<(typeof VAULT_STATUS)[number], LoanStatus> = {
  Created: "APPROVED", Pledged: "PLEDGED", Auction: "AUCTION", Active: "ACTIVE", Released: "RELEASED", Cancelled: "CANCELLED",
};

/** Chain is the source of truth for status once a vault exists. */
async function syncStatus(ctx: Ctx, loan: Loan): Promise<Loan> {
  if (!loan.vault || loan.status === "DECLINED") return loan;
  const s = VAULT_STATUS[Number(await ctx.pub.readContract({ address: loan.vault, abi: vaultAbi, functionName: "status" }))]!;
  const status = STATUS_BY_VAULT[s];
  if (status !== loan.status) {
    db.updateLoan(ctx.db, loan.id, { status });
    ctx.log("server", `loan ${loan.id} status ${loan.status} → ${status} (on-chain ${s})`);
    return { ...loan, status };
  }
  return loan;
}

async function detail(ctx: Ctx, id: number): Promise<LoanDetail> {
  let loan = db.getLoan(ctx.db, id);
  if (!loan) throw bad(`loan ${id} not found`, 404);
  loan = await syncStatus(ctx, loan);
  let debt: DebtState | null = null;
  if (loan.vault && ["AUCTION", "ACTIVE", "RELEASED", "PLEDGED"].includes(loan.status)) {
    try {
      debt = await (await mod<Keeper>("keeper")).readDebt(ctx, loan.vault);
    } catch (e) {
      ctx.log("server", `loan ${id}: readDebt unavailable`, (e as Error).message); // show the loan anyway, debt: null
    }
  }
  return { ...loan, debt, events: db.listEvents(ctx.db, id), signals: db.listLoanSignals(ctx.db, id), memos: db.listMemos(ctx.db, id) };
}

const OPEN: LoanStatus[] = ["APPROVED", "PLEDGED", "AUCTION", "ACTIVE"];
const DECLINE_COOLDOWN_MS = 24 * 3600_000; // re-underwriting re-publishes signals (and mirror buys): at most once a day


/**
 * Bankr build-claim for this token, checked to be exactly collectFees(poolId) on the fees manager. null when nothing is
 * accrued. Honest framing: signing it is the borrower's choice; skipping it is safe, those fees then go to the vault on
 * the first collect and count as repayment (SPEC §2 claim-first).
 */
async function claimFirst(ctx: Ctx, id: number, borrower: Address, inp: NonNullable<Quote["inputs"]>): Promise<ClaimFirst | null> {
  if (BigInt(inp.claimableWethRaw) === 0n && BigInt(inp.claimableTokenRaw) === 0n) return null;
  try {
    const r = await buildClaim(borrower, [inp.token]);
    if (r.txs.length !== 1) throw new Error(`build-claim returned ${r.txs.length} txs, errors ${JSON.stringify(r.errors).slice(0, 200)}`);
    const tx = { ...r.txs[0]!, label: "Claim accrued fees first (FeesManager.collectFees)" };
    assertClaimTx(tx, { feesManager: inp.feesManager, poolId: inp.poolId });
    return {
      tx, claimableWethRaw: inp.claimableWethRaw, claimableTokenRaw: inp.claimableTokenRaw,
      note: "Optional, sign BEFORE pledgeTx: collects the fees accrued so far to your wallet. If you skip it, they go to the vault on its first collect and count as repayment.",
    };
  } catch (e) {
    db.addEvent(ctx.db, id, "error", null, { step: "buildClaim", error: (e as Error).message });
    ctx.log("server", `loan ${id}: claim-first tx unavailable`, (e as Error).message);
    return null;
  }
}

/** Flow A: underwrite → store memos → signals → (approve) createLoan on-chain via Dynamic wallet → pledge tx (+ optional claim-first tx). */
async function apply(ctx: Ctx, req: ApplyRequest): Promise<ApplyResponse> {
  const token = addr(req.token, "token"), borrower = addr(req.borrower, "borrower");
  const controller = req.controller ? addr(req.controller, "controller") : borrower;
  const via = req.via === "bankr-skill" ? "bankr-skill" : "web";
  // Only the fee beneficiary can apply (and name a controller, which may later authorize dining draws).
  if (typeof req.nonce !== "string" || req.nonce.length < 8 || req.nonce.length > 128)
    throw bad("nonce (8..128 chars) and signature over applyMessage(token, borrower, controller, nonce) required", 401);
  if (!(await verifySigner(ctx, borrower, applyMessage(token, borrower, controller, req.nonce), req.signature)))
    throw bad(`signature is not the borrower's (${borrower}) over applyMessage(token, borrower, controller, nonce)`, 401);
  const mine = db.listLoans(ctx.db, { borrower }).filter((l) => l.token.toLowerCase() === token.toLowerCase());
  const open = mine.find((l) => OPEN.includes(l.status));
  if (open) throw bad(`loan ${open.id} for this token is already ${open.status}`, 409);
  const declined = mine.find((l) => l.status === "DECLINED" && Date.now() - Date.parse(l.createdAt) < DECLINE_COOLDOWN_MS);
  if (declined) throw bad(`loan ${declined.id} for this token was declined at ${declined.createdAt}; re-apply after 24h`, 409);
  const agentId = req.erc8004AgentId === undefined || req.erc8004AgentId === null ? undefined : await borrowerAgent(ctx, req.erc8004AgentId, borrower, controller);
  // The desk wallet must be able to sign createLoan BEFORE anything is stored (no orphan CANCELLED loans, nonce not burnt).
  await ctx.wallet().catch((e: Error & { retryInSec?: number }) => {
    throw bad(e.retryInSec ? `desk wallet temporarily rate-limited, retry in ${e.retryInSec}s` : `desk wallet unavailable: ${e.message.split("\n")[0]}`, 503);
  });
  if (!db.useNonce(ctx.db, req.nonce)) throw bad("nonce already used", 409);

  const u = await underwrite(ctx, token, borrower, { erc8004AgentId: agentId }); // 422 ineligible / 502 lead memo failure → nothing stored
  const inp = u.quote.inputs!;
  const approved = u.lead.decision === "approve";
  const id = db.insertLoan(ctx.db, {
    status: approved ? "APPROVED" : "DECLINED", via, borrower, controller, token, symbol: inp.symbol, poolId: inp.poolId,
    feesManager: inp.feesManager, terms: approved ? u.terms : u.quote.terms, quote: u.quote, leadMemo: u.lead,
  });
  db.addEvent(ctx.db, id, "applied", null, { via, formula: u.quote.formula });
  if (agentId !== undefined) await (await mod<Erc8004>("erc8004")).setBorrowerAgentId(ctx, id, agentId);
  for (const m of u.memos) {
    db.insertMemo(ctx.db, id, m, u.rawText[m.personaId] ?? null);
    db.addEvent(ctx.db, id, "memo", null, { personaId: m.personaId, model: m.model, decision: m.decision, principalRaw: m.principalRaw, maxNotePrice: m.maxNotePrice });
  }
  // Signals are public, scored decisions: only for loans that exist (declined, or approved AND created on-chain).
  const signals = async () => {
    try {
      (await mod<Social>("social")).publishSignals(ctx, id, u.memos, u.quote);
    } catch (e) {
      db.addEvent(ctx.db, id, "error", null, { step: "publishSignals", error: (e as Error).message });
      ctx.log("server", `loan ${id}: publishSignals failed`, (e as Error).message);
    }
  };
  if (!approved) {
    await signals();
    db.addEvent(ctx.db, id, "declined", null, { personaId: u.lead.personaId, rationale: u.lead.rationale });
    return detail(ctx, id);
  }

  // Dynamic agent wallet signs createLoan right after the lead memo's decision.
  let created;
  try {
    created = await (await mod<Keeper>("keeper")).createLoanOnchain(ctx, { borrower, poolId: inp.poolId, feesManager: inp.feesManager, creatorToken: token, symbol: inp.symbol, terms: u.terms });
  } catch (e) {
    db.addEvent(ctx.db, id, "error", null, { step: "createLoanOnchain", error: (e as Error).message });
    created = await adoptVault(ctx, inp.poolId, borrower).catch(() => null); // the tx may have mined (receipt timeout, log parse)
    if (!created) {
      db.updateLoan(ctx.db, id, { status: "CANCELLED" });
      throw bad(`approved, but createLoan on-chain failed: ${(e as Error).message}`, 502);
    }
    ctx.log("server", `loan ${id}: createLoan threw but vault ${created.vault} exists on-chain for this borrower; adopted`);
  }
  db.updateLoan(ctx.db, id, { onchainId: created.onchainId, vault: created.vault, note: created.note });
  db.addEvent(ctx.db, id, "loan_created", created.txHash, { onchainId: created.onchainId, vault: created.vault, note: created.note, terms: u.terms });
  await signals();

  try {
    const pledgeTx = await buildTransferBeneficiary({ tokenAddress: token, currentBeneficiary: borrower, newBeneficiary: created.vault });
    assertPledgeTx(pledgeTx, { feesManager: inp.feesManager, poolId: inp.poolId, vault: created.vault });
    db.updateLoan(ctx.db, id, { pledgeTx });
  } catch (e) {
    db.addEvent(ctx.db, id, "error", null, { step: "buildTransferBeneficiary", error: (e as Error).message });
    ctx.log("server", `loan ${id}: pledge tx build failed (retry via GET /api/loans/${id}/pledge-tx)`, (e as Error).message);
  }
  return { ...(await detail(ctx, id)), claimFirst: await claimFirst(ctx, id, borrower, inp) };
}

/** ERC-8004 agentId named at apply: must exist and be owned by the borrower or its controller (else 400). */
async function borrowerAgent(ctx: Ctx, raw: unknown, borrower: Address, controller: Address): Promise<bigint> {
  if (typeof raw !== "string" || !/^\d{1,78}$/.test(raw)) throw bad("erc8004AgentId must be a decimal string");
  const m = await mod<Erc8004>("erc8004");
  const owner = await ctx.pub.readContract({ address: m.IDENTITY_REGISTRY, abi: m.identityAbi, functionName: "ownerOf", args: [BigInt(raw)] }).catch(() => null);
  if (!owner) throw bad(`ERC-8004 agent ${raw} does not exist in the identity registry`);
  if (!isAddressEqual(owner, borrower) && !isAddressEqual(owner, controller))
    throw bad(`ERC-8004 agent ${raw} is owned by ${owner}, not the borrower or controller`);
  return BigInt(raw);
}

/** The desk's open vault for this pool, if it belongs to this borrower and no loan row tracks it (recovers a mined createLoan). */
async function adoptVault(ctx: Ctx, poolId: Hex, borrower: Address): Promise<{ onchainId: number; vault: Address; note: Address; txHash: null } | null> {
  const vault = (await ctx.pub.readContract({ address: ctx.deskAddress, abi: deskAbi, functionName: "activeVaultByPool", args: [poolId] })) as Address;
  if (vault === zeroAddress || db.listLoans(ctx.db).some((l) => l.vault && isAddressEqual(l.vault, vault))) return null;
  const v = { address: vault, abi: vaultAbi } as const;
  const [b, loanId, note] = await Promise.all([
    ctx.pub.readContract({ ...v, functionName: "borrower" }),
    ctx.pub.readContract({ ...v, functionName: "loanId" }),
    ctx.pub.readContract({ ...v, functionName: "note" }),
  ]);
  return isAddressEqual(b as Address, borrower) ? { onchainId: Number(loanId), vault, note: note as Address, txHash: null } : null;
}

/** Pledge tx (re)build via the Bankr builder, checked byte-for-byte. Served ONLY while the vault is Created (APPROVED):
 * FeeVault cannot return shares pledged to a Cancelled/Released vault, so the chain status is re-read right before. */
async function pledgeTx(ctx: Ctx, loan: Loan): Promise<TxRequest> {
  const vault = loan.vault;
  if (!vault) throw bad("loan has no vault", 409);
  loan = await syncStatus(ctx, loan);
  if (loan.status !== "APPROVED") throw bad(`loan ${loan.id} is ${loan.status}: pledging is only possible while APPROVED (vault Created)`, 409);
  const tx = loan.pledgeTx ?? (await buildTransferBeneficiary({ tokenAddress: loan.token, currentBeneficiary: loan.borrower, newBeneficiary: vault }));
  assertPledgeTx(tx, { feesManager: loan.feesManager, poolId: loan.poolId, vault });
  if (!loan.pledgeTx) db.updateLoan(ctx.db, loan.id, { pledgeTx: tx });
  return tx;
}

const pledging = new Set<number>(); // ponytail: in-process lock (one agent process)

/** Flow B: verify shares moved on-chain → confirmPledge (agent wallet) → launch FeeNote CCA. Retry-safe. */
async function pledge(ctx: Ctx, id: number, req: PledgeRequest): Promise<LoanDetail> {
  if (pledging.has(id)) throw bad(`pledge for loan ${id} is already being processed; GET /api/loans/${id} shortly`, 409);
  pledging.add(id);
  try {
    return await pledgeLocked(ctx, id, req);
  } finally {
    pledging.delete(id);
  }
}

async function pledgeLocked(ctx: Ctx, id: number, req: PledgeRequest): Promise<LoanDetail> {
  let loan = db.getLoan(ctx.db, id);
  if (!loan) throw bad(`loan ${id} not found`, 404);
  loan = await syncStatus(ctx, loan);
  if (!loan.vault) throw bad(`loan ${id} is ${loan.status} (no vault)`, 409);
  if (req.txHash !== undefined) {
    if (!isHash(req.txHash)) throw bad("txHash must be a 32-byte hex hash");
    const rc = await ctx.pub.waitForTransactionReceipt({ hash: req.txHash, timeout: 20_000 }).catch((e) => {
      throw bad(`pledge tx ${req.txHash} not confirmed: ${(e as Error).message}`, 409);
    });
    if (rc.status !== "success") throw bad(`pledge tx ${req.txHash} reverted`, 409);
  }

  if (loan.status === "APPROVED") {
    const fm = { address: loan.feesManager, abi: parseAbi(FEES_MANAGER_ABI), functionName: "getShares" } as const;
    const [vaultShares, borrowerShares] = await Promise.all([
      ctx.pub.readContract({ ...fm, args: [loan.poolId, loan.vault] }),
      ctx.pub.readContract({ ...fm, args: [loan.poolId, loan.borrower] }),
    ]);
    if (vaultShares === 0n || borrowerShares !== 0n)
      throw bad(`fee rights not moved yet: getShares(vault)=${vaultShares}, getShares(borrower)=${borrowerShares}. Submit pledgeTx first.`, 409);
    // Soft check only: on-chain getShares above is authoritative (and FeeVault.confirmPledge re-checks it on-chain).
    const bankrSees = ctx.demoFork ? null : await claimableFees(loan.token, loan.vault, true).then((c) => c.eligible, () => null);
    if (!bankrSees) ctx.log("server", `loan ${id}: Bankr claimable-fees eligible=${bankrSees} for vault (${ctx.demoFork ? "DEMO_FORK: API reads mainnet" : "indexer lag or contract beneficiary not indexed"}); proceeding on on-chain shares`);
    const keeper = await mod<Keeper>("keeper");
    let hash: Hex | null = null;
    try {
      hash = await keeper.confirmPledge(ctx, loan);
    } catch (e) {
      loan = await syncStatus(ctx, loan); // an earlier/concurrent confirmPledge may have landed
      if (loan.status === "APPROVED") throw e;
    }
    if (hash) {
      db.updateLoan(ctx.db, id, { status: "PLEDGED" });
      db.addEvent(ctx.db, id, "pledged", hash, { vaultShares: vaultShares.toString(), pledgeTxHash: req.txHash ?? null, bankrIndexedVault: bankrSees });
      loan = { ...loan, status: "PLEDGED" };
    }
  }
  if (loan.status === "PLEDGED") {
    try {
      const a = await (await mod<Cca>("cca")).launchAuction(ctx, loan);
      db.updateLoan(ctx.db, id, { status: "AUCTION", auction: a.auction });
      db.addEvent(ctx.db, id, "auction_started", a.txHash, { auction: a.auction });
    } catch (e) {
      db.addEvent(ctx.db, id, "error", null, { step: "launchAuction", error: (e as Error).message });
      throw bad(`pledge confirmed, but auction launch failed (POST again to retry): ${(e as Error).message}`, 502);
    }
  }
  return detail(ctx, id);
}

// ─── restricted JSON-RPC proxy: the public web reads the chain (the Anvil fork in DEMO_FORK) through the agent ───
/** Read-only methods + eth_sendRawTransaction (already user-signed; the proxy adds no authority). Everything else, notably
 * anvil_* / hardhat_* / evm_* / debug_* / eth_sendTransaction / eth_sign*, is rejected. eth_getTransactionCount is needed
 * for a browser to pick the nonce of the raw tx it signs. */
export const RPC_ALLOWED = new Set([
  "eth_chainId", "eth_blockNumber", "eth_call", "eth_getBalance", "eth_getCode", "eth_getLogs", "eth_getTransactionReceipt",
  "eth_getTransactionByHash", "eth_getBlockByNumber", "eth_estimateGas", "eth_gasPrice", "eth_maxPriorityFeePerGas",
  "eth_feeHistory", "net_version", "eth_getTransactionCount", "eth_sendRawTransaction",
]);
export const RPC_MAX_BATCH = 20;
const RPC_MAX_BYTES = 256 * 1024;
type RpcCall = { jsonrpc: "2.0"; id: string | number | null; method: string; params?: unknown[] };

/** Validates a JSON-RPC request or batch. Returns the sanitized calls, or {status, error} to send back as-is. */
export function checkRpc(body: unknown): { calls: RpcCall[]; batch: boolean } | { status: 400 | 403; error: string } {
  const batch = Array.isArray(body);
  const items = batch ? (body as unknown[]) : [body];
  if (!items.length || items.length > RPC_MAX_BATCH) return { status: 400, error: `batch must have 1..${RPC_MAX_BATCH} calls` };
  const calls: RpcCall[] = [];
  for (const it of items) {
    const o = it as Record<string, unknown> | null;
    if (typeof o !== "object" || o === null || Array.isArray(o) || typeof o.method !== "string") return { status: 400, error: "each call must be a JSON-RPC object with a string method" };
    if (o.params !== undefined && !Array.isArray(o.params)) return { status: 400, error: `${o.method}: params must be an array` };
    const id = o.id === undefined ? null : o.id;
    if (id !== null && typeof id !== "string" && typeof id !== "number") return { status: 400, error: "id must be a string, number or null" };
    if (!RPC_ALLOWED.has(o.method)) return { status: 403, error: `method ${o.method} is not allowed through /api/rpc` };
    calls.push({ jsonrpc: "2.0", id, method: o.method, ...(o.params ? { params: o.params as unknown[] } : {}) });
  }
  return { calls, batch };
}

export function createApp(ctx: Ctx): Hono {
  const app = new Hono();
  app.use("/api/*", cors({ origin: [ctx.webUrl, ...(process.env.EXTRA_WEB_ORIGINS ?? "").split(",").filter(Boolean)], allowHeaders: ["content-type", "x-admin-token"], allowMethods: ["GET", "POST", "DELETE", "OPTIONS"] }));
  app.use("/api/admin/*", async (c, next) => {
    const got = Buffer.from(c.req.header("x-admin-token") ?? ""), want = Buffer.from(need("ADMIN_TOKEN"));
    if (got.length !== want.length || !timingSafeEqual(got, want)) return c.json({ error: "bad or missing x-admin-token" }, 401);
    await next();
  });
  app.onError((e, c) => {
    if (e instanceof HTTPException) return c.json({ error: e.message }, e.status);
    // Config errors are safe to show and are the #1 setup question: say which key is missing instead of a bare 500.
    const cfg = /^(Missing env [A-Z0-9_]+.*|Dynamic MPC SDK has no Windows binaries.*)$/m.exec((e as Error).message ?? "");
    if (cfg) return c.json({ error: cfg[1] }, 503);
    ctx.log("server", `${c.req.method} ${c.req.path} failed`, (e as Error).stack ?? String(e));
    return c.json({ error: `internal error on ${c.req.method} ${c.req.path}; see agent log` }, 500); // raw viem errors can embed the RPC URL (and its key)
  });
  return app;
}

export function register(app: Hono, ctx: Ctx): void {
  app.get("/api/health", async (c) => c.json({ ok: true, demoFork: ctx.demoFork, block: Number(await ctx.pub.getBlockNumber()) }));

  app.get("/api/desk", async (c) => {
    const d = { address: ctx.deskAddress, abi: parseAbi(FEE_DESK_ABI) } as const;
    const [keeper, treasury] = await Promise.all([
      ctx.pub.readContract({ ...d, functionName: "keeper" }),
      ctx.pub.readContract({ ...d, functionName: "treasury" }),
    ]);
    const info: DeskInfo = {
      chainId: CHAIN_ID_BASE, demoFork: ctx.demoFork, desk: ctx.deskAddress, agentWallet: keeper, treasury,
      personas: PERSONAS.map((p, i) => (i === 0 ? { ...p, wallet: keeper } : p)), publicUrl: ctx.publicUrl,
    };
    return c.json(info);
  });

  app.post("/api/rpc", async (c) => {
    const text = await c.req.text();
    if (text.length > RPC_MAX_BYTES) throw bad(`body over ${RPC_MAX_BYTES} bytes`);
    let body: unknown;
    try { body = JSON.parse(text); } catch { throw bad("request body must be valid JSON"); }
    const r = checkRpc(body);
    if ("error" in r) return c.json({ error: r.error }, r.status);
    const res = await fetch(ctx.rpcUrl, {
      method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(20_000),
      body: JSON.stringify(r.batch ? r.calls : r.calls[0]),
    }).catch((e) => { throw bad(`upstream RPC unreachable (${(e as Error).name})`, 502); }); // no message: it can carry the RPC URL
    if (!res.ok) return c.json({ error: `upstream RPC ${res.status}` }, 502);
    return c.body(await res.text(), 200, { "content-type": "application/json" });
  });

  app.get("/api/quote", async (c) => c.json(await quote(ctx, addr(c.req.query("token"), "token"), addr(c.req.query("borrower"), "borrower"))));

  // Base Doppler tokens a wallet is beneficiary on (proxied so the browser shares our rate-limited cache).
  app.get("/api/creator-tokens", async (c) => {
    const r = await creatorFees(addr(c.req.query("wallet"), "wallet"));
    return c.json(r.tokens.filter((t) => t.chain === "base" && t.source === "doppler").map((t) => ({
      token: t.tokenAddress, symbol: t.symbol, name: t.name, sharePct: parseFloat(t.share),
      claimableWeth: Number(dust(t.tokenIsToken0 ? t.claimable.token1 : t.claimable.token0)),
    })));
  });

  app.post("/api/loans", async (c) => c.json(await apply(ctx, await jsonBody<ApplyRequest>(c))));

  app.get("/api/loans", async (c) => {
    const status = c.req.query("status") as LoanStatus | undefined;
    const STATUSES: LoanStatus[] = ["DECLINED", ...OPEN, "RELEASED", "CANCELLED"];
    if (status !== undefined && !STATUSES.includes(status)) throw bad(`status must be one of ${STATUSES.join("|")}`);
    const b = c.req.query("borrower");
    const loans = db.listLoans(ctx.db, { borrower: b ? addr(b, "borrower") : undefined });
    // chain is the source of truth: re-sync open loans (one status() read each) before filtering
    const synced = await Promise.all(loans.map((l) => (l.vault && OPEN.includes(l.status) ? syncStatus(ctx, l).catch(() => l) : l)));
    return c.json(status ? synced.filter((l) => l.status === status) : synced);
  });

  const idParam = (s: string) => {
    const n = Number(s);
    if (!Number.isInteger(n) || n < 1) throw bad("loan id must be a positive integer");
    return n;
  };
  app.get("/api/loans/:id", async (c) => c.json(await detail(ctx, idParam(c.req.param("id")))));

  app.get("/api/loans/:id/pledge-tx", async (c) => {
    const loan = db.getLoan(ctx.db, idParam(c.req.param("id")));
    if (!loan) throw bad("loan not found", 404);
    return c.json(await pledgeTx(ctx, loan));
  });

  app.post("/api/loans/:id/pledge", async (c) =>
    c.json(await pledge(ctx, idParam(c.req.param("id")), await jsonBody<PledgeRequest>(c, true))));

  app.get("/api/loans/:id/release-tx", async (c) => {
    const loan = db.getLoan(ctx.db, idParam(c.req.param("id")));
    if (!loan?.vault) throw bad("loan not found or has no vault", 404);
    const ok = await ctx.pub.readContract({ address: loan.vault, abi: vaultAbi, functionName: "canRelease" });
    if (!ok) throw bad("vault.canRelease() is false: debt not fully covered yet", 409);
    const tx: TxRequest = { to: loan.vault, data: encodeFunctionData({ abi: vaultAbi, functionName: "release" }), chainId: CHAIN_ID_BASE, label: "Release fee rights (FeeVault.release)" };
    return c.json(tx);
  });

  app.notFound((c) => c.json({ error: `no route ${c.req.method} ${c.req.path}` }, 404));
}

export function listen(app: Hono, ctx: Ctx): void {
  const port = Number(opt("AGENT_PORT", "8787"));
  serve({ fetch: app.fetch, port }, () => ctx.log("server", `listening on :${port} (demoFork=${ctx.demoFork}, desk=${ctx.deskAddress})`));
}
