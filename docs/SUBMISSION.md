# Submission checklist: Gadai

The deadline is **Sun 2026-09-20 03:00 WIB**. Tick a box only against evidence you can click (a file, a tx hash, a live URL or a video timestamp). Paste-ready text is in [READY_TO_PASTE.md](READY_TO_PASTE.md). Mainnet txs: [EVIDENCE.md](EVIDENCE.md).

## 0. Before submitting

- [x] Repo is **public**: https://github.com/PugarHuda/gadai (skill/README/DEMO placeholders are already filled in).
- [ ] The agent behind the tunnel runs the **current** code: `curl https://aqua-economic-moss-modes.trycloudflare.com/api/flynet/status` returns JSON (not `no route`), and `/api/board` has `robinhood` rows. If the tunnel hostname changed, update it in README.md, READY_TO_PASTE.md, both `grok/skills/*/SKILL.md`, `skill/gadai/` and the Vercel env.
- [ ] https://gadai-six.vercel.app/evidence is deployed (it returned 404 at 15:52 UTC on 2026-09-19). Until then, point judges at docs/EVIDENCE.md.
- [ ] README line links match the code: `node docs/anchors.mjs` prints `README anchors OK`. After the last code change, run `node docs/anchors.mjs --write`.
- [ ] The skill matches the server: `node skill/gadai/check.mjs` passes.
- [ ] `pnpm --filter @feedesk/agent test` and `pnpm contracts:test` are green.
- [ ] `.env` is **not** committed: `git ls-files | grep -c '^.env$'` prints `0`.
- [x] Video: https://gadai-six.vercel.app/demo (3:08, narrated; scene list in [DEMO.md](DEMO.md)).
- [x] Mainnet evidence (Base, signed by the Dynamic agent wallet `0x81b7…305D`):
  - Uniswap Trading API swap: `0x6dd51e0c3fa3a8ace9633a32200857b8795c1e6cadd06e0eb5d9f701026cc072`
  - FeeDesk: `0xa4f21ace41923bccfdebf1c6ab49659d80476b4f` (deploy tx `0x21cce9322a7ceb0a1af4225973d9ad3969c298a5594d7f71a7f7689c233ee858`)
  - ERC-8004 desk agent #94699: `0xde4b3490940e7bc064c3511c7843eab20f16f1419e456185e35a7690966229cb`
  - x402 payment (risk verdict, $0.05): `0x9c22339bffe1f0e424dad6d5ab64d77603176716d95694eb40430d203f98ad00`
  - Flash TWAP order `fb3b2572-48c6-4ce5-b79a-6199cefac82f`, first fill `0x261a1355c4d5c7a1e97aaf398a1eb42f8c8563b5489f68709c2bd7660f3bcab4`
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
| Bankr agent profile `gadai` | created; pending Bankr admin review (not public yet) | [ ] |

## 2. Dynamic: an agent that decides, then pays

| Requirement | Evidence | ✓ |
|---|---|---|
| Dynamic agent wallet pattern (agent signing token → SIWE → JWT → MPC) | `agent/src/wallet/index.ts` `signInAgent`, `getAgentWallet`; `agent/src/wallet/bootstrap.ts` | [x] |
| Decision → payment on mainnet | x402 risk verdict paid by the agent wallet before approval: EVIDENCE #4 | [x] |
| Decision → payment in the loan flow | lead memo approves → `createLoan`, anchor bid, `disburse()` 239.75 USDC to the borrower, all signed by the agent wallet (fork, `/loans/1`, video 1:44–2:05) | [x] |
| Embedded wallets for borrowers, lenders, followers | `web/lib/wallet.tsx`, pledge and bid panels | [x] |
| Delegated access for auto-mirroring | `agent/src/social/delegation.ts` | [x] |

## 3. Uniswap: New Assets, New Agents

| Requirement | Evidence | ✓ |
|---|---|---|
| Uses the Uniswap API / CCA | Trading API: `agent/src/uniswap/index.ts` (mainnet swap EVIDENCE #1). CCA v2.1.0: `FeeVault.sol` `startAuction`, `agent/src/cca/index.ts` | [x] |
| New asset: FeeNote sold via CCA | `contracts/src/FeeNote.sol`, `FeeDesk.sol` `createLoan` | [x] |
| New agents price and bid | persona `maxNotePrice`, desk anchor bid, "copy agent bid" button | [x] |
| `FEEDBACK.md` at the repo root | `FEEDBACK.md` | [x] |
| README points to exact files and lines | README "Uniswap" section | [x] |
| **Uniswap developer feedback form submitted** (text in READY_TO_PASTE.md) | ______ | [ ] |

## 4. Definitive Flash: Best Social Trading Build

| Requirement | Evidence | ✓ |
|---|---|---|
| A Flash advanced order | **TWAP on mainnet**: order `fb3b2572-48c6-4ce5-b79a-6199cefac82f`, the desk mirroring its own approved signal (EVIDENCE #5). Code: `agent/src/flash/index.ts` `twapSellTokenLeg`; bracket/DCA mirrors in `agent/src/social/index.ts` `quoteMirror` / `submitMirror` | [x] |
| Social trading: follow agents, leaderboard, mirrors, shareable signals | `publishSignals`, `leaderboard`, `score.ts`; `/desk`, `/signals/[id]` | [x] |
| Vault-funded (EIP-1271) keeper TWAP and follower mirrors filled | built and quote-tested only; Flash settles on mainnet and the loan runs on the fork | [ ] |
| Post on X tagging **@DefinitiveFi** (text in READY_TO_PASTE.md) | post URL ______ | [ ] |

## 5. Blackbird Flynet: dining concierge

FLY dining draws were **removed** on 2026-09-19. The app "hackathon 2" is approved on production with read scopes plus `write:save_to_list`; payments and rewards are pending Blackbird review.

| Requirement | Evidence | ✓ |
|---|---|---|
| Live Flynet restaurant data | `agent/src/flynet/index.ts` catalog (locations, hours, specials, challenges); `GET /api/flynet/restaurants` | [x] |
| Concierge inside the loan's dining budget | `POST /api/loans/:id/dine/plan`; `/dine/[id]` | [x] |
| Member passport (OAuth + PKCE) | `/api/flynet/connect` → `/callback` → `/api/loans/:id/dine/passport`. Needs the redirect URI registered in the Make dashboard; tested with a real member? ______ | [ ] |
| Save-to-list (`write:save_to_list`) | scope granted; not in the code as of 23:00 WIB | [ ] |
| No invented payment call; the member pays in the Blackbird app | README Blackbird section; `payments.enabled: false` | [x] |

## 6. Grok Bot

| Requirement | Evidence | ✓ |
|---|---|---|
| Skills | `grok/skills/gadai-credit`, `grok/skills/gadai-loan-watch`; `node grok/check.mjs` | [x] |
| `grok/` pushed to main so the raw URLs resolve | raw `grok/skills/gadai-credit/SKILL.md` returns 200 | [x] |
| Bot created and **public template link** copied (docs/distribution.md §1). Submit this track only with the link | ______ | [ ] |
