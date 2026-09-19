# On-chain evidence (Base mainnet, 2026-09-19)

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

Also live on mainnet infrastructure:
- Paid credit report on Bankr x402 Cloud: `https://x402.bankr.bot/0x0455408228f460722ecbe80789bcf1628b479e98/gadai-credit?token=0x…` ($0.02, returns HTTP 402 with payment requirements).
- Bankr Agent Profile `gadai` (pending Bankr review).

Reproduce: `agent/src/demo/mainnet-deploy.ts` (1–3) and `agent/src/demo/risk-check.ts` (4), run under WSL/Linux with the `.env` described in `.env.example`.
