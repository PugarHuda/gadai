# Ready to paste (submission, 2026-09-20)

Every line below was checked against the live endpoints and `docs/EVIDENCE.md` on 2026-09-20. If the tunnel hostname changes before you submit, replace `aqua-economic-moss-modes.trycloudflare.com` everywhere. The X thread lives in [x-post.md](x-post.md); the short post below is the fallback if you post only one.

## Links
- Repo: https://github.com/PugarHuda/gadai
- Live site: https://gadai-six.vercel.app (live data from the Gadai agent, which runs in DEMO_FORK on an Anvil fork of Base)
- Demo video (duration: **TODO(lead)** — confirm after the re-cut): https://gadai-six.vercel.app/demo (direct MP4: https://gadai-six.vercel.app/gadai-demo.mp4)
- Slides: https://gadai-six.vercel.app/deck (only paste this once it returns 200)
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
- Credit Line Board: every Bankr agent profile priced live by the same engine. At 01:19 UTC on 2026-09-20: 105 Base agents, 14 eligible, $856.57 of pre-approved credit, 593.3 WETH lifetime fees, 19.5B LLM tokens in 30 days. It also lists 17 Robinhood Chain agents as indicative lines ($444.93), 3 of them earning fees in tokenized stocks (SPY, TSLA, MSTR; $64,514 of lifetime equity fees). These are live reads and change through the day.
- Onchain equities, executed: the desk bridged 0.0002 ETH from Base to Robinhood Chain with Relay and bought 0.00079 TSLA through the Uniswap Trading API on chain 4663.
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
6. Onchain equity purchase: 0.0002 ETH bridged Base → Robinhood Chain through Relay (Base tx 0xc65bd93a23bdf9756dec9503aeb40ff902d9beeb53200a6068c99cab2e5af2d4), then 0.00078962 TSLA bought for 0.00011 ETH with the Uniswap Trading API on chain 4663 (swap tx 0xbfbe9702dd40ed28e734d1ebc319a7ace9d27b30f77eb5185179de01366dd708).

**Honest scope:** the full loan cycle ran end to end on an Anvil fork of Base against a real Bankr pool (GITLAWB): apply, pledge, CCA, 239.75 USDC disbursed, 0.166 WETH collected, Uniswap Trading API swap to 289.71 USDC, repaid, released, ERC-8004 feedback. Our Bankr LLM credits are $0, so memos are written by deterministic persona rules and labelled "rules, no LLM review"; the LLM path is built and fails closed. The vault-funded Flash TWAP and follower mirrors are built and quote-tested but not filled (Flash settles on mainnet only). The Flynet app is approved on production with read scopes plus `write:save_to_list`; payment and rewards scopes are pending Blackbird review, so no FLY moves, and save-to-list returns an honest 501 because Blackbird has not published that endpoint. Dynamic delegated access is configured end to end (RSA credential uploaded, webhook verified and rejecting unsigned posts with 401), but no delegation has been granted yet, because that needs a person to approve the prompt in a browser.

**Tracks:** Bankr, Dynamic, Uniswap, Definitive Flash, Blackbird. Grok Bot only if the public Grok Bot template link exists (see below).

## Per-track text

