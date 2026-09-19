// One-time Dynamic agent-wallet setup + smoke test. Run on Linux (Docker/WSL):
//   pnpm --filter @feedesk/agent bootstrap:dynamic                 # step 1: identity, step 2: wallet, then self-test
//   pnpm --filter @feedesk/agent bootstrap:dynamic --fund-fork 1000 # DEMO_FORK: 10 ETH + 1000 USDC on Anvil, then a signed tx
// Prints KEY=value lines to paste into .env. Never rotate AGENT_SIGNING_TOKEN: a new token is a new Dynamic user.
import { createPublicClient, http, verifyMessage } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { base } from "viem/chains";
import { need, opt } from "../ctx.ts";
import { fundOnFork, loadSdk, readWalletSecrets, signInAgent } from "./index.ts";

const out = (k: string, v: string) => console.log(`${k}=${v}`);

// Step 1: agent identity (signing token + P-256 session key). Generated locally, nothing sent anywhere.
if (!process.env.AGENT_SIGNING_TOKEN || !process.env.DYNAMIC_SESSION_KEY_JWK || !process.env.DYNAMIC_SESSION_PUBLIC_KEY_HEX) {
  const { publicKeyHex, privateKeyJwk } = await (await loadSdk()).node.generateSessionKeyPair();
  console.log("# Step 1 done. Add to .env, set DYNAMIC_ENVIRONMENT_ID / DYNAMIC_APP_ORIGIN / DYNAMIC_WALLET_PASSWORD, rerun:");
  out("AGENT_SIGNING_TOKEN", process.env.AGENT_SIGNING_TOKEN || generatePrivateKey());
  out("DYNAMIC_SESSION_KEY_JWK", JSON.stringify(privateKeyJwk));
  out("DYNAMIC_SESSION_PUBLIC_KEY_HEX", publicKeyHex);
  process.exit(0);
}

const s = await signInAgent();
console.log(`# signed in to Dynamic as agent ${s.agentAddress}`);

// Step 2: create the MPC wallet exactly once.
if (!process.env.DYNAMIC_AGENT_WALLET_METADATA) {
  const r = await s.client.createWalletAccount({
    thresholdSignatureScheme: s.sdk.node.ThresholdSignatureScheme.TWO_OF_TWO,
    password: need("DYNAMIC_WALLET_PASSWORD"),
    backUpToDynamic: true,
  });
  console.log("# Step 2 done. Add to .env (KEY_SHARES is SECRET), then rerun for the self-test:");
  out("DYNAMIC_AGENT_WALLET_METADATA", JSON.stringify(r.walletMetadata));
  out("DYNAMIC_AGENT_KEY_SHARES", JSON.stringify(r.externalServerKeyShares));
  out("AGENT_WALLET_ADDRESS", r.walletMetadata.accountAddress);
  process.exit(0);
}

// Step 3: self-test. MPC signature must recover to the wallet address.
const demoFork = process.env.DEMO_FORK === "1";
const rpcUrl = demoFork ? opt("FORK_RPC_URL", "http://127.0.0.1:8545") : opt("BASE_RPC_URL", "https://base-rpc.publicnode.com");
const wc = await s.client.getWalletClient({ ...readWalletSecrets(), chain: base, rpcUrl });
const address = wc.account.address;
const msg = `Gadai agent self-test ${new Date().toISOString()}`;
const sig = await wc.signMessage({ account: wc.account, message: msg });
if (!(await verifyMessage({ address, message: msg, signature: sig }))) throw new Error("MPC signature does not recover to the wallet address");
console.log(`# MPC signMessage OK for ${address}`);
out("AGENT_WALLET_ADDRESS", address);

const i = process.argv.indexOf("--fund-fork");
if (i > 0) {
  if (!demoFork) throw new Error("--fund-fork needs DEMO_FORK=1 (Anvil cheatcodes only)");
  const usdc = BigInt(Math.round(Number(process.argv[i + 1] ?? "1000") * 1e6));
  await fundOnFork(rpcUrl, address, usdc);
  // Proves the COORDINATION day-1 check: Dynamic MPC-signed tx broadcast + mined on the Anvil fork.
  const hash = await wc.sendTransaction({ account: wc.account, chain: base, to: address, value: 0n });
  const r = await createPublicClient({ chain: base, transport: http(rpcUrl) }).waitForTransactionReceipt({ hash });
  console.log(`# fork funded (10 ETH, ${Number(usdc) / 1e6} USDC); MPC-signed self tx ${hash} status=${r.status}`);
}
process.exit(0);
