// DEMO_FORK ONLY: exercise ERC-8004 + ERC-8021 end to end with the real Dynamic agent wallet on an Anvil fork of Base.
//   1. desk registers (or reuses) its ERC-8004 agent  → register tx
//   2. desk writes a loan outcome as its own metadata  → setMetadata tx, read back + decoded
//   3. a borrower agent (fresh EOA) registers; desk gives it "repaid" feedback → giveFeedback tx, getSummary
//   4. self-feedback by the desk is refused by the registry (simulated only)
//   5. every desk tx's calldata ends with the ERC-8021 builder-code suffix
// Linux/macOS (Dynamic MPC SDK): node --env-file=../.env src/demo/erc8004-check.ts   (FORK_RPC_URL = Anvil)
import { createPublicClient, createWalletClient, http, keccak256, toHex, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import type { Address, Hex } from "@feedesk/shared";
import { need, opt, type AgentWallet, type Ctx } from "../ctx.ts";
import { openDb } from "../db/index.ts";
import { builderSuffix, getAgentWallet } from "../wallet/index.ts";
import { IDENTITY_REGISTRY, REPUTATION_REGISTRY, TAG, borrowerReputation, decodeLoanOutcome, encodeLoanOutcome, ensureDeskIdentity, identityAbi, reputationAbi } from "../erc8004/index.ts";

const rpcUrl = opt("FORK_RPC_URL", "http://127.0.0.1:8545");
const pub = createPublicClient({ chain: base, transport: http(rpcUrl) }) as PublicClient;
await pub.request({ method: "anvil_nodeInfo", params: [] } as never).catch(() => { throw new Error(`${rpcUrl} is not Anvil: erc8004-check is DEMO_FORK only`); });

let walletP: Promise<AgentWallet> | undefined;
const ctx: Ctx = {
  db: openDb(":memory:"), pub, rpcUrl, demoFork: true,
  deskAddress: need("FORK_FEE_DESK_ADDRESS") as Address,
  publicUrl: need("AGENT_PUBLIC_URL"), webUrl: opt("WEB_URL", "http://localhost:3000"),
  wallet: () => (walletP ??= getAgentWallet(ctx)),
  log: (m, msg, d) => console.log(`[${m}] ${msg}`, d === undefined ? "" : JSON.stringify(d)),
};
const w = await ctx.wallet();
const suffix = builderSuffix();
const txs: Record<string, Hex> = {};
const checkSuffix = async (label: string, hash: Hex) => {
  txs[label] = hash;
  const tx = await pub.getTransaction({ hash });
  const ok = !!suffix && tx.input.toLowerCase().endsWith(suffix.slice(2).toLowerCase());
  console.log(`${label}: ${hash}  ERC-8021 suffix ${ok ? "present" : "MISSING"}`);
  if (!ok) throw new Error(`${label}: calldata has no builder-code suffix (BASE_BUILDER_CODE=${process.env.BASE_BUILDER_CODE ?? ""})`);
};

// 1. desk identity
const deskId = await ensureDeskIdentity(ctx);
const regTx = ctx.db.prepare("SELECT value FROM kv WHERE key = 'erc8004.deskRegisterTx'").get() as { value: Hex } | undefined;
if (regTx) await checkSuffix("register", regTx.value);
console.log(`desk agent #${deskId} owner=${await pub.readContract({ address: IDENTITY_REGISTRY, abi: identityAbi, functionName: "ownerOf", args: [deskId] })} uri=${await pub.readContract({ address: IDENTITY_REGISTRY, abi: identityAbi, functionName: "tokenURI", args: [deskId] })}`);

// 2. desk self-publication: loan outcome as metadata (owner-only write)
const outcome = { status: "RELEASED", principalRaw: 10_000_000n, repaidRaw: 10_500_000n, txs: regTx ? [regTx.value] : [] };
const key = "gadai.loan.check";
const md = await w.write({ address: IDENTITY_REGISTRY, abi: identityAbi, functionName: "setMetadata", args: [deskId, key, encodeLoanOutcome(outcome)] });
await checkSuffix("setMetadata", md.hash);
const back = decodeLoanOutcome(await pub.readContract({ address: IDENTITY_REGISTRY, abi: identityAbi, functionName: "getMetadata", args: [deskId, key] }));
console.log(`getMetadata(${deskId}, ${key}) →`, JSON.stringify(back, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

// 3. borrower agent (fresh throwaway EOA: the Anvil dev keys carry 7702 sweeper code on Base, which rejects the ERC-721 mint) + desk feedback
const borrower = privateKeyToAccount(generatePrivateKey());
await pub.request({ method: "anvil_setBalance", params: [borrower.address, "0xDE0B6B3A7640000"] } as never);
const bwc = createWalletClient({ chain: base, transport: http(rpcUrl), account: borrower });
const { result: borrowerId, request } = await pub.simulateContract({ account: borrower, address: IDENTITY_REGISTRY, abi: identityAbi, functionName: "register", args: ["https://example.invalid/borrower-agent.json"] });
await pub.waitForTransactionReceipt({ hash: await bwc.writeContract(request) });
console.log(`borrower agent #${borrowerId} (owner ${borrower.address})`);
const before = await borrowerReputation(ctx, borrowerId, w.address);
const memo = JSON.stringify({ check: "erc8004-check", loan: "demo" });
const fb = await w.write({
  address: REPUTATION_REGISTRY, abi: reputationAbi, functionName: "giveFeedback",
  args: [borrowerId, 100n, 0, TAG, "repaid", `${ctx.publicUrl}/api/loans/0`, `${ctx.webUrl}/loans/0#memos`, keccak256(toHex(memo))],
});
await checkSuffix("giveFeedback", fb.hash);
const after = await borrowerReputation(ctx, borrowerId, w.address);
console.log(`getSummary(#${borrowerId}, [desk], "${TAG}", "") before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
if (after.count !== before.count + 1) throw new Error("feedback count did not increase");

// 4. self-feedback is refused
const self = await pub.simulateContract({ account: w.address, address: REPUTATION_REGISTRY, abi: reputationAbi, functionName: "giveFeedback", args: [deskId, 100n, 0, TAG, "self", "", "", `0x${"00".repeat(32)}`] })
  .then(() => "ALLOWED?!", (e: Error) => e.message.split("\n").find((l) => l.includes("Self-feedback")) ?? e.message.split("\n")[0]);
console.log(`desk self-feedback → ${self}`);

console.log("\nOK", JSON.stringify({ deskAgentId: deskId.toString(), borrowerAgentId: borrowerId.toString(), builderSuffix: suffix, txs }));
process.exit(0);
