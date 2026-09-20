# On-chain evidence (Base mainnet + Robinhood Chain, last checked 2026-09-20)

Every transaction below was signed by the desk's **Dynamic agent wallet**
[`0x81b73786BF2dE819e66BB57d08effADe0085305D`](https://basescan.org/address/0x81b73786BF2dE819e66BB57d08effADe0085305D)
(Dynamic "agent wallet" pattern: agent signing token → SIWE → user JWT → 2-of-2 MPC wallet, `@dynamic-labs-wallet/node-evm`).
The full loan lifecycle runs on an Anvil fork of Base against a real Bankr pool (see the demo video); these are the parts that ran on mainnet.

| # | What | Why it matters | Tx |
|---|---|---|---|
| 1 | Uniswap Trading API swap, 0.00015 ETH → 0.395941 USDC (routing CLASSIC, impact 0.01%) | The desk funds its own API budget through the same Uniswap API the keeper uses | [0x6dd51e0c…6cc072](https://basescan.org/tx/0x6dd51e0c3fa3a8ace9633a32200857b8795c1e6cadd06e0eb5d9f701026cc072) |
| 2 | Deploy `FeeDesk` (keeper = Dynamic agent wallet, treasury = desk Bankr wallet, oracle max age 1 h) | The lending desk is live on Base mainnet | [0x21cce932…c233ee858](https://basescan.org/tx/0x21cce9322a7ceb0a1af4225973d9ad3969c298a5594d7f71a7f7689c233ee858) → [`0xa4f21ace41923bccfdebf1c6ab49659d80476b4f`](https://basescan.org/address/0xa4f21ace41923bccfdebf1c6ab49659d80476b4f) |
| 3 | ERC-8004 `register(agentURI)` → desk agent **#94699**, calldata carries the Base builder code `bc_32d4pc8g` (ERC-8021) | The underwriter has an on-chain identity that repayment reputation attaches to | [0xde4b3490…966229cb](https://basescan.org/tx/0xde4b3490940e7bc064c3511c7843eab20f16f1419e456185e35a7690966229cb) |
| 4 | **Agent pays for an API over x402**: the desk buys a third-party honeypot/rug verdict for the GITLAWB token ($0.05 USDC, EIP-3009 signed by the Dynamic MPC wallet, settled by the Bankr facilitator). Verdict SAFE → no limit reduction; HONEYPOT would decline, SUSPICIOUS halves the limit | Dynamic track: "an agent that pays for an API, retries the request and uses the response" | [0x9c22339b…3f98ad00](https://basescan.org/tx/0x9c22339bffe1f0e424dad6d5ab64d77603176716d95694eb40430d203f98ad00) |
| 5 | **Definitive Flash TWAP order** `fb3b2572-48c6-4ce5-b79a-6199cefac82f`: the desk mirrors its own approved credit signal (buy the approved borrower token GITLAWB, 0.25 USDC in 2 slices over 10 min). Order EIP-712 typed data signed by the Dynamic MPC wallet (approval [0x6cef30c5…1f0ce007](https://basescan.org/tx/0x6cef30c59a7e6d071fb543f19443ef1cf6db0470b689e382296852121f0ce007)) | Flash track: an advanced order (TWAP) placed by an agent that others follow; same order shape a DCA follower mirror uses | first fill 0.125 USDC → 2,158 GITLAWB via Uniswap v2+v3: [0x261a1355…3bcab4](https://basescan.org/tx/0x261a1355c4d5c7a1e97aaf398a1eb42f8c8563b5489f68709c2bd7660f3bcab4) |
| 6 | **Onchain equities, for real**: the desk bridges **0.0002 ETH** from Base to **Robinhood Chain (4663)** through Relay (`depositNative` to the Relay Depository `0x4cD0…BC31`), then buys **0.000789621985268726 TSLA** ("Tesla • Robinhood Token", `0x322F0929c4625eD5bAd873c95208D54E1c003b2d`) for **0.000109976 ETH** through the **Uniswap Trading API on chain 4663** | The Credit Line Board prices Bankr agents whose creator fees are paid in tokenized stocks (SPY, TSLA, MSTR); this proves that leg is tradable, not theoretical | bridge (Base) [0xc65bd93a…5af2d4](https://basescan.org/tx/0xc65bd93a23bdf9756dec9503aeb40ff902d9beeb53200a6068c99cab2e5af2d4) · swap (4663) [0xbfbe9702…66dd708](https://robinhoodchain.blockscout.com/tx/0xbfbe9702dd40ed28e734d1ebc319a7ace9d27b30f77eb5185179de01366dd708) · [TSLA balance](https://robinhoodchain.blockscout.com/token/0x322F0929c4625eD5bAd873c95208D54E1c003b2d?a=0x81b73786BF2dE819e66BB57d08effADe0085305D) |

Rows 1–5 are Base mainnet. Row 6 is one Base tx (the bridge deposit) plus one Robinhood Chain tx (the swap).

**Re-checking row 6 without an explorer** (robinhoodchain.blockscout.com sits behind a Cloudflare challenge, and this network's ISP hijacks `rpc.mainnet.chain.robinhood.com`, so we use a public RPC):

```bash
curl -s -X POST https://robinhood-rpc.publicnode.com -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_getTransactionReceipt","params":["0xbfbe9702dd40ed28e734d1ebc319a7ace9d27b30f77eb5185179de01366dd708"]}'
```
On 2026-09-20 this returns `status 0x1` and a `Transfer` log from TSLA `0x322f0929…3b2d` to the desk wallet for `0x2ce2831f053f6` = 0.00078962 TSLA, plus a WETH deposit of `0x6405cd3af26b` = 0.000109976 ETH into the 4663 Universal Router `0x204FAca1…0498`.

Also live on mainnet infrastructure:
- Paid credit report on Bankr x402 Cloud: `https://x402.bankr.bot/0x0455408228f460722ecbe80789bcf1628b479e98/gadai-credit?token=0x…` ($0.02, returns HTTP 402 with payment requirements).
- Bankr Agent Profile `gadai` (pending Bankr review).
- **Dynamic delegated access: configured and live, awaiting one user approval.** The RSA credential is uploaded in the Dynamic console, `DYNAMIC_AUTH_TOKEN` and `DYNAMIC_WEBHOOK_SECRET` are set, and the webhook endpoint is verified by Dynamic and enforcing HMAC. Check it yourself: an unsigned POST is rejected.
  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' -d '{}' \
    https://aqua-economic-moss-modes.trycloudflare.com/api/dynamic/webhook     # → 401 (bad signature)
  ```
  What is still missing is a human: one person must open `/desk`, tick **auto-mirror** and approve the Dynamic delegation prompt in the browser, which makes Dynamic post `wallet.delegation.created` and gives us a stored delegation to point at. Until that happens, no delegation evidence is claimed here. Steps: [docs/integrations/dynamic.md §3](integrations/dynamic.md).

Reproduce: `agent/src/demo/mainnet-deploy.ts` (1–3), `agent/src/demo/risk-check.ts` (4) `agent/src/demo/desk-mirror.ts` (5) and `agent/src/demo/rh-equity-swap.ts` (6), run under WSL/Linux with the `.env` described in `.env.example`.

Found while doing this: Flash's order typed data carries an explicit `EIP712Domain` type and a string `chainId`, which made the
Dynamic MPC relay drop the signing WebSocket. `forMpcSigner()` in `agent/src/wallet/index.ts` normalizes it at the single
signing chokepoint (same EIP-712 digest, unit-tested), so the keeper TWAP and follower mirrors sign correctly too.
