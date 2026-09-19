// ERC-8004 (Trustless Agents) on Base: desk identity + repayment reputation. Contracts: github.com/erc-8004/erc-8004-contracts
// (v2.0.0 UUPS proxies; selectors checked against the Base implementations with `cast code`). Every write goes through the
// Dynamic agent wallet (ctx.wallet()), so it also carries the ERC-8021 builder code.
//  - desk: the agent wallet owns an ERC-8004 agent whose agentURI is GET /.well-known/agent-card.json (served here).
//  - borrower reputation: getSummary(agentId, [desk wallet], "gadai", "") = what THIS desk said about repayments.
//  - on release: giveFeedback(borrowerAgentId, 100, 0, "gadai", "repaid", ...) when the borrower gave an agentId, and
//    always setMetadata(deskAgentId, "gadai.loan.<id>", abi(status, principal, repaid, txs)) (owner-only; no self-feedback rule).
import type { Hono } from "hono";
import { decodeAbiParameters, decodeEventLog, encodeAbiParameters, keccak256, parseAbi, parseAbiParameters, toHex } from "viem";
import type { Address, Hex, Loan } from "@feedesk/shared";
import type { Ctx } from "../ctx.ts";
import { addEvent, getLoan, listEvents, now } from "../db/index.ts";

export const IDENTITY_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as const;
export const REPUTATION_REGISTRY = "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63" as const;
export const identityAbi = parseAbi([
  "function register(string agentURI) returns (uint256 agentId)",
  "function setAgentURI(uint256 agentId, string newURI)",
  "function setMetadata(uint256 agentId, string metadataKey, bytes metadataValue)",
  "function getMetadata(uint256 agentId, string metadataKey) view returns (bytes)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
]);
export const reputationAbi = parseAbi([
  "function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)",
  "function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)",
]);
export const TAG = "gadai";
const CHAIN = 8453;

// ─── pure helpers (unit-tested) ───
export const LOAN_OUTCOME = parseAbiParameters("string status, uint256 principalRaw, uint256 repaidRaw, bytes32[] txs");
export type LoanOutcome = { status: string; principalRaw: bigint; repaidRaw: bigint; txs: Hex[] };
export const encodeLoanOutcome = (o: LoanOutcome): Hex => encodeAbiParameters(LOAN_OUTCOME, [o.status, o.principalRaw, o.repaidRaw, o.txs]);
export function decodeLoanOutcome(b: Hex): LoanOutcome {
  const [status, principalRaw, repaidRaw, txs] = decodeAbiParameters(LOAN_OUTCOME, b);
  return { status, principalRaw, repaidRaw, txs: [...txs] };
}
export const outcomeKey = (loanId: number) => `${TAG}.loan.${loanId}`;
export const cardUrl = (publicUrl: string) => `${publicUrl.replace(/\/$/, "")}/.well-known/agent-card.json`;

/** ERC-8004 registration file (#registration-v1), served as the desk's agentURI. */
export function agentCard(a: { publicUrl: string; webUrl: string; agentId: bigint | null; wallet: Address | null; personas: { id: string; name: string; model: string; style: string }[] }) {
  const api = a.publicUrl.replace(/\/$/, "");
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "Gadai underwriter desk",
    description:
      "Autonomous credit desk on Base: lends USDC to Bankr creators and agents against pledged Doppler fee rights. " +
      "LLM underwriter personas write credit memos; the desk's Dynamic agent wallet creates FeeVaults, runs the FeeNote auction, " +
      "services the loan from fees and releases the lien. Repayment outcomes are published on-chain (ERC-8004 metadata + reputation).",
    services: [
      { name: "web", endpoint: a.webUrl },
      { name: "api", endpoint: `${api}/api` },
      { name: "quote", endpoint: `${api}/api/quote` },
      { name: "loans", endpoint: `${api}/api/loans` },
      { name: "reputation", endpoint: `${api}/api/erc8004/{agentId}` },
      ...(a.wallet ? [{ name: "agentWallet", endpoint: `eip155:${CHAIN}:${a.wallet}` }] : []),
    ],
    personas: a.personas.map((p) => ({ id: p.id, name: p.name, model: p.model, style: p.style })),
    x402Support: false,
    active: true,
    chainId: CHAIN,
    registries: { identity: `eip155:${CHAIN}:${IDENTITY_REGISTRY}`, reputation: `eip155:${CHAIN}:${REPUTATION_REGISTRY}` },
    registrations: a.agentId === null ? [] : [{ agentId: Number(a.agentId), agentRegistry: `eip155:${CHAIN}:${IDENTITY_REGISTRY}` }],
    supportedTrust: ["reputation"],
  };
}

