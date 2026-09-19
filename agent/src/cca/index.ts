// FeeNote CCA (Uniswap Continuous Clearing Auction v2.1.0): launch per loan, desk anchor bid, bid/exit plans, settle watcher.
// Source-verified rules (continuous-clearing-auction@v2.1.0):
//  - every tick price (incl. floor) must be a MULTIPLE of tickSpacing (TickStorage._getTick: price % TICK_SPACING == 0)
//  - bids need price > current clearing price; ERC-20 currency is pulled via Permit2 AllowanceTransfer
//  - isGraduated()/currencyRaised() are as of the last checkpoint → checkpoint() at/after endBlock before settling
import { HTTPException } from "hono/http-exception";
import type { Hono } from "hono";
import { encodeFunctionData, encodePacked, parseAbi, parseEventLogs, toHex } from "viem";
import {
  ADDR, CCA_AUCTION_ABI, CHAIN_ID_BASE, ERC20_ABI, FEE_VAULT_ABI, PERMIT2_ABI, Q96, q96ToUsdcPerNote,
  type Address, type AuctionState, type BidPlan, type BidPlanRequest, type BidRow, type ExitPlan, type ExitPlanRequest,
  type Hex, type Loan, type TxRequest,
} from "@feedesk/shared";
import type { Ctx } from "../ctx.ts";
import { jsonBody, opt, posInt } from "../ctx.ts";
import { addEvent, getLoan, listLoans, now, updateLoan } from "../db/index.ts";

const auctionAbi = parseAbi(CCA_AUCTION_ABI);
const vaultAbi = parseAbi(FEE_VAULT_ABI);
const erc20Abi = parseAbi(ERC20_ABI);
const permit2Abi = parseAbi(PERMIT2_ABI);
const MPS = 10_000_000;
const lc = (s: string) => s.toLowerCase();

// ─── pure math (tested in cca.test.ts) ───
/** 1 cent per note in Q96. Tick grid = k · TICK_Q96 (the CCA requires price % tickSpacing == 0). */
export const TICK_Q96 = Q96 / 100n;
export const centsToQ96 = (cents: number): bigint => BigInt(cents) * TICK_Q96;
/** Snap a USDC-per-note price DOWN to the cent grid. */
export const priceToCents = (price: number): number => Math.floor(price * 100 + 1e-9);

/** N-1 blocks at a = floor(6e6/(N-1)) mps, then 1 block with the rest (≈40% in the final block). Σ mps·blocks = 1e7. */
export function stepsData(nBlocks: number): Hex {
  if (!Number.isInteger(nBlocks) || nBlocks < 2) throw new Error(`AUCTION_BLOCKS must be an integer ≥ 2 (got ${nBlocks})`);
  const a = Math.floor(6_000_000 / (nBlocks - 1));
  const last = MPS - a * (nBlocks - 1);
  return encodePacked(["uint24", "uint40", "uint24", "uint40"], [a, nBlocks - 1, last, 1]);
}

export type Cp = { block: bigint; clearingPrice: bigint; prev: bigint; next: bigint };
/**
 * Hints for exitPartiallyFilledBid, per v2.1.0 source:
 *  lastFullyFilled: cp.clearing < maxPrice && next(cp).clearing >= maxPrice && cp.block >= bid.startBlock
 *  outbid: first cp with clearing > maxPrice (its prev has clearing <= maxPrice); 0 when the bid sits at the final clearing price.
 * `cps` ascending by block.
 */
export function exitHints(cps: Cp[], maxPrice: bigint, startBlock: bigint): { lastFullyFilled: bigint; outbid: bigint } {
  const below = cps.filter((c) => c.clearingPrice < maxPrice && c.block >= startBlock);
  const lastFull = below.at(-1);
  if (!lastFull) throw new Error("no checkpoint below the bid price at/after bid start");
  const outbid = cps.find((c) => c.clearingPrice > maxPrice);
  return { lastFullyFilled: lastFull.block, outbid: outbid?.block ?? 0n };
}

// ─── chain reads ───
const readA = <T>(ctx: Ctx, auction: Address, functionName: string, args: readonly unknown[] = []) =>
  ctx.pub.readContract({ address: auction, abi: auctionAbi, functionName: functionName as any, args: args as any }) as Promise<T>;
const readV = <T>(ctx: Ctx, vault: Address, functionName: string) =>
  ctx.pub.readContract({ address: vault, abi: vaultAbi, functionName: functionName as any }) as Promise<T>;

