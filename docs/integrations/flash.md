# Definitive Flash API: integration notes for Fee Desk

Researched 2026-09-18. Every endpoint below was read in the official docs, and the ones marked **LIVE-TESTED** were called against production (Base 8453) today with the public dev key.

Sources:
- Doc index: https://flash.definitive.fi/docs/llms.txt (full dump: https://flash.definitive.fi/docs/llms-full.txt)
- OpenAPI (authoritative): https://flash.definitive.fi/v1/openapi.json (v2.0.0, server `https://flash.definitive.fi/v1`)
- Pages: `/docs/getting-started.md`, `/docs/for-agents.md`, `/docs/placing-orders.md`, `/docs/twap-order.md`, `/docs/trigger-orders.md`, `/docs/brackets.md`, `/docs/evm-overview.md`, `/docs/cancelling-orders.md`, `/docs/updating-orders.md`, `/docs/post-trade-reporting.md`, `/docs/rate-limits.md`, `/docs/supported-chains.md`, `/docs/flash-mcp.md`, `/docs/faq.md`, `/docs/security.md`, `/docs/changelog.md`, all under `https://flash.definitive.fi`
- Old docs site: https://docs.definitive.fi/developers/flash-api-new.md only links to the pages above.

## 1. Setup

| Item | Value |
|---|---|
| Base URL | `https://flash.definitive.fi/v1` |
| Auth | Header `x-definitive-api-key: <key>` on every REST call |
| Public dev key | `dpka_513a2bd7_57a2_46d2_927b_2a3857fe271b`. Docs say it is "safe for development" and it is the OpenAPI `x-default`. It is a shared Definitive org key, so orders are attributed to Definitive and integrator fees go to them. |
| Own key | Sign up at app.definitive.fi **with an email account**, then go to More > Flash > "Create Flash Key". This is self-serve and needs no approval. The MCP wizard uses `app.definitive.fi/account/organization/mcp-setup` instead. |
| WebSocket | `wss://flash.definitive.fi/v1/ws` (orders + streaming market quotes) |
| Rate limit | 5 req/s **per endpoint per key**, returns 429 with `RateLimit-Reset` header |
| Sandbox/testnet | None. Docs say to test on Base with small amounts. |
| Chain | `"base"` (8453) is supported. Other chains: arbitrum, arc, avalanche, bsc, ethereum, hyperevm, ink, monad, optimism, plasma, polygon, robinhood, solana |
| Settlement contract (all EVM chains) | `0x5d00000873b6BF41539e6f5365B0Ff7d3c368f78` (EIP-712 domain `DefinitiveFlashAllowance` v1). The ERC-20 approve goes to this address. |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` (optional path) |
| Fees | Definitive charges 10 bps (promo through Dec 2026). The optional integrator fee `flashIntegratorFeeBps` (string, max "1000") must be sent with the same value on quote and order. |

Env vars for our code:
```
FLASH_API_KEY=            # required; fail loudly if missing. For dev only you may set it to the public key above.
FLASH_BASE_URL=https://flash.definitive.fi/v1
FLASH_INTEGRATOR_FEE_BPS= # optional, e.g. "25" (only meaningful with our own key)
BASE_BUILDER_CODE=        # optional, erc8021AttributionCode on POST /order
```
The keeper signer key comes from the Dynamic server wallet (see dynamic.md) and needs no separate Flash env var.

**Note:** `https://flash.definitive.fi/docs/openapi.json` is a different spec. It lists server `https://ddp.definitive.fi/v2/flash` with another default key (`dpka_2bd021e7_...`). Every doc page uses `flash.definitive.fi/v1`, so use that one.

## 2. Endpoints (from the OpenAPI spec)

| Method | Path | Purpose |
|---|---|---|
| POST | `/quote` | Pricing plus signing payloads (**LIVE-TESTED**) |
| POST | `/order` | Submit a signed order and get back `orderId` |
| POST | `/setup-transaction` | Broadcast funder-signed `setupTxs` from a quote (approve/wrap) with no RPC needed |
| GET | `/orders?funderAddress=&statuses=&pageSize=&pageToken=` | List orders |
| GET | `/orders/{orderId}?funderAddress=` (**required**) | Order detail plus `fills[]` (post-trade report) |
| PATCH | `/orders/{orderId}` | Update the limit or trigger price (signed plaintext message) |
| POST | `/orders/{orderId}/cancel` | Cancel (signed plaintext message) |
| GET | `/search?query=&chain=&limit=` | Symbol/address to asset, with price, liquidity and `riskFlagged` (**LIVE-TESTED**) |
| GET | `/balances/{address}` | Wallet token balances |

