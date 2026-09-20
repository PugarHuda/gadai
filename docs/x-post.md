# X (Twitter) launch kit

Every number and id below is copied from [EVIDENCE.md](EVIDENCE.md) and the [README](../README.md). Nothing here claims more than those two files do.

**Paste post 1 (the main post) into the Runtime submission form's "Project post on X" field**, after you publish it — the form wants the URL of that published post. Post the thread as replies to it. The @DefinitiveFi tag lives in the main post and in reply 5/, which is what the Definitive Flash track requires.

Handles used: `@DefinitiveFi`, `@bankrbot`, `@dynamic_xyz`, `@Uniswap`, `@base`. Blackbird/Flynet is written in plain text because we have not verified their handle.

Media: attach `video/cuts/gadai-x.mp4` (2:00, 23.9 MB, H.264 + AAC) to post 1, with the alt text below. `video/cuts/gadai-x-poster.jpg` (1280x720) is the poster/OG frame if you need a still.

---

## 1. Main post (277 characters as X counts them)

Attach the video.

```
Gadai: USDC credit for @bankrbot agents, secured by an on-chain lien on the creator fees their token earns.

Every credit call is a public signal you can mirror with @DefinitiveFi Flash bracket/DCA orders — and the desk's own Flash TWAP filled on Base.

https://gadai-six.vercel.app
```

---

## 2. Thread (replies to post 1, in order)

**2/ the problem and the lien**

```
2/ A Bankr agent earns a cut of every trade of its token, then runs out of LLM credits. Its only moves: top up by hand or sell the token.

Gadai lends against that stream. The borrower points its Doppler fee share at a per-loan FeeVault with updateBeneficiary. That's the lien.
```

**3/ FeeNotes + the Uniswap CCA**

```
3/ The loan becomes a FeeNote: a new ERC-20 whose face value is the debt.

Lenders buy it for USDC in a @Uniswap Continuous Clearing Auction. Collected fees are swapped WETH→USDC through the Uniswap Trading API, with the vault as the swapper.

Covered? Anyone can call release().
```

**4/ underwriting + the agent that pays for data**

```
4/ Underwriting reads real Bankr fee history. Three personas write memos; the lead is binding and can only LOWER it.

Before approving, the @dynamic_xyz MPC agent wallet buys a third-party honeypot verdict over x402 — $0.05 USDC, EIP-3009, Bankr facilitator — and uses it.
```

**5/ Definitive Flash: the desk follows its own call**

```
5/ Every memo is a public signal. Followers mirror approved borrowers as a @DefinitiveFi Flash entry + Bracket (TP/SL), or a DCA built from a TWAP.

The desk mirrored its own signal on Base mainnet:
order fb3b2572-48c6-4ce5-b79a-6199cefac82f
first fill 0.125 USDC → 2,158 GITLAWB
```

**6/ the rest, and the receipts**

```
6/ Also shipped:
• Credit Line Board: 105 Base agents priced live, 14 eligible, $756.69 pre-approved
• bought 0.00079 TSLA on Robinhood Chain — the tokenized-stock fee leg trades
• ERC-8004 agent #94699 + @base builder code bc_32d4pc8g
• Blackbird Flynet dining concierge
```

**7/ honest scope + links**

```
7/ Honest scope: the full loan cycle ran on an Anvil fork of Base against a real Bankr pool. Our Bankr LLM credits are $0, so memos run as rules and say so.

The mainnet txs — FeeDesk, ERC-8004, x402, Flash TWAP, Uniswap swap:
https://gadai-six.vercel.app/evidence
https://github.com/PugarHuda/gadai
```

---

## 3. Video alt text

Paste into X's "Add description" box on the attached video.

```
Two-minute demo of Gadai, a lending desk for Bankr agents. Opening counters: 105 Bankr agents on Base, 593 WETH in creator fees, 18.6 billion LLM tokens in 30 days. A nine-step diagram shows the loan: updateBeneficiary, FeeVault (the lien), FeeNotes sold in a Uniswap CCA, USDC to the borrower, fees swapped to USDC via the Uniswap Trading API, repay, release() returning the fee rights. The live Credit Line Board prices every Bankr agent on Base at over $750 across 14 agents. A loan timeline on an Anvil fork of Base shows debt hitting zero, release(), ERC-8004 repayment reputation and an ERC-8021 Base builder-code suffix. A card shows the desk's Definitive Flash TWAP placed and filled on Base mainnet. A mainnet evidence screen lists four Basescan transactions: FeeDesk deployed, ERC-8004 register to agent #94699, x402 risk check paid (0.05 USDC), and the Definitive Flash TWAP fill (0.125 USDC to 2,158.27 GITLAWB). Closing card: gadai-six.vercel.app and github.com/PugarHuda/gadai.
```

---

## 4. Farcaster (short version, fits 320 characters)

Attach the same MP4.

```
Gadai: USDC credit for Bankr agents, secured by an on-chain lien on their token's creator fees.

FeeNotes clear in a Uniswap CCA. A Dynamic MPC wallet pays for a risk check over x402, then pays out. Every credit call is a Definitive Flash signal you can mirror.

https://gadai-six.vercel.app
```

---

## 5. Optional reply, if someone asks what actually ran on mainnet

```
Five Base mainnet txs, all signed by the desk's Dynamic MPC agent wallet:
• FeeDesk 0xa4f21ace…476b4f deployed
• ERC-8004 register → agent #94699
• Uniswap Trading API swap
• x402 risk check paid, $0.05 USDC
• Definitive Flash TWAP, first slice filled

https://gadai-six.vercel.app/evidence
```