type RawBid = { startBlock: bigint; startCumulativeMps: number; exitedBlock: bigint; maxPrice: bigint; owner: Address; amountQ96: bigint; tokensFilled: bigint };

async function readBids(ctx: Ctx, auction: Address): Promise<(RawBid & { id: bigint })[]> {
  const n = await readA<bigint>(ctx, auction, "nextBidId");
  if (n === 0n) return [];
  const ids = Array.from({ length: Number(n) }, (_, i) => BigInt(i));
  const res = await ctx.pub.multicall({
    allowFailure: false,
    contracts: ids.map((id) => ({ address: auction, abi: auctionAbi, functionName: "bids", args: [id] }) as const),
  });
  return (res as unknown as RawBid[]).map((b, i) => ({ ...b, id: ids[i]! }));
}

async function readCheckpoints(ctx: Ctx, auction: Address): Promise<Cp[]> {
  const out: Cp[] = [];
  let b = await readA<bigint>(ctx, auction, "lastCheckpointedBlock");
  // ponytail: sequential walk, one RPC per checkpoint (≈ one per active block); fine for demo-length auctions, batch via multicall if long
  for (let i = 0; b !== 0n && i < 2000; i++) {
    const c = await readA<{ clearingPrice: bigint; prev: bigint; next: bigint }>(ctx, auction, "checkpoints", [b]);
    out.unshift({ block: b, clearingPrice: c.clearingPrice, prev: c.prev, next: c.next });
    b = c.prev;
  }
  return out;
}

/** maxPrice of every bid ever placed, per auction (immutable once placed → cache, fetch only new ids). */
const bidPrices = new Map<string, bigint[]>();
/** Highest initialized tick strictly below `price`. Initialized ticks = floor ∪ every bid's maxPrice (the CCA never
 *  un-initializes a tick), so one multicall over NEW bid ids replaces the ticks(p).next walk. */
async function prevTick(ctx: Ctx, auction: Address, price: bigint): Promise<bigint> {
  const [floor, n] = await Promise.all([readA<bigint>(ctx, auction, "floorPrice"), readA<bigint>(ctx, auction, "nextBidId")]);
  const known = bidPrices.get(lc(auction)) ?? [];
  if (BigInt(known.length) < n) {
    const ids = Array.from({ length: Number(n) - known.length }, (_, i) => BigInt(known.length + i));
    const res = (await ctx.pub.multicall({
      allowFailure: false,
      contracts: ids.map((id) => ({ address: auction, abi: auctionAbi, functionName: "bids", args: [id] }) as const),
    })) as unknown as RawBid[];
    bidPrices.set(lc(auction), [...known, ...res.map((b) => b.maxPrice)]);
  }
  return (bidPrices.get(lc(auction)) ?? []).reduce((best, p) => (p < price && p > best ? p : best), floor);
}

const tx = (to: Address, abi: readonly unknown[], functionName: string, args: readonly unknown[], label: string): TxRequest => ({
  to, chainId: CHAIN_ID_BASE, label, value: "0",
  data: encodeFunctionData({ abi: abi as any, functionName, args: args as any }) as Hex,
});

function needAuction(loan: Loan | null): Loan & { auction: Address; vault: Address } {
  if (!loan) throw new HTTPException(404, { message: "loan not found" });
  if (!loan.auction || !loan.vault) throw new HTTPException(409, { message: `loan ${loan.id} has no FeeNote auction yet (status ${loan.status})` });
  return loan as Loan & { auction: Address; vault: Address };
}

/** In-process single-flight: concurrent callers for the same key share one run (no double anchor bid / double launch). */
const inflight = new Map<string, Promise<unknown>>();
function single<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const cur = inflight.get(key);
  if (cur) return cur as Promise<T>;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

// ─── exports (SPEC §5) ───

/** Pledged vault → start the FeeNote CCA (signed by the Dynamic agent wallet), then the desk anchor bid. Updates the loan to AUCTION.
 *  Idempotent: if the vault is already in Auction it only (re)tries the anchor bid; the settle loop also retries it. */
export const launchAuction = (ctx: Ctx, loan: Loan) => single(`launch:${loan.id}`, () => launchAuctionOnce(ctx, loan));