`orderType` enum (OpenAPI and live validator): `market | limit | twap | stop | stop-loss | take-profit | bracket`.

Order statuses: `ORDER_STATUS_PENDING | ACCEPTED | PARTIALLY_FILLED | FILLED | CANCELLED | REJECTED | TERMINATED`.

Error shape: `{ "error": { "code", "message", "details" } }`.

## 3. Request shapes (target/contra convention)

- `targetAsset` is the thing traded, and `contraAsset` is the pricing/payment asset (USDC for us).
- `qty` is always the **spent** amount as a decimal string. On `buy` it is in contra units (USDC). On `sell` it is in target units.
- Prices come in two bases, and each price must use exactly one: `limitNotionalPrice` / trigger `notionalPrice` (the USD price of target) or `limitCrossPrice` / `crossPrice` (contra per target).
- `funderAddress` is mandatory in practice. Without it, `orderTypedData` comes back empty.
- `maxSlippage` and `maxPriceImpact` are decimal strings with a default of "0.05". They are enforced **offchain** by Flash's keeper and are not part of the signed struct.

Base constants: USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, WETH `0x4200000000000000000000000000000000000006`.

### TWAP (keeper sells the creator-token fee leg). LIVE-TESTED on GITLAWB
```jsonc
{ "targetChain":"base","contraChain":"base",
  "targetAsset":"0x5f980dcfc4c0fa3911554cf5ab288ed0eb13dba3", // GITLAWB (test pool 0xec33...b0b9)
  "contraAsset":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "side":"sell","qty":"2000000","orderType":"twap",
  "durationSeconds":3600,     // quote-only, min 300, do NOT echo on /order
  "twapBucketCount":12,       // 2..2560, echo on /order
  "startTime":"...",          // optional ISO-8601, echo on /order
  "limitNotionalPrice":"...", // optional floor, echo on /order
  "funderAddress":"0x..." }
```
Live result: 2,000,000 GITLAWB sold for 52.91 USDC, fee $0.55, impact -0.28%. `expireTime` and `triggers` are rejected on TWAP. Progress is reported as `completedFillCount` vs `twapBucketCount`.

### DCA
**There is no `dca` orderType in the API.** The live validator rejected it with "Invalid enum value ... received 'dca'". The marketing pages list DCA anyway. A DCA is a long TWAP. This quote was LIVE-TESTED: `orderType:"twap", side:"buy", qty:"50", durationSeconds:2592000, twapBucketCount:30`, which buys $50 in 30 daily slices over 30 days. In the UI, label it "DCA (Flash TWAP)" and do not claim a native DCA endpoint.

### Stop-loss / Take-profit / Stop. LIVE-TESTED (stop-loss, take-profit)
```jsonc
{ ..., "side":"sell","qty":"100000","orderType":"stop-loss",
  "triggers":[{"notionalPrice":"0.00002","triggerType":"lower"}],
  "limitNotionalPrice":"...", // optional; turns it into stop-limit
  "expireTime":"2026-10-01T00:00:00Z" } // optional GTT; omit = GTC
```
The fixed combinations are `stop-loss` with sell+lower, `take-profit` with sell+upper, and `stop` with buy (usually upper). Each takes exactly one trigger.

### Limit. LIVE-TESTED
`{ ..., "side":"buy","qty":"5","orderType":"limit","limitNotionalPrice":"0.00002" }`. `expireTime` is optional.

### Bracket (the social mirror entry). LIVE-TESTED quote
Only **attached** brackets work. A standalone `orderType:"bracket"` returns `"bracket orders are not yet supported"` (live). Attach the bracket to a `market`, `limit` or `twap` entry. It works on same-chain EVM and requires `funderAddress`.
```jsonc
// quote
{ "targetChain":"base","contraChain":"base","targetAsset":"<creatorToken>","contraAsset":"<USDC>",
  "side":"buy","qty":"5","orderType":"market","funderAddress":"0x...",
  "attachedBracket":{ "takeProfit":{"notionalPrice":"0.00004"}, "stopLoss":{"notionalPrice":"0.00002"} } }
// quote response adds: attachedBracket.{evm:{approveTx,permitTypedData,orderTypedData}, salt, deadline, signedMaxFromAmount}
// order: same body + quoteId, userSignature, evmOrderTypedData, (evmPermitTypedData, evmPermitSignature),
//   attachedBracket:{ takeProfit, stopLoss, userSignature:<sig over attachedBracket.evm.orderTypedData>,
//                     salt, deadline, signedMaxFromAmount, (evmPermitTypedData, evmPermitSignature) }
// response: { orderId, attachedBracket:{ status:"pending_activation" } }
```
Rules:
- Leg prices apply to the **received** asset.
- Both legs must use the same basis.
- TP must be above SL.
- The pair activates on the entry's first fill and then runs as OCO. When a leg fires, the rest of the entry is cancelled.
- `GET /orders/{entryId}` returns `attachedBracket.{status, bracketOrderId}`.
- The follower must keep the bought tokens **and the allowance** in the funder wallet. If they don't, the exit fails entirely.
- The follower signs 2 EIP-712 payloads and may need 2 approvals (USDC and the token).

