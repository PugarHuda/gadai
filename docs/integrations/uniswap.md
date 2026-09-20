# Uniswap integration notes for Gadai (Trading API and CCA)

Researched 2026-09-18. Tags: **[V]** means I checked it against official docs or source (URL given), **[V-chain]** means I also checked it on Base mainnet with `cast` against `https://base-rpc.publicnode.com`, and **[UNVERIFIED]** means we have to test it before relying on it.

Gadai uses Uniswap in two places:
- **(a) Keeper swap.** The FeeVault's collected WETH is swapped to USDC through the Uniswap Trading API.
- **(b) FeeNote CCA.** Each loan is tokenized as a FeeNote ERC-20 and sold for USDC in a Continuous Clearing Auction (CCA). The auction is what funds the loan.

---

## 0. Addresses on Base (8453)

| What | Address | Status |
|---|---|---|
| USDC (6 dec) | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | [V-chain] symbol/decimals |
| WETH (18 dec) | `0x4200000000000000000000000000000000000006` | [V-chain] |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | [V-chain] code present |
| SwapProxy (for the `x-permit2-disabled` flow) | `0x0000000085E102724e78eCd2F45DC9cA239Affad` | [V-chain] code present |
| Universal Router 2.0 | `0x6fF5693b99212Da76ad316178A184AB56D299b43` | [V] supported-chains |
| Universal Router 2.1.1 | `0xFdf682F51FE81Aa4898F0AE2163d8A55c127fbC7` | [V-chain] |
| **ContinuousClearingAuctionFactory v2.1.0** | `0x000000001F26a0044BaA66024e7b6599c61963F8` | [V-chain] code present, `create` selector `0x4aaa5b37` present, `protocolFeeController() == 0x0` (**no protocol fee**) |
| CCA Factory v2.0.0 (older) | `0x00cCa200BF124dBfA848937c553864f4B4CE0632` | [V-chain] |
| LiquidityLauncher v3.2.0 | `0x0000FffFBE8efE702c8703aE3477FF5dE3d319C0` | [V] deployments |
| LBPStrategy v3.3.0 (Base) | `0xf10124B01E9fa88b0a2eF3fA95a53B3310446000` | [V] deployments |
| v4 PoolManager | `0x498581fF718922c3f8e6A244956aF099B2652b2b` | [V] deployments.json |
| v4 PositionManager | `0x7C5f5A4bBd8fD63184577525326123B519429bDc` | [V] deployments.json |

Sources:
- https://developers.uniswap.org/docs/liquidity/liquidity-launchpad/deployments.md
- https://developers.uniswap.org/deployments.json
- https://developers.uniswap.org/docs/trading/swapping-api/supported-chains.md
- https://developers.uniswap.org/docs/trading/swapping-api/concepts/no-permit2-workflow.md

No CCALens or AuctionStateLens is listed on Base in deployments.json. Read state directly from the auction getters instead (see §2.6).

---

## 1. Uniswap Trading API: keeper WETH -> USDC

