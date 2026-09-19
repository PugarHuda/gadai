// The desk buys a real onchain equity: bridge ETH Base → Robinhood Chain (4663) with Relay, then swap ETH → TSLA
// (Robinhood tokenized stock) through the Uniswap Trading API on 4663. Both legs signed by the Dynamic agent wallet.
// Default is a DRY RUN: prints both quotes and the exact txs, sends nothing, needs no Dynamic (runs on Windows).
// Usage: node --env-file=../.env src/demo/rh-equity-swap.ts [--eth=0.0002] [--execute]   (--execute: Linux/WSL only)
// Env: AGENT_WALLET_ADDRESS, UNISWAP_API_KEY; optional BASE_RPC_URL, RH_RPC_URL, MAX_SPEND_ETH (per-tx gas cap), RH_GAS_RESERVE_ETH.
import { createPublicClient, formatEther, formatUnits, getAddress, http, parseAbi, parseEther, type Address, type Chain, type Hex, type PublicClient, type WalletClient } from "viem";
import { base, robinhood } from "viem/chains"; // robinhood = chain 4663 (viem ships it; checked eth_chainId on-chain)
import { need, opt } from "../ctx.ts";

const TSLA: Address = "0x322F0929c4625eD5bAd873c95208D54E1c003b2d"; // symbol() "TSLA", name() "Tesla • Robinhood Token", 18 dec (read on 4663, 2026-09-19)
const ETH: Address = "0x0000000000000000000000000000000000000000";
const CAP = parseEther("0.00025");
const RELAY = "https://api.relay.link";
const UNI = "https://trade-api.gateway.uniswap.org/v1";
const RH_EXPLORER = "https://robinhoodchain.blockscout.com"; // viem + chainid.network; Relay lists https://robin.etherscan.io too

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const execute = process.argv.includes("--execute");
const amount = parseEther(arg("eth") ?? "0.0002");
if (amount <= 0n || amount > CAP) throw new Error(`--eth must be in (0, ${formatEther(CAP)}]`);
const maxSpend = parseEther(opt("MAX_SPEND_ETH", "0.0002")); // per-tx gas cost cap, like mainnet-deploy.ts
// ponytail: fixed gas reserve left on 4663 for the swap tx; the Trading API quoted gasFee 0.0000189 ETH on 2026-09-19.
const reserve = parseEther(opt("RH_GAS_RESERVE_ETH", "0.00003"));

const baseRpc = opt("BASE_RPC_URL", "https://base-rpc.publicnode.com");
// The official RPC is https://rpc.mainnet.chain.robinhood.com; publicnode is the default because some ISPs hijack robinhood.com hosts.
const rhRpc = opt("RH_RPC_URL", "https://robinhood-rpc.publicnode.com");
const pubBase = createPublicClient({ chain: base, transport: http(baseRpc) });
const pubRh = createPublicClient({ chain: robinhood, transport: http(rhRpc) });
if ((await pubRh.getChainId()) !== robinhood.id) throw new Error(`${rhRpc} is not chain ${robinhood.id}`);
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function symbol() view returns (string)"]);
if ((await pubRh.readContract({ address: TSLA, abi: erc20, functionName: "symbol" })) !== "TSLA") throw new Error(`${TSLA} is not TSLA on 4663`);

let wcBase: WalletClient | undefined, wcRh: WalletClient | undefined;
const me = getAddress(need("AGENT_WALLET_ADDRESS"));
if (execute) {
  const { readWalletSecrets, signInAgent } = await import("../wallet/index.ts");
  const s = await signInAgent();
  wcBase = await s.client.getWalletClient({ ...readWalletSecrets(), chain: base, rpcUrl: baseRpc });
  wcRh = await s.client.getWalletClient({ ...readWalletSecrets(), chain: robinhood, rpcUrl: rhRpc });
  if (getAddress(wcBase.account!.address) !== me) throw new Error(`wallet ${wcBase.account!.address} != AGENT_WALLET_ADDRESS`);
}
const tsla = () => pubRh.readContract({ address: TSLA, abi: erc20, functionName: "balanceOf", args: [me] });
const [baseEth, rhEth0, tsla0] = await Promise.all([pubBase.getBalance({ address: me }), pubRh.getBalance({ address: me }), tsla()]);
console.log(`${execute ? "EXECUTE" : "DRY RUN (nothing is sent; add --execute)"}  wallet ${me}`);
console.log(`  Base ${formatEther(baseEth)} ETH | Robinhood ${formatEther(rhEth0)} ETH, ${formatUnits(tsla0, 18)} TSLA`);
if (execute && baseEth <= amount) throw new Error(`Base balance ${formatEther(baseEth)} ETH does not cover ${formatEther(amount)} + gas`);