## 4. EVM signing flow (viem, from docs)
```ts
const post = (p: string, b: unknown) => fetch(`${FLASH_BASE_URL}${p}`, {
  method: "POST", headers: { "content-type": "application/json", "x-definitive-api-key": FLASH_API_KEY },
  body: JSON.stringify(b) }).then(async r => { const j = await r.json(); if (!r.ok) throw new Error(`flash ${p} ${r.status} ${JSON.stringify(j.error)}`); return j; });

const q = await post("/quote", { ...order, durationSeconds: 3600, funderAddress });
if (q.evm.approveTx) await wallet.sendTransaction({ to: q.evm.approveTx.to, data: q.evm.approveTx.data, value: 0n }); // from funder, wait receipt
let permit = {};
if (q.evm.permitTypedData) permit = { evmPermitTypedData: q.evm.permitTypedData,
  evmPermitSignature: await account.signTypedData(JSON.parse(q.evm.permitTypedData)) };
const userSignature = await account.signTypedData(JSON.parse(q.evm.orderTypedData));
const { orderId } = await post("/order", { ...order, funderAddress, quoteId: q.quoteId, userSignature,
  evmOrderTypedData: q.evm.orderTypedData, ...permit });
```
- **Empty-string gotcha:** a live quote returned `permitTypedData: ""`, not null. Use a truthiness check, as in the snippet above.
- **Neither approveTx nor permit returned:** this is valid. Just sign and submit.
- The signed `FlashOrder` struct (live) is `{swapper, vault, recipient, fromToken, toToken, fromAmount, salt, deadline}`. `swapper` and `recipient` are both equal to `funderAddress` on same-chain orders, so the proceeds return to the funder. `vault` is the integrator's Definitive vault, which is filled in by the quote. The struct has **no min-out**, so price protection depends on Flash offchain.

Cancel (EIP-191 `personal_sign`, exact bytes, **em dash**):
```ts
const cancelMessage = `Definitive Flash v1 — Cancel Order\nOrder: ${orderId}`;
await post(`/orders/${orderId}/cancel`, { cancelMessage, userSignature: await account.signMessage({ message: cancelMessage }) }); // {ok:true}
```
Update: `PATCH /orders/{id}` with `{limitNotionalPrice|limitCrossPrice, trigger?, updateMessage, userSignature}`. The message format is:
```
Definitive Flash — Update Order
Order: <id>
Issued At: <RFC3339>
Limit ... Price: <x>
Trigger <Lower|Upper> <Cross|Notional> Price: <y>
```

## 5. Smart-contract funder (FeeVault as the Flash funder)
- The docs say Flash accepts **EIP-1271** signatures from any funder that has code (evm-overview.md "Smart wallet support", faq.md). Cancels are verified with ERC-1271 plus ERC-6492.
- Dynamic embedded wallets are explicitly listed as supported funders.
- This means FeeVault itself can be the `funderAddress` for the creator-token TWAP. The tokens never leave the vault until a fill, and the USDC lands back in the vault because `recipient == swapper`. That makes the flow non-custodial and deep. The vault needs to:
  1. `IERC20(token).approve(0x5d00000873b6BF41539e6f5365B0Ff7d3c368f78, amt)`, called by keeper-gated vault code. We can also use the `approveTx` calldata target/spender from the quote.
  2. Implement `isValidSignature(bytes32 hash, bytes sig) returns (bytes4)`. The safe design is to have the keeper call `vault.authorizeFlashOrder(FlashOrder o)`, which recomputes the EIP-712 hash onchain (domain `DefinitiveFlashAllowance`, "1", 8453, `0x5d00…8f78`). That function must require `o.swapper == o.recipient == address(this)`, `o.toToken == USDC` and `o.fromToken ∈ {WETH, creatorToken}`, and then store `approvedHash[h] = true`. `isValidSignature` returns `0x1626ba7e` only for stored hashes, which may also be required to carry a keeper ECDSA sig. For cancels, authorize the EIP-191 hash of the cancel message the same way.
