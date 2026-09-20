# X (Twitter) posting package — Premium account, @BangDropID

Final. One long-form post, no thread. Every number and id is copied from [EVIDENCE.md](EVIDENCE.md), the [README](../README.md) and the canonical board snapshot below; nothing here claims more than those do.

**Canonical board snapshot (pinned by the lead, `/api/board` `generatedAt` 2026-09-20T01:19:15Z):** 105 Base agents, 14 eligible, **$856.57** pre-approved, 593.30 WETH lifetime fees, 9.6847 WETH claimable (~$25.4k at ETH $2,621.82), 19.48B LLM tokens in 30 days, 17 Robinhood Chain agents, 3 of them earning fees in tokenized stocks, $64,513.66 of lifetime equity fees. Never write "$756" or "$57k claimable". (A re-read at 01:34 UTC gave $855.82 / $64,527.60 — live drift, same shape. The pinned snapshot is what ships.)

Handles used: `@DefinitiveFi` (required by the Definitive Flash track), `@bankrbot`, `@dynamic_xyz`, `@Uniswap`, `@base`. Blackbird/Flynet stays in plain text because their handle is unverified.

---

## 1. The post (1,606 characters as X weights them — Premium allows 25,000)

Attach the video (§3), add the alt text (§4), then post.

```
Gadai — a credit desk for @bankrbot agents.

An agent earns a cut of every trade of its token, but the fees land later and the compute bill is due now. Its options: top up by hand or sell.

The lien. The borrower points its Doppler fee share at a per-loan FeeVault with updateBeneficiary. Only the contract moves it back, only to the borrower, and release() is permissionless; the desk can't keep them.

The funding. Each loan mints a FeeNote, an ERC-20 whose face value is the debt, sold for USDC in a @Uniswap Continuous Clearing Auction. Collected fees repay it via the Uniswap Trading API.

The underwriter reads real Bankr fee history and writes three memos; the lead is binding and can only lower it. Before approving, its @dynamic_xyz MPC wallet pays $0.05 USDC over x402 for a honeypot verdict, and uses it.

Every call is a public signal you can mirror with @DefinitiveFi Flash: an entry plus a Bracket (TP/SL), or a DCA from a TWAP. The desk went first: TWAP fb3b2572-48c6-4ce5-b79a-6199cefac82f, filled on Base mainnet.

The Credit Line Board prices every Bankr agent: 105 on Base, 14 eligible, $856.57 pre-approved (01:19 UTC, 20 Sep). Three are paid in tokenized stocks, so the desk bought one: 0.00079 TSLA on Robinhood Chain via Relay + Uniswap. A Blackbird Flynet concierge plans a meal inside the dining budget. ERC-8004 agent #94699 carries repayment reputation; @base builder code bc_32d4pc8g on every desk tx.

Honest scope: the full lifecycle ran on an Anvil fork of Base against a real Bankr pool. The mainnet actions are at /evidence.

https://gadai-six.vercel.app
https://github.com/PugarHuda/gadai
```

Where each claim comes from: lien and release() — README "How it works" 2/5 and `FeeVault.sol`; FeeNote + CCA — README "Uniswap"; x402 honeypot verdict $0.05 — EVIDENCE #4; Flash TWAP order `fb3b2572-48c6-4ce5-b79a-6199cefac82f` filled — EVIDENCE #5; board numbers — the pinned snapshot above; TSLA buy — EVIDENCE #6; ERC-8004 #94699 and builder code `bc_32d4pc8g` — EVIDENCE #3; fork scope — README "Live vs simulated".

## 2. Short fallback (277 characters, classic format)

Use only if the long post is not wanted. Same video, same alt text.

```
Gadai: USDC credit for @bankrbot agents, secured by an on-chain lien on the creator fees their token earns.

Every credit call is a public signal you can mirror with @DefinitiveFi Flash bracket/DCA orders — and the desk's own Flash TWAP filled on Base.

https://gadai-six.vercel.app
```

## 3. VIDEO TO ATTACH

Attach `web/public/gadai-demo.mp4` (absolute: C:/Hackathons/bankrbot hackathon/web/public/gadai-demo.mp4) — the current render: **4:49 (289.40 s), 43.2 MB**, H.264 1920x1080 + AAC, faststart. X Premium accepts it.

The same film is on the site at https://gadai-six.vercel.app/demo. An earlier 3:49 cut is on YouTube at https://youtu.be/F7joLyWWB0E — to make the post, the site and YouTube identical, re-upload the 4:49 file and use the new YouTube link everywhere.

`video/cuts/gadai-x.mp4` (2:00) was cut from the older 3:49 render, so its beats no longer line up; keep it only as a fallback if an upload is rejected.

## 4. Video alt text (994 characters; X allows 1,000)

Paste into X's "Add description" box on the attached video.

```
Narrated 4:49 screen demo of Gadai, a lending desk for Bankr agents. It opens on live counters: 105 Bankr agents on Base, 593 WETH of creator fees and 19B LLM tokens in 30 days. A nine step diagram draws the loan: updateBeneficiary moves the fee share to a FeeVault, the lien; FeeNotes sell in a Uniswap Continuous Clearing Auction; USDC goes to the borrower; fees are swapped to USDC through the Uniswap Trading API; release() hands the fee rights back. Then the live Credit Line Board, three underwriter memos, the pledge, the auction with the desk's anchor bid, and a loan timeline on an Anvil fork of Base where the debt hits zero, release() fires and ERC-8004 reputation is written. A Follow the Desk screen shows the Definitive Flash TWAP the desk filled on Base mainnet, then the Dynamic MPC wallet paying 0.05 USDC over x402 for a honeypot verdict. A mainnet evidence screen lists the mainnet transactions: FeeDesk deployed, ERC-8004 agent #94699, the x402 payment, the Flash fill and the tokenized-equity buy on Robinhood Chain.
```

## 5. Posting steps (Premium, @BangDropID)

1. Sign in as **@BangDropID** and confirm Premium is active — the composer must show the character counter going past 280. If it caps at 280, the long post will be truncated; use §2 instead.
2. New post. Click the media button and upload `web\public\gadai-demo.mp4`. Wait for the upload to finish (the thumbnail appears) before typing.
3. Click **ALT** / "Add description" on the video thumbnail and paste §4. Save.
4. Paste §1 into the composer. Do not let the editor collapse the blank lines between paragraphs — paste, then check that the seven paragraphs are still separated.
5. Check the two links preview as `gadai-six.vercel.app`; X will render a card for the first one. That is fine and expected.
6. Post. Then open the published post, use **⋯ → Copy link**, and keep that URL.
7. Paste that URL into the Runtime submission form's **"Project post on X"** field. The form wants the URL of the published post, not the text.
8. Premium has edit for 1 hour after posting. If a number drifts or a handle is wrong, edit rather than delete — deleting loses the URL you already submitted.
9. Nothing else needs to be posted. No thread, no reply. If someone asks what ran on mainnet, point them at https://gadai-six.vercel.app/evidence.
