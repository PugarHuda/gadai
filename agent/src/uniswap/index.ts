// Uniswap Trading API client (docs/integrations/uniswap.md §1). Two uses:
//  - ethUsd(): ETH/USD for underwriting = /quote 1 WETH → USDC.
//  - buildVaultSwap(): keeper WETH → USDC with the FeeVault itself as swapper, through the no-Permit2 SwapProxy
//    flow (`x-permit2-disabled: true`), because a contract cannot sign Permit2. The vault approves the exact
//    amount, calls SwapProxy with the /swap calldata and enforces minUsdcOut on-chain (FeeVault.swapWethToUsdc).
import { parseAbi } from "viem";
import { ADDR, API, CHAIN_ID_BASE, TEST_POOL, type Address, type Hex } from "@feedesk/shared";
import { opt, type Ctx } from "../ctx.ts";

export const SLIPPAGE_PCT = 0.5;
const PROTOCOLS = ["V2", "V3", "V4"]; // pin AMM ⇒ routing CLASSIC, no UniswapX order path

export function headers(apiKey: string, urVersion: string): Record<string, string> {
  return {
    "x-api-key": apiKey,
    "content-type": "application/json",
    accept: "application/json",
    "x-permit2-disabled": "true",
    "x-universal-router-version": urVersion, // must be identical on every call of one swap
    "x-agent-info": JSON.stringify({ decision_origin: "autonomous", integration_name: "gadai-keeper", version: "0.1.0" }),
  };
}

export const checkApprovalBody = (wallet: Address, token: Address, amount: bigint) => ({
  walletAddress: wallet, token, amount: amount.toString(), chainId: CHAIN_ID_BASE, tokenOut: ADDR.USDC, tokenOutChainId: CHAIN_ID_BASE,
});

export const quoteBody = (swapper: Address, amountIn: bigint, tokenIn: Address = ADDR.WETH, tokenOut: Address = ADDR.USDC) => ({
  type: "EXACT_INPUT",
  amount: amountIn.toString(),
  tokenInChainId: CHAIN_ID_BASE,
  tokenOutChainId: CHAIN_ID_BASE,
  tokenIn,
  tokenOut,
  swapper,
  slippageTolerance: SLIPPAGE_PCT,
  routingPreference: "BEST_PRICE", // the only value allowed together with `protocols`
  protocols: PROTOCOLS,
});

export const swapBody = (quote: unknown, simulateTransaction: boolean, nowSec = Math.floor(Date.now() / 1000)) => ({
  quote, // passed through verbatim from /quote
  simulateTransaction,
  deadline: nowSec + 300,
});

/** On-chain floor passed to FeeVault.swapWethToUsdc: quoted output minus SLIPPAGE_PCT. */
export const minOutFor = (quoteOut: bigint) => (quoteOut * BigInt(10_000 - SLIPPAGE_PCT * 100)) / 10_000n;

export type QuoteRes = { requestId: string; routing: string; quote: { output: { amount: string }; priceImpact?: number; [k: string]: unknown }; permitData: unknown };

// Independent price: Chainlink ETH/USD on Base (checked on-chain 2026-09-18: description() "ETH / USD", decimals() 8).
// Used to size the keeper's WETH sale to the debt and to refuse a Trading API quote that is off-market.
export const CHAINLINK_ETH_USD: Address = "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70";
const feedAbi = parseAbi(["function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)"]);
export const MAX_ORACLE_DEV_PCT = 3n; // quote may be at most 3% below Chainlink
export const MAX_PRICE_IMPACT_PCT = Number(process.env.UNISWAP_MAX_PRICE_IMPACT_PCT || 1); // quote.priceImpact is in percent; the Chainlink floor (MAX_ORACLE_DEV_PCT) still bounds the price
export const DEBT_SWAP_BUFFER_PCT = 105n; // sell outstanding ÷ price × 1.05 (slippage + fees), never the whole balance

/** ETH/USD with 8 decimals from Chainlink. Rejects a stale round (> 1 h vs chain time) except on DEMO_FORK, whose feed is frozen at the fork block. */
export async function oracleEthUsd8(ctx: Ctx): Promise<bigint> {
  const [, answer, , updatedAt] = await ctx.pub.readContract({ address: CHAINLINK_ETH_USD, abi: feedAbi, functionName: "latestRoundData" });
  if (answer <= 0n) throw new Error(`Chainlink ETH/USD answer ${answer}`);
  if (!ctx.demoFork) {
    const { timestamp } = await ctx.pub.getBlock();
    if (timestamp - updatedAt > 3600n) throw new Error(`Chainlink ETH/USD stale: updated ${timestamp - updatedAt}s ago`);
  }
  return answer;
}
/** USDC (6 dec) that `wethIn` (18 dec) is worth at `px8`. */
export const oracleUsdcOut = (wethIn: bigint, px8: bigint) => (wethIn * px8) / 10n ** 20n;
/** WETH to sell for `outstandingUsdc` of debt, with the buffer; capped at `held`. */
export const wethForDebt = (outstandingUsdc: bigint, px8: bigint, held: bigint) => {
  const want = (outstandingUsdc * 10n ** 20n * DEBT_SWAP_BUFFER_PCT) / (px8 * 100n);
  return want < held ? want : held;
};
/** Throws when the API's quote is off-market versus the oracle, or its route moves the price too much. */
export function assertQuoteSane(quoteOut: bigint, oracleOut: bigint, priceImpact: unknown): void {
  if (quoteOut * 100n < oracleOut * (100n - MAX_ORACLE_DEV_PCT))
    throw new Error(`uniswap quote ${quoteOut} is >${MAX_ORACLE_DEV_PCT}% below Chainlink value ${oracleOut}`);
  if (priceImpact !== undefined && Number(priceImpact) > MAX_PRICE_IMPACT_PCT)
    throw new Error(`uniswap priceImpact ${priceImpact}% > ${MAX_PRICE_IMPACT_PCT}%`);
}
export type SwapRes = { requestId: string; swap: { to: Address; from: Address; data: Hex; value: string; chainId: number } };

