---
name: Gadai
description: A public registry of pledged fee rights. Grey desk, white form sheets, hairline boxes, one violet stamp ink.
colors:
  desk-ground: "#e5e8e3"
  form-sheet: "#fcfcfa"
  ink: "#16181d"
  mute: "#545a64"
  rule: "#c4c9cf"
  stamp-violet: "#5a2bb3"
  stamp-violet-deep: "#45208c"
  stamp-violet-tint: "#efe9fa"
  repaid-green: "#16683b"
  declined-red: "#b42318"
  pending-amber: "#e3a32b"
  pending-amber-ink: "#7a4b00"
typography:
  display:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "3rem"
    fontWeight: 750
    lineHeight: 1.02
    letterSpacing: "-0.015em"
  section:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  caption:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.07em"
  data:
    fontFamily: "Chivo Mono, ui-monospace, monospace"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  hairline: "2px"
  control: "3px"
spacing:
  box: "16px"
  sheet: "20px"
  section: "48px"
components:
  button-primary:
    backgroundColor: "{colors.stamp-violet}"
    textColor: "{colors.form-sheet}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.stamp-violet-deep}"
  button-ghost:
    backgroundColor: "{colors.form-sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
    height: "40px"
  button-ghost-hover:
    backgroundColor: "{colors.stamp-violet-tint}"
  input:
    backgroundColor: "#ffffff"
    textColor: "{colors.ink}"
    typography: "{typography.data}"
    rounded: "{rounded.control}"
    height: "40px"
  sheet:
    backgroundColor: "{colors.form-sheet}"
    padding: "{spacing.sheet}"
  status-pill:
    typography: "{typography.caption}"
    rounded: "{rounded.hairline}"
    padding: "1px 6px"
---

# Design System: Gadai

## Overview

Gadai (Indonesian for "pledge") is drawn as a public lien registry. Each loan is a filed instrument: a white form sheet on a grey desk, its facts in ruled boxes with small captions, typed entries in a mono face, and a violet filing stamp that states where the lien stands. The look refuses both the neon-on-black crypto dashboard and cream-paper editorial. It is an Operate surface: the registry grammar lives in details (captions, hairline boxes, the stamp), never at the cost of scanning a table.

## Colors

### Primary
- **Stamp violet** `#5a2bb3`: the only brand ink. Primary actions, links, the current lifecycle step, focus rings, text selection, the filing stamp. Deep `#45208c` for hover; tint `#efe9fa` for selected rows, chosen options and the next-step band.

### Neutral
- **Desk ground** `#e5e8e3` behind everything; **form sheet** `#fcfcfa` for sheets; **ink** `#16181d` text; **mute** `#545a64` secondary text (≥ 6:1 on sheet); **rule** `#c4c9cf` hairlines.

### Semantic
- **Repaid green** `#16683b`: ACTIVE, approve, positive PnL, repayment bars. **Declined red** `#b42318`: DECLINED, CANCELLED, errors, negative PnL. **Pending amber** `#e3a32b` fills (auction progress, unclaimed fees) with **amber ink** `#7a4b00` for text on light grounds (fork notices, PLEDGED/AUCTION).

### Named Rules
- **The Stamp Law.** Violet marks registry state and the primary action only. It is never decoration, never a background field.
- **Status carries words.** Every colored state is a pill or stamp with its text; color alone never encodes status.

## Typography

One family, Archivo, with its width axis doing the hierarchy: display at 118% width and 750 weight, section heads at ~108% width bold, captions at 88% width uppercase semibold. Chivo Mono is for data only: amounts, addresses, hashes, block numbers, typed inputs. Fixed rem scale (h1 2.25rem mobile, 3rem desktop).

### Hierarchy
- Page title `.h1` (display). Section heads `text-lg font-bold`. Sheet titles `text-sm font-bold` in the sheet header row.
- Field captions `.label`: small, uppercase, mute. They label boxes and fields; they never sit above a heading as an eyebrow.
- Prose measure ≤ 68ch.

## Layout

Max width 72rem, 16px gutters. Sections separated by 48px ("deep gaps"); sheets separated by 24–32px. Shared-edge grids (`gap-px` over a rule-colored background) form the registry boxes: summary strip, loan terms, loan header facts. The five-step lifecycle track (Pledge, Auction, Disburse, Repay, Release) is one shared axis: detailed on the home page, stateful on every loan page. Tables scroll horizontally inside their sheet; the home loan book switches to a stacked list below `md`. The nav becomes a horizontally scrolling tab row on phones.

## Elevation & Depth

Only sheets (`.card`) carry depth: `0 1px 2px rgb(22 24 29 / .06), 0 10px 28px -16px rgb(22 24 29 / .28)`. Everything inside a sheet is flat: `.box` hairline boxes, never nested sheets.

## Shapes

Near-square corners: 2px for pills and tags, 3px for controls and boxes. Lifecycle step numbers and timeline nodes are the only circles.

## Components

### Buttons
Primary violet, ghost white with rule border turning violet on hover; 40px min height; `active` nudges 1px down. `Btn` shows "Working…" with `aria-busy` while its async action runs and prints the error under itself.

### Status pill and filing stamp
Pills: 1.5px current-color border, tinted ground, uppercase caption type. The loan page's filing stamp is the signature moment: double-ruled violet/green/red box, rotated -2°, striking in once (260ms, expo ease-out from a visible 55% opacity) when the status renders or changes; disabled under reduced motion.

### Sheet (Card)
Header row with bold title and a mute right slot, hairline under it, 16–20px body padding.

### States
Loading: three skeleton bars (`aria-busy`). Offline: dashed box "The Gadai agent is offline" naming what it serves and that on-chain contracts are unaffected, with Try again. Empty: dashed box with a title and one line on how the list gets filled. Errors: red hairline box, `role="alert"`, agent-offline errors reworded instead of printing fetch errors.

## Do's and Don'ts

- Do label every number with where it came from (on-chain, agent, Bankr API).
- Do keep the DEMO_FORK notice sticky and literal.
- Don't use hard offset shadows, colored side borders, gradient text, or glyphs as icons (inline SVG only).
- Don't put captions above page titles.
- Don't use violet for anything that isn't registry state or the primary action.
