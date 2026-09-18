// DEMO_FORK ONLY: act as the real test-pool beneficiary (GITLAWB, TEST_POOL) on an Anvil fork of Base.
// That beneficiary is an EIP-7702 account whose key we don't hold, so `setup` re-points its 7702 delegation to
// contracts/src/demo/ForkDelegate.sol (ERC-1271: accepts signatures from DEMO_BORROWER_KEY). The agent's normal
// verifySigner (ERC-1271 path) then checks a real signature — no server bypass. Refuses to run on a non-Anvil node.
//   node --env-file-if-exists=../.env src/demo/fork-borrower.ts setup
//   node --env-file-if-exists=../.env src/demo/fork-borrower.ts apply            → prints loan id + decision
//   node --env-file-if-exists=../.env src/demo/fork-borrower.ts pledge <loanId>  → impersonated updateBeneficiary + POST /pledge
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, type Abi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { TEST_POOL, applyMessage, type Address, type TxRequest } from "@feedesk/shared";

const rpcUrl = process.env.FORK_RPC_URL || "http://127.0.0.1:8545";
const agent = process.env.NEXT_PUBLIC_AGENT_URL || `http://localhost:${process.env.AGENT_PORT || 8787}`;
// ponytail: default is Anvil dev key #0 (public, fork-only). Set DEMO_BORROWER_KEY to use another.
const signer = privateKeyToAccount((process.env.DEMO_BORROWER_KEY || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80") as Hex);
const pub = createPublicClient({ chain: base, transport: http(rpcUrl) });
const rpc = (method: string, params: unknown[]) => pub.request({ method, params } as never) as Promise<unknown>;
const who = TEST_POOL.beneficiary as Address;

await rpc("anvil_nodeInfo", []).catch(() => { throw new Error(`${rpcUrl} is not an Anvil node: fork-borrower is DEMO_FORK only`); });

async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(agent + path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status}: ${JSON.stringify(j)}`);
  return j as T;
}

const cmd = process.argv[2];
if (cmd === "setup") {
  const art = JSON.parse(readFileSync(new URL("../../../contracts/out/ForkDelegate.sol/ForkDelegate.json", import.meta.url), "utf8")) as { abi: Abi; bytecode: { object: Hex } };
  const wc = createWalletClient({ chain: base, transport: http(rpcUrl), account: signer });
  await rpc("anvil_setBalance", [signer.address, "0x8AC7230489E80000"]);
  const hash = await wc.deployContract({ abi: art.abi, bytecode: art.bytecode.object, args: [signer.address] });
  const { contractAddress } = await pub.waitForTransactionReceipt({ hash });
  await rpc("anvil_setCode", [who, `0xef0100${contractAddress!.slice(2)}`]);
  await rpc("anvil_setBalance", [who, "0x8AC7230489E80000"]); // gas for the impersonated pledge tx
  const msg = "fork-borrower self-check";
  const ok = await pub.verifyMessage({ address: who, message: msg, signature: await signer.signMessage({ message: msg }) });
  if (!ok) throw new Error("ERC-1271 self-check failed: fork does not execute the 7702 delegation");
  console.log(`ok: ${who} now accepts personal_sign from ${signer.address} on this fork (delegate ${contractAddress})`);
} else if (cmd === "apply") {
  const nonce = `fork-${Date.now()}`;
  const token = TEST_POOL.token as Address;
  const signature = await signer.signMessage({ message: applyMessage(token, who, who, nonce) });
  const loan = await api<{ id: number; status: string; vault?: string }>("/api/loans", { token, borrower: who, nonce, signature, via: "web" });
  console.log(JSON.stringify(loan, null, 2));
} else if (cmd === "pledge") {
  const id = Number(process.argv[3]);
  const tx = await api<TxRequest>(`/api/loans/${id}/pledge-tx`);
  await rpc("anvil_impersonateAccount", [who]);
  const txHash = (await rpc("eth_sendTransaction", [{ from: who, to: tx.to, data: tx.data, value: "0x0" }])) as Hex;
  await rpc("anvil_stopImpersonatingAccount", [who]);
  const r = await pub.waitForTransactionReceipt({ hash: txHash });
  if (r.status !== "success") throw new Error(`pledge tx ${txHash} reverted`);
  console.log(`pledge tx ${txHash}`, JSON.stringify(await api(`/api/loans/${id}/pledge`, { txHash }), null, 2));
} else {
  console.error("usage: fork-borrower.ts setup | apply | pledge <loanId>");
  process.exit(1);
}
