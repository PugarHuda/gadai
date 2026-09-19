// One-off Base MAINNET actions signed by the Dynamic agent wallet (Linux/WSL only):
//   1. deploy FeeDesk(keeper = agent wallet, treasury = DESK_TREASURY_MAINNET, maxOracleAge = 3600)
//   2. register the desk as an ERC-8004 agent (agentURI = AGENT_PUBLIC_URL agent card)
// Usage: node --env-file=../.env src/demo/mainnet-deploy.ts <path to contracts/out/FeeDesk.sol/FeeDesk.json> [--skip-deploy]
// Refuses to spend more than MAX_SPEND_ETH (default 0.0002) per tx.
import { readFileSync } from "node:fs";
import { type Abi, createPublicClient, encodeDeployData, encodeFunctionData, formatEther, http, parseEther, type Address, type Hex } from "viem";
import { base } from "viem/chains";
import { need, opt } from "../ctx.ts";
import { readWalletSecrets, signInAgent, withBuilderCode } from "../wallet/index.ts";
import { IDENTITY_REGISTRY, cardUrl, identityAbi } from "../erc8004/index.ts";

const rpcUrl = opt("BASE_RPC_URL", "https://base-rpc.publicnode.com");
const pub = createPublicClient({ chain: base, transport: http(rpcUrl) });
const maxSpend = parseEther(opt("MAX_SPEND_ETH", "0.0002"));
const artifact = JSON.parse(readFileSync(process.argv[2]!, "utf8")) as { abi: Abi; bytecode: { object: Hex } };

const s = await signInAgent();
const wc = await s.client.getWalletClient({ ...readWalletSecrets(), chain: base, rpcUrl });
const me = wc.account.address as Address;
if (me.toLowerCase() !== need("AGENT_WALLET_ADDRESS").toLowerCase()) throw new Error(`wallet ${me} != AGENT_WALLET_ADDRESS`);
console.log(`agent wallet ${me}: ${formatEther(await pub.getBalance({ address: me }))} ETH on Base mainnet`);

async function send(label: string, tx: { to?: Address; data: Hex; value?: bigint }) {
  const gas = await pub.estimateGas({ account: me, ...tx });
  const fees = await pub.estimateFeesPerGas();
  const cost = gas * fees.maxFeePerGas;
  console.log(`${label}: gas ${gas}, max cost ${formatEther(cost)} ETH`);
  if (cost > maxSpend) throw new Error(`${label} would cost up to ${formatEther(cost)} ETH > MAX_SPEND_ETH`);
  const hash = await wc.sendTransaction({ ...tx, gas: (gas * 12n) / 10n, account: wc.account, chain: base });
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (r.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  console.log(`${label}: https://basescan.org/tx/${hash}`);
  return r;
}

// Optional: --swap-eth=0.00015 swaps native ETH -> USDC through the Uniswap Trading API (no approval needed for native input).
const swapArg = process.argv.find((a) => a.startsWith("--swap-eth="));
if (swapArg) {
  const amount = parseEther(swapArg.split("=")[1]!).toString();
  const H = { "content-type": "application/json", "x-api-key": need("UNISWAP_API_KEY"), "x-universal-router-version": opt("UNISWAP_UR_VERSION", "2.0") };
  const post = async (path: string, body: unknown) => {
    const r = await fetch(`https://trade-api.gateway.uniswap.org/v1${path}`, { method: "POST", headers: H, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(`uniswap ${path} ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
    return j as any;
  };
  const q = await post("/quote", { type: "EXACT_INPUT", amount, tokenIn: "0x0000000000000000000000000000000000000000", tokenOut: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", tokenInChainId: 8453, tokenOutChainId: 8453, swapper: me, routingPreference: "BEST_PRICE", protocols: ["V2", "V3", "V4"] });
  console.log(`uniswap quote: ${swapArg.split("=")[1]} ETH -> ${Number(q.quote.output.amount) / 1e6} USDC (routing ${q.routing}, impact ${q.quote.priceImpact}%)`);
  if (q.routing !== "CLASSIC") throw new Error(`unexpected routing ${q.routing}`);
  const { swap } = await post("/swap", { quote: q.quote });
  await send("uniswap swap ETH->USDC", { to: swap.to, data: withBuilderCode(swap.data), value: BigInt(swap.value) });
}
if (process.argv.includes("--swap-only")) process.exit(0);

let desk = process.env.FEE_DESK_ADDRESS as Address | undefined;
if (!process.argv.includes("--skip-deploy")) {
  const treasury = need("DESK_TREASURY_MAINNET") as Address;
  const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: [me, treasury, 3600n] });
  const r = await send("deploy FeeDesk", { data });
  desk = r.contractAddress as Address;
  console.log(`FEE_DESK_ADDRESS=${desk}  (https://basescan.org/address/${desk})`);
}

const uri = cardUrl(need("AGENT_PUBLIC_URL"));
const reg = await send("ERC-8004 register", { to: IDENTITY_REGISTRY, data: withBuilderCode(encodeFunctionData({ abi: identityAbi, functionName: "register", args: [uri] })) });
const log = reg.logs.find((l) => l.address.toLowerCase() === IDENTITY_REGISTRY.toLowerCase() && l.topics.length === 4);
console.log(`ERC8004_DESK_AGENT_ID_MAINNET=${log ? BigInt(log.topics[3]!) : "see tx logs"}  agentURI=${uri}`);
console.log(`remaining: ${formatEther(await pub.getBalance({ address: me }))} ETH`);
