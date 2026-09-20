# Submission checklist: Gadai

The deadline is **Sun 2026-09-20 11:00 WIB**. Tick a box only against evidence you can click (a file, a tx hash, a live URL or a video timestamp). Paste-ready text is in [READY_TO_PASTE.md](READY_TO_PASTE.md). Mainnet txs: [EVIDENCE.md](EVIDENCE.md).

## 0. Before submitting

- [x] Repo is **public**: https://github.com/PugarHuda/gadai (skill/README/DEMO placeholders are already filled in).
- [x] The agent behind the tunnel serves the **concierge + equity** build. Verified 01:19 UTC 2026-09-20: `/api/flynet/status` returns JSON with app "hackathon 2", `/api/flynet/trending` returns venues, `/api/flash/info` returns `integratorFeeBps 10`, `/api/signals/1` returns a card, `/api/risk/<token>` returns a cached-verdict shape, and `/api/board` has `robinhood` rows and the equity totals. If the tunnel hostname changes, update it in README.md, READY_TO_PASTE.md, both `grok/skills/*/SKILL.md`, `skill/gadai/` and the Vercel env.
- [x] **Agent restarted** on the FLY-checkout build that landed 2026-09-20: `curl .../api/flynet/status` returns `payments.state: "pending-review"` (checked 02:3x UTC 2026-09-20).
- [x] https://gadai-six.vercel.app/evidence is deployed (200 at 01:2x UTC on 2026-09-20). `/demo` and `/board` are 200 too.
- [x] https://gadai-six.vercel.app/deck (slides) returns **200** (checked 02:3x UTC on 2026-09-20). Safe to paste.
- [x] README line links match the code: `node docs/anchors.mjs` prints `README anchors OK (56 links)` (re-run at 02:4x UTC 2026-09-20). Re-run `node docs/anchors.mjs --write` after any further code change.
- [ ] The skill matches the server: `node skill/gadai/check.mjs` passes.
- [x] `pnpm --filter @feedesk/agent test` is green: **118 tests, 117 pass, 1 skipped, 0 fail** (run 2026-09-20). `pnpm contracts:test` (26 Foundry fork tests) was last run green by the contracts owner on 2026-09-19; it needs `forge` on `PATH` and a Base archive RPC, so re-run it from a shell that has both.
- [ ] `.env` is **not** committed: `git ls-files | grep -c '^.env$'` prints `0`.
- [x] Video (3:49, narrated): https://youtu.be/F7joLyWWB0E — also at https://gadai-six.vercel.app/demo (scene list in [DEMO.md](DEMO.md)). Paste the YouTube link into the Runtime form.
- [x] Mainnet evidence (Base, signed by the Dynamic agent wallet `0x81b7…305D`):
  - Uniswap Trading API swap: `0x6dd51e0c3fa3a8ace9633a32200857b8795c1e6cadd06e0eb5d9f701026cc072`
  - FeeDesk: `0xa4f21ace41923bccfdebf1c6ab49659d80476b4f` (deploy tx `0x21cce9322a7ceb0a1af4225973d9ad3969c298a5594d7f71a7f7689c233ee858`)
  - ERC-8004 desk agent #94699: `0xde4b3490940e7bc064c3511c7843eab20f16f1419e456185e35a7690966229cb`
  - x402 payment (risk verdict, $0.05): `0x9c22339bffe1f0e424dad6d5ab64d77603176716d95694eb40430d203f98ad00`
  - Flash TWAP order `fb3b2572-48c6-4ce5-b79a-6199cefac82f`, first fill `0x261a1355c4d5c7a1e97aaf398a1eb42f8c8563b5489f68709c2bd7660f3bcab4`
  - Tokenized equity: Relay bridge on Base `0xc65bd93a23bdf9756dec9503aeb40ff902d9beeb53200a6068c99cab2e5af2d4` → 0.00078962 TSLA bought on Robinhood Chain (4663) `0xbfbe9702dd40ed28e734d1ebc319a7ace9d27b30f77eb5185179de01366dd708`. Re-checkable through `https://robinhood-rpc.publicnode.com` (see EVIDENCE.md).
- The loan lifecycle (createLoan → pledge → CCA → disburse → collect → swap → repay → release) ran on the Anvil fork, not on mainnet: loan #1 at https://gadai-six.vercel.app/loans/1. Say so wherever it comes up.

