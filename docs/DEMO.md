# Gadai: demo video

**Duration: TODO(lead)** — fill this in once the cut that folds in the slide deck is rendered, and change it in README.md, docs/READY_TO_PASTE.md and the submission form at the same time. The file currently on disk, `web/public/gadai-demo.mp4`, is **228.8 s (3:49)**, 39.0 MB, H.264 + AAC (`ffprobe`, 2026-09-20).

Watch: https://gadai-six.vercel.app/demo (MP4: https://gadai-six.vercel.app/gadai-demo.mp4). Slides: https://gadai-six.vercel.app/deck (paste that link only once it returns 200).

The video is rendered with Remotion from `video/src/Gadai.tsx`. The narration is `video/narration/script.json`, voiced by `video/narration/tts.py`. The screen clips in `video/public/clips/` were recorded from the live site against the DEMO_FORK agent, and the numbers on screen come from `video/public/data.json`, read from the live agent on 2026-09-19. Re-render: `cd video && npm run render`.

## Scenes

The current cut has eleven scenes, in this order (ids match `video/narration/script.json` and `video/public/voice/words.json`). Per-scene timestamps are deliberately not listed here: the last two re-cuts changed them, and a stale timestamp is worse than none. Recompute them with the scene durations in `words.json` when the final cut is locked.

| # | Scene (`id`) | On screen | Narration (summary) |
|---|---|---|---|
| 1 | `open` | Counters from `/api/board`: Bankr agents on Base, lifetime creator fees (WETH), LLM tokens in 30 days | 105 Bankr agents on Base had earned 593 WETH in creator fees and burned 18.6B LLM tokens in 30 days at render time, yet they still run out of compute |
| 2 | `idea` | Animated flow: fee share → FeeVault (lien) → FeeNotes in a Uniswap auction → USDC to the borrower → fees swapped through the Trading API → release | "Gadai" is Indonesian for pledge; how the loan works end to end |
| 3 | `board` | `/board` clip. Lower third "Live · Gadai agent /api/board"; Bankr sponsor tag | Every Bankr agent on Base priced live; ineligible rows say why; a pill shows whether fees cover compute |
| 4 | `apply` | `/apply` then the memo cards. Lower thirds "Memos · rules, no LLM review" and "Borrower identity · ERC-8004" | Quote from real fee history; three personas write memos, **as rules because our Bankr LLM credits were $0, and the page says so**; the lead can only lower; the borrower brings its ERC-8004 identity |
| 5 | `pledge` | Pledge clip; lower third with the `pledged` tx hash | `updateBeneficiary` moves GITLAWB's 57% fee share into the FeeVault; only the vault can move it back |
| 6 | `cca` | Notes auction clip; Uniswap and Dynamic tags; lower third with the desk anchor-bid tx | Lenders buy FeeNotes in a Uniswap CCA; the Dynamic agent wallet places the anchor bid at its underwriter's price |
| 7 | `repay` | Loan #1 timeline: `disbursed` (239.75 USDC), `swapped`, `released`, ERC-8004 feedback, ERC-8021 builder-code suffix | The Dynamic wallet pays the borrower; the keeper collects, swaps WETH→USDC, repays; release returns the fee rights; reputation is written |
| 8 | `desk` | `/desk` then `/dine` clips; Definitive and Blackbird tags | Signals can be mirrored with Flash bracket/DCA orders, and the desk's own Dynamic wallet placed a Flash TWAP on Base mainnet **that filled**; the concierge ranks 1,675 live Blackbird venues against the loan's dining budget; members log in for their passport; **paying in FLY still needs Blackbird's review** |
| 9 | `x402` | The live 402 of the gadai-credit URL, then the paid risk check | x402 both ways: other agents buy the credit report for $0.02, and the desk paid $0.05 for a third-party risk verdict it then uses (HONEYPOT declines, SUSPICIOUS halves) |
| 10 | `mainnet` | Mainnet evidence card: FeeDesk `0xa4f2…6b4f`, ERC-8004 #94699, the x402 payment, the Flash fill | "This isn't only on the fork" — every hash is on Basescan |
| 11 | `close` | Sponsor tiles, gadai-six.vercel.app, github.com/PugarHuda/gadai | "This demo runs on an Anvil fork of Base, against real Bankr pools" |

## Changed since the current render (2026-09-19 23:14)

Say these in the submission text; the video has not been re-cut for them.

- **Onchain equities are no longer theoretical.** The video mentions no equity leg. Since the render, the desk bridged 0.0002 ETH from Base to Robinhood Chain with Relay and bought **0.00078962 TSLA** through the Uniswap Trading API on chain 4663 ([EVIDENCE.md](EVIDENCE.md) #6). The live `/api/board` now also carries the equity totals (`equityAgents`, `equityFeesUsd`, `indicativeEquityCreditUsdc`).
- **Board numbers moved.** Scene 1 and scene 3 quote the render-time read (105 agents, 593 WETH, 18.6B tokens, "over $750"). The live board at 01:19 UTC on 2026-09-20 reads 105 agents, 14 eligible, **$856.57** pre-approved, 593.3 WETH lifetime, 19.5B tokens. The board is live and drifts; say "live, changes through the day" rather than defending a single figure.
- **Dynamic delegated access** is now configured and its webhook is verified and HMAC-enforced (unsigned POST → 401). No delegation has been granted yet, because that needs a person to approve the browser prompt.
- **Flash integrator fee** is set to 10 bps (`GET /api/flash/info`).
- **Flynet FLY checkout** was written on 2026-09-20 and has never been executed; the app has no payment scope, so Flynet answers 403 and the UI prints that verbatim. Scene 8's "paying in FLY still needs Blackbird's review" is still exactly right.
- **Slides.** A deck is published at `/deck` and is meant to be folded into the next cut; see the TODO at the top of this file.

## Rules the cut follows
- Every loan clip was recorded on the fork with the DEMO_FORK banner visible, and the close card says so.
- Memos are shown with their "rules, no LLM review" label.
- Numbers on screen were read live from the agent, not typed.
