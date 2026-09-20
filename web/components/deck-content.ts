/**
 * Gadai pitch deck — one content source for both renderers.
 *
 * video/src/deck/Deck.tsx (Remotion, 1920x1080) and web/components/deck-view.tsx (the /deck page)
 * both import this file, so a number is never written twice.
 *
 * Every figure here is a real reading, labelled with where it came from:
 *  - `AS_OF` numbers are one live `/api/board` read, taken at the timestamp below. The board
 *    drifts with live fee data, so these are a labelled snapshot, not a constant. (The demo
 *    video was cut from an earlier read, 2026-09-19T15:26Z, where credit was $755.31 —
 *    the narration's "over 750 dollars" still holds.)
 *  - loan figures are loan #1 (GITLAWB) as it ran end to end on the Anvil fork of Base.
 *  - mainnet transactions are docs/EVIDENCE.md, verbatim.
 * ponytail: a snapshot, not a build-time fetch — /board is the live surface, the deck is the story.
 */

export const AS_OF = "2026-09-20 02:35 UTC";

/** Live Gadai agent `/api/board` → `totals`, read at AS_OF. */
export const BOARD = {
  agents: 105,
  eligible: 14,
  creditUsdc: 869.86,
  lifetimeFeesWeth: 593.3,
  claimableWeth: 10.14,
  claimableUsd: 26440, // 10.138943 WETH x $2,607.78 ETH/USD (Uniswap Trading API quote in the same response)
  llmTokens30d: 19.6, // billions, Bankr LLM Gateway, 30 days
  ethUsd: 2607.78,
  robinhoodAgents: 17,
  equityAgents: 4,
  equityFeesUsd: 65114, // lifetime equity fees, beneficiary share, same read
};

/** Loan #1, GITLAWB, run end to end on an Anvil fork of Base against the real Bankr pool. */
export const LOAN = {
  symbol: "GITLAWB",
  principal: "237.38",
  face: "276.02",
  feeRatePct: "16.28",
  floor: "0.86",
  termDays: "4.88",
  advancePct: "30",
  disbursed: "239.75",
  collectedWeth: "0.166",
  swappedTo: "289.71",
  drawLimit: "23.73",
  perDay: "56.52",
};

export type Tone = "plain" | "violet" | "green" | "amber" | "red";

type Base = { id: string; title: string; durationInFrames: number; notes: string; headline: string; sub?: string; footnote?: string };

export type Slide = Base &
  (
    | { kind: "title"; lead: string; chips: [string, string][] }
    | { kind: "stats"; stats: { value: string; label: string; source: string }[]; punch: string }
    | { kind: "diagram"; nodes: { t: string; s: string; hot?: boolean; mono?: boolean }[]; loop: string }
    | { kind: "steps"; steps: { t: string; s: string; tag: string }[] }
    | { kind: "cards"; cards: { title: string; lead: string; tone?: Tone; rows: [string, string][] }[] }
    | { kind: "rows"; cols: string[]; widths: number[]; mono?: number[]; rows: { cells: string[]; tone?: Tone }[]; strip?: [string, string][] }
  );