async function launchAuctionOnce(ctx: Ctx, loan: Loan): Promise<{ auction: Address; txHash: Hex }> {
  if (!loan.vault || !loan.terms || !loan.leadMemo) throw new Error(`loan ${loan.id}: vault/terms/leadMemo missing, cannot launch auction`);
  const vault = loan.vault;
  const status = await readV<number>(ctx, vault, "status");
  if (status === 2) {
    const auction = await readV<Address>(ctx, vault, "auction");
    updateLoan(ctx.db, loan.id, { auction, status: "AUCTION" });
    return { auction, txHash: (await placeAnchorBid(ctx, { ...loan, auction })) ?? ("0x" as Hex) };
  }
  if (status !== 1) throw new HTTPException(409, { message: `vault ${vault} status ${status} ≠ Pledged(1); confirmPledge first` });

  const [principal, face] = await Promise.all([readV<bigint>(ctx, vault, "principal"), readV<bigint>(ctx, vault, "faceValue")]);
  // floor on the cent grid (engine guarantees floor·face ≥ principal). Terms.floorPriceQ96 is NOT used: it is
  // usdcPerNoteToQ96(x), which is not a multiple of tickSpacing, and the CCA constructor would revert.
  const floorCents = priceToCents(loan.terms.floorPrice);
  if (floorCents < 1 || (BigInt(floorCents) * face) / 100n < principal) throw new Error(`bad floor ${loan.terms.floorPrice} for principal ${principal}/face ${face}`);

  const w = await ctx.wallet();
  const anchorAmt = anchorAmount(principal);
  if (anchorAmt > 0n) { // check before starting: an auction without its anchor would likely fail to graduate
    const bal = await ctx.pub.readContract({ address: ADDR.USDC, abi: erc20Abi, functionName: "balanceOf", args: [w.address] });
    if (bal < anchorAmt) throw new Error(`desk wallet ${w.address} holds ${bal} raw USDC < anchor bid ${anchorAmt} (fund it or lower DESK_ANCHOR_BID_PCT)`);
  }

  const nBlocks = Number(opt("AUCTION_BLOCKS", "150"));
  const startBlock = (await ctx.pub.getBlockNumber({ cacheTime: 0 })) + 5n;
  const endBlock = startBlock + BigInt(nBlocks);
  const claimBlock = endBlock + BigInt(opt("AUCTION_CLAIM_DELAY_BLOCKS", "0"));
  const started = await w.write({
    address: vault, abi: vaultAbi, functionName: "startAuction",
    args: [startBlock, endBlock, claimBlock, TICK_Q96, centsToQ96(floorCents), stepsData(nBlocks)],
  });
  const auction = await readV<Address>(ctx, vault, "auction");
  updateLoan(ctx.db, loan.id, { auction, status: "AUCTION" });
  // auction_started event is recorded by the server (COORDINATION agent-core 23:21)
  ctx.log("cca", `loan ${loan.id} FeeNote CCA ${auction} blocks ${startBlock}..${endBlock} floor ${floorCents / 100}`);
  try {
    await placeAnchorBid(ctx, { ...loan, auction });
  } catch (e) { // auction is live; the watcher retries the anchor bid. Return normally so the caller records auction_started.
    addEvent(ctx.db, loan.id, "error", null, { step: "desk_anchor_bid", error: (e as Error).message, retry: "cca watcher" });
    ctx.log("cca", `loan ${loan.id} anchor bid failed, watcher retries: ${(e as Error).message}`);
  }
  return { auction, txHash: started.hash };
}

const anchorSkipped = new Set<number>();
// default 101: a bid of exactly principal ends a few raw units short of requiredCurrencyRaised after the CCA's Q96/mps rounding
// (seen on the fork), so a desk-only auction would not graduate. Unspent USDC is refunded on exit.
const anchorAmount = (principal: bigint) => (principal * BigInt(opt("DESK_ANCHOR_BID_PCT", "101"))) / 100n;

/** Desk's own bid (Dynamic agent wallet) at the lead persona's price, ≥ one tick above the floor. No-op if the desk already bid. */
const placeAnchorBid = (ctx: Ctx, loan: Loan) => single(`anchor:${loan.id}`, () => placeAnchorBidOnce(ctx, loan));

