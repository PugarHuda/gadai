// End-to-end check of the cca module against the REAL FeeDesk/FeeVault (contracts/out) + REAL CCA v2.1.0 factory + REAL
// Doppler FeesManager test pool, on an Anvil fork of Base. Exercises launchAuction (concurrently, to prove one anchor bid),
// bidPlan for a lender, settleOnce (checkpoint + disburse), desk exitPlan/claim, desk FeeNote redeem.
// Run: anvil --fork-url https://base-rpc.publicnode.com --chain-id 8453 --port 8546
//      FORK_RPC_URL=http://127.0.0.1:8546 [DESK_ONLY=1] node src/cca/fork-check.ts   (fresh anvil per run; needs `forge build` artifacts)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, encodeFunctionData, http, keccak256, parseAbi, toHex, type Abi, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { ADDR, CCA_AUCTION_ABI, ERC20_ABI, FEES_MANAGER_ABI, FEE_VAULT_ABI, type Address, type Hex } from "@feedesk/shared";
import type { AgentWallet, Ctx } from "../ctx.ts";
import { getLoan, insertLoan, listEvents, openDb } from "../db/index.ts";
import { bidPlan, launchAuction, settleOnce } from "./index.ts";

process.env.AUCTION_BLOCKS = "20";
process.env.AUCTION_CLAIM_DELAY_BLOCKS = "0";
const DESK_ONLY = process.env.DESK_ONLY === "1"; // desk anchor is the only bid: must still graduate at the default DESK_ANCHOR_BID_PCT
delete process.env.DESK_ANCHOR_BID_PCT;
const rpc = process.env.FORK_RPC_URL ?? "http://127.0.0.1:8546";
const pub = createPublicClient({ chain: base, transport: http(rpc) }) as PublicClient;
const call = (method: string, params: unknown[]) => (pub.request as any)({ method, params });
await call("anvil_nodeInfo", []); // refuse to run against a non-Anvil node
const art = (f: string) => JSON.parse(readFileSync(new URL(`../../../contracts/out/${f}`, import.meta.url), "utf8")) as { abi: Abi; bytecode: { object: Hex } };

const FM = "0xD59cE43E53D69F190E15d9822Fb4540dCcc91178" as Address;
const POOL = "0xec33256bf1ded407a57fd3c1965e7556e42ac14db09bc4e6fef57d5e2eb0b0b9" as Hex;
const BORROWER = "0xfdb6430011f6E4796Ca380CB39e47975b1f876Bf" as Address;
const TOKEN = "0x5F980Dcfc4c0fa3911554cf5ab288ed0eb13DBa3" as Address; // GITLAWB (creator token of the test pool)
const P = 100_000_000n, FACE = 110_000_000n;
const [deskKey, lenderKey, treasuryKey] = ["desk", "lender", "treasury"].map((n) => keccak256(toHex(`gadai-fork-e2e-${n}`))); // fork-only keys
const deskWc = createWalletClient({ account: privateKeyToAccount(deskKey!), chain: base, transport: http(rpc) });
const lenderWc = createWalletClient({ account: privateKeyToAccount(lenderKey!), chain: base, transport: http(rpc) });
const treasury = privateKeyToAccount(treasuryKey!).address;
const erc20 = parseAbi(ERC20_ABI), vaultAbi = parseAbi(FEE_VAULT_ABI), auctionAbi = parseAbi(CCA_AUCTION_ABI);
const bal = (token: Address, who: Address) => pub.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [who] });
const deal = (to: Address, raw: bigint) => call("anvil_dealERC20", [to, ADDR.USDC, toHex(raw)]);
for (const a of [deskWc.account.address, lenderWc.account.address, BORROWER]) await call("anvil_setBalance", [a, "0x56bc75e2d63100000"]);

// same contract as the Dynamic wallet: simulate → send → receipt, throw on revert
const wait = async (hash: Hex) => {
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`tx ${hash} reverted`);
  return { hash, receipt };
};
let deskTxs = 0;
const wallet: AgentWallet = {
  address: deskWc.account.address, walletClient: deskWc,
  write: async ({ address, abi, functionName, args = [], value }) => {
    const { request } = await pub.simulateContract({ account: deskWc.account, address, abi: abi as Abi, functionName, args, value });
    deskTxs++;
    return wait(await deskWc.writeContract(request as never));
  },
  send: async ({ to, data, value }) => (deskTxs++, wait(await deskWc.sendTransaction({ to, data, value, account: deskWc.account, chain: base }))),
  signTypedData: () => { throw new Error("unused"); }, signMessage: () => { throw new Error("unused"); },
};
const ctx: Ctx = {
  db: openDb(":memory:"), pub, rpcUrl: rpc, demoFork: true, deskAddress: "0x0000000000000000000000000000000000000000",
  publicUrl: "", webUrl: "", wallet: async () => wallet, log: (m, msg) => console.log(`  [${m}] ${msg}`),
};