**Bankr.** Bankr is the foundation: the collateral is a Bankr/Doppler creator-fee share, the pledge tx comes from Bankr's `build-transfer-beneficiary`, underwriting reads `/token-launches/{token}/fees` and `claimable-fees`, the memo path runs on the Bankr LLM Gateway, the Bankr Skill lets any Bankr agent borrow by chat and turn the loan into `bankr llm credits add`, the credit report is sold on Bankr x402 Cloud, and the Credit Line Board prices every Bankr agent profile. **Onchain equities:** the board also prices the Bankr agents on Robinhood Chain whose creator fees arrive as tokenized stocks (SPY, TSLA, MSTR), converting Bankr's WETH-labelled amounts back into shares, and the desk proved that leg is tradable by actually buying TSLA on chain 4663 (EVIDENCE #6). Evidence: README "Bankr" section, `/board`, `/loans/1`, the x402 URL above.

**Dynamic.** The desk is a Dynamic agent wallet (agent signing token → SIWE → JWT → 2-of-2 MPC, `@dynamic-labs-wallet/node-evm`). After the lead memo approves, the same wallet signs `createLoan`, the USDC anchor bid and `disburse()` to the borrower. Before approving, it pays a third-party API over x402 ($0.05 USDC, mainnet tx in EVIDENCE #4), retries the request and uses the verdict (HONEYPOT declines, SUSPICIOUS halves the limit). It also signed the mainnet FeeDesk deploy, the ERC-8004 registration, the Flash TWAP, and the two-chain equity purchase (Relay bridge on Base, then the TSLA swap on Robinhood Chain). If it is short on gas when a verdict is due, it swaps a capped amount of its own USDC for ETH first (`RISK_AUTO_TOPUP`). Borrowers and lenders use Dynamic embedded wallets. Auto-mirroring uses **delegated access**, which is configured and live: the RSA credential is uploaded, the webhook is verified by Dynamic and enforcing HMAC (an unsigned POST gets 401), and the encrypted key share is only ever stored encrypted and decrypted per signature. Granting a delegation needs a human to approve the browser prompt on /desk, so we claim the plumbing, not a granted delegation.

**Uniswap.** New asset: the FeeNote, an ERC-20 claim on one loan's repayment stream, sold in a Uniswap CCA v2.1.0 that funds the loan (`requiredCurrencyRaised = principal`). New agents: each underwriter persona publishes a `maxNotePrice` and the desk agent places the anchor bid at its lead's price; humans can copy it. The keeper swaps collected WETH to USDC through the Trading API with the vault as the swapper (`minUsdcOut` enforced on-chain, floored at 95% of Chainlink). Mainnet Trading API swap: EVIDENCE #1. **Real-world assets:** the same Trading API prices and trades Robinhood tokenized stocks on chain 4663 — it values the equity-quoted creator fees on the Credit Line Board, and the desk used it to buy 0.00079 TSLA for real (EVIDENCE #6). Feedback: FEEDBACK.md.

**Definitive Flash.** Follow the Desk: every credit memo is a public signal, personas are ranked on realized repayment and follower PnL, and followers mirror approved borrowers as a Flash market entry with an attached Bracket (TP/SL) or a DCA built from a long TWAP; each signal has a shareable card. The keeper sells the creator-token fee leg with a Flash TWAP so the borrower's token isn't dumped. On mainnet the desk placed a real Flash TWAP mirroring its own approved signal (order fb3b2572-48c6-4ce5-b79a-6199cefac82f, first slice filled: EVIDENCE #5). The desk's Flash integrator fee is set to 10 bps; `GET /api/flash/info` reports `integratorFeeBps: 10, integratorFeeSet: true`.

**Blackbird.** A dining concierge on live Flynet production data: ask for "somewhere in NYC for four, open late" and get real Blackbird venues with today's hours, specials, challenges and a cost estimate against the loan's dining budget. A member can log in with Blackbird (OAuth + PKCE) for a passport of places visited, membership cards and gaps nearby, and the plan uses those cards plus the venue's 7-day network check-in count (there is also a `GET /api/flynet/trending` view). "Save to my Blackbird list" returns an honest 501: we hold the scope, but Blackbird has published no endpoint for it, and we would not guess a path. Our app "hackathon 2" is approved on production with read:profile, read:wallets, read:user_checkins, read:checkins, read:app, read:balance, read:restaurant_specials, read:restaurant_challenges, write:save_to_list, read:memberships and read:tags. Payments and rewards are pending Blackbird review, so Gadai moves no FLY; the member pays in the Blackbird app.

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

Replies (the full thread is in [x-post.md](x-post.md)):
1. Flash track: "The desk already mirrored its own approved signal with a real Flash TWAP on Base: order fb3b2572-48c6-4ce5-b79a-6199cefac82f, first slice filled. Integrator fee 10 bps. Evidence: gadai-six.vercel.app/evidence"
2. Onchain equities: "Some Bankr creators are paid their fees in tokenized stocks. So the desk bought one: 0.0002 ETH bridged from @base with Relay, then 0.00079 TSLA via the @Uniswap Trading API on Robinhood Chain. Real tx, not a mock: gadai-six.vercel.app/evidence"
3. Dynamic: "Follow the desk in auto mode and a @dynamic_xyz delegation lets it sign your mirror orders for you. The webhook is live and HMAC-verified; we only ever store the encrypted key share and decrypt it per signature."

## Uniswap developer feedback form

**What did you build?** Gadai, a credit desk for Bankr agents. Each loan is a new ERC-20, the FeeNote, sold in a Uniswap Continuous Clearing Auction (v2.1.0 factory on Base) that funds the loan. The desk's agent and its underwriter personas price the notes and bid. The keeper swaps the collected WETH fees to USDC through the Trading API (`/check_approval` → `/quote` → `/swap`, no-Permit2 SwapProxy flow) with the vault contract as the swapper.

We also used the Trading API on **chain 4663 (Robinhood Chain)** for real-world assets: some Bankr pools are quoted in Robinhood tokenized stocks, so those creators are paid their fees in SPY, TSLA or MSTR. Our Credit Line Board values those fee streams with a `/quote` on 4663 (0.1 share → WETH, multiplied by the Base ETH/USD quote), and the desk then proved the liquidation leg by actually buying a tokenized stock: it bridged 0.0002 ETH from Base with Relay and bought 0.00078962 TSLA through `/quote` + `/swap` on 4663 (tx `0xbfbe9702dd40ed28e734d1ebc319a7ace9d27b30f77eb5185179de01366dd708`).

**Which Uniswap products?** Trading API (on Base 8453 and Robinhood Chain 4663), Continuous Clearing Auction v2.1.0.

**Feedback:** paste the sections of FEEDBACK.md and link https://github.com/PugarHuda/gadai/blob/main/FEEDBACK.md. The newest item is chain 4663: the Trading API returns no quotes there if you send `x-universal-router-version: 2.0` (that chain's Universal Router is 2.1.1), and the fix is to omit the header entirely — which took a while to find, because the failure looks like "no route" rather than a bad header.

**Mainnet txs:** Base — https://basescan.org/tx/0x6dd51e0c3fa3a8ace9633a32200857b8795c1e6cadd06e0eb5d9f701026cc072 · Robinhood Chain — https://robinhoodchain.blockscout.com/tx/0xbfbe9702dd40ed28e734d1ebc319a7ace9d27b30f77eb5185179de01366dd708