async function placeAnchorBidOnce(ctx: Ctx, loan: Loan): Promise<Hex | null> {
  const a = loan.auction!, w = await ctx.wallet();
  const [principal, floor, startBlock] = await Promise.all([
    readV<bigint>(ctx, loan.vault!, "principal"), readA<bigint>(ctx, a, "floorPrice"), readA<bigint>(ctx, a, "startBlock"),
  ]);
  const amt = anchorAmount(principal);
  if (amt === 0n || (await readBids(ctx, a)).some((b) => lc(b.owner) === lc(w.address))) return null;
  const cents = Math.max(priceToCents(loan.leadMemo!.maxNotePrice), Number(floor / TICK_Q96) + 1);
  await waitForBlock(ctx, startBlock);
  // lenders already bid the clearing price up to/above the desk's price: the loan is funded without the desk, not an error
  if ((await readA<bigint>(ctx, a, "clearingPrice")) >= centsToQ96(cents)) {
    if (!anchorSkipped.has(loan.id)) ctx.log("cca", `loan ${loan.id}: clearing ≥ desk price ${cents / 100}, anchor bid not needed`);
    anchorSkipped.add(loan.id);
    return null;
  }
  const plan = await bidPlan(ctx, loan, { bidder: w.address, amountRaw: amt.toString(), maxPrice: cents / 100 });
  let last: Hex | null = null;
  for (const t of plan.txs) last = (await w.send({ to: t.to, data: t.data })).hash;
  addEvent(ctx.db, loan.id, "bid", last, { action: "desk_anchor_bid", bidder: w.address, amountRaw: amt.toString(), maxPrice: cents / 100, persona: loan.leadMemo!.personaId });
  return last;
}

/** Bids revert before startBlock. Mainnet: wait (~2s blocks). DEMO_FORK: anvil_mine (labeled fork-only). */
async function waitForBlock(ctx: Ctx, target: bigint) {
  for (let i = 0; i < 60; i++) {
    const b = await ctx.pub.getBlockNumber({ cacheTime: 0 });
    if (b >= target) return;
    if (ctx.demoFork) {
      ctx.log("cca", `DEMO_FORK: anvil_mine ${target - b} blocks to reach auction start`);
      await (ctx.pub.request as any)({ method: "anvil_mine", params: [toHex(target - b)] });
    } else await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`block ${target} not reached after 120s`);
}

export async function auctionState(ctx: Ctx, loan: Loan): Promise<AuctionState> {
  const l = needAuction(loan);
  const a = l.auction;
  const [startBlock, endBlock, claimBlock, currentBlock, floor, tickSpacing, clearing, raised, graduated, supply, required, bids] = await Promise.all([
    readA<bigint>(ctx, a, "startBlock"), readA<bigint>(ctx, a, "endBlock"), readA<bigint>(ctx, a, "claimBlock"),
    ctx.pub.getBlockNumber({ cacheTime: 0 }), readA<bigint>(ctx, a, "floorPrice"), readA<bigint>(ctx, a, "tickSpacing"),
    readA<bigint>(ctx, a, "clearingPrice"), readA<bigint>(ctx, a, "currencyRaised"), readA<boolean>(ctx, a, "isGraduated"),
    readA<bigint>(ctx, a, "totalSupply"), readV<bigint>(ctx, l.vault, "principal"), readBids(ctx, a),
  ]);
  return {
    loanId: l.id, auction: a, startBlock: Number(startBlock), endBlock: Number(endBlock), claimBlock: Number(claimBlock),
    currentBlock: Number(currentBlock), floorPrice: q96ToUsdcPerNote(floor), tickSpacingQ96: tickSpacing.toString(),
    clearingPrice: q96ToUsdcPerNote(clearing), currencyRaisedRaw: raised.toString(), requiredRaw: required.toString(),
    graduated, totalSupplyRaw: supply.toString(),
    bids: bids.map((b): BidRow => ({
      bidId: b.id.toString(), owner: b.owner, maxPrice: q96ToUsdcPerNote(b.maxPrice), amountRaw: (b.amountQ96 >> 96n).toString(),
      exited: b.exitedBlock !== 0n, tokensFilledRaw: b.tokensFilled.toString(),
    })),
  };
}

