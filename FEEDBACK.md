# Uniswap developer feedback: Gadai

We used two Uniswap products:
- The **Trading API** swaps WETH to USDC with a smart contract as the swapper, through the no-Permit2 SwapProxy flow. Code: `agent/src/uniswap/index.ts`, `contracts/src/FeeVault.sol` `swapWethToUsdc`.
- The **Continuous Clearing Auction v2.1.0** sells a new ERC-20 (the FeeNote, a claim on one loan's repayments) for USDC. The auction is what funds the loan. Code: `contracts/src/FeeVault.sol` `startAuction`/`disburse`/`cancel`, `agent/src/cca/index.ts`.

What we built on these was the right shape for them. The CCA is a very good fit for pricing a brand-new credit asset, and the SwapProxy flow is the only clean way to let a contract swap. Below is everything that cost us time, in the order we hit it. Each point gives what we read, what the source or the chain actually does, and what would have helped.

## Continuous Clearing Auction

### 1. Step packing in the docs is the reverse of the contract
- **Where:** the Example Configuration guide and `docs/TechnicalDocumentation.md`.
- **What they show:** each step built as `uint64(mps) | (uint64(blockDelta) << 24)`, which puts mps in the low bits.
- **What the contract does:** `StepLib.parse` reads `mps = uint24(bytes3(data))` from the **high** bytes, and the repo's own `AuctionStepsBuilder` uses `abi.encodePacked(uint24 mps, uint40 blockDelta)`.
- **Impact:** if you follow the guide, you get an invalid or wildly wrong supply schedule.
- **Suggested fix:** show `abi.encodePacked(mps, blockDelta)` in the guide (and the viem equivalent, `encodePacked(['uint24','uint40'], …)`).

### 2. Factory function names in the docs don't match the deployed factory
- **What the docs say:** `initializeDistribution(...)` and `getAuctionAddress(...)`.
- **What is deployed:** the v2.1.0 factory on Base (`0x000000001F26a0044BaA66024e7b6599c61963F8`) exposes `create(address,uint256,bytes,bytes32)` and `getAddress(...)`. We checked the bytecode: the `create` selector `0x4aaa5b37` is there, and the `initializeDistribution` selector `0x03770504` is not.
- **Impact:** an integrator following the guide gets a revert on an unknown selector.
- **Suggested fix:** update the guide, or add a note naming the version.

### 3. The tick grid is absolute, but every example hides that
- **The rule:** `TickStorage._getTick` reverts with `TickPriceNotAtBoundary` unless `price % tickSpacing == 0`. That applies to **every** tick, including `floorPrice`.
- **Why the examples hide it:** every example sets `tickSpacing == floorPrice`, where the rule holds trivially. The prose ("minimum bid-price increment", and bids at `floorPrice + tickSpacing`) reads as though prices are `floor + k·tick`.
- **How it broke for us:** we wanted a floor of 0.90 USDC per note with a 1-cent tick. In Q96 that is `0.90·2^96` and `0.01·2^96`, rounded down. `2^96 mod 100 = 36`, so the floor is not a multiple of the tick, and the constructor reverts.
- **Our fix:** we define the tick as `Q96/100` and every price, the floor included, as `cents · (Q96/100)` (`agent/src/cca/index.ts`, `TICK_Q96`).
- **Suggested fix:** one sentence in the docs, "floorPrice and every bid price must be exact multiples of tickSpacing," plus a helper that snaps a price to the grid.

### 4. `isGraduated()` reflects only the last checkpoint
- **The behavior:** `isGraduated()` and `currencyRaised()` read checkpointed state. After `endBlock`, if nobody has checkpointed, `isGraduated()` can return `false` for an auction that did in fact reach `requiredCurrencyRaised`.
- **Why it's easy to miss:** `sweepCurrency`/`sweepUnsoldTokens` are protected by `ensureEndBlockIsCheckpointed`, but the view functions aren't.
- **Why it matters for us:** our vault has a permissionless `cancel()` for auctions that fail to graduate. Written naively, it would let anyone cancel an auction that actually succeeded.
- **Our fix:** we call `checkpoint()` before reading `isGraduated()`.
- **Suggested fix:** a warning in the NatSpec and docs, or an `isGraduatedAfterCheckpoint()` helper.

### 5. Off-chain hints are hard to compute and no lens is deployed on Base
- **The hints:** the 5-argument `submitBid` needs `prevTickPrice`, and `exitPartiallyFilledBid` needs `lastFullyFilledCheckpointBlock` and `outbidBlock`.
- **The cost:** computing them means walking the `ticks()` linked list and the `checkpoints()` prev/next list from the client.
- **The workaround:** the 4-argument `submitBid` overload walks the ticks on-chain, but the docs warn it is expensive.
- **What's missing:** `deployments.json` lists no CCA lens or state lens for Base.
- **What we did:** we wrote both walkers (`bidPlan`, `exitPlan`, `exitHints` in `agent/src/cca/index.ts`).
- **Suggested fix:** a deployed lens (`getBidHints(auction, price)`, `getExitHints(auction, bidId)`) or an SDK function. This would save every integrator the same afternoon.

### 6. No npm package for the ABIs
- **What we checked:** `@uniswap/continuous-clearing-auction` and `@uniswap/liquidity-launcher` both 404 on npm.
- **What we did:** vendored the interfaces and hand-wrote the viem ABI fragments.
- **Where it went wrong:** the `bids()` and `checkpoints()` struct field order is where we had to go back to the source to be sure.
- **Suggested fix:** publish an ABI-only package, or JSON ABIs on the docs site.

### 7. Three transactions per first-time bidder
- **What a bid takes:** ERC-20 currency is pulled through Permit2 `AllowanceTransfer`, so a new bidder needs `USDC.approve(Permit2)`, then `Permit2.approve(USDC, auction, amount, expiry)`, then `submitBid`.
- **The UX:** for embedded-wallet lenders, that is three prompts to place one bid.
- **What we did:** our bid plan skips any approval that is already satisfied on-chain.
- **Suggested fix:** a signature-based Permit2 bid path (`permitTransferFrom` in `submitBid`) would make this one signature plus one transaction.

## Trading API

### 8. A contract as swapper is the main use case of the no-Permit2 flow, but it isn't documented end to end
- **What the docs cover:** the Proxy Approval flow says it is for systems that can't produce Permit2 signatures, which is exactly our case. The FeeVault holds the WETH and must be the swapper.
- **What the docs don't cover:** whether `/quote` and `/swap` accept a contract `swapper`, and whether `simulateTransaction: true` passes when the approval to SwapProxy is set **inside the same call** (our vault approves the exact amount, calls SwapProxy, then resets the approval to 0).
- **Our fallback:** if simulation fails, we retry once with `simulateTransaction: false`. The vault still enforces `minUsdcOut` on-chain (`agent/src/uniswap/index.ts` `buildVaultSwap`).
- **Suggested fix:** a documented "smart-contract swapper" recipe. It should cover the approve-inside-the-call pattern and state which checks the API runs against `swapper`.

### 9. Easy-to-miss request rules
Each of these is documented, but spread across the OpenAPI spec and several pages. We had to collect them from `api.json` before we could write a request that validates.
- `slippageTolerance` and `autoSlippage` are mutually exclusive.
- `routingPreference` must be `BEST_PRICE` when `protocols` is set.
- `x-universal-router-version` must be identical on every call of one swap.
- `/swap` takes `signature` and `permitData` together or not at all.

A single "request rules" table on the integration guide would save time.

### 10. `quote.output.amount` isn't expanded in the reference
- **The problem:** the ClassicQuote schema points to `QuoteOutput`, but the guide never shows where the output amount lives. We need that amount to compute the on-chain `minUsdcOut`.
- **Suggested fix:** a short "computing a min-out for a contract caller" example.

### 11. No public sandbox key
- **The problem:** every Trading API call returns 401 without a key, so you can't try an endpoint before signing up.
- **For comparison:** another API we integrated this week publishes a clearly labeled public development key in its OpenAPI spec, which made first contact a lot faster.
- **Note:** a free key is quick to get from the developer dashboard, so this is minor.

### 12. `x-agent-info` is a good idea, so make it louder
- **What we liked:** tagging requests with `decision_origin: autonomous` fits agent-driven swaps exactly, and the `x-agent-info-status` response header for parse failures is thoughtful.
- **The problem:** we found it only by reading the OpenAPI spec.
- **Suggested fix:** a line in the "for agents" material.

### 13. On chain 4663 (Robinhood Chain) the router-version header has to be left off, and the failure doesn't say so
- **What we were doing:** pricing and then buying Robinhood tokenized stocks (SPY, TSLA, MSTR) through the Trading API on chain 4663. Some Bankr/Doppler pools are quoted in those tokens, so a creator's fees arrive as shares, and we value and liquidate them with the same API we use on Base.
- **What happened:** our Base client always sends `x-universal-router-version: 2.0` (per the rule that it must be identical on every call of one swap). Sent on 4663, `/quote` returns no route. Omitting the header entirely works, and the swap then executes: [`0xbfbe9702…66dd708`](https://robinhoodchain.blockscout.com/tx/0xbfbe9702dd40ed28e734d1ebc319a7ace9d27b30f77eb5185179de01366dd708), 0.00011 ETH → 0.00078962 TSLA. The chain's Universal Router there is 2.1.1 (`0x204FAca1…0498`).
- **Why it cost time:** the error reads like a liquidity problem ("no route"), not a header problem, so we went looking at pools first. Two related surprises on the same chain: a 1-share quote returned `NoRouteFoundError` while 0.1 routed, and the accepted values of `x-universal-router-version` are per-chain but not listed per-chain.
- **Suggested fix:** document the supported router versions per chain (or make the API fall back to the chain default instead of returning an empty route), and return a distinguishable error when the requested router version doesn't exist on the requested chain.

## What worked well
- **The SwapProxy flow.** One header switches the whole API to plain ERC-20 approvals. That is exactly what a vault needs.
- **The CCA itself.** It gives price discovery and a hard graduation threshold, plus clean refunds on failure (`exitBid`). With these, "the auction didn't fill, so the loan is cancelled and the lien is returned" is a real code path, not a fake one.
- **No protocol fee on Base.** `protocolFeeController() == 0x0` on the Base factory, which keeps the lending math simple.
- **Source quality.** The v2.1.0 source is clear enough that we could answer every question above ourselves.

## SwapProxy address changed under us (found 2026-09-19)

Our FeeVault hardcodes the `x-permit2-disabled` SwapProxy as its only allowed swap target, because a vault that
executes API calldata must pin where that calldata can go. The integration notes we built from on 2026-09-18 listed
`0x0000000085E102724e78eCd2F45DC9cA239Affad`. On 2026-09-19 `/swap` returned `to = 0x02E5be68D46DAc0B524905bfF209cf47EE6dB2a9`
(also a verified `SwapProxy`) for both `x-universal-router-version: 2.0` and `2.1.2`, so every keeper swap was
rejected by our own target check until we redeployed. Asks:
- Publish the current SwapProxy address per chain on the Deployments page, with a changelog entry when it moves.
- Let integrators pin a proxy version (a header, like the router version), or keep the old proxy routable for a deprecation window.
- `x-universal-router-version` now accepts only `2.0` and `2.1.2`; `2.1` returns 400, so the accepted values are worth listing next to the header in the docs.
