# Ready to paste (submission, 2026-09-19)

Every line below was checked against the live endpoints and `docs/EVIDENCE.md` on 2026-09-19. If the tunnel hostname changes before you submit, replace `aqua-economic-moss-modes.trycloudflare.com` everywhere.

## Links
- Repo: https://github.com/PugarHuda/gadai
- Live site: https://gadai-six.vercel.app (live data from the Gadai agent, which runs in DEMO_FORK on an Anvil fork of Base)
- Demo video (3:08, narrated): https://gadai-six.vercel.app/demo (direct MP4: https://gadai-six.vercel.app/gadai-demo.mp4)
- Mainnet evidence: https://gadai-six.vercel.app/evidence (source: https://github.com/PugarHuda/gadai/blob/main/docs/EVIDENCE.md)
- Credit Line Board: https://gadai-six.vercel.app/board
- A full loan (fork): https://gadai-six.vercel.app/loans/1
- Agent health: https://aqua-economic-moss-modes.trycloudflare.com/api/health
- Paid credit report (x402, $0.02 USDC on Base, answers 402 without payment): https://x402.bankr.bot/0x0455408228f460722ecbe80789bcf1628b479e98/gadai-credit?token=0x5F980Dcfc4c0fa3911554cf5ab288ed0eb13DBa3
- FeeDesk on Base mainnet: https://basescan.org/address/0xa4f21ace41923bccfdebf1c6ab49659d80476b4f
- Desk agent wallet (Dynamic MPC): https://basescan.org/address/0x81b73786BF2dE819e66BB57d08effADe0085305D
- ERC-8004 desk agent: #94699 on Base mainnet

## Runtime submission form

**Project name:** Gadai

**One-liner:** USDC credit for Bankr agents and creators, secured by a lien on their token's creator-fee rights.

**Description:**
Bankr agents earn a share of every trade of their token, yet they still run out of LLM credits, and today they can only top up by hand or sell the token. Gadai turns that fee stream into collateral. The borrower moves its Doppler fee share to a per-loan FeeVault with `updateBeneficiary`; only the vault can move it back, and only to the borrower. Lenders fund the loan by buying FeeNotes, a new ERC-20 sold in a Uniswap Continuous Clearing Auction. The desk's Dynamic agent wallet places the anchor bid and sends the USDC to the borrower. The vault collects the fees, a keeper swaps WETH to USDC through the Uniswap Trading API, and once the notes are covered anyone can call `release()` to return the fee rights.

The underwriter reads live data from Bankr's fee APIs and sizes the loan with a deterministic engine. Three underwriter personas write credit memos; the lead memo is binding and can only lower the amount. Before approving, the Dynamic agent wallet pays a third-party API over x402 for a token risk verdict and uses it. Every credit decision is a public signal ("Follow the Desk"), and followers can mirror approved borrowers with Definitive Flash bracket (TP/SL) or DCA orders. Each loan also carries a dining budget, and a concierge plans meals from live Blackbird Flynet data.

**Also built:**
- Credit Line Board: every Bankr agent profile priced live by the same engine. At 15:44 UTC on 2026-09-19: 105 Base agents, 14 eligible, $756.69 of pre-approved credit, 593 WETH lifetime fees, 18.6B LLM tokens in 30 days. It also lists 17 Robinhood Chain agents as indicative lines, 4 of them earning fees in tokenized stocks (SPY, TSLA, MSTR, AMZN).
- Paid credit report on Bankr x402 Cloud ($0.02 USDC per report, agent-to-agent commerce).
- ERC-8004: the desk is registered agent #94699 on Base mainnet; a repaid loan writes repayment reputation for the borrower's agent and the outcome to the desk's metadata.
- Base Builder Code (ERC-8021) on every desk transaction.
- Bankr Skill (`skill/gadai`) so any Bankr agent can borrow by chat, Grok Bot skills (`grok/`), and a Bankr agent profile `gadai` (pending Bankr review).

**On Base mainnet (docs/EVIDENCE.md), all signed by the Dynamic agent wallet:**
1. Uniswap Trading API swap, 0.00015 ETH → 0.395941 USDC.
2. FeeDesk deployed at 0xa4f21ace41923bccfdebf1c6ab49659d80476b4f.
3. ERC-8004 registration, desk agent #94699, with builder code bc_32d4pc8g.
4. x402 payment: the agent bought a honeypot/rug verdict for GITLAWB for $0.05 USDC (EIP-3009, Bankr facilitator).
5. Definitive Flash TWAP order fb3b2572-48c6-4ce5-b79a-6199cefac82f: the desk mirrors its own approved signal (0.25 USDC → GITLAWB in 2 slices); first slice filled, 0.125 USDC → 2,158 GITLAWB.

**Honest scope:** the full loan cycle ran end to end on an Anvil fork of Base against a real Bankr pool (GITLAWB): apply, pledge, CCA, 239.75 USDC disbursed, 0.166 WETH collected, Uniswap Trading API swap to 289.71 USDC, repaid, released, ERC-8004 feedback. Our Bankr LLM credits are $0, so memos are written by deterministic persona rules and labelled "rules, no LLM review"; the LLM path is built and fails closed. The vault-funded Flash TWAP and follower mirrors are built and quote-tested but not filled (Flash settles on mainnet only). The Flynet app is approved on production with read scopes plus `write:save_to_list`; payment and rewards scopes are pending Blackbird review, so no FLY moves.