/** Txs a bidder signs: [USDC.approve(Permit2)], [Permit2.approve(USDC, auction)], submitBid(5-arg with prevTickPrice hint). */
export async function bidPlan(ctx: Ctx, loan: Loan, req: BidPlanRequest): Promise<BidPlan> {
  const l = needAuction(loan);
  const a = l.auction;
  if (!/^0x[0-9a-fA-F]{40}$/.test(req.bidder ?? "")) throw new HTTPException(400, { message: "bidder must be an address" });
  const amount = /^[0-9]{1,39}$/.test(String(req.amountRaw ?? "")) ? BigInt(req.amountRaw) : 0n;
  if (amount <= 0n || amount >= 2n ** 128n) throw new HTTPException(400, { message: "amountRaw must be a positive USDC raw amount" });
  const cents = priceToCents(Number(req.maxPrice));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 1e9) throw new HTTPException(400, { message: "maxPrice must be a positive USDC-per-note number" });
  const priceQ96 = centsToQ96(cents);

  const [block, endBlock, clearing, tickSpacing] = await Promise.all([
    ctx.pub.getBlockNumber({ cacheTime: 0 }), readA<bigint>(ctx, a, "endBlock"), readA<bigint>(ctx, a, "clearingPrice"), readA<bigint>(ctx, a, "tickSpacing"),
  ]);
  if (tickSpacing !== TICK_Q96) throw new Error(`auction tickSpacing ${tickSpacing} ≠ desk grid ${TICK_Q96}`);
  if (block >= endBlock) throw new HTTPException(409, { message: `auction ended at block ${endBlock}` });
  if (priceQ96 <= clearing) throw new HTTPException(409, { message: `bid ${cents / 100} must be above the clearing price ${q96ToUsdcPerNote(clearing)} (snapped to the 0.01 grid)` });

  const bidder = req.bidder as Address;
  const [allowance, p2, prev] = await Promise.all([
    ctx.pub.readContract({ address: ADDR.USDC, abi: erc20Abi, functionName: "allowance", args: [bidder, ADDR.PERMIT2] }),
    ctx.pub.readContract({ address: ADDR.PERMIT2, abi: permit2Abi, functionName: "allowance", args: [bidder, ADDR.USDC, a] }),
    prevTick(ctx, a, priceQ96),
  ]);
  const txs: TxRequest[] = [];
  if (allowance < amount) txs.push(tx(ADDR.USDC, erc20Abi, "approve", [ADDR.PERMIT2, amount], "Approve USDC to Permit2"));
  const nowSec = Math.floor(Date.now() / 1000);
  if (p2[0] < amount || p2[1] < nowSec + 600) {
    txs.push(tx(ADDR.PERMIT2, permit2Abi, "approve", [ADDR.USDC, a, amount, nowSec + 86_400], "Permit2: allow the FeeNote auction"));
  }
  txs.push(tx(a, auctionAbi, "submitBid", [priceQ96, amount, bidder, prev, "0x"], `Bid ${Number(amount) / 1e6} USDC ≤ ${cents / 100}/note`));
  return { maxPriceQ96: priceQ96.toString(), prevTickPriceQ96: prev.toString(), txs };
}

/** Exit (full, partial with computed hints) and/or claimTokens for one bid. 409 when nothing is possible yet. */
export async function exitPlan(ctx: Ctx, loan: Loan, req: ExitPlanRequest): Promise<ExitPlan> {
  const l = needAuction(loan);
  const a = l.auction;
  if (!/^[0-9]{1,20}$/.test(String(req.bidId ?? ""))) throw new HTTPException(400, { message: "bidId must be a non-negative integer" });
  const id = BigInt(req.bidId);
  const [n, block, endBlock, claimBlock, lastCp, graduated, clearing] = await Promise.all([
    readA<bigint>(ctx, a, "nextBidId"), ctx.pub.getBlockNumber({ cacheTime: 0 }), readA<bigint>(ctx, a, "endBlock"),
    readA<bigint>(ctx, a, "claimBlock"), readA<bigint>(ctx, a, "lastCheckpointedBlock"), readA<boolean>(ctx, a, "isGraduated"),
    readA<bigint>(ctx, a, "clearingPrice"),
  ]);
  if (id < 0n || id >= n) throw new HTTPException(404, { message: `bid ${req.bidId} not found` });
  const bid = await readA<RawBid>(ctx, a, "bids", [id]);
  const txs: TxRequest[] = [];
  // tokensFilled is only known after the exit executes; claimTokens with 0 filled is a harmless no-op
  const mayHaveTokens = bid.exitedBlock === 0n || bid.tokensFilled > 0n;

  if (bid.exitedBlock === 0n) {
    const ended = block >= endBlock;
    if (ended && lastCp !== endBlock) {
      throw new HTTPException(409, { message: "auction end not checkpointed yet; the desk watcher finalizes it within a minute (or call checkpoint())" });
    }
    if (ended && (!graduated || bid.maxPrice > clearing)) {
      txs.push(tx(a, auctionAbi, "exitBid", [id], graduated ? "Exit bid (fully filled)" : "Exit bid (auction failed: full refund)"));
    } else if ((ended && bid.maxPrice <= clearing) || (!ended && graduated && bid.maxPrice < clearing)) {
      const h = exitHints(await readCheckpoints(ctx, a), bid.maxPrice, bid.startBlock);
      if (!ended && h.outbid === 0n) throw new HTTPException(409, { message: "bid is not outbid yet" });
      txs.push(tx(a, auctionAbi, "exitPartiallyFilledBid", [id, h.lastFullyFilled, h.outbid], "Exit bid (partially filled / outbid)"));
    } else {
      throw new HTTPException(409, { message: "bid is still active; exit after the auction ends or once it is outbid" });
    }
  }
  if (graduated && block >= claimBlock && mayHaveTokens) txs.push(tx(a, auctionAbi, "claimTokens", [id], "Claim FeeNotes"));
  if (!txs.length) throw new HTTPException(409, { message: bid.exitedBlock !== 0n && block < claimBlock ? `claim opens at block ${claimBlock}` : "nothing to exit or claim" });
  return { txs };
}