async function json(url: string, init?: RequestInit): Promise<any> {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${url} ${r.status}: ${t.slice(0, 300)}`);
  return JSON.parse(t);
}
const uni = (path: string, body: unknown) => json(UNI + path, {
  method: "POST", body: JSON.stringify(body),
  // No x-universal-router-version: 2.0 returns no quotes on 4663 (its default there is 2.1.1, see board/index.ts).
  headers: { "x-api-key": need("UNISWAP_API_KEY"), "content-type": "application/json", accept: "application/json", "x-permit2-disabled": "true" },
});

type Tx = { to: Address; data: Hex; value: bigint };
/** Gas-capped send; raw calldata (no ERC-8021 suffix: Relay and 4663 calldata is sent exactly as quoted). */
async function send(label: string, chain: Chain, pub: PublicClient, wc: WalletClient, explorer: string, tx: Tx) {
  const gas = await pub.estimateGas({ account: me, ...tx });
  const fees = await pub.estimateFeesPerGas();
  const cost = gas * fees.maxFeePerGas;
  console.log(`${label}: gas ${gas}, max cost ${formatEther(cost)} ETH`);
  if (cost > maxSpend) throw new Error(`${label} would cost up to ${formatEther(cost)} ETH > MAX_SPEND_ETH`);
  const hash = await wc.sendTransaction({ ...tx, gas: (gas * 12n) / 10n, account: wc.account!, chain });
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (r.status !== "success") throw new Error(`${label} reverted: ${explorer}/tx/${hash}`);
  console.log(`${label}: ${explorer}/tx/${hash}`);
}

// ─── leg 1: Relay quote, Base ETH → Robinhood Chain ETH (docs.relay.link: POST /quote/v2; /quote is deprecated, same shape) ───
const chains = (await json(`${RELAY}/chains`)).chains as { id: number; solverAddresses?: string[]; contracts?: unknown; protocol?: unknown }[];
const rbase = chains.find((c) => c.id === base.id);
if (!chains.some((c) => c.id === robinhood.id)) throw new Error("Relay does not list chain 4663");
const relayTargets = new Set([...(rbase?.solverAddresses ?? []), ...JSON.stringify([rbase?.contracts, rbase?.protocol]).match(/0x[0-9a-fA-F]{40}/g) ?? []].map((a) => a.toLowerCase()));
const rq = await json(`${RELAY}/quote/v2`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ user: me, recipient: me, originChainId: base.id, destinationChainId: robinhood.id, originCurrency: ETH, destinationCurrency: ETH, amount: amount.toString(), tradeType: "EXACT_INPUT" }),
});
const out = rq.details.currencyOut;
console.log(`\nRELAY quote ${rq.steps[0]?.requestId}: ${formatEther(amount)} ETH (Base) -> ${out.amountFormatted} ETH (Robinhood), min ${formatEther(BigInt(out.minimumAmount))}, ~${rq.details.timeEstimate}s`);
console.log(`  fees: relayer ${formatEther(BigInt(rq.fees.relayer.amount))} ETH ($${rq.fees.relayer.amountUsd}), origin gas ${formatEther(BigInt(rq.fees.gas.amount))} ETH`);
const relayTxs: Tx[] = [];
for (const step of rq.steps) {
  if (step.kind !== "transaction") throw new Error(`Relay step ${step.id} is ${step.kind}, expected transaction`);
  for (const it of step.items) {
    const d = it.data;
    if (Number(d.chainId) !== base.id || getAddress(d.from) !== me || !relayTargets.has(d.to.toLowerCase()) || BigInt(d.value ?? 0) > amount)
      throw new Error(`unexpected Relay tx ${JSON.stringify(d)}`);
    relayTxs.push({ to: getAddress(d.to), data: d.data, value: BigInt(d.value ?? 0) });
    console.log(`  Base tx ${step.id}: to ${d.to} value ${formatEther(BigInt(d.value ?? 0))} ETH data ${d.data}`);
  }
}

// ─── leg 2: Uniswap Trading API on 4663, ETH → TSLA ───
async function uniLeg(amountIn: bigint, simulate: boolean) {
  if (amountIn <= 0n) throw new Error(`nothing to swap after the ${formatEther(reserve)} ETH gas reserve`);
  const q = await uni("/quote", {
    type: "EXACT_INPUT", amount: amountIn.toString(), tokenIn: ETH, tokenOut: TSLA, tokenInChainId: robinhood.id, tokenOutChainId: robinhood.id,
    swapper: me, slippageTolerance: 1, routingPreference: "BEST_PRICE", protocols: ["V2", "V3", "V4"],
  });
  if (q.routing !== "CLASSIC") throw new Error(`unexpected routing ${q.routing}`);
  const { swap } = await uni("/swap", { quote: q.quote, simulateTransaction: simulate, deadline: Math.floor(Date.now() / 1000) + 300 });
  if (Number(swap.chainId) !== robinhood.id || getAddress(swap.from) !== me || BigInt(swap.value) !== amountIn || !swap.data || swap.data === "0x")
    throw new Error(`unexpected /swap tx ${JSON.stringify(swap).slice(0, 300)}`);
  console.log(`\nUNISWAP quote (chain 4663): ${formatEther(amountIn)} ETH -> ${formatUnits(BigInt(q.quote.output.amount), 18)} TSLA (min ${formatUnits(BigInt(q.quote.output.minimumAmount ?? 0), 18)}), impact ${q.quote.priceImpact}%, gas ~$${Number(q.quote.gasFeeUSD).toFixed(4)}`);
  console.log(`  Robinhood tx swap: to ${swap.to} value ${formatEther(BigInt(swap.value))} ETH data ${swap.data}`);
  return { to: getAddress(swap.to), data: swap.data as Hex, value: BigInt(swap.value) };
}

if (!execute) {
  await uniLeg(BigInt(out.amount) - reserve, false); // sized from Relay's expected output; re-quoted on the real arrival when executing
  console.log(`\nDRY RUN done. Nothing sent. Explorers: https://basescan.org/address/${me} | ${RH_EXPLORER}/address/${me}`);
  process.exit(0);
}

