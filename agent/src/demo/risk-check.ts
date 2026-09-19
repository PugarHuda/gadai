// ONE REAL PAID CALL: the desk's Dynamic agent wallet buys a honeypot/rug verdict over x402 (Bankr x402 Cloud) with real
// USDC on Base MAINNET ($0.05, EIP-3009 authorization, no gas: the facilitator settles). This is the one mainnet action,
// also when the rest of the demo runs on the Anvil fork.
//   1. unpaid probe → prints the exact 402 requirements
//   2. desk wallet USDC on Base mainnet; if < $0.05, prints how to fund and polls up to 5 min (RISK_POLL_SEC=0 to skip)
//   3. funded → Dynamic sign-in (reuses .dynamic-session.json, never loops) → paid call → verdict + settlement tx (checked on-chain)
// Linux/macOS (Dynamic MPC SDK): node --env-file=../.env src/demo/risk-check.ts [token]
import { createPublicClient, http, type PublicClient } from "viem";
import { base } from "viem/chains";
import type { Address, Hex } from "@feedesk/shared";
import { need, opt, type AgentWallet, type Ctx } from "../ctx.ts";
import { openDb } from "../db/index.ts";
import { readWalletSecrets, signInAgent } from "../wallet/index.ts";
import { buyRiskVerdict, dynamicSigner, mainnetUsdc, PRICE_RAW, requirements, RISK_URL } from "../risk/index.ts";

const token = (process.argv[2] ?? "0x5f980dcfc4c0fa3911554cf5ab288ed0eb13dba3") as Address; // a Bankr Doppler token on Base
const mainnetRpc = opt("BASE_RPC_URL", "https://base-rpc.publicnode.com");
const payer = need("AGENT_WALLET_ADDRESS") as Address;
const usd = (raw: bigint) => `$${(Number(raw) / 1e6).toFixed(6)}`;

console.log(`x402 service: ${RISK_URL}`);
const pr = await requirements();
console.log("402 Payment Required (unpaid probe, decoded PAYMENT-REQUIRED header):");
console.log(JSON.stringify(pr, null, 2));

let bal = await mainnetUsdc(payer);
console.log(`desk Dynamic wallet ${payer}: ${usd(bal)} USDC on Base mainnet (needs ${usd(PRICE_RAW)})`);
if (bal < PRICE_RAW) {
  console.log(`\nfund the desk wallet with >= 0.10 USDC on Base: send USDC (0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913, chain 8453) to ${payer}`);
  const until = Date.now() + Number(opt("RISK_POLL_SEC", "300")) * 1000;
  while (bal < PRICE_RAW && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 15_000));
    bal = await mainnetUsdc(payer).catch(() => bal);
    console.log(`  ${new Date().toISOString()} balance ${usd(bal)}`);
  }
  if (bal < PRICE_RAW) {
    console.log("\nnot funded within the polling window: NO payment made, no verdict (none is ever invented).");
    process.exit(2);
  }
}

// Funded: sign the Dynamic agent in once (saved session first) and pay from its MPC wallet. The wallet client is bound
// to Base MAINNET here; signTypedData is chain-independent anyway (domain chainId 8453, USD Coin v2).
const s = await signInAgent();
const wc = await s.client.getWalletClient({ ...readWalletSecrets(), chain: base, rpcUrl: mainnetRpc });
if (wc.account.address.toLowerCase() !== payer.toLowerCase()) throw new Error(`Dynamic wallet ${wc.account.address} != AGENT_WALLET_ADDRESS ${payer}`);
const w = {
  address: wc.account.address as Address,
  signTypedData: async (json: string) => { await s.ensureFresh(); return wc.signTypedData({ account: wc.account, ...JSON.parse(json) }) as Promise<Hex>; },
} as Pick<AgentWallet, "address" | "signTypedData">;

const pub = createPublicClient({ chain: base, transport: http(mainnetRpc) }) as PublicClient;
const ctx = {
  db: openDb(":memory:"), pub, rpcUrl: mainnetRpc, demoFork: false,
  log: (m: string, msg: string, d?: unknown) => console.log(`[${m}] ${msg}`, d === undefined ? "" : JSON.stringify(d)),
  wallet: async () => { throw new Error("unused: signer passed explicitly"); },
} as unknown as Ctx;

const r = await buyRiskVerdict(ctx, token, { force: true, deps: { signer: dynamicSigner(w) } });
console.log("\nresult:", JSON.stringify(r, null, 2));
if (!r.verdict) { console.log("NO verdict:", r.note); process.exit(1); }
const tx = r.paid?.txHash;
if (tx) {
  const rc = await pub.waitForTransactionReceipt({ hash: tx, timeout: 60_000 }).catch((e) => { console.log(`receipt not found yet: ${(e as Error).message.split("\n")[0]}`); return null; });
  if (rc) console.log(`settlement ${tx} on Base mainnet: status ${rc.status}, block ${rc.blockNumber} → https://basescan.org/tx/${tx}`);
}
console.log(`VERDICT for ${token}: ${r.verdict} (paid ${r.paid?.amountUsd} USDC from ${r.paid?.payer})`);
process.exit(0);