// ─── settle watcher ───
const kvGet = (ctx: Ctx, k: string) => (ctx.db.prepare("SELECT value FROM kv WHERE key = ?").get(k) as { value: string } | undefined)?.value;
const kvSet = (ctx: Ctx, k: string, v: string) =>
  ctx.db.prepare("INSERT INTO kv (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").run(k, v, now());

/** At/after endBlock: finalize checkpoint, then disburse (graduated) or cancel (not). Then the desk exits + claims its own bids. */
export async function settleOnce(ctx: Ctx, loanId: number): Promise<void> {
  const loan = getLoan(ctx.db, loanId);
  if (!loan?.auction || !loan.vault) return;
  const { auction: a, vault } = loan;
  let status = await readV<number>(ctx, vault, "status");
  if (status === 2) {
    const [block, endBlock] = await Promise.all([ctx.pub.getBlockNumber({ cacheTime: 0 }), readA<bigint>(ctx, a, "endBlock")]);
    if (block < endBlock) {
      if (loan.leadMemo && !inflight.has(`launch:${loanId}`)) await placeAnchorBid(ctx, loan); // retry if launch failed after startAuction
      return;
    }
    const w = await ctx.wallet();
    if ((await readA<bigint>(ctx, a, "lastCheckpointedBlock")) !== endBlock) {
      await w.write({ address: a, abi: auctionAbi, functionName: "checkpoint" });
    }
    if (await readA<boolean>(ctx, a, "isGraduated")) {
      const r = await w.write({ address: vault, abi: vaultAbi, functionName: "disburse" });
      const ev = parseEventLogs({ abi: vaultAbi, logs: r.receipt.logs, eventName: "Disbursed" })[0];
      updateLoan(ctx.db, loanId, { status: "ACTIVE" });
      status = 3;
      addEvent(ctx.db, loanId, "disbursed", r.hash, { amountRaw: (ev?.args as { amount?: bigint })?.amount?.toString() ?? null, to: loan.borrower, signer: w.address });
      ctx.log("cca", `loan ${loanId} graduated → disbursed`, { tx: r.hash });
    } else {
      const r = await w.write({ address: vault, abi: vaultAbi, functionName: "cancel" });
      updateLoan(ctx.db, loanId, { status: "CANCELLED" });
      status = 5;
      addEvent(ctx.db, loanId, "cancelled", r.hash, { reason: "FeeNote auction did not graduate; lien returned, bidders refund via exitBid" });
      ctx.log("cca", `loan ${loanId} auction failed → cancelled`, { tx: r.hash });
    }
  } else if (status === 3 && loan.status === "AUCTION") updateLoan(ctx.db, loanId, { status: "ACTIVE" }); // disbursed by someone else
  else if (status === 5 && loan.status !== "CANCELLED") updateLoan(ctx.db, loanId, { status: "CANCELLED" });
  if (status < 3) return;
  const claimed = await deskExitAndClaim(ctx, loanId);
  if (status === 5) { if (claimed) kvSet(ctx, doneKey(loanId), "1"); return; } // failed auction: refunds only, no notes
  if (claimed && (await redeemDeskNotes(ctx, loanId, status)) && status === 4) kvSet(ctx, doneKey(loanId), "1");
}
const doneKey = (loanId: number) => `cca:desk-done:${loanId}`;

