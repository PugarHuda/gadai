// Keeper e2e on an Anvil fork of Base against the real GITLAWB pool (TEST_POOL) and the compiled contracts.
//   anvil --fork-url https://base-rpc.publicnode.com --chain-id 8453 --port 8546
//   (cd contracts && forge build)
//   FORK_E2E_RPC=http://127.0.0.1:8546 node --test src/keeper/keeper.fork.test.ts
// The desk signer here is an Anvil dev key standing in for the Dynamic wallet (MPC can't run on a test box without
// Dynamic credentials); everything else is the production keeper + cca code path, on the real FeesManager and CCA factory:
// stale-vault cancel → createLoan → pledge (impersonated) → keeper confirmPledge + CCA launch + desk anchor bid →
// collect real pool fees → settle/disburse → Active tick → repay → keeper release (fee rights back to the borrower).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseAbi, type Abi, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { ADDR, ERC20_ABI, FEES_MANAGER_ABI, TEST_POOL, type Address, type Hex, type Memo, type Terms } from "@feedesk/shared";
import type { AgentWallet, Ctx } from "../ctx.ts";
import { getLoan, insertLoan, listEvents, openDb } from "../db/index.ts";
import { fundOnFork } from "../wallet/index.ts";
import { createLoanOnchain, readDebt, runKeeperOnce } from "./index.ts";

const RPC = process.env.FORK_E2E_RPC;
const ANVIL_KEY0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // public Anvil dev key

