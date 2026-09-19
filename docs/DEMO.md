# Gadai: demo video (3:08)

Watch: https://gadai-six.vercel.app/demo (MP4: https://gadai-six.vercel.app/gadai-demo.mp4).

The video is rendered with Remotion from `video/src/Gadai.tsx`. The narration is `video/narration/script.json`, voiced by `video/narration/tts.py`. The screen clips in `video/public/clips/` were recorded from the live site against the DEMO_FORK agent, and the numbers on screen come from `video/public/data.json`, read from the live agent on 2026-09-19. Re-render: `cd video && npm run render`.

## Scenes

Times are scene starts and ends, computed from the voice timings (`video/public/voice/words.json`, 30 fps, 18-frame crossfades).

| t | Scene | On screen | Narration (summary) |
|---|---|---|---|
| 0:00–0:18 | Open | Counters from `/api/board`: Bankr agents on Base, lifetime creator fees (WETH), LLM tokens in 30 days | 105 Bankr agents on Base have earned 593 WETH in creator fees and burned 18.6B LLM tokens in 30 days, yet they still run out of compute |
| 0:17–0:46 | Idea | Animated flow: fee share → FeeVault (lien) → FeeNotes in a Uniswap auction → USDC to the borrower → fees swapped through the Trading API → release | "Gadai" is Indonesian for pledge; how the loan works end to end |
| 0:46–1:09 | 01 Credit Line Board | `/board` clip. Lower third "Live · Gadai agent /api/board"; Bankr sponsor tag | Every Bankr agent on Base priced live: over $750 across 14 agents; ineligible rows say why; a pill shows whether fees cover compute |
| 1:08–1:35 | 02 Apply & underwrite | `/apply` then the memo cards. Lower thirds "Memos · rules, no LLM review" with each persona's amount, and "Borrower identity · ERC-8004" | Quote from real fee history; three personas write memos, **as rules because our Bankr LLM credits were $0, and the page says so**; the lead can only lower; the borrower brings its ERC-8004 identity |
| 1:34–1:45 | 03 Pledge · the lien | Pledge clip; lower third with the `pledged` tx hash | `updateBeneficiary` moves GITLAWB's 57% fee share into the FeeVault; only the vault can move it back |
| 1:44–1:56 | 04 Uniswap CCA · FeeNotes | Notes auction clip; Uniswap and Dynamic tags; lower third with the desk anchor-bid tx | Lenders buy FeeNotes in a Uniswap CCA; the Dynamic agent wallet places the anchor bid at its underwriter's price |
| 1:55–2:24 | 05 Disburse · repay · release | Loan #1 timeline: `disbursed` (239.75 USDC), `swapped` (Uniswap Trading API), `released`, ERC-8004 feedback, ERC-8021 builder-code suffix | The Dynamic wallet pays the borrower; the keeper collects, swaps WETH→USDC, repays; release returns the fee rights; reputation is written |
| 2:23–2:46 | 06 Follow the Desk · Dine on fees | `/desk` then `/dine` clips; Definitive and Blackbird tags; amber status lines | Signals can be mirrored with Flash bracket/DCA orders; "Flash is mainnet only, so on the fork it's quote-tested, not filled"; dining line at Blackbird restaurants; "Flynet access is still pending" |
| 2:46–2:56 | Paid credit report | The live 402 response of the gadai-credit x402 URL (`amount 20000` = $0.02, USDC on Base) | Other agents buy the same credit report for two cents over x402 on Bankr's cloud |
| 2:56–3:08 | Close | Sponsor tiles, gadai-six.vercel.app, github.com/PugarHuda/gadai | "This demo runs on an Anvil fork of Base, against real Bankr pools" |

## Changed since the video was rendered (22:49 WIB, 2026-09-19)

Say these in the submission text; the video itself was not re-cut.
- **Dining draws are gone.** Scene 06 narrates "draw a small dining line ... signed by the borrower" and shows "signed draws (EIP-191/1271) · Flynet access pending". The draws were removed the same evening. Blackbird is now a dining concierge on live Flynet data plus a member passport. The app "hackathon 2" is **approved on production**; only payments and rewards are pending Blackbird review, so no FLY moves.
- **Flash on mainnet.** Scene 06 says Flash is "quote-tested, not filled" on the fork, which is still true for the fork. Separately, the desk has since placed a real Flash TWAP on Base mainnet from its Dynamic wallet (order `fb3b2572-48c6-4ce5-b79a-6199cefac82f`, first slice filled): [EVIDENCE.md](EVIDENCE.md) #5.
- **Mainnet evidence** (Uniswap swap, FeeDesk deploy, ERC-8004 #94699, x402 payment, Flash TWAP) is not in the video. It is at https://gadai-six.vercel.app/evidence and in [EVIDENCE.md](EVIDENCE.md).
- The Credit Line Board also lists 17 Robinhood Chain agents as indicative lines (4 with tokenized-stock fees); the video shows only the Base rows.

## Rules the cut follows
- Every loan clip was recorded on the fork with the DEMO_FORK banner visible, and the close card says so.
- Memos are shown with their "rules, no LLM review" label.
- Numbers on screen were read live from the agent, not typed.