// 1. deploy FeeDesk (keeper = desk wallet), createLoan, borrower pledges via FeesManager.updateBeneficiary, confirmPledge
const deskArt = art("FeeDesk.sol/FeeDesk.json");
const depHash = await deskWc.deployContract({ abi: deskArt.abi, bytecode: deskArt.bytecode.object, args: [deskWc.account.address, treasury, 86400n], account: deskWc.account, chain: base });
const desk = (await wait(depHash)).receipt.contractAddress!;
const params = { borrower: BORROWER, poolId: POOL, feesManager: FM, creatorToken: TOKEN, principal: P, faceValue: FACE, drawLimit: 10_000_000n, noteName: "FeeNote GITLAWB #1", noteSymbol: "fnGITLAWB1", keeperTokenCustody: false };
const { result: [, vault, note], request } = await pub.simulateContract({ address: desk, abi: deskArt.abi, functionName: "createLoan", args: [params], account: deskWc.account }) as unknown as { result: [bigint, Address, Address]; request: unknown };
await wait(await deskWc.writeContract(request as never));
await call("anvil_impersonateAccount", [BORROWER]);
await wait(await call("eth_sendTransaction", [{ from: BORROWER, to: FM, data: encodeFunctionData({ abi: parseAbi(FEES_MANAGER_ABI), functionName: "updateBeneficiary", args: [POOL, vault] }) }]));
await call("anvil_stopImpersonatingAccount", [BORROWER]);
await wallet.write({ address: vault, abi: vaultAbi, functionName: "confirmPledge" });
console.log("desk", desk, "vault", vault, "pledged ✓");

const memo = { personaId: "lead", model: "x", decision: "approve" as const, principalRaw: P.toString(), maxNotePrice: 0.95, confidence: 0.8, rationale: "", risks: [] };
const terms = { principalRaw: P.toString(), faceValueRaw: FACE.toString(), feeRatePct: 10, floorPrice: 0.91, floorPriceQ96: "0", tickSpacingQ96: "0", termDays: 30, drawLimitRaw: "10000000", advanceRatePct: 50, maxPrincipalRaw: P.toString() };
const id = insertLoan(ctx.db, { status: "PLEDGED", borrower: BORROWER, token: TOKEN, symbol: "GITLAWB", poolId: POOL, feesManager: FM, vault, note, terms, leadMemo: memo });

// 2. launch: refuses without desk USDC for the anchor, then two concurrent launches + a watcher tick → exactly ONE desk bid
await assert.rejects(launchAuction(ctx, getLoan(ctx.db, id)!), /anchor bid/);
await deal(deskWc.account.address, 1_000_000_000n);
const loan = getLoan(ctx.db, id)!;
const l1 = launchAuction(ctx, loan), l2 = launchAuction(ctx, loan);
assert.equal(l1, l2, "concurrent launches share one run");
const watcher = (async () => { while (getLoan(ctx.db, id)!.status !== "AUCTION") await new Promise((r) => setTimeout(r, 20)); await settleOnce(ctx, id); })();
const [{ auction }] = await Promise.all([l1, watcher]);
await settleOnce(ctx, id); // watcher tick after launch: anchor already placed → no-op
const bidsBy = async (who: Address) => {
  const n = await pub.readContract({ address: auction, abi: auctionAbi, functionName: "nextBidId" });
  const all = await Promise.all(Array.from({ length: Number(n) }, (_, i) => pub.readContract({ address: auction, abi: auctionAbi, functionName: "bids", args: [BigInt(i)] })));
  return all.filter((b) => (b as { owner: Address }).owner.toLowerCase() === who.toLowerCase()).length;
};
assert.equal(await bidsBy(wallet.address), 1, "exactly one desk anchor bid");
console.log("auction", auction, "single anchor bid ✓");

// 3. a lender bids above the desk via bidPlan (prev-tick hint from cached bid prices)
await deal(lenderWc.account.address, 1_000_000_000n);
if (!DESK_ONLY) {
const plan = await bidPlan(ctx, getLoan(ctx.db, id)!, { bidder: lenderWc.account.address, amountRaw: "40000000", maxPrice: 0.99 });
for (const t of plan.txs) await wait(await lenderWc.sendTransaction({ to: t.to, data: t.data, account: lenderWc.account, chain: base }));
}
await assert.rejects(bidPlan(ctx, getLoan(ctx.db, id)!, { bidder: lenderWc.account.address, amountRaw: "1e9", maxPrice: 1 }), /amountRaw/);
await assert.rejects(bidPlan(ctx, getLoan(ctx.db, id)!, { bidder: lenderWc.account.address, amountRaw: "1", maxPrice: Infinity }), /maxPrice/);
console.log("lender bid ✓ (bad input → 400 ✓)");

// 4. end → settleOnce: checkpoint + disburse (borrower paid) → ACTIVE; next tick: desk exits + claims its notes
await call("anvil_mine", [toHex(25)]);
const before = await bal(ADDR.USDC, BORROWER);
await settleOnce(ctx, id);
const got = (await bal(ADDR.USDC, BORROWER)) - before;
assert.equal(getLoan(ctx.db, id)!.status, "ACTIVE");
assert.ok(got >= P, `borrower got ${got} < principal`);
const deskNotes = await bal(note, wallet.address);
assert.ok(deskNotes > 0n, "desk claimed its FeeNotes");
console.log(`disbursed ${got} to borrower ✓, desk claimed ${deskNotes} notes ✓`);

// 5. repayment USDC lands in the vault → the watcher redeems the desk's notes 1:1
await deal(vault, 30_000_000n);
const deskUsdc = await bal(ADDR.USDC, wallet.address);
await settleOnce(ctx, id);
assert.equal(await bal(note, wallet.address), deskNotes - 30_000_000n);
assert.equal((await bal(ADDR.USDC, wallet.address)) - deskUsdc, 30_000_000n);
assert.ok(listEvents(ctx.db, id).some((e) => e.kind === "desk_paid"));
const n = deskTxs;
await settleOnce(ctx, id); // vault empty now → nothing to redeem, no tx
assert.equal(deskTxs, n);
console.log("desk redeemed 30 USDC of FeeNotes ✓\nfork-check OK");