for (const [i, tx] of relayTxs.entries()) await send(`relay deposit ${i + 1}/${relayTxs.length} (Base)`, base, pubBase as PublicClient, wcBase!, "https://basescan.org", tx);
const minArrive = rhEth0 + BigInt(out.minimumAmount);
let rhEth = rhEth0;
for (let t0 = Date.now(); rhEth < minArrive; ) {
  if (Date.now() - t0 > 10 * 60_000) throw new Error(`bridge not arrived after 10 min: ${RELAY}${rq.steps[0].items[0].check?.endpoint}`);
  await new Promise((r) => setTimeout(r, 5_000));
  rhEth = await pubRh.getBalance({ address: me });
  const st = await json(`${RELAY}${rq.steps[0].items[0].check.endpoint}`).catch(() => null);
  console.log(`  waiting for 4663: ${formatEther(rhEth)} ETH, relay status ${st?.status ?? "?"}${st?.txHashes?.length ? ` fill ${RH_EXPLORER}/tx/${st.txHashes[0]}` : ""}`);
}
const swapTx = await uniLeg(rhEth - rhEth0 - reserve, true);
await send("uniswap swap ETH->TSLA (Robinhood Chain)", robinhood, pubRh as PublicClient, wcRh!, RH_EXPLORER, swapTx);
const tsla1 = await tsla();
if (tsla1 <= tsla0) throw new Error("TSLA balance did not increase");
console.log(`\nDONE: +${formatUnits(tsla1 - tsla0, 18)} TSLA -> ${RH_EXPLORER}/token/${TSLA}?a=${me}  (Robinhood ETH left ${formatEther(await pubRh.getBalance({ address: me }))})`);