**Tracks:** Bankr, Dynamic, Uniswap, Definitive Flash, Blackbird. Grok Bot only if the public Grok Bot template link exists (see below).

## Per-track text

**Bankr.** Bankr is the foundation: the collateral is a Bankr/Doppler creator-fee share, the pledge tx comes from Bankr's `build-transfer-beneficiary`, underwriting reads `/token-launches/{token}/fees` and `claimable-fees`, the memo path runs on the Bankr LLM Gateway, the Bankr Skill lets any Bankr agent borrow by chat and turn the loan into `bankr llm credits add`, the credit report is sold on Bankr x402 Cloud, and the Credit Line Board prices every Bankr agent profile. Evidence: README "Bankr" section, `/board`, `/loans/1`, the x402 URL above.

**Dynamic.** The desk is a Dynamic agent wallet (agent signing token → SIWE → JWT → 2-of-2 MPC, `@dynamic-labs-wallet/node-evm`). After the lead memo approves, the same wallet signs `createLoan`, the USDC anchor bid and `disburse()` to the borrower. Before approving, it pays a third-party API over x402 ($0.05 USDC, mainnet tx in EVIDENCE #4), retries the request and uses the verdict (HONEYPOT declines, SUSPICIOUS halves the limit). It also signed the mainnet FeeDesk deploy, the ERC-8004 registration and the Flash TWAP. Borrowers and lenders use Dynamic embedded wallets; auto-mirroring uses delegated access.

**Uniswap.** New asset: the FeeNote, an ERC-20 claim on one loan's repayment stream, sold in a Uniswap CCA v2.1.0 that funds the loan (`requiredCurrencyRaised = principal`). New agents: each underwriter persona publishes a `maxNotePrice` and the desk agent places the anchor bid at its lead's price; humans can copy it. The keeper swaps collected WETH to USDC through the Trading API with the vault as the swapper (`minUsdcOut` enforced on-chain, floored at 95% of Chainlink). Mainnet Trading API swap: EVIDENCE #1. Feedback: FEEDBACK.md.

**Definitive Flash.** Follow the Desk: every credit memo is a public signal, personas are ranked on realized repayment and follower PnL, and followers mirror approved borrowers as a Flash market entry with an attached Bracket (TP/SL) or a DCA built from a long TWAP; each signal has a shareable card. The keeper sells the creator-token fee leg with a Flash TWAP so the borrower's token isn't dumped. On mainnet the desk placed a real Flash TWAP mirroring its own approved signal (order fb3b2572-48c6-4ce5-b79a-6199cefac82f, first slice filled: EVIDENCE #5).

**Blackbird.** A dining concierge on live Flynet production data: ask for "somewhere in NYC for four, open late" and get real Blackbird venues with today's hours, specials, challenges and a cost estimate against the loan's dining budget. A member can log in with Blackbird (OAuth + PKCE) for a passport of places visited and gaps nearby. Our app "hackathon 2" is approved on production with read:profile, read:wallets, read:user_checkins, read:checkins, read:app, read:balance, read:restaurant_specials, read:restaurant_challenges, write:save_to_list, read:memberships and read:tags. Payments and rewards are pending Blackbird review, so Gadai moves no FLY; the member pays in the Blackbird app.

**Grok Bot (only if the link exists).** `grok/` holds two Agent Skills: `gadai-credit` (quote, pledge-flow explainer, Credit Line Board, the paid x402 report after asking) and `gadai-loan-watch` (read-only daily loan summary). Submit this track only after the user has created the Bot in Grok Bot and copied its public link (Share → Create template → Public link; steps in docs/distribution.md). Template link: ______

## X post (tag @DefinitiveFi, required for the Flash track)

(280 characters; X counts the link as 23, so it fits.)

> Gadai: USDC credit for @bankrbot agents, secured by a lien on their token's creator fees. #Runtime
>
> FeeNotes sell in a @Uniswap CCA, a @dynamic_xyz agent wallet pays out, fees repay.
>
> Mirror every credit call with @DefinitiveFi Flash bracket/DCA orders.
>
> gadai-six.vercel.app/demo

Reply to it (for the Flash track): "The desk already mirrored its own approved signal with a real Flash TWAP on Base: order fb3b2572-48c6-4ce5-b79a-6199cefac82f. Evidence: gadai-six.vercel.app/evidence"

## Uniswap developer feedback form

**What did you build?** Gadai, a credit desk for Bankr agents. Each loan is a new ERC-20, the FeeNote, sold in a Uniswap Continuous Clearing Auction (v2.1.0 factory on Base) that funds the loan. The desk's agent and its underwriter personas price the notes and bid. The keeper swaps the collected WETH fees to USDC through the Trading API (`/check_approval` → `/quote` → `/swap`, no-Permit2 SwapProxy flow) with the vault contract as the swapper. We also used the Trading API on chain 4663 (Robinhood Chain) to price tokenized-stock fees.

**Which Uniswap products?** Trading API, Continuous Clearing Auction v2.1.0.

**Feedback:** paste the sections of FEEDBACK.md and link https://github.com/PugarHuda/gadai/blob/main/FEEDBACK.md

**Mainnet tx:** https://basescan.org/tx/0x6dd51e0c3fa3a8ace9633a32200857b8795c1e6cadd06e0eb5d9f701026cc072
