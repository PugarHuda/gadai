# Product

<!-- impeccable:product-schema 1 -->

> Source: written from the user's written brief (delivered through the orchestrating agent). No live interview round was possible in that session; facts below are the brief's, repository evidence is marked (repo).

## Platform

web

## Users

- **Hackathon judges** (Bankr, Propaganda, Dynamic, Uniswap, Definitive, Blackbird) watching a ~3-minute recorded demo, and later opening the deployed site cold. They need to grasp the mechanism in seconds and see each sponsor integration doing real work.
- **Bankr agent operators and token creators** on Base: crypto-native, comfortable with wallets, tx hashes and basis points. Their job: turn a token's creator-fee stream into USDC now, without selling the token.
- **Lenders**: bid for FeeNotes in auctions, follow underwriters, redeem notes as fees arrive.

## Product Purpose

Gadai (Indonesian for "pledge / pawn") lends USDC to Bankr AI agents and token creators on Base. The borrower pledges their Bankr/Doppler token's creator-fee rights to a per-loan on-chain FeeVault (`FeesManager.updateBeneficiary`). WETH fees flow into the vault and repay the loan; when debt reaches zero anyone can call `release()` and the fee rights go back. Success: a judge understands pledge → auction → disburse → repay → release from the home page alone, and every flow works live on the demo fork.

## Positioning

Credit collateralized by a *fee stream*, not a token balance: the lien is the beneficiary slot itself, held by a vault that can only hand it back. Loans are funded by selling a new asset, the FeeNote ERC-20 (senior claim on 1 USDC of that loan's fees), in a Uniswap Continuous Clearing Auction. Underwriting is done in public by AI personas whose track record is scored on-chain.

## Operating Context

- Flows (repo): home loan book (`/`), apply + quote + credit memos + pledge (`/apply`), FeeNote auctions and holdings (`/notes`), loan detail with auction, debt, timeline, redeem, release (`/loans/[id]`; `/loan/:id` redirects), Follow the Desk leaderboard / signals / follows / mirror orders (`/desk`; `/leaderboard` redirects), Flynet dining line (`/dine`, `/dine/[id]`).
- AI underwriter: Bankr LLM Gateway personas write credit memos; the lead persona's decision binds; an engine-only fallback must be labeled as such.
- Follow the Desk: followers mirror approved borrowers via Definitive Flash bracket (TP/SL) or DCA (TWAP) orders; auto-mirror via Dynamic delegated access.
- Dine on your fees: Blackbird Flynet restaurant credit draws recorded on the FeeVault as junior debt.
- Logins and signing via Dynamic embedded wallets.

## Capabilities and Constraints

- Demo runs in **DEMO_FORK** mode (Anvil fork of Base). The DEMO_FORK banner must stay visible and honest: on-chain state is local, fork-only txs have no Basescan link, Flash is mainnet-only.
- The agent API may be offline when judges open the deployed site: every page needs a designed empty / offline state; never crash, never show a raw stack or fetch error as the primary content.
- Web app is Next.js App Router + Tailwind v4 + Dynamic React SDK + viem (repo). Agent, contracts and shared packages are out of scope for UI work.
- Terminology: FeeVault, FeeNote (ticker prefix `fn$`), CCA, lien, release, claim-first, lead underwriter, dining line, draw, mirror order.

## Brand Commitments

- Name: **Gadai**. Indonesian name, English UI copy.
- Voice: precise, confident, finance-grade, honest about risk. Numbers before adjectives.
- Must look distinctive, not generic AI SaaS.

## Evidence on Hand

- Live data comes only from the agent API and chain reads; there are no testimonials, customers, TVL figures or benchmarks. Do not fabricate any.
- Sponsor integrations are real and named in the product: Bankr (fee APIs, LLM Gateway, skill), Doppler, Uniswap (CCA, Trading API), Dynamic (embedded + agent wallets, delegation), Definitive (Flash), Blackbird (Flynet).

## Product Principles

1. Show the mechanism, not a pitch: every screen should make the pledge → note → repay → release loop legible.
2. Every number is sourced: say where it was read (on-chain, agent, Bankr API).
3. Risk is stated plainly: declines, failed auctions, fork-only limits and fallbacks are shown, never hidden.
4. Degrade gracefully: offline agent or empty book still reads as a working product with a clear next step.

## Accessibility & Inclusion

WCAG 2.1 AA baseline: keyboard reachable controls, visible focus, 4.5:1 body contrast, status not conveyed by color alone (pills carry text).
