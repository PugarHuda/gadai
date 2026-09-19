# Ready to paste (submission, 2026-09-19)

Links
- Repo: https://github.com/PugarHuda/gadai
- Live site: https://gadai-six.vercel.app (the agent runs locally in DEMO_FORK mode; with it off the site shows a clear "agent offline" state)
- Demo video: <YouTube/Loom URL after upload> (file: docs/demo/gadai-demo.mp4, 2:02, narrated)

## Runtime submission form

**Project name:** Gadai

**One-liner:** USDC credit for Bankr agents and creators, secured by a lien on their token's creator-fee rights.

**Description:**
Bankr tokens pay creators a share of every trade, but an agent that runs out of LLM credits today can only top up by hand or sell its token. Gadai turns that fee stream into collateral. The borrower moves its Doppler fee share to a per-loan FeeVault with `updateBeneficiary` (we verified on Base that a contract can hold and move the share, and that only the vault can move it back). Lenders fund the loan by buying FeeNotes, a new ERC-20 sold in a Uniswap Continuous Clearing Auction. The vault collects the fees, a keeper swaps WETH to USDC through the Uniswap Trading API, and once the debt is zero anyone can call `release()` to return the fee rights.

The underwriter reads live data from Bankr's public fee APIs, sizes the loan with a deterministic engine and asks three personas on the Bankr LLM Gateway for credit memos (the lead memo can only lower the amount). The desk's wallet is a Dynamic agent wallet (agent signing token, MPC) that creates loans, bids, disburses and runs the keeper. Every credit decision is a public signal ("Follow the Desk"), and followers can mirror approved borrowers with Definitive Flash bracket or DCA orders. Borrowers can draw a small Flynet dining line against pledged fees.

**What's live in the demo (honest scope):** the full loan cycle ran end to end on an Anvil fork of Base against a real Bankr pool (GITLAWB): apply, pledge, CCA, disburse 239 USDC, collect 0.166 WETH, Uniswap Trading API swap to 289 USDC, repay, release. Every desk transaction is signed by the Dynamic agent wallet. Memos are labeled "engine-only" in the demo because our Bankr LLM credits were $0. Flash orders are mainnet-only, so the Flash path is implemented and quote-tested but not filled in the fork demo. Flynet is implemented against the documented API; our Maker account is awaiting approval.

**Tracks:** Bankr (auto), Dynamic, Uniswap, Definitive Flash (Blackbird only if Flynet access is approved before submitting)

## X post (tag @DefinitiveFi, required for the Flash track)

> Built Gadai for #Runtime: USDC credit for @bankrbot agents, secured by a lien on their token's creator fees.
>
> Pledge fee rights to a vault → FeeNotes sold in a @Uniswap CCA → @dynamic_xyz agent wallet disburses → fees repay → release() returns the rights.
>
> Every credit call is a public signal you can mirror with @DefinitiveFi Flash bracket/DCA orders.
>
> Demo: <video URL>
> Code: github.com/PugarHuda/gadai

## Uniswap developer feedback form
Paste the sections of FEEDBACK.md, and link: https://github.com/PugarHuda/gadai/blob/main/FEEDBACK.md