### 1.1 Basics [V]
- **Base URL:** `https://trade-api.gateway.uniswap.org/v1`. The OpenAPI spec is at `https://trade-api.gateway.uniswap.org/v1/api.json` (I downloaded and parsed it).
- **Auth:** every request needs the `x-api-key` header, plus `Content-Type: application/json` and `Accept: application/json`.
  - I checked this live: a request without a key returns HTTP 401 with `{"errorCode":"Unauthorized","detail":"Unauthenticated api key or session"}`.
  - Get a key at the Uniswap Developer Platform (https://developers.uniswap.org/dashboard). It is free.
- **Rate limit:** 6 req/s per key by default (FAQ).
- **Keep the key server-side.** The docs say not to ship it in front-end code.
- **Base support:** Base (8453) is supported. `protocols` can be `V2`, `V3`, `V4`, `UNISWAPX_V2` or `UNISWAPX_V3`, and UniswapX V2 and V3 both support Base.
- **Pin to AMM:** set `protocols: ["V2","V3","V4"]` so the quote is always `routing: "CLASSIC"` and goes through `/swap`. That way there is no UniswapX `/order` path and no off-chain filler.
- Docs: https://developers.uniswap.org/docs/trading/swapping-api/start-building/integration-guide.md and https://developers.uniswap.org/docs/trading/swapping-api/concepts/swap-routing.md

### 1.2 Endpoints (from `api.json`) [V]

**`POST /check_approval`**
- Required: `walletAddress`, `token`, `amount` (base units string), `chainId`.
- Optional: `tokenOut`, `tokenOutChainId`, `urgency`, `includeGasInfo`.
- Response: `{ requestId, approval: TransactionRequest|null, cancel: TransactionRequest|null, gasFee?, cancelGasFee? }`. It only returns an approval tx when one is needed. `cancel` is used for tokens that must be reset to 0 before re-approval.

**`POST /quote`**
- Required: `type` (`EXACT_INPUT` or `EXACT_OUTPUT`), `amount`, `tokenInChainId`, `tokenOutChainId`, `tokenIn`, `tokenOut`, `swapper`.
- Optional: `slippageTolerance` (a percent, e.g. `0.5`) **or** `autoSlippage: "DEFAULT"`. You must send exactly one of the two.
- Optional: `routingPreference` (`BEST_PRICE` or `FASTEST`; only `BEST_PRICE` is allowed when `protocols` is set).
- Optional: `protocols`, `hooksOptions` (`V4_HOOKS_INCLUSIVE`, `V4_HOOKS_ONLY` or `V4_NO_HOOKS`), `permitAmount` (`FULL` or `EXACT`), `generatePermitAsTransaction`, `recipient` (the output receiver; defaults to `swapper`), `integratorFees` (max 5%), `urgency`.
- Response: `{ requestId, quote, routing, permitData|null, permitTransaction, isTokenApprovalApplicable, permitGasFee, ... }`.
  - `quote` (ClassicQuote) has: `input`, `output`, `swapper`, `chainId`, `slippage`, `tradeType`, `route`, `routeString`, `quoteId`, `gasFee`, `gasFeeUSD`, `gasUseEstimate`, `priceImpact`, `txFailureReasons`, `blockNumber`, ...

**`POST /swap`**
- Required: `quote`, passed through exactly as `/quote` returned it.
- Optional: `signature` together with `permitData`. Send **both or neither**; sending only one fails validation.
- Optional: `simulateTransaction`, `refreshGasPrice`, `deadline` (unix timestamp), `safetyMode: "SAFE"`, `urgency`.
- Response: `{ requestId, swap: TransactionRequest, gasFee }`.
- `TransactionRequest` is `{to, from, data, value, chainId, gasLimit?, maxFeePerGas?, maxPriorityFeePerGas?, gasPrice?}`. The `data` field must be non-empty; do not modify it.

**Header parameters**
- `x-permit2-disabled: true` switches the flow to the SwapProxy (§1.3). Send it on `/check_approval`, `/quote` and `/swap`.
- `x-universal-router-version` takes `2.0` or `2.1.1`. It **must be the same across all calls**.
- `x-agent-info` is analytics only. Its value is JSON: `{"decision_origin":"autonomous","integration_name":"gadai-keeper","version":"0.1.0"}`. `decision_origin` must be exactly `autonomous` or `human_mediated`. Do not put wallets, IDs or keys in it. It can't affect the response, and parse failures are reported in the `x-agent-info-status` response header.
- `x-erc20eth-enabled` only matters for native-ETH input to UniswapX. We don't need it.

Status endpoint (exists in the spec): `GET /swaps` checks AMM tx status. I did not read its parameters; use the RPC receipt instead.

### 1.3 Why FeeVault uses the proxy flow instead of Permit2 (design decision)
- The **FeeVault contract** holds the WETH, so the vault itself must be the `swapper`. Moving WETH to the keeper EOA first would be a custody hole.
- A contract **cannot produce the EIP-712 Permit2 signature** that the default flow requires.
- The Proxy Approval flow was built for exactly this case (docs: "Your system cannot generate Permit2 signatures"). With `x-permit2-disabled: true`:
  1. `/check_approval` returns plain ERC-20 `approve` calldata targeting the SwapProxy `0x0000000085E102724e78eCd2F45DC9cA239Affad`.
  2. `/quote` always returns `permitData: null`.
  3. `/swap` returns a tx whose `to` is the SwapProxy, which forwards to the Universal Router.
- UniswapX is not available in this flow, which is fine because we pin V2/V3/V4 anyway.

So the keeper (the Dynamic server wallet) calls a guarded vault function. It does not send the swap tx from its own address:

```solidity
// FeeVault (sketch): keeper relays API calldata; vault is msg.sender to the proxy.
address constant UNI_SWAP_PROXY = 0x0000000085E102724e78eCd2F45DC9cA239Affad;
function swapWethToUsdc(bytes calldata data, uint256 amountIn, uint256 minUsdcOut) external onlyKeeper {
    uint256 before = USDC.balanceOf(address(this));
    WETH.approve(UNI_SWAP_PROXY, amountIn);               // exact approval, not the API's approve tx
    (bool ok, bytes memory r) = UNI_SWAP_PROXY.call(data); // data = /swap response swap.data
    if (!ok) assembly { revert(add(r, 32), mload(r)) }
    WETH.approve(UNI_SWAP_PROXY, 0);
    uint256 got = USDC.balanceOf(address(this)) - before;
    require(got >= minUsdcOut, "slippage");               // on-chain floor; don't trust calldata blindly
    _repay(got);
}
```

The keeper side needs only Node 18+ `fetch`, no SDK:

```ts
const API = 'https://trade-api.gateway.uniswap.org/v1';
const key = process.env.UNISWAP_API_KEY ?? (() => { throw new Error('UNISWAP_API_KEY missing (https://developers.uniswap.org/dashboard)'); })();
const H = { 'x-api-key': key, 'content-type': 'application/json', accept: 'application/json',
  'x-permit2-disabled': 'true', 'x-universal-router-version': '2.0',
  'x-agent-info': JSON.stringify({ decision_origin: 'autonomous', integration_name: 'gadai-keeper' }) };
const post = async (p: string, body: unknown) => {
  const r = await fetch(API + p, { method: 'POST', headers: H, body: JSON.stringify(body) });
  const j = await r.json(); if (!r.ok) throw new Error(`uniswap ${p} ${r.status}: ${JSON.stringify(j)}`); return j;
};
const { quote, routing } = await post('/quote', {
  type: 'EXACT_INPUT', amount: wethAmount.toString(), tokenInChainId: 8453, tokenOutChainId: 8453,
  tokenIn: WETH, tokenOut: USDC, swapper: FEE_VAULT, slippageTolerance: 0.5, protocols: ['V2', 'V3', 'V4'],
});
if (routing !== 'CLASSIC') throw new Error(`unexpected routing ${routing}`);
const { swap } = await post('/swap', { quote, simulateTransaction: true, deadline: Math.floor(Date.now() / 1e3) + 120 });
if (!swap.data || swap.data === '0x') throw new Error('empty swap calldata');
if (swap.to.toLowerCase() !== '0x0000000085e102724e78ecd2f45dc9ca239affad') throw new Error('unexpected swap target');
// minOut: the API's quote.output.amount minus slippage -> pass as minUsdcOut
await vault.write.swapWethToUsdc([swap.data, wethAmount, minOut]); // signed by the Dynamic server wallet
```

The `/check_approval` call is skipped on purpose. The vault approves the exact amount itself, which is safer than the API's standing approval. Calling it is still harmless, and it shows the API integration end to end.

**[UNVERIFIED]:**
- We couldn't make a live quote without a key. I haven't confirmed that `/quote` and `/swap` with `swapper` = a contract address pass the API's balance, approval and simulation checks.
  - Expect it to work because the balance is real. But the API's simulation may assume the approval from `/check_approval` is already in place.
  - If `simulateTransaction: true` fails because the approval isn't there yet, retry with `simulateTransaction: false` and rely on the on-chain `minUsdcOut`.
- The shape of `quote.output.amount` wasn't expanded (it is the `QuoteOutput` schema in `api.json`). Read it from a real response.

### 1.4 DEMO_FORK notes
- The calldata comes from Base mainnet state. It usually still executes on an Anvil fork started from recent `latest` state, as long as the pool state hasn't drifted past the slippage tolerance. The fork's timestamp must also be before the `deadline`.
- Fork right before running the demo, and don't `evm_increaseTime` past the deadline before the swap.
- The API key is still required in DEMO_FORK because we don't mock the API.

---

## 2. CCA: tokenized FeeNote auction to fund each loan

### 2.1 Source of truth [V]
- The repo is https://github.com/Uniswap/continuous-clearing-auction. **Use tag `v2.1.0`** (released 2026-07-10), which matches the deployed factory. The `main` branch may be ahead of it.
- Install with `forge install Uniswap/continuous-clearing-auction@v2.1.0`, or vendor the minimal interfaces below.
- It is **not on npm**: I checked `@uniswap/continuous-clearing-auction` and `@uniswap/liquidity-launcher` and both return 404.
- The contracts are Solidity 0.8.26, with dependencies on solady, permit2, v4-periphery and liquidity-launcher@3a31035.
- Docs:
  - https://developers.uniswap.org/docs/liquidity/liquidity-launchpad/guides/example-configuration.md
  - `.../submit-bid.md`
  - `.../exit-bid.md`
  - https://github.com/Uniswap/continuous-clearing-auction/blob/v2.1.0/docs/TechnicalDocumentation.md

### 2.2 Exact signatures (v2.1.0 source) [V]

**Factory.** `IContinuousClearingAuctionFactory is IDistributorFactory`:
```solidity
function create(address token, uint256 amount, bytes calldata configData, bytes32 salt) external returns (IDistributor distributor); // 0x4aaa5b37
function getAddress(address token, uint256 amount, bytes calldata configData, bytes32 salt, address sender) external view returns (IDistributor);
function protocolFeeController() external view returns (address); // Base: 0x0 -> no fee
event AuctionCreated(address indexed auction, address indexed token, uint256 amount, bytes configData);
```
- `configData = abi.encode(AuctionParameters)`. The CREATE2 salt is `keccak256(abi.encode(msg.sender, salt))`.
- If you pass `tokensRecipient` or `fundsRecipient` as `address(1)`, the factory replaces it with `msg.sender`.

```solidity
struct AuctionParameters {
    address currency;              // USDC for us (address(0) = native ETH)
    address tokensRecipient;       // gets unsold FeeNotes (sweepUnsoldTokens)
    address fundsRecipient;        // ONLY this address can sweepCurrency() -> must be FeeDesk/loan contract
    uint64 startBlock;             // inclusive
    uint64 endBlock;               // exclusive; must equal startBlock + sum(step blockDeltas)
    uint64 claimBlock;             // >= endBlock
    uint256 tickSpacing;           // Q96; >= 2; docs: >= 1bp of floor, 1% is reasonable
    address validationHook;        // optional IValidationHook, address(0) = none
    uint256 floorPrice;            // Q96 currency/token (raw units); >= 2^32+1
    uint128 requiredCurrencyRaised;// graduation threshold = loan principal
    bytes auctionStepsData;        // packed (uint24 mps, uint40 blockDelta)[]; sum(mps*blocks) == 1e7
}
```

**Auction** (`IContinuousClearingAuction`):
```solidity
function onTokensReceived() external;   // MUST be called after tokens are transferred in; checks balance >= totalSupply
function submitBid(uint256 maxPriceQ96, uint128 amount, address owner, uint256 prevTickPriceQ96, bytes calldata hookData) external payable returns (uint256 bidId); // 0xa52c8728
function submitBid(uint256 maxPriceQ96, uint128 amount, address owner, bytes calldata hookData) external payable returns (uint256 bidId); // 0x140fe8ee, uses floorPrice as the hint (walks the tick list)
function checkpoint() external returns (Checkpoint memory);
function exitBid(uint256 bidId) external;                                        // after endBlock; bid.maxPrice > final clearing price, or not graduated (full refund)
function exitPartiallyFilledBid(uint256 bidId, uint64 lastFullyFilledCheckpointBlock, uint64 outbidBlock) external;
function claimTokens(uint256 bidId) external;                                    // after claimBlock, graduated, bid already exited
function claimTokensBatch(address owner, uint256[] calldata bidIds) external;
function sweepCurrency() external;      // only fundsRecipient, after endBlock, only if graduated
function sweepUnsoldTokens() external;  // only tokensRecipient, after endBlock
// views
function clearingPrice() external view returns (uint256);
function isGraduated() external view returns (bool);
function currencyRaised() external view returns (uint256);   // as of last checkpoint, gross
function totalCleared() external view returns (uint256);
function remainingSupply() external view returns (uint256);
function floorPrice() external view returns (uint256);
function tickSpacing() external view returns (uint256);
function nextActiveTickPrice() external view returns (uint256);
function ticks(uint256 priceQ96) external view returns (uint256 next, uint256 currencyDemandQ96);
function bids(uint256 bidId) external view returns (Bid memory); // {uint64 startBlock; uint24 startCumulativeMps; uint64 exitedBlock; uint256 maxPrice; address owner; uint256 amountQ96; uint256 tokensFilled}
function nextBidId() external view returns (uint256);
function latestCheckpoint() external view returns (Checkpoint memory);
function lastCheckpointedBlock() external view returns (uint64);
function checkpoints(uint64 blockNumber) external view returns (Checkpoint memory); // {clearingPrice, currencyRaisedAtClearingPriceQ96X7, cumulativeMpsPerPrice, uint24 cumulativeMps, uint64 prev, uint64 next}
function currency() / token() / totalSupply() / tokensRecipient() / fundsRecipient() / startBlock() / endBlock() / claimBlock() / validationHook()
events: BidSubmitted(uint256 indexed id, address indexed owner, uint256 priceQ96, uint128 amount), BidExited(bidId, owner, tokensFilled, currencyRefunded), TokensClaimed(bidId, owner, tokensFilled), ClearingPriceUpdated, CheckpointUpdated, TokensReceived, CurrencySwept, TokensSwept
```

### 2.3 FeeNote auction flow
1. The underwriter agent approves a loan of principal `P` USDC. FeeDesk then deploys `FeeNote` (ERC-20, **6 decimals**, supply = face value `F` in raw units, e.g. `F = P * 1.1`).
2. FeeDesk calls `factory.create(feeNote, F, abi.encode(params), salt)` with these params:
   - `currency = USDC`
   - `fundsRecipient = FeeDesk` (so it can sweep and disburse)
   - `tokensRecipient = FeeDesk` (unsold notes are burned or held)
   - `requiredCurrencyRaised = P`
3. FeeDesk mints or transfers **exactly** `F` FeeNotes to the auction, then calls `auction.onTokensReceived()`. The factory does **not** fund the auction. Tokens sent beyond `totalSupply` are unrecoverable.
4. Lenders and agents (in Dynamic embedded wallets) bid in USDC. The currency is pulled through **Permit2 AllowanceTransfer** (`permit2TransferFrom`), not a plain `transferFrom`. Each wallet needs three txs:
   ```
   USDC.approve(PERMIT2, amount)                                   // once
   PERMIT2.approve(USDC, auction, uint160 amount, uint48 expiration) // Permit2 AllowanceTransfer
   auction.submitBid(maxPriceQ96, uint128 amount, owner, prevTickPriceQ96, 0x)
   ```
   `msg.value` must be 0 for an ERC-20 currency. The bid price must be **strictly > clearingPrice** and a multiple of `tickSpacing` above `floorPrice`.
5. At `endBlock`, `isGraduated()` is true when `currencyRaised >= P`. FeeDesk calls `sweepCurrency()`, receives the USDC (no protocol fee on Base, because the controller is `0x0`), and the Dynamic server wallet disburses it to the borrower.
6. Each bidder calls `exitBid(id)` if `maxPrice > finalClearing`, or `exitPartiallyFilledBid(id, lastFullyFilled, outbid)` otherwise. This refunds the unspent USDC. After that, `claimTokens(id)` at or after `claimBlock` delivers the FeeNotes.
7. FeeNote holders are paid from the fee stream through our own FeeNote/FeeVault logic (pro-rata redemption). This part is **ours, not Uniswap's**.
8. If the auction doesn't graduate, every bidder gets a full refund through `exitBid`, the loan is not disbursed, and FeeDesk calls `sweepUnsoldTokens()` and releases the pledge. This is a real failure path, not a fake one.

### 2.4 Parameter math (verified against source)
- **Price:** Q96 of `currencyRaw/tokenRaw`. With both tokens at 6 decimals, 1 note = 1 USDC of face value, so the price equals the USDC paid per note.
  - `Q96 = 79228162514264337593543950336`
  - floor 0.90 -> `71305346262837903834189555302`
  - tickSpacing 1% of face -> `792281625142643375935439503`
  - `MIN_FLOOR_PRICE = 2^32 + 1 = 4294967297`
  - `MAX_TOTAL_SUPPLY = 2^100`
- **Steps:** each step is 8 bytes, encoded as **`abi.encodePacked(uint24 mps, uint40 blockDelta)`** with mps in the HIGH 24 bits. `StepLib.parse` reads `mps = uint24(bytes3(data))`.
  - These must hold: `sum(mps * blockDelta) == 1e7`, and `startBlock + sum(blockDelta) == endBlock`.
  - Base blocks are about 2 s, so 30 minutes is 900 blocks.
  - Docs guidance: keep the steps increasing, and sell a significant share in the last block.
  - In viem: `encodePacked(['uint24','uint40','uint24','uint40'], [mps1, n1, mps2, n2])`.
  - Example for 900 blocks: 899 blocks at 6_000 mps (5_394_000) plus 1 block at 4_606_000, which sums to 1e7.
- Use a validation hook `address(0)`. We could add an allowlist hook implementing `validate(uint256,uint128,address,address,bytes)` if needed.

### 2.5 Docs vs source discrepancies (gotchas, verified)
- **Step packing:** the Example Configuration guide and TechnicalDocumentation show `uint64(mps) | (uint64(blockDelta) << 24)`, which puts mps in the LOW bits. That **does not match** `StepLib.parse` or the repo's own `AuctionStepsBuilder` (`abi.encodePacked(mps, blockDelta)`). Use encodePacked.
- **Factory function name:** the guide and TechnicalDocumentation call it `initializeDistribution(...)` and `getAuctionAddress(...)`. The deployed v2.1.0 factory has **`create(...)` and `getAddress(...)`**. I confirmed on Base that the `create` selector is in the bytecode and the `initializeDistribution` selector `0x03770504` is absent.
- **`submitBid` argument count:** the guide's example calls `submitBid{value}(maxPrice, amount, owner, bytes(""))`. That is the 4-argument overload, which also exists. The TechnicalDocumentation warns it is gas-heavy because it walks ticks from the floor. Prefer the 5-argument form with `prevTickPriceQ96`: the highest initialized tick below your price, found by walking `ticks(p).next` from `floorPrice()` off-chain.
- `currencyRaised()` is based on the last checkpoint, so call `checkpoint()` (or simulate it) for fresh numbers.

### 2.6 Hints for `exitPartiallyFilledBid` (from source)
- `lastFullyFilledCheckpointBlock` must meet three conditions: its `clearingPrice < bid.maxPrice`, its `next` checkpoint has `clearingPrice >= bid.maxPrice`, and it is `>= bid.startBlock`.
- `outbidBlock` is `0` when the bid was still at the clearing price at the end. Otherwise it is the first checkpoint block where `clearingPrice > maxPrice`.
- To compute these off-chain, walk the linked list `checkpoints(b).prev/next` starting from `lastCheckpointedBlock()`.

---

## 3. Graduating to a v4 pool (LiquidityLauncher + LBPStrategy)

**Recommendation: don't do this for FeeNote.** The standard path looks like this [V]:
- Call `LiquidityLauncher.multicall([depositToken(token, amount) or createToken(...), distributeToken(token, Distribution{strategy: LBPStrategy, amount, configData}, salt)])`.
- The LBPStrategy `configData` is `abi.encode(MigratorParameters, bytes initializerParams)`.
  - `MigratorParameters` = `{token, currency, migrationBlock, reservedTokenAmountForLP, recipient, positionRecipient, PoolParameters{fee, tickSpacing, hook}, positionDefinitions, lpAllocationSchedule}`.
  - `initializerParams` goes to the CCA factory.
- After `migrationBlock`, anyone calls `ILBPStrategy.migrate(initializer)`, which creates the v4 pool at the discovered price.
- Launcher address: `0x0000FffFBE8efE702c8703aE3477FF5dE3d319C0`. LBPStrategy on Base: `0xf10124B01E9fa88b0a2eF3fA95a53B3310446000`.
- Source (v3.3.0 commit `1c59049`): https://github.com/Uniswap/liquidity-launcher/blob/1c5904912aefceaceb89c24528cd5e25d0b61597/src/libraries/MigratorParams.sol and `docs/TechnicalReference.md`.

Why skip it:
- The LBP route sends the raised currency to the **strategy**. The initializer's `fundsRecipient` must be the strategy, and part of the currency becomes LP. That conflicts with "raised USDC funds the loan".
- The `positionDefinitions` and `lpAllocationSchedule` encodings add a lot of surface area.
- For Gadai, "graduation" is `isGraduated()`, meaning the CCA reached `requiredCurrencyRaised = principal`.
- If a secondary market is wanted later, a simple v4 pool could be created for FeeNote/USDC. That is out of scope and not planned.

---

## 4. Env vars
```
UNISWAP_API_KEY=            # required for the keeper swap; fail loudly if missing
BASE_RPC_URL=https://base-rpc.publicnode.com
UNISWAP_UR_VERSION=2.0      # sent as x-universal-router-version; must be consistent across calls
CCA_FACTORY=0x000000001F26a0044BaA66024e7b6599c61963F8
PERMIT2=0x000000000022D473030F116dDEE9F6B43aC78BA3
UNISWAP_SWAP_PROXY=0x0000000085E102724e78eCd2F45DC9cA239Affad
```
Hardcoding the addresses is also fine because they are immutable CREATE2 deployments. Keep the env override only for DEMO_FORK.

## 4b. The Trading API on chain 4663 (Robinhood Chain): RWA pricing and a real buy [V 2026-09-20]

Some Bankr/Doppler pools are quoted in Robinhood **tokenized stocks**, so the creator's fees arrive as shares (EARN in SPY, TESLR in TSLA, MINR in MSTR). The board values those streams, and the desk has now traded one.

- **Pricing** (`agent/src/board/index.ts`): `/quote` for **0.1 share → WETH on 4663**, multiplied by the Base ETH/USD quote. 0.1 routes where 1.0 returned `NoRouteFoundError` on 2026-09-19. A failed quote becomes a row `error`; nothing is estimated.
- **Executing** (`agent/src/demo/rh-equity-swap.ts`): bridge Base ETH → 4663 with Relay `POST https://api.relay.link/quote/v2` (the deposit tx is sent exactly as quoted, and its target must be one of Relay's advertised Base addresses), wait for arrival, then `/quote` + `/swap` ETH → TSLA on 4663. Executed 2026-09-20: bridge `0xc65bd93a…5af2d4` on Base (0.0002 ETH to the Relay Depository `0x4cD0…BC31`), swap `0xbfbe9702…66dd708` on 4663 (0.000109976 ETH → 0.00078962 TSLA).
- **Header rule, the hard-won one: do NOT send `x-universal-router-version` on 4663.** Our Base client pins `2.0`; sent on 4663 the API returns no route. Omit it and the chain's default Universal Router 2.1.1 (`0x204FAca1…0498`) is used and the swap goes through. This is in `FEEDBACK.md` §13.
- **Network note:** `rpc.mainnet.chain.robinhood.com` and `docs.robinhood.com` are hijacked by the local ISP on this machine (a TLS cert for `internetbaik.telkomsel.com`), so the scripts default `RH_RPC_URL` to `https://robinhood-rpc.publicnode.com` (listed on chainid.network; `eth_chainId` = 4663). `robinhoodchain.blockscout.com` sits behind a Cloudflare challenge, so re-check receipts over the RPC, not the explorer API.
- Guards: `--eth` capped at 0.00025, a per-tx gas cap (`MAX_SPEND_ETH`), `RH_GAS_RESERVE_ETH` held back on 4663 for the swap gas, `symbol()` read on-chain before trusting the token address, and dry-run by default (`--execute` sends, WSL only).

## 5. Hackathon deliverables for the Uniswap track (from the task brief)
- Public repo.
- `FEEDBACK.md`, written and covering 13 items. The ones that cost the most time:
  - the step-packing mismatch between the docs and `StepLib`;
  - the `initializeDistribution` vs `create` naming in the docs;
  - no CCA lens deployed on Base;
  - whether a contract `swapper` works with the proxy flow when simulation is enabled;
  - the SwapProxy address moving under us mid-hackathon;
  - `x-universal-router-version: 2.0` silently yielding no route on chain 4663 (§13).
- Mainnet txs to cite: the Base Trading API swap (EVIDENCE #1) and the Robinhood Chain TSLA buy (EVIDENCE #6).
- The README should point to exact files and lines: the keeper swap module, `FeeVault.swapWethToUsdc`, the FeeNote CCA creation, and the bid UI.

## 6. What is NOT possible, or what we must not claim
- There is no Trading API call without an API key (401). There is no mock fallback.
- A contract can't use the default Permit2 flow because it can't sign EIP-712. ERC-1271 support in Permit2 is theoretically possible but untested and not planned. Use the proxy flow.
- UniswapX routing is unavailable with `x-permit2-disabled`, and we pin V2/V3/V4 anyway.
- The API returns **unsigned** txs. Nonces, broadcasting and gas are ours; the Dynamic server wallet signs.
- CCA doesn't support fee-on-transfer tokens or tokens with fewer than 6 decimals, and prices must stay within `MAX_BID_PRICE` (derived from supply). FeeNote at 6 decimals with supply around 1e9 to 1e12 raw is fine.
- CCA bids can't be withdrawn before `endBlock` unless they are outbid (`exitPartiallyFilledBid` with an `outbidBlock`). Before graduation, a partial exit reverts with `CannotPartiallyExitBidBeforeGraduation` until the end.
- A CCA can't be cancelled once `onTokensReceived()` has been called. Its parameters are immutable.
- There is no Uniswap-hosted API for creating or bidding in a CCA. It is all direct contract calls. The Uniswap web "Launch Auction" page exists but we don't use it.
