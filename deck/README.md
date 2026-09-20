# deck/

`Gadai.pptx` — a 12-slide PowerPoint deck for judges and sponsors. 16:9 widescreen
(13.33" × 7.5"), built from `build.mjs` with [pptxgenjs](https://gitbrent.github.io/PptxGenJS/).

## Slides

| # | Slide | The one idea |
|---|---|---|
| 1 | Gadai | Title, one-liner, tracks, the filing stamp, the four judge links |
| 2 | The fees arrive later. The compute bill is due now. | The problem in four live numbers |
| 3 | A lien the desk cannot keep | `updateBeneficiary` → FeeVault; only `release()`/`cancel()` move it back, and only to the borrower |
| 4 | How a loan moves | Pledge → Auction → Disburse → Service → Release, with loan #1's real figures |
| 5 | The math decides. Models may only lower it. | Engine formula, three personas, the paid x402 honeypot check |
| 6 | The loan becomes something you can buy | FeeNote ERC-20 sold in a Uniswap CCA v2.1.0; the Trading API repays it |
| 7 | Every Bankr agent, already priced | Credit Line Board, Robinhood Chain equities, the real TSLA buy |
| 8 | Follow the desk, or don't | Signals, leaderboard, Bracket/DCA mirrors, the filled mainnet Flash TWAP |
| 9 | Dine on your fees | Blackbird Flynet concierge; the FLY checkout is built but still answers 403 |
| 10 | Agents buy from agents | $0.02 report sold, $0.05 verdict bought, Bankr Skill, Grok skills |
| 11 | Six transactions on Base mainnet | The evidence table, short hashes |
| 12 | Live vs simulated | What ran on mainnet, what ran on the fork, and the links |

Every slide carries its source in the footer, and each has speaker notes.

## Numbers and where they came from

- `105 agents`, `593 WETH lifetime fees`, `18.6B LLM tokens/30d`, `$756.69 across 14 agents`,
  `17 Robinhood Chain agents`, `4 earning tokenized-stock fees` — the `/api/board` snapshot of
  2026-09-19 15:44 UTC that `README.md` and `docs/READY_TO_PASTE.md` quote.
- `9.68 WETH claimable` — read live from `GET /api/board` on 2026-09-20 (`totals.claimableWeth`;
  ETH was $2,621.82 in the same response). The board is live data, so this moves.
- Everything on slide 11 is `docs/EVIDENCE.md`. Loan #1's figures are from `README.md`.

## Rebuild

```bash
cd deck
npm install pptxgenjs        # not a repo dependency; the deck is a build artifact
node build.mjs Gadai.pptx
```

## Fonts

The brand faces (Archivo, Chivo Mono) cannot be embedded in a `.pptx` that opens everywhere,
so the deck uses **Arial** for text and **Courier New** for data, which every PowerPoint and
LibreOffice install has. Colours are the real tokens from `web/app/globals.css`:
desk ground `#e5e8e3`, form sheet `#fcfcfa`, ink `#16181d`, mute `#545a64`, rule `#c4c9cf`,
stamp violet `#5a2bb3`, repaid green `#16683b`, amber ink `#7a4b00`, declined red `#b42318`.

## Checks run

- `python scripts/office/validate.py Gadai.pptx` (pptx skill) — all validations passed.
- LibreOffice → PDF → 150/110 dpi PNGs, every slide inspected for overflow, overlap and margins.
- Slide text dumped with `python-pptx`; no placeholder text, numbers match the sources above.