## 1. Bankr

| Requirement | Evidence | ✓ |
|---|---|---|
| Bankr fee APIs drive real decisions | `agent/src/bankr/index.ts` (`tokenFees`, `creatorFees`, `claimableFees`, `buildTransferBeneficiary`, `buildClaim`); `agent/src/underwriter/index.ts` `quote`; `/board` | [x] |
| Bankr LLM Gateway in the underwriting | `llmChat`, `PERSONAS`, `underwrite`. **Our LLM credits are $0**, so live memos are deterministic persona rules labelled "rules (Bankr LLM unavailable)"; the LLM path fails closed | [x] (honest label) |
| Bankr Skill: any Bankr agent applies, checks status, repays | `skill/gadai/SKILL.md` + `catalog.json` | [x] |
| A real Bankr agent installs the skill from our public URL (screenshot of the reply) | ______ | [ ] |
| Optional: PR to `BankrBot/skills` adding `gadai/` | PR URL ______ | [ ] |
| Paid API on Bankr x402 Cloud | `curl -i` the gadai-credit URL → 402 | [x] |
| Onchain equities: Bankr agents paid in tokenized stocks | `/board` prices them live (02:35 UTC 2026-09-20: 4 equity agents — SPY, TSLA, MSTR, AMZN — $65,114 lifetime equity fees, $164.63 indicative, `totals.failed: 0`; live reads that drift), and the desk bought TSLA for real on chain 4663 (EVIDENCE #6) | [x] |
| Bankr agent profile `gadai` | created; pending Bankr admin review (not public yet) | [ ] |

## 2. Dynamic: an agent that decides, then pays

| Requirement | Evidence | ✓ |
|---|---|---|
| Dynamic agent wallet pattern (agent signing token → SIWE → JWT → MPC) | `agent/src/wallet/index.ts` `signInAgent`, `getAgentWallet`; `agent/src/wallet/bootstrap.ts` | [x] |
| Decision → payment on mainnet | x402 risk verdict paid by the agent wallet before approval: EVIDENCE #4 | [x] |
| Decision → payment in the loan flow | lead memo approves → `createLoan`, anchor bid, `disburse()` 239.75 USDC to the borrower, all signed by the agent wallet (fork, `/loans/1`, video 1:44–2:05) | [x] |
| Embedded wallets for borrowers, lenders, followers | `web/lib/wallet.tsx`, pledge and bid panels | [x] |
| Delegated access: **configured and live** | RSA credential uploaded in the Dynamic console, `DYNAMIC_AUTH_TOKEN` + `DYNAMIC_WEBHOOK_SECRET` set, webhook verified by Dynamic; unsigned `POST /api/dynamic/webhook` → `401 bad signature` (checked 2026-09-20). Code: `agent/src/social/delegation.ts` | [x] |
| Delegated access: **one delegation actually granted** | Done 2026-09-20: a user approved the prompt from embedded wallet `0x277aaE03…AFF9C`; Dynamic delivered the encrypted share to the HMAC-verified webhook, the agent stored it (02:10:49Z, `dynamic webhook: stored`) and the same user revoked it (02:16:12Z). EVIDENCE #7. The auto-mirror executor stays disabled on the fork, deliberately | [x] |
| Agent tops up its own gas before paying | `RISK_AUTO_TOPUP` in `agent/src/risk` (EXACT_OUTPUT USDC→ETH via the Trading API, daily + per-tx caps, off on the fork) | [x] |
| Two-chain wallet action: bridge + buy a tokenized stock | EVIDENCE #6 (`agent/src/demo/rh-equity-swap.ts`) | [x] |

## 3. Uniswap: New Assets, New Agents

| Requirement | Evidence | ✓ |
|---|---|---|
| Uses the Uniswap API / CCA | Trading API: `agent/src/uniswap/index.ts` (mainnet swap EVIDENCE #1). CCA v2.1.0: `FeeVault.sol` `startAuction`, `agent/src/cca/index.ts` | [x] |
| Real-world assets through the Trading API | Equity-quoted creator fees priced with a `/quote` on chain 4663 (`agent/src/board/index.ts`), and a real purchase of 0.00078962 TSLA there (EVIDENCE #6) | [x] |
| New asset: FeeNote sold via CCA | `contracts/src/FeeNote.sol`, `FeeDesk.sol` `createLoan` | [x] |
| New agents price and bid | persona `maxNotePrice`, desk anchor bid, "copy agent bid" button | [x] |
| `FEEDBACK.md` at the repo root | `FEEDBACK.md` | [x] |
| README points to exact files and lines | README "Uniswap" section | [x] |
| **Uniswap developer feedback form submitted** (text in READY_TO_PASTE.md) | ______ | [ ] |

## 4. Definitive Flash: Best Social Trading Build

| Requirement | Evidence | ✓ |
|---|---|---|
| A Flash advanced order | **TWAP on mainnet**: order `fb3b2572-48c6-4ce5-b79a-6199cefac82f`, the desk mirroring its own approved signal (EVIDENCE #5). Code: `agent/src/flash/index.ts` `twapSellTokenLeg`; bracket/DCA mirrors in `agent/src/social/index.ts` `quoteMirror` / `submitMirror` | [x] |
| Social trading: follow agents, leaderboard, mirrors, shareable signals | `publishSignals`, `leaderboard`, `score.ts`; `/desk`, `/signals/[id]`, `GET /api/signals/:id` + `/flash-quote` | [x] |
| Integrator fee configured | `GET /api/flash/info` → `integratorFeeBps 10, integratorFeeSet true` (checked live 2026-09-20) | [x] |
| Vault-funded (EIP-1271) keeper TWAP and follower mirrors filled | built and quote-tested only; Flash settles on mainnet and the loan runs on the fork | [ ] |
| Post on X tagging **@DefinitiveFi** (text in READY_TO_PASTE.md) | post URL ______ | [ ] |

## 5. Blackbird Flynet: dining concierge

FLY dining draws were **removed** on 2026-09-19. The app "hackathon 2" is approved on production with read scopes plus `write:save_to_list`; payments and rewards are pending Blackbird review. A FLY **checkout** (the member paying their own FLY) was written on 2026-09-20 against the documented `/payment_intents` lifecycle and has never been run.

| Requirement | Evidence | ✓ |
|---|---|---|
| Live Flynet restaurant data | `agent/src/flynet/index.ts` catalog (locations, hours, specials, challenges); `GET /api/flynet/restaurants` | [x] |
| Concierge inside the loan's dining budget | `POST /api/loans/:id/dine/plan`; `/dine/[id]` | [x] |
| Member passport (OAuth + PKCE) | `/api/flynet/connect` → `/callback` → `/api/loans/:id/dine/passport`. Verified live on 2026-09-19: authorize 302s to `passport.flynet.org`, an ungranted scope is bounced with `error=invalid_request`, a bogus code gives `400 invalid_grant`. `/api/flynet/status` reports `memberLogin.available: true`. Completed with a real member account? ______ | [ ] |
| Ranking on live network data | 7-day check-ins per venue, membership cards, `GET /api/flynet/trending` (returns venues live) | [x] |
| Save-to-list (`write:save_to_list`) | Built: `POST /api/loans/:id/dine/save` validates and returns an honest **501**, because Blackbird publishes no endpoint for the scope. Web button disabled with the reason | [x] (as far as Blackbird allows) |
| FLY checkout | Code complete 2026-09-20 (`/dine/pay`, `/refund`, cancel, `/payments`, `flynet_payments` table, `dine_payment` events, `FLYNET_MAX_PAY_FLY=5`). **Never executed**: the app has no payment scope, so Flynet answers 403 and we print it verbatim. Runbook: `docs/integrations/flynet.md` §11 | [ ] (pending Blackbird review) |
| No invented payment call; nothing is faked | README Blackbird section; `payments.state: "pending-review"`; no payment endpoint has ever been called from this repo | [x] |

## 6. Grok Bot

| Requirement | Evidence | ✓ |
|---|---|---|
| Skills | `grok/skills/gadai-credit`, `grok/skills/gadai-loan-watch`; `node grok/check.mjs` | [x] |
| `grok/` pushed to main so the raw URLs resolve | raw `grok/skills/gadai-credit/SKILL.md` returns 200 | [x] |
| Bot created and **public template link** copied (docs/distribution.md §1). Submit this track only with the link | ______ | [ ] |