test("keeper on Base fork: full loan lifecycle driven by the keeper", { skip: !RPC && "set FORK_E2E_RPC to an Anvil Base fork" }, async (t) => {
  const pub = createPublicClient({ chain: base, transport: http(RPC) }) as PublicClient;
  const account = privateKeyToAccount(ANVIL_KEY0);
  const wc = createWalletClient({ account, chain: base, transport: http(RPC) });
  const rpc = (method: string, params: unknown[]) => pub.request({ method, params } as never);
  const snap = await rpc("evm_snapshot", []); // leave the fork as we found it (rerunnable)
  t.after(() => rpc("evm_revert", [snap]));
  await rpc("anvil_setBalance", [account.address, "0x8AC7230489E80000"]);

  const art = JSON.parse(readFileSync(new URL("../../../contracts/out/FeeDesk.sol/FeeDesk.json", import.meta.url), "utf8"));
  const deployHash = await wc.deployContract({ abi: art.abi, bytecode: art.bytecode.object, args: [account.address, account.address] });
  const desk = (await pub.waitForTransactionReceipt({ hash: deployHash })).contractAddress as Address;

  const wallet: AgentWallet = {
    address: account.address,
    walletClient: wc,
    async write({ address, abi, functionName, args = [], value }) {
      const a = (typeof abi[0] === "string" ? parseAbi(abi as string[]) : abi) as Abi;
      const { request } = await pub.simulateContract({ account, address, abi: a, functionName, args, value });
      const hash = await wc.writeContract(request as never);
      const receipt = await pub.waitForTransactionReceipt({ hash });
      assert.equal(receipt.status, "success");
      return { hash, receipt };
    },
    async send({ to, data, value }) {
      const hash = await wc.sendTransaction({ to, data, value });
      return { hash, receipt: await pub.waitForTransactionReceipt({ hash }) };
    },
    signTypedData: async () => { throw new Error("unused"); },
    signMessage: (m) => wc.signMessage({ message: m }),
  };
  const ctx: Ctx = {
    db: openDb(":memory:"), pub, rpcUrl: RPC!, demoFork: true, deskAddress: desk, publicUrl: "http://x", webUrl: "http://x",
    wallet: async () => wallet, log: () => {},
  };

  // $10 principal, face 11.2, floor 0.90 on the CCA cent grid (0.90·11.2 ≥ 10), lead persona bids 0.95.
  const terms = { principalRaw: "10000000", faceValueRaw: "11200000", drawLimitRaw: "1000000", floorPrice: 0.9 } as Terms;
  const leadMemo = { personaId: "prudent", model: "test", decision: "approve", principalRaw: "10000000", maxNotePrice: 0.95, confidence: 0.8, rationale: "", risks: [] } as Memo;
  const args = { borrower: TEST_POOL.beneficiary as Address, poolId: TEST_POOL.poolId as Hex, feesManager: TEST_POOL.feesManager as Address, creatorToken: TEST_POOL.token as Address, symbol: "GITLAWB", terms };
  const row = { borrower: TEST_POOL.beneficiary as Address, token: TEST_POOL.token as Address, symbol: "GITLAWB", poolId: TEST_POOL.poolId as Hex, feesManager: TEST_POOL.feesManager as Address, terms, leadMemo };
  const errorsOf = (loanId: number) => listEvents(ctx.db, loanId).filter((e) => e.kind === "error");

  // 1. Flow G: a vault the borrower never pledged is cancelled by the keeper after 24h, freeing the pool slot.
  const stale = await createLoanOnchain(ctx, args);
  const idStale = insertLoan(ctx.db, { ...row, status: "APPROVED", vault: stale.vault, note: stale.note });
  ctx.db.prepare("UPDATE loans SET created_at = ? WHERE id = ?").run(new Date(Date.now() - 25 * 3600_000).toISOString(), idStale);
  await runKeeperOnce(ctx, idStale);
  assert.equal(getLoan(ctx.db, idStale)!.status, "CANCELLED", JSON.stringify(listEvents(ctx.db, idStale)));

  // 2. Flow A: agent wallet creates the loan on-chain.
  const created = await createLoanOnchain(ctx, args);
  assert.equal(created.onchainId, 2);
  const id = insertLoan(ctx.db, { ...row, status: "APPROVED", vault: created.vault, note: created.note });

  // 3. Flow B: borrower pledges (fork impersonation, DEMO_FORK path 3) and never calls /pledge: keeper confirms + launches the CCA.
  const fm = parseAbi(FEES_MANAGER_ABI);
  const shares = (who: Address) => pub.readContract({ address: TEST_POOL.feesManager, abi: fm, functionName: "getShares", args: [TEST_POOL.poolId, who] });
  const borrowerShares = await shares(TEST_POOL.beneficiary);
  assert.ok(borrowerShares > 0n);
  await rpc("anvil_setBalance", [TEST_POOL.beneficiary, "0x8AC7230489E80000"]);
  await rpc("anvil_impersonateAccount", [TEST_POOL.beneficiary]);
  const imp = createWalletClient({ account: TEST_POOL.beneficiary as Address, chain: base, transport: http(RPC) });
  await pub.waitForTransactionReceipt({ hash: await imp.writeContract({ address: TEST_POOL.feesManager, abi: fm, functionName: "updateBeneficiary", args: [TEST_POOL.poolId, created.vault] }) });
  await rpc("anvil_stopImpersonatingAccount", [TEST_POOL.beneficiary]);
  await fundOnFork(RPC!, account.address, 50_000_000n); // desk USDC for its anchor bid (DEMO_FORK helper under test)
  process.env.AUCTION_BLOCKS = "20";
  process.env.DESK_ANCHOR_BID_PCT = "105"; // exactly 100% leaves raised a few wei short of principal after CCA rounding (see COORDINATION)
  await runKeeperOnce(ctx, id);
  assert.deepEqual(errorsOf(id), []);
  assert.equal(getLoan(ctx.db, id)!.status, "AUCTION");

  // 4. Keeper collects during the auction (claim-first: uncollected fees moved with the pledge).
  await runKeeperOnce(ctx, id);
  assert.deepEqual(errorsOf(id), []);
  const collected = listEvents(ctx.db, id).find((e) => e.kind === "collected");
  console.log("collected:", JSON.stringify(collected?.data ?? "none at this fork block"));

  // 5. Flow C/D: auction ends → cca settles → agent wallet disburse() → ACTIVE.
  const auction = getLoan(ctx.db, id)!.auction!;
  const endBlock = await pub.readContract({ address: auction, abi: parseAbi(["function endBlock() view returns (uint64)"]), functionName: "endBlock" });
  const head = await pub.getBlockNumber({ cacheTime: 0 });
  if (endBlock > head) await rpc("anvil_mine", [`0x${(endBlock - head).toString(16)}`]);
  const { settleOnce } = await import("../cca/index.ts");
  await settleOnce(ctx, id);
  assert.equal(getLoan(ctx.db, id)!.status, "ACTIVE", JSON.stringify(listEvents(ctx.db, id)));

  // 6. Flow E: keeper tick while Active. Without UNISWAP_API_KEY the WETH swap must fail loudly (no fake swap).
  await runKeeperOnce(ctx, id);
  const d1 = await readDebt(ctx, created.vault);
  console.log("debt while active:", JSON.stringify(d1));
  const swapped = listEvents(ctx.db, id).find((e) => e.kind === "swapped")?.data as Record<string, string> | undefined;
  if (process.env.UNISWAP_API_KEY) {
    // Real Trading API swap with the vault as swapper: sized to the debt (not the whole WETH balance), floor respected.
    assert.ok(swapped, JSON.stringify(errorsOf(id)));
    assert.ok(BigInt(swapped.usdcOutRaw) >= BigInt(swapped.minOutRaw));
    assert.ok(BigInt(swapped.wethInRaw) < BigInt(swapped.wethHeldRaw), "must not sell the whole WETH balance for a small debt");
    console.log("swapped:", JSON.stringify(swapped));
  } else if (BigInt(d1.wethInVaultRaw) >= 2_000_000_000_000_000n) {
    assert.match(String((errorsOf(id).at(-1)?.data as { error?: string })?.error), /Missing env UNISWAP_API_KEY/);
  }
  if (!swapped) assert.ok(BigInt(d1.noteSupplyRaw) > 0n && !d1.canRelease);

  // 7. Flow F: repayment lands in the vault (here: a direct USDC transfer = early repay) → keeper releases the lien.
  if (BigInt(d1.outstandingRaw) > 0n) await fundOnFork(RPC!, created.vault, BigInt(d1.outstandingRaw));
  await runKeeperOnce(ctx, id);
  assert.equal(getLoan(ctx.db, id)!.status, "RELEASED", JSON.stringify(listEvents(ctx.db, id)));
  assert.equal(await shares(TEST_POOL.beneficiary), borrowerShares, "fee rights back with the borrower");
  assert.equal(await shares(created.vault), 0n);
  const d2 = await readDebt(ctx, created.vault);
  assert.equal(d2.usdcInVaultRaw, d2.noteSupplyRaw); // exactly the noteholders' redemption USDC stays behind
  console.log("after release:", JSON.stringify(d2), "events:", listEvents(ctx.db, id).map((e) => e.kind === "error" ? `error(${(e.data as { step: string }).step})` : e.kind).join(","));
  assert.ok(errorsOf(id).every((e) => (e.data as { step: string }).step === "swap"), "only the key-less Uniswap swap may fail");
});