// ─── kv (same table cca/flynet use) ───
const kvGet = (ctx: Ctx, k: string) => (ctx.db.prepare("SELECT value FROM kv WHERE key = ?").get(k) as { value: string } | undefined)?.value;
const kvSet = (ctx: Ctx, k: string, v: string) =>
  ctx.db.prepare("INSERT INTO kv (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").run(k, v, now());
const DESK_KEY = "erc8004.deskAgentId";
const borrowerKey = (loanId: number) => `erc8004.borrower.${loanId}`;

/** Desk agentId if known (env, else db). Never touches the chain. */
export function deskAgentId(ctx: Ctx): bigint | null {
  const v = process.env.ERC8004_DESK_AGENT_ID || kvGet(ctx, DESK_KEY);
  return v ? BigInt(v) : null;
}

const idc = { address: IDENTITY_REGISTRY, abi: identityAbi } as const;

/** Idempotent: make sure the Dynamic agent wallet owns a desk agent whose URI is our agent card. Returns its agentId.
 *  Memoized per process so start() and a keeper release never register twice. */
let deskP: Promise<bigint> | undefined;
export const ensureDeskIdentity = (ctx: Ctx): Promise<bigint> => (deskP ??= ensureDesk(ctx).catch((e) => { deskP = undefined; throw e; }));
async function ensureDesk(ctx: Ctx): Promise<bigint> {
  const w = await ctx.wallet();
  const uri = cardUrl(ctx.publicUrl);
  const fromEnv = !!process.env.ERC8004_DESK_AGENT_ID;
  let id = deskAgentId(ctx);
  if (id !== null) {
    const owner = await ctx.pub.readContract({ ...idc, functionName: "ownerOf", args: [id] }).catch(() => null);
    if (owner?.toLowerCase() !== w.address.toLowerCase()) {
      if (fromEnv) throw new Error(`ERC8004_DESK_AGENT_ID ${id} is owned by ${owner ?? "nobody"}, not the agent wallet ${w.address}`);
      ctx.log("erc8004", `stored desk agent ${id} not owned by ${w.address} on this chain (fresh fork?): registering again`);
      id = null;
    }
  }
  if (id === null) {
    const r = await w.write({ ...idc, functionName: "register", args: [uri] });
    const ev = r.receipt.logs
      .filter((l) => l.address.toLowerCase() === IDENTITY_REGISTRY.toLowerCase())
      .map((l) => { try { return decodeEventLog({ abi: identityAbi, data: l.data, topics: l.topics }); } catch { return null; } })
      .find((e) => e?.eventName === "Registered");
    if (!ev || ev.eventName !== "Registered") throw new Error(`register ${r.hash}: no Registered event`);
    id = ev.args.agentId;
    kvSet(ctx, DESK_KEY, id.toString());
    kvSet(ctx, "erc8004.deskRegisterTx", r.hash);
    ctx.log("erc8004", `desk registered as ERC-8004 agent #${id}`, { tx: r.hash, uri });
    return id;
  }
  if ((await ctx.pub.readContract({ ...idc, functionName: "tokenURI", args: [id] })) !== uri) {
    const r = await w.write({ ...idc, functionName: "setAgentURI", args: [id, uri] });
    ctx.log("erc8004", `desk agent #${id} URI → ${uri}`, { tx: r.hash });
  }
  return id;
}

/** What this desk has said about `agentId` on-chain: average of its "gadai" feedback (100 = repaid). Read-only. */
export async function borrowerReputation(ctx: Ctx, agentId: bigint, desk?: Address) {
  const client = desk ?? (process.env.AGENT_WALLET_ADDRESS as Address | undefined);
  if (!client) throw new Error("Missing env AGENT_WALLET_ADDRESS (the desk wallet that gives feedback)");
  const [count, value, decimals] = await ctx.pub.readContract({
    address: REPUTATION_REGISTRY, abi: reputationAbi, functionName: "getSummary", args: [agentId, [client], TAG, ""],
  });
  return { agentId: agentId.toString(), client, tag1: TAG, count: Number(count), summaryValue: value.toString(), summaryValueDecimals: decimals };
}

/** Called by the server on apply when the borrower names its ERC-8004 agentId (must exist). Logged on the loan timeline. */
export async function setBorrowerAgentId(ctx: Ctx, loanId: number, agentId: bigint): Promise<void> {
  const owner = await ctx.pub.readContract({ ...idc, functionName: "ownerOf", args: [agentId] }); // throws if not registered
  kvSet(ctx, borrowerKey(loanId), agentId.toString());
  addEvent(ctx.db, loanId, "erc8004_registered", null, { borrowerAgentId: agentId.toString(), owner, registry: IDENTITY_REGISTRY });
}
export const borrowerAgentId = (ctx: Ctx, loanId: number): bigint | null => {
  const v = kvGet(ctx, borrowerKey(loanId));
  return v ? BigInt(v) : null;
};