- **UNVERIFIED:** whether Flash accepts an arbitrary or placeholder `userSignature` bytes value for 1271 funders. The OpenAPI only says the value must be "0x-prefixed hex". Pass the keeper's ECDSA signature over the typed data and have the vault accept that as well. Test once on mainnet with a small amount before the demo.
- **Fallback if 1271 fails in testing:** the vault transfers the token leg to the keeper's Dynamic server wallet (EOA). The keeper runs the Flash TWAP from that wallet and then calls `vault.repay(usdc)`. This is simpler but custodial for the duration of the TWAP.

## 6. MCP server / agent integration
- npm: `@definitive-fi/flash-mcp` **0.1.11** (published 2026-07-17, MIT, node >=20). Source: https://github.com/DefinitiveCo/flash-mcp. Dependencies: `@modelcontextprotocol/sdk ^1.18`, `viem ^2.21`, `@solana/web3.js`, `zod ^3.23`.
- Install: `claude mcp add definitive-flash -- npx -y @definitive-fi/flash-mcp`. Setup: `npx -y @definitive-fi/flash-mcp setup`.
- Tools: `flash_setup, flash_status, flash_quote, flash_balances, flash_submit_order (market|limit|twap|stop|take-profit), flash_get_order, flash_list_orders, flash_cancel_order`. **The MCP tools do not list bracket support**, so use the REST API for brackets.
- Env vars (these take precedence over the keychain; the keychain is macOS-only, so on Windows use env): `DEFINITIVE_API_KEY`, `DEFINITIVE_PRIVATE_KEY` (EVM 0x hex), `DEFINITIVE_SVM_PRIVATE_KEY`, `DEFINITIVE_RPC_<CHAIN>`.
- The MCP signs with a **raw private key**. It cannot sign through a Dynamic server wallet. Our keeper should therefore call REST directly with the Dynamic signer's `signTypedData`, and the MCP stays optional tooling (for example, in the Bankr Skill docs for power users).

## 7. Post-trade data (leaderboard PnL)
`GET /orders/{id}?funderAddress=` returns `order.filled.{averagePrice, averageNotionalPrice, targetAmount, contraAmount}` plus `fills[]` with `{fillPrice, targetAmount, contraAmount, notional, feeNotional, integratorFeeNotional, venues, transactionId, filledAt}`. Use these values to compute a realized follower PnL per signal. The Orders WS (`{"channel":"orders","type":"subscribe","funderAddress":"0x…","apiKey":"dpka_…"}`) streams updates. Without `funderAddress` it streams the whole org.

## 8. What is NOT possible / gotchas
- There is no native DCA (see above; use TWAP) and no standalone bracket (use `attachedBracket`).
- There is **no Anvil/DEMO_FORK support**. Flash executes on real Base only, because its offchain keeper lands transactions on mainnet. In DEMO_FORK mode, skip Flash and label it clearly. Quotes still work against mainnet.
- There is no testnet.
- Cross-chain works for market orders only, and brackets are same-chain only.
- An entry that buys native ETH cannot take a bracket, so buy WETH instead.
- The signature has no min-out. Slippage is enforced offchain by Flash (a trust assumption; mention it in the README).
- The approve tx must come from `funderAddress` and cannot be batched with the EIP-712 signature.
- EIP-7702-delegated EOAs are validated through 1271, and bare ECDSA sigs may be rejected. Keep the keeper as a plain EOA/MPC wallet.
- The shared public key: orders are attributed to Definitive, integrator fees can't be collected, and `GET /orders` without a funder shows org-wide data. Get our own key (self-serve, a few minutes).
- The rate limit of 5 rps/endpoint means follower mirroring must be queued or throttled.
- Creator tokens have thin liquidity. For example, GITLAWB has $1.24M liquidity and $75k 24h volume. Check `estimatedPriceImpact` and `/search.riskFlagged` before sizing, and drive `twapBucketCount` from the quote impact.
- Hackathon compliance: TWAP (keeper) and attached Bracket (followers) are both on the required list. Also tag @DefinitiveFi.