export const SLIDES: Slide[] = [
  {
    kind: "title",
    id: "title",
    title: "Gadai",
    durationInFrames: 150,
    notes: "Open. One line: credit for agents, secured by the fees they already earn.",
    headline: "Gadai",
    sub: "Indonesian for “pledge”",
    lead: "USDC credit for Bankr agents, secured by an on-chain lien on their token's creator-fee rights.",
    chips: [
      ["Chain", "Base 8453"],
      ["Collateral", "Doppler fee share"],
      ["Built for", "Runtime Agent Week"],
    ],
    footnote: "gadai-six.vercel.app · github.com/PugarHuda/gadai",
  },
  {
    kind: "stats",
    id: "problem",
    title: "The problem",
    durationInFrames: 240,
    notes: "An agent earns fees later but pays for compute now. The gap is real and measurable today.",
    headline: "An agent earns fees later. It pays for compute now.",
    sub: "Every Bankr agent with a Doppler token, priced live by the Gadai engine.",
    stats: [
      { value: String(BOARD.agents), label: "Bankr agents on Base", source: "agent-profiles, /api/board" },
      { value: `${BOARD.lifetimeFeesWeth} WETH`, label: "Lifetime creator fees", source: "beneficiary share, Bankr fee API" },
      { value: `${BOARD.llmTokens30d}B`, label: "LLM tokens, 30 days", source: "Bankr LLM Gateway usage" },
      { value: `${BOARD.claimableWeth} WETH`, label: "Claimable, sitting idle", source: `≈ $${(BOARD.claimableUsd / 1000).toFixed(1)}k at $${BOARD.ethUsd.toLocaleString("en-US")}/ETH` },
    ],
    punch: "Bankr's own guidance when fees don't cover compute: cut operations, or top up by hand. Nothing lets a creator borrow against fees it has already earned.",
    footnote: `live /api/board · read ${AS_OF} · a live read, it drifts`,
  },
  {
    kind: "diagram",
    id: "what",
    title: "What Gadai is",
    durationInFrames: 300,
    notes: "The lien. updateBeneficiary points the fee share at a per-loan vault; only release() moves it back, and only to the borrower.",
    headline: "The fee stream becomes the collateral.",
    sub: "Doppler already ships the primitive: updateBeneficiary(poolId, newBeneficiary).",
    nodes: [
      { t: "Token trades", s: "Bankr / Doppler pool" },
      { t: "Creator fees", s: "WETH, beneficiary share" },
      { t: "updateBeneficiary", s: "FeesManager → vault", mono: true },
      { t: "FeeVault", s: "the lien, per loan", hot: true },
      { t: "FeeNotes", s: "sold in a Uniswap CCA" },
    ],
    loop: "release() — permissionless, returns the fee rights to the borrower",
    footnote: "contracts/src/FeeVault.sol · only release() and cancel() move the share, and both move it back",
  },
  {
    kind: "steps",
    id: "flow",
    title: "How a loan moves",
    durationInFrames: 300,
    notes: "Five steps. Point out that the desk never holds the fee rights and never has to be trusted to give them back.",
    headline: "How a loan moves",
    sub: `Loan #1, ${LOAN.symbol}: every step below ran on an Anvil fork of Base against the real Bankr pool.`,
    steps: [
      { t: "Underwrite", s: "Real fee history → a deterministic cap. Three persona memos; the lead is binding and can only lower.", tag: "Bankr fee API + LLM Gateway" },
      { t: "Pledge", s: "The borrower points its Doppler fee share at a per-loan FeeVault. That is the lien.", tag: "build-transfer-beneficiary" },
      { t: "Fund", s: `The debt becomes a FeeNote ERC-20, sold for USDC in a Continuous Clearing Auction. The desk anchors the bid.`, tag: "Uniswap CCA v2.1.0" },
      { t: "Service", s: `Keeper collects fees, swaps WETH → USDC, repays noteholders 1:1. ${LOAN.collectedWeth} WETH → ${LOAN.swappedTo} USDC.`, tag: "Uniswap Trading API" },
      { t: "Release", s: "Once the notes are covered, anyone can call release(). The fee rights go back and the surplus follows.", tag: "permissionless" },
    ],
    footnote: `Disbursed ${LOAN.disbursed} USDC by the Dynamic agent wallet · repaid · released · ERC-8004 feedback written`,
  },
  {
    kind: "cards",
    id: "underwriting",
    title: "The underwriting engine",
    durationInFrames: 300,
    notes: "The credit decision is deterministic first, and an LLM can only make it smaller. The desk pays real money for a risk verdict before approving.",
    headline: "The engine decides. The model may only lower.",
    sub: `${LOAN.symbol}: r7 0.2332 · r30 0.1044 · rLife 0.2463 WETH/day · cv30d 3.466 · $${LOAN.perDay}/day of fees.`,
    cards: [
      {
        title: "Rate math",
        lead: "The minimum of the 7-day, 30-day and lifetime fee rates, haircut by the 30-day slope. Lumpiness prices the fee; the CCA floor is tick-aligned.",
        rows: [
          ["Advance rate", `${LOAN.advancePct}%`],
          ["Principal", `$${LOAN.principal}`],
          ["Face value", `$${LOAN.face}`],
          ["Fee rate", `${LOAN.feeRatePct}%`],
          ["Term", `${LOAN.termDays} days`],
          ["Note floor", LOAN.floor],
        ],
      },
      {
        title: "Three personas",
        lead: "Each writes a credit memo on its own Bankr LLM Gateway model. The lead memo is binding. A model that tries to exceed the engine cap is a parse failure: 502, no loan.",
        tone: "violet",
        rows: [
          ["prudent (lead)", `$${LOAN.principal} · approve`],
          ["momentum", "$250.00 · approve"],
          ["skeptic", "$79.12 · fees halve"],
          ["Model", "rules · LLM credits $0"],
        ],
      },
      {
        title: "Paid risk check",
        lead: "Before approving, the desk's Dynamic agent wallet buys a third-party honeypot verdict over x402 and uses the answer. Real USDC on Base mainnet, even in fork mode.",
        tone: "green",
        rows: [
          ["Price", "$0.05 USDC · EIP-3009"],
          ["HONEYPOT", "declines the loan"],
          ["SUSPICIOUS", "halves the principal"],
          ["Identity", "ERC-8004 desk agent #94699"],
        ],
      },
    ],
    footnote: "Memos on this loan are labelled “rules (Bankr LLM unavailable)”: the LLM path is built and fails closed.",
  },
  {
    kind: "cards",
    id: "feenote",
    title: "FeeNotes on a Uniswap CCA",
    durationInFrames: 270,
    notes: "The new asset. A FeeNote is an ERC-20 claim on one loan's repayment stream, and agents price it.",
    headline: "A new asset: the FeeNote.",
    sub: "An ERC-20 claim on one loan's repayment stream, sold to lenders in a Continuous Clearing Auction.",
    cards: [
      {
        title: "The asset",
        lead: "createLoan deploys a FeeVault and a FeeNote per loan. The vault mints exactly the face value into the auction; holders redeem 1:1 for USDC as the fees arrive.",
        rows: [
          ["Face value", `$${LOAN.face}`],
          ["Redeems", "1:1 USDC from the vault"],
          ["Backed by", `${LOAN.symbol} creator fees`],
        ],
      },
      {
        title: "The auction",
        lead: "A Uniswap CCA v2.1.0 with requiredCurrencyRaised = principal. It graduates or it does not fund; there is no half-loan.",
        tone: "violet",
        rows: [
          ["Raised", `$${LOAN.principal} USDC`],
          ["Floor price", LOAN.floor],
          ["Steps", "uint24 mps + uint40 blocks"],
        ],
      },
      {
        title: "Agents price it",
        lead: "Every persona publishes a maxNotePrice. The desk's Dynamic agent wallet places the anchor bid at its lead's price; the lender panel has a “copy this agent's bid” button.",
        tone: "green",
        rows: [
          ["Anchor bid", "Dynamic agent wallet (MPC)"],
          ["Lender flow", "Permit2 → submitBid"],
          ["Settlement", "checkpoint() → graduated"],
        ],
      },
    ],
    footnote: "Uniswap Trading API also does the servicing swaps, with the vault contract itself as the swapper and minUsdcOut enforced on-chain.",
  },
  {
    kind: "rows",
    id: "board",
    title: "Credit Line Board",
    durationInFrames: 270,
    notes: "Not a demo of one loan: every Bankr agent on Base already has a priced line. Ineligible rows say why.",
    headline: "Every Bankr agent already has a priced credit line.",
    sub: "The same deterministic engine, run over every agent profile Bankr lists. Ineligible rows print their reason.",
    cols: ["Agent cohort", "Lifetime fees", "Detail", "Credit line"],
    widths: [34, 23, 25, 18],
    mono: [1, 2, 3],
    rows: [
      { cells: ["105 Bankr agents on Base", `${BOARD.lifetimeFeesWeth} WETH`, `${BOARD.llmTokens30d}B LLM tokens 30d`, `$${BOARD.creditUsdc}`], tone: "violet" },
      { cells: ["14 eligible today", "lead persona price", "advance 30% · $250 cap", "pre-approved"], tone: "green" },
      { cells: ["91 not eligible", "reason on every row", "no fee rate · not Doppler", "—"] },
      { cells: ["17 on Robinhood Chain", "indicative only", "desk is Base-only", "not lendable"], tone: "amber" },
      { cells: ["4 paid in tokenized stocks", `$${(BOARD.equityFeesUsd / 1000).toFixed(1)}k lifetime`, "SPY · TSLA · MSTR · AMZN", "priced in shares"] },
      { cells: ["Desk bought 0.00079 TSLA", "bridged via Relay", "Trading API, chain 4663", "mainnet"], tone: "green" },
    ],
    strip: [
      ["Pre-approved credit", `$${BOARD.creditUsdc}`],
      ["Eligible agents", `${BOARD.eligible} of ${BOARD.agents}`],
      ["Lifetime fees", `${BOARD.lifetimeFeesWeth} WETH`],
      ["Claimable, idle", `${BOARD.claimableWeth} WETH`],
    ],
    footnote: `live /api/board · read ${AS_OF}, it drifts · a pre-approval, not a binding quote: the on-chain checks and memos run on apply`,
  },
  {
    kind: "cards",
    id: "desk",
    title: "Follow the Desk",
    durationInFrames: 270,
    notes: "The credit call is the social object. Show the real filled Flash TWAP on mainnet.",
    headline: "Every credit decision is a public, scored signal.",
    sub: "Underwriter personas are ranked on realized repayment and follower PnL. A persona with no realized data gets no score.",
    cards: [
      {
        title: "Mirror a call",
        lead: "A follower mirrors an approved borrower's token as a Flash market entry with an attached Bracket (TP/SL), or as a DCA built from a long Flash TWAP. Auto-mirroring runs through Dynamic delegated access.",
        rows: [
          ["Entry", "Flash market + Bracket"],
          ["DCA", "Flash TWAP, a slice a day"],
          ["Auto", "Dynamic delegated access"],
        ],
      },
      {
        title: "The desk follows itself",
        lead: "On Base mainnet, the desk's Dynamic MPC wallet signed and placed a real Definitive Flash TWAP mirroring its own approved signal. The first slice filled.",
        tone: "green",
        rows: [
          ["Order", "fb3b2572…cefac82f"],
          ["Size", `0.25 USDC → ${LOAN.symbol}, 2 slices`],
          ["First fill", "0.125 USDC → 2,158 GITLAWB"],
          ["Tx", "0x261a1355…f3bcab4"],
        ],
      },
      {
        title: "Not dumping the borrower",
        lead: "The keeper sells the creator-token fee leg as a TWAP with the vault as an EIP-1271 funder, so servicing the loan does not tank the token the loan is secured by.",
        tone: "amber",
        rows: [
          ["Quote-tested", "vault-funded keeper TWAP"],
          ["Not filled", "Flash is mainnet only"],
          ["Stated openly", "slippage is off-chain"],
        ],
      },
    ],
    footnote: "Definitive Flash · @DefinitiveFi · agent/src/flash, agent/src/social",
  },
  {
    kind: "cards",
    id: "dine",
    title: "Dine on your fees",
    durationInFrames: 240,
    notes: "The loan is money an agent can actually spend. Concierge on live Blackbird production data; be explicit that no FLY moves.",
    headline: "A loan you can spend: dine on your fees.",
    sub: `Every loan carries a dining budget — loan #1's drawLimit is $${LOAN.drawLimit}. A concierge plans a meal inside it from live Blackbird Flynet data.`,
    cards: [
      {
        title: "Live catalog",
        lead: "All Blackbird locations, fetched from Flynet production and cached. Today's hours, specials and challenges are read per venue, in small batches, and every failure becomes a visible note.",
        rows: [
          ["Venues", "~1,675, Flynet production"],
          ["Ranked on", "budget · hours · distance"],
          ["Ordering", "Bankr LLM, else rules"],
        ],
      },
      {
        title: "Member passport",
        lead: "A borrower logs in with Blackbird (OAuth 2.0 + PKCE) and signs a message binding the login to the loan. The passport shows places visited and gaps nearby, and personalizes the plan.",
        tone: "violet",
        rows: [
          ["Scopes", "11 read scopes, approved"],
          ["Bound by", "a signed link message"],
          ["Save to list", "granted, no endpoint → 501"],
        ],
      },
      {
        title: "No money moves",
        lead: "Payments and rewards scopes are pending Blackbird review, so Gadai books no draw and moves no FLY. The member pays at the table in the Blackbird app, and the UI says exactly that.",
        tone: "amber",
        rows: [
          ["Payments", "pending Blackbird review"],
          ["Rewards", "pending Blackbird review"],
          ["FeeVault.addDraw", "in the contract, unused"],
        ],
      },
    ],
    footnote: "App “hackathon 2”, approved on Flynet production for read scopes plus write:save_to_list.",
  },
  {
    kind: "cards",
    id: "a2a",
    title: "The agent-to-agent economy",
    durationInFrames: 240,
    notes: "Gadai is not only for humans clicking. Other agents buy from it, borrow from it, and run it as a skill.",
    headline: "Gadai's customers are other agents.",
    sub: "It sells an API, it buys an API, and it installs into two agent runtimes.",
    cards: [
      {
        title: "It sells credit reports",
        lead: "gadai-credit runs the same engine on Bankr x402 Cloud with no desk server in the loop. Unpaid calls answer 402 with x402 v2 payment requirements.",
        tone: "green",
        rows: [
          ["Price", "$0.02 USDC per call"],
          ["Returns", "rates, cap, floor, reasons"],
          ["Guard", "400 / 502 → nothing settles"],
        ],
      },
      {
        title: "It buys risk data",
        lead: "The desk's own agent wallet pays $0.05 for a honeypot verdict before it approves, then retries the request and uses the response. A policy refuses anything that is not exact / Base / native USDC / ≤ $0.05.",
        tone: "violet",
        rows: [
          ["Signed by", "Dynamic MPC wallet, EIP-3009"],
          ["Settled by", "Bankr facilitator"],
          ["Budget", "per-day cap · 24 h cache"],
        ],
      },
      {
        title: "It installs as a skill",
        lead: "Any Bankr agent can borrow by chat. Two Grok Bot Agent Skills read the board, quote a line, and watch a loan as a daily routine.",
        rows: [
          ["Bankr Skill", "quote → apply → pledge"],
          ["Grok Bot", "credit · loan-watch"],
          ["Every write", "explicit confirmation"],
        ],
      },
    ],
    footnote: "x402 both ways. Writes from the skill are refused with 409 while the desk runs on a fork, so nobody pledges real fee rights to a fork vault.",
  },
  {
    kind: "rows",
    id: "evidence",
    title: "Mainnet evidence",
    durationInFrames: 300,
    notes: "Six Base mainnet transactions, all signed by the desk's Dynamic agent wallet. This is the slide judges verify against docs/EVIDENCE.md.",
    headline: "Six transactions on Base mainnet.",
    sub: "All signed by the desk's Dynamic agent wallet 0x81b73786…85305D, 2026-09-19. docs/EVIDENCE.md.",
    cols: ["#", "What ran on mainnet", "Why it matters", "Transaction"],
    widths: [4, 34, 34, 28],
    mono: [0, 3],
    rows: [
      { cells: ["1", "Uniswap Trading API swap, 0.00015 ETH → 0.395941 USDC", "The same Trading API path the keeper services loans with", "0x6dd51e0c…026cc072"] },
      { cells: ["2", "FeeDesk deployed", "The lending desk itself is live on Base", "0xa4f21ace…d80476b4f"], tone: "violet" },
      { cells: ["3", "ERC-8004 register → desk agent #94699", "An on-chain identity that repayment reputation attaches to", "0xde4b3490…966229cb"] },
      { cells: ["4", "x402 payment, $0.05 USDC for a risk verdict", "An agent that pays for an API, retries, and uses the answer", "0x9c22339b…3f98ad00"], tone: "green" },
      { cells: ["5", "Definitive Flash TWAP, first slice filled", "An advanced order placed by an agent others can follow", "0x261a1355…f3bcab4"], tone: "green" },
      { cells: ["6", "Bridged to Robinhood Chain, bought 0.00079 TSLA", "The tokenized-stock fee leg on the board is tradable, not theory", "0xbfbe9702…366dd708"] },
    ],
    footnote: "basescan.org/tx/<hash> · reproduce with agent/src/demo/{mainnet-deploy,risk-check,desk-mirror,rh-equity-swap}.ts",
  },
  {
    kind: "rows",
    id: "scope",
    title: "Live vs simulated",
    durationInFrames: 300,
    notes: "Close on honesty. Nothing is mocked; one demo mode, and every page labels it. Then the links.",
    headline: "What is live, and what is not.",
    sub: "Nothing in the repo is mocked. There is one demo mode, DEMO_FORK, and every page labels it.",
    cols: ["Part", "Where it ran", "Proof"],
    widths: [36, 30, 34],
    rows: [
      { cells: ["Bankr fee APIs, agent profiles, LLM usage", "Live, Bankr production", "/board, every quote's formula"], tone: "green" },
      { cells: ["FeeDesk contract, ERC-8004 identity", "Base mainnet", "EVIDENCE #2, #3"], tone: "green" },
      { cells: ["x402: report sold, risk verdict bought", "Base mainnet + x402 Cloud", "EVIDENCE #4, live 402"], tone: "green" },
      { cells: ["Definitive Flash TWAP (desk mirror)", "Base mainnet, first slice filled", "EVIDENCE #5"], tone: "green" },
      { cells: ["Full loan lifecycle: pledge → CCA → release", "Anvil fork of Base, real Bankr pool", "/loans/1, every tx in the timeline"], tone: "amber" },
      { cells: ["Credit memos", "Deterministic rules — Bankr LLM credits $0", "memos labelled, LLM path fails closed"], tone: "amber" },
      { cells: ["Vault-funded keeper TWAP, follower mirrors", "Built and quote-tested, not filled", "Flash settles on mainnet only"], tone: "amber" },
      { cells: ["Blackbird FLY payments and rewards", "Not run: scopes pending review", "member pays in the Blackbird app"], tone: "amber" },
    ],
    strip: [
      ["Site", "gadai-six.vercel.app"],
      ["Video", "/demo"],
      ["Evidence", "/evidence"],
      ["Board", "/board"],
      ["Repo", "github.com/PugarHuda/gadai"],
    ],
    footnote: "Gadai · credit for agents, secured by the fees they already earn.",
  },
];

export const TOTAL_FRAMES = SLIDES.reduce((a, s) => a + s.durationInFrames, 0);
