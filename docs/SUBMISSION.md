# Submission checklist: Gadai

The deadline is **Sun 2026-09-20 03:00 WIB**. Tick every box only against evidence you can click (a file:line, a tx hash, or a video timestamp).

## 0. Before submitting (everyone)

- [ ] Repo is **public** on GitHub. Put its URL here: `https://github.com/PugarHuda/gadai`
- [ ] Fill in the placeholders in the skill and docs (run from the repo root, Git Bash):
  ```bash
  OWNER=… REPO=… API_HOST=…   # API_HOST = AGENT_PUBLIC_URL without https://
  WEB_HOST=…                  # public web URL without https://
  sed -i "s#GITHUB_OWNER#$OWNER#g; s#GITHUB_REPO#$REPO#g; s#FEEDESK_API_HOST#$API_HOST#g; s#FEEDESK_WEB_HOST#$WEB_HOST#g" \
    skill/gadai/SKILL.md skill/gadai/catalog.json README.md docs/DEMO.md
  grep -rn "GITHUB_OWNER\|FEEDESK_API_HOST\|FEEDESK_WEB_HOST" skill README.md docs/DEMO.md || echo "no placeholders left"
  ```
  This file (SUBMISSION.md) is left out on purpose so the commands above stay reusable. Fill in its repo URL by hand.
- [ ] README line links match the code: `node docs/anchors.mjs` prints `README anchors OK`. After the last code change, run `node docs/anchors.mjs --write` and commit. The check also fails while `pnpm contracts:deploy` points at a missing `contracts/script/Deploy.s.sol`.
- [ ] The skill matches the server: `node skill/gadai/check.mjs` passes. It checks the applyMessage text and the pledge-data rule against a live `build-transfer-beneficiary` response.
- [ ] `pnpm --filter @feedesk/agent test` and `pnpm contracts:test` are green. Paste the summary lines into the submission form.
- [ ] `.env` is **not** committed: `git ls-files | grep -c '^.env$'` prints `0`.
- [ ] The 3-minute video is recorded following `docs/DEMO.md` and uploaded (unlisted YouTube or Loom). Link: ______
- [ ] Mainnet evidence (write the hashes here and in the README):
  - FeeDesk: ______
  - loan vault: ______
  - `createLoan` tx: ______
  - pledge tx: ______
  - `disburse` tx: ______
  - swap tx: ______
  - Flash order id: ______
  - release tx: ______

## 1. Bankr: grand prize

| Requirement | Evidence | ✓ |
|---|---|---|
| Uses the Bankr fee APIs for real decisions | `agent/src/bankr/index.ts` (`tokenFees`, `creatorFees`, `claimableFees`, `buildTransferBeneficiary`, `buildClaim`); `agent/src/underwriter/index.ts` `quote` | [ ] |
| Bankr LLM Gateway powers the underwriting | `agent/src/bankr/index.ts` `llmChat`; `agent/src/underwriter/index.ts` `PERSONAS`, `underwrite`; three memos appear on every loan page | [ ] |
| Bankr Skill that lets any Bankr agent apply, check status and repay | `skill/gadai/SKILL.md` + `catalog.json`; video 0:12–1:30 | [ ] |
| The skill is installed by a real Bankr agent from our public URL (screenshot of the install reply) | ______ | [ ] |
| Optional: PR to `BankrBot/skills` adding `gadai/` (copy `skill/gadai/`, set `repoPath: "gadai"`, add a row to the root README table) | PR URL ______ | [ ] |
| The loan becomes LLM credits (`bankr llm credits add`) | video 1:50–2:05 | [ ] |

## 2. Dynamic ($2k): an agent that makes a meaningful decision, then carries out a wallet/payment action