/** Keeper hook for a RELEASED loan. Idempotent per loan (kv flags), each write done at most once. */
export async function publishLoanOutcome(ctx: Ctx, loanId: number): Promise<void> {
  const loan = getLoan(ctx.db, loanId);
  if (!loan || loan.status !== "RELEASED") return;
  const w = await ctx.wallet();
  const events = listEvents(ctx.db, loanId);
  const api = `${ctx.publicUrl.replace(/\/$/, "")}/api/loans/${loanId}`;

  const fbKey = `erc8004.feedback.${loanId}`;
  const borrower = borrowerAgentId(ctx, loanId);
  if (borrower !== null && !kvGet(ctx, fbKey)) {
    const memoUrl = `${ctx.webUrl.replace(/\/$/, "")}/loans/${loanId}#memos`;
    const memoHash = keccak256(toHex(memoText(loan)));
    const r = await w.write({
      address: REPUTATION_REGISTRY, abi: reputationAbi, functionName: "giveFeedback",
      args: [borrower, 100n, 0, TAG, "repaid", api, memoUrl, memoHash],
    });
    kvSet(ctx, fbKey, r.hash);
    addEvent(ctx.db, loanId, "erc8004_feedback", r.hash, { agentId: borrower.toString(), value: 100, tag1: TAG, tag2: "repaid", feedbackHash: memoHash });
  }

  const mdKey = `erc8004.metadata.${loanId}`;
  if (!kvGet(ctx, mdKey)) {
    const desk = await ensureDeskIdentity(ctx);
    const txs = events.flatMap((e) => (e.txHash && /^0x[0-9a-fA-F]{64}$/.test(e.txHash) ? [e.txHash] : []));
    const outcome = { status: loan.status, principalRaw: BigInt(loan.terms?.principalRaw ?? 0), repaidRaw: BigInt(loan.terms?.faceValueRaw ?? 0), txs };
    const r = await w.write({ ...idc, functionName: "setMetadata", args: [desk, outcomeKey(loanId), encodeLoanOutcome(outcome)] });
    kvSet(ctx, mdKey, r.hash);
    addEvent(ctx.db, loanId, "erc8004_metadata", r.hash, { deskAgentId: desk.toString(), key: outcomeKey(loanId), status: outcome.status, txCount: txs.length });
  }
}
// ponytail: repaidRaw = note face value (release() requires notes + draws fully covered); the tx list is the audit trail.
const memoText = (l: Loan) => JSON.stringify(l.leadMemo ?? null);

export function register(app: Hono, ctx: Ctx): void {
  const card = async () => {
    const personas = await import("../underwriter/index.ts").then((m) => m.PERSONAS as { id: string; name: string; model: string; style: string }[]).catch(() => []);
    return agentCard({ publicUrl: ctx.publicUrl, webUrl: ctx.webUrl, agentId: deskAgentId(ctx), wallet: (process.env.AGENT_WALLET_ADDRESS as Address) || null, personas });
  };
  app.get("/.well-known/agent-card.json", async (c) => c.json(await card()));
  app.get("/api/erc8004/desk", (c) => {
    const id = deskAgentId(ctx);
    return c.json({
      agentId: id?.toString() ?? null, chainId: CHAIN, identityRegistry: IDENTITY_REGISTRY, reputationRegistry: REPUTATION_REGISTRY,
      agentURI: cardUrl(ctx.publicUrl), registerTx: kvGet(ctx, "erc8004.deskRegisterTx") ?? null, demoFork: ctx.demoFork,
    });
  });
  app.get("/api/erc8004/:agentId{[0-9]+}", async (c) => c.json(await borrowerReputation(ctx, BigInt(c.req.param("agentId")))));
}

export function start(ctx: Ctx): () => void {
  let t: NodeJS.Timeout | undefined, delay = 60_000;
  const attempt = () => ensureDeskIdentity(ctx).catch((e) => {
    ctx.log("erc8004", `desk identity not registered (retry in ${delay / 1000}s): ${(e as Error).message.split("\n")[0]}`);
    t = setTimeout(attempt, delay); // e.g. a Dynamic sign-in 429 at boot: back off, don't keep the rate limit hot
    delay = Math.min(delay * 2, 15 * 60_000);
  });
  void attempt();
  return () => clearTimeout(t);
}