/** Validates /swap output before the vault executes it. Throws on anything unexpected. */
export function assertSwapTx(res: SwapRes, vault: Address): void {
  const { swap } = res;
  if (!swap?.data || swap.data === "0x") throw new Error("uniswap /swap returned empty calldata");
  if (swap.to.toLowerCase() !== ADDR.UNI_SWAP_PROXY.toLowerCase()) throw new Error(`uniswap /swap target ${swap.to} is not SwapProxy ${ADDR.UNI_SWAP_PROXY}`);
  if (swap.from && swap.from.toLowerCase() !== vault.toLowerCase()) throw new Error(`uniswap /swap from ${swap.from} is not the vault ${vault}`);
  if (BigInt(swap.value || "0") !== 0n) throw new Error(`uniswap /swap wants value ${swap.value} for a WETH input`);
  if (Number(swap.chainId) !== CHAIN_ID_BASE) throw new Error(`uniswap /swap chainId ${swap.chainId}`);
}

export async function post<T>(path: string, body: unknown): Promise<T> {
  const key = process.env.UNISWAP_API_KEY;
  if (!key) throw new Error("Missing env UNISWAP_API_KEY (see .env.example; free key at https://developers.uniswap.org/dashboard)");
  const r = await fetch(API.UNISWAP_TRADE + path, { method: "POST", headers: headers(key, opt("UNISWAP_UR_VERSION", "2.0")), body: JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`uniswap ${path} ${r.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text) as T;
}

let ethCache: { at: number; px: number } | undefined;
/** USDC per 1 WETH from a live Trading API quote (60 s cache). */
export async function ethUsd(): Promise<number> {
  if (ethCache && Date.now() - ethCache.at < 60_000) return ethCache.px;
  // Pricing only (never executed): any funded address works as swapper; prefer the desk's own wallet.
  const swapper = (process.env.AGENT_WALLET_ADDRESS || TEST_POOL.beneficiary) as Address;
  const q = await post<QuoteRes>("/quote", quoteBody(swapper, 10n ** 18n));
  const px = Number(BigInt(q.quote.output.amount)) / 1e6;
  if (!(px > 0)) throw new Error(`uniswap ETH/USD quote returned ${q.quote.output.amount}`);
  ethCache = { at: Date.now(), px };
  return px;
}

/** check_approval → quote → swap for `amountIn` WETH held by `vault`. Returns calldata + floor for swapWethToUsdc.
 *  `px8` = oracleEthUsd8(): the quote must be within MAX_ORACLE_DEV_PCT of Chainlink. */
export async function buildVaultSwap(ctx: Ctx, vault: Address, amountIn: bigint, px8: bigint): Promise<{ data: Hex; minOut: bigint; quoteOut: bigint; requestId: string }> {
  // Logged only: the vault does its own exact approve (safer than a standing approval to SwapProxy).
  try {
    const appr = await post<{ approval: unknown }>("/check_approval", checkApprovalBody(vault, ADDR.WETH, amountIn));
    ctx.log("uniswap", "check_approval", { vault, needsApproval: !!appr.approval });
  } catch (e) {
    ctx.log("uniswap", "check_approval failed (not needed: vault approves exact amount itself)", { error: (e as Error).message });
  }

  const q = await post<QuoteRes>("/quote", quoteBody(vault, amountIn));
  if (q.routing !== "CLASSIC") throw new Error(`uniswap routing ${q.routing}, expected CLASSIC`);
  if (q.permitData) throw new Error("uniswap returned permitData despite x-permit2-disabled");
  const quoteOut = BigInt(q.quote.output.amount);
  assertQuoteSane(quoteOut, oracleUsdcOut(amountIn, px8), q.quote.priceImpact);

  let s: SwapRes;
  try {
    s = await post<SwapRes>("/swap", swapBody(q.quote, true));
  } catch (e) {
    // Simulation can fail for a contract swapper whose approval is set inside the same call; minOut guards on-chain.
    ctx.log("uniswap", "simulated /swap failed, retrying without simulation", { error: (e as Error).message });
    s = await post<SwapRes>("/swap", swapBody(q.quote, false));
  }
  assertSwapTx(s, vault);
  return { data: s.swap.data, minOut: minOutFor(quoteOut), quoteOut, requestId: s.requestId };
}