| Requirement | Evidence | ✓ |
|---|---|---|
| Documented Dynamic agent wallet pattern (agent signing token → SIWE → `DynamicEvmWalletClient`, Node SDK `@dynamic-labs-wallet/*` 1.1.13) | `agent/src/wallet/index.ts` `signInAgent`, `getAgentWallet`; `agent/src/wallet/bootstrap.ts` | [ ] |
| Decision → payment: the LLM approval leads to `createLoan`, the USDC anchor bid and `disburse()` (USDC to the borrower), all signed by the agent wallet | `agent/src/server/index.ts` `apply`; `agent/src/cca/index.ts` `launchAuction`, `settleOnce`; `disbursed` tx hash ______ | [ ] |
| Embedded wallets (React SDK 5.9.0) for borrowers, lenders and followers | `web/lib/wallet.tsx`; the pledge and bid panels | [ ] |
| Delegated access for auto-mirroring | `agent/src/social/delegation.ts` | [ ] |

## 3. Uniswap ($1k): New Assets, New Agents

| Requirement | Evidence | ✓ |
|---|---|---|
| Uses the Uniswap API, AMM or CCA | Trading API: `agent/src/uniswap/index.ts`. CCA v2.1.0: `contracts/src/FeeVault.sol` `startAuction`, `agent/src/cca/index.ts` | [ ] |
| New asset: FeeNote ERC-20, a claim on a loan's fee stream, sold via CCA | `contracts/src/FeeNote.sol`, `contracts/src/FeeDesk.sol` `createLoan` | [ ] |
| New agents: underwriter agents price notes (`maxNotePrice`), and the desk agent bids | `agent/src/cca/index.ts` `launchAuction` (anchor bid); "copy agent bid" button | [ ] |
| Public repo | §0 | [ ] |
| `FEEDBACK.md` at the repo root with genuine feedback | `FEEDBACK.md` | [ ] |
| README points to exact files and lines | `README.md` → "Uniswap" section | [ ] |
| **Fill in the Uniswap developer feedback form** (linked from the Uniswap track page). Paste the highlights of `FEEDBACK.md` into it | form submitted? ______ | [ ] |

## 4. Definitive Flash ($1k): Best Social Trading Build

| Requirement | Evidence | ✓ |
|---|---|---|
| At least one Flash advanced order (DCA / Limit / StopLoss / TakeProfit / TWAP / Bracket) | **TWAP**: `agent/src/flash/index.ts` `twapSellTokenLeg`. **Bracket** (TP/SL attached to a market entry) and **DCA** (long TWAP): `agent/src/social/index.ts` `quoteMirror` / `submitMirror` | [ ] |
| Social trading: follow underwriter agents, a leaderboard of realized results, mirrored orders | `agent/src/social/index.ts` `publishSignals`, `leaderboard`; `agent/src/social/score.ts`; `/desk` page | [ ] |
| A real mainnet Flash order id shown in the video | order id ______, video 2:05–2:40 | [ ] |
| Post on X tagging **@DefinitiveFi** (draft below) | post URL ______ | [ ] |

## 5. Blackbird Flynet ($2.5k in $FLY): dining

| Requirement | Evidence | ✓ |
|---|---|---|
| Flynet restaurant data | `agent/src/flynet/index.ts` `recommend` (`listLocations`, open hours, `listSpecials`, `listChallenges`) | [ ] |
| Member context (OAuth + PKCE) | `dineState` (profile, wallets, check-ins, memberships) | [ ] |
| Payment tools | `draw` → `rewards.issueReward`; `settle` → `createPaymentIntent` + `confirmPaymentIntent` | [ ] |
| Only documented APIs are used (no invented "pay the restaurant" call; the member pays in the Blackbird app) | README, Flynet section | [ ] |
| Staging run with a real member shown in the video | video 2:40–2:50 | [ ] |

## 6. X post draft

Keep it under 280 characters, and attach the video or a GIF of the loan page:

> Gadai: Bankr agents borrow USDC against their token's creator fees.
> Fees → lien vault. 3 LLM underwriters on @bankrbot decide, a @dynamic_xyz agent wallet pays, loans sell as FeeNotes in a @Uniswap CCA, @DefinitiveFi Flash TWAP repays.
> <repo URL>

Follow-up reply, for the social track:

> Every credit decision is a public signal. Follow the best underwriter agent and mirror its picks as @DefinitiveFi Flash bracket (TP/SL) or DCA orders. Borrowers can even dine on their fees with Blackbird Flynet. Demo: <video URL>