/** Desk-held FeeNotes (from its anchor bid) → vault.redeem 1:1 for the USDC repayment already in the vault.
 *  Returns true when the desk holds no notes anymore. */
async function redeemDeskNotes(ctx: Ctx, loanId: number, status: number): Promise<boolean> {
  const loan = getLoan(ctx.db, loanId)!;
  const w = await ctx.wallet();
  const note = loan.note ?? (await readV<Address>(ctx, loan.vault!, "note"));
  const [held, usdc] = await Promise.all([
    ctx.pub.readContract({ address: note, abi: erc20Abi, functionName: "balanceOf", args: [w.address] }),
    ctx.pub.readContract({ address: ADDR.USDC, abi: erc20Abi, functionName: "balanceOf", args: [loan.vault!] }),
  ]);
  const amt = held < usdc ? held : usdc;
  if (amt > 0n && (status === 3 || status === 4)) {
    const r = await w.write({ address: loan.vault!, abi: vaultAbi, functionName: "redeem", args: [amt] });
    addEvent(ctx.db, loanId, "desk_paid", r.hash, { source: "feenote_redeem", notesRaw: amt.toString(), usdcRaw: amt.toString(), by: w.address });
    ctx.log("cca", `loan ${loanId}: desk redeemed ${amt} FeeNotes`, { tx: r.hash });
  }
  return held - amt === 0n;
}

/** Returns true once every desk bid is exited and claimed. */
async function deskExitAndClaim(ctx: Ctx, loanId: number): Promise<boolean> {
  const key = `cca:desk-settled:${loanId}`;
  if (kvGet(ctx, key)) return true;
  const loan = getLoan(ctx.db, loanId)!;
  const w = await ctx.wallet();
  const mine = (await readBids(ctx, loan.auction!)).filter((b) => lc(b.owner) === lc(w.address));
  let pending = false;
  for (const b of mine) {
    if (b.exitedBlock !== 0n && b.tokensFilled === 0n) continue; // exited and claimed (or nothing filled)
    try {
      const plan = await exitPlan(ctx, loan, { bidId: b.id.toString() });
      for (const t of plan.txs) {
        const s = await w.send({ to: t.to, data: t.data });
        addEvent(ctx.db, loanId, "bid", s.hash, { action: `desk_${t.label}`, bidId: b.id.toString() });
      }
    } catch (e) {
      if (!(e instanceof HTTPException && e.status === 409)) throw e;
      pending = true; // e.g. claim block not reached
    }
  }
  if (!pending) kvSet(ctx, key, "1");
  return !pending;
}

// ─── routes + loop ───
export function register(app: Hono, ctx: Ctx) {
  const loanOf = (id: string) => getLoan(ctx.db, posInt(id, "loan id"));
  app.get("/api/loans/:id/auction", async (c) => c.json(await auctionState(ctx, loanOf(c.req.param("id"))!)));
  app.post("/api/loans/:id/auction/bid-plan", async (c) => c.json(await bidPlan(ctx, loanOf(c.req.param("id"))!, await jsonBody<BidPlanRequest>(c))));
  app.post("/api/loans/:id/auction/exit-plan", async (c) => c.json(await exitPlan(ctx, loanOf(c.req.param("id"))!, await jsonBody<ExitPlanRequest>(c))));
}

export function start(ctx: Ctx): () => void {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const ids = (["AUCTION", "ACTIVE", "RELEASED", "CANCELLED"] as const).flatMap((status) => listLoans(ctx.db, { status }))
        .filter((l) => l.auction && (l.status === "AUCTION" || !kvGet(ctx, doneKey(l.id))))
        .map((l) => l.id);
      for (const id of ids) {
        try { await settleOnce(ctx, id); } catch (e) { ctx.log("cca", `settle loan ${id} failed: ${(e as Error).message}`); }
      }
    } finally { busy = false; }
  };
  const t = setInterval(tick, Number(opt("CCA_WATCH_SEC", "15")) * 1000);
  return () => clearInterval(t);
}

