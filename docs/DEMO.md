# Fee Desk: 3-minute demo script

Record at 1920×1080. Use a browser at 125% zoom, a terminal with a large font, and Basescan in a third tab. Keep the voice-over (VO) short and let the chain do the talking. Every tx hash shown on screen must be real: from mainnet, or from the fork with the DEMO_FORK banner visible.

## Before recording

1. `.env` is filled in. `pnpm agent:docker` and `pnpm web` are running. `GET /api/health` returns `ok`.
2. The **mainnet** clip is recorded first (the real-money path, a small $5–20 loan):
   - an apply → pledge → auction → disburse run whose tx hashes are on Basescan;
   - one keeper tick showing `collected`, `swapped` (Uniswap) and `flash_twap` events;
   - a mirror order that the Flash API returns with `attachedBracket.status`.
3. The **fork** is warmed up for the fast-forward part:
   - `docker compose --profile fork up anvil`, started less than 10 minutes before recording (so the Uniswap `/swap` deadline and pool state are fresh);
   - FeeDesk deployed to the fork;
   - the agent wallet funded with ETH and USDC on the fork.
4. The Bankr agent has the skill installed: `install the fee-desk skill from https://github.com/GITHUB_OWNER/GITHUB_REPO/tree/main/skill/fee-desk`.
5. A Blackbird staging member is logged in for the dining shot, and the staging app wallet holds FLY.
6. A follower wallet on `/desk` already follows `prudent` in bracket mode.

## Shot list

| t | Screen | Action | VO |
|---|---|---|---|
| 0:00–0:12 | `/` loan book | Slow scroll: loans, statuses, repaid %, Basescan links | "Bankr agents earn trading fees, but LLM credits are prepaid. Fee Desk lends them USDC today against those fees, with the fee rights locked in a contract as collateral." |
| 0:12–0:35 | Bankr chat (terminal or bankr.bot) | Type: *"borrow against my GITLAWB fees with fee desk"*. The skill runs `/api/quote`, then shows the terms and the formula string | "Any Bankr agent can borrow by chat through our Bankr Skill. The quote comes from real fee history in the Bankr API, and it discounts fee decay and lumpy days." |
| 0:35–0:55 | Same chat → `/loans/[id]` | Agent: *"apply"*. Cut to the loan page: three memo cards (Prudent/Claude, Momentum/Gemini, Skeptic/GPT) and the lead's APPROVED badge | "Three underwriters on the Bankr LLM Gateway write credit memos on three different models. The lead's decision is binding, and the model can only lower the amount, never raise it." |
| 0:55–1:10 | Loan timeline + Basescan | Click the `loan_created` tx: `createLoan` from the Dynamic agent wallet | "The moment it approves, the desk's own Dynamic agent wallet deploys this loan's vault on-chain. The agent decides, then acts." |
| 1:10–1:30 | Bankr chat → Basescan | *"yes, pledge"*. The skill submits `pledgeTx` (`updateBeneficiary` → vault). Show the tx on Basescan, then the loan status flips to AUCTION | "The borrower pledges by moving its Doppler fee beneficiary to the vault. It's Bankr's own primitive, and now it's a lien." |
| 1:30–1:50 | `/loans/[id]` auction panel | The desk's anchor bid appears. A lender logs in with a Dynamic embedded wallet (email), clicks "copy Prudent's bid" and signs. Raised/required bar fills up | "The loan becomes a FeeNote, a new ERC-20 claim on this fee stream, sold in a Uniswap Continuous Clearing Auction. Agents set the price, and humans can copy their bids." |
| 1:50–2:05 | Timeline → terminal | `disbursed` event from the agent wallet, then in terminal `bankr llm credits add 10` | "It graduates, the agent wallet pays out the USDC, and the borrower turns the loan into LLM credits." |
| 2:05–2:25 | Timeline (fork, banner visible, `anvil_mine`) | Keeper tick: `collected` → `swapped` (Uniswap Trading API, vault as swapper) → the `flash_twap` event from the mainnet clip; the debt bar drops | "Fees flow into the vault. WETH goes through the Uniswap Trading API with the vault itself as the swapper. The creator-token leg sells via a Definitive Flash TWAP, so the borrower's own token isn't dumped." |
| 2:25–2:40 | `/desk` | Leaderboard, signal feed, and a follower's mirror: market entry with an attached take-profit/stop-loss **Bracket**. Show the Flash order status | "Every credit decision is a public signal. Follow the best underwriter, and its approvals mirror into Flash bracket orders or DCA, signed by one click or automatically through Dynamic delegation." |
| 2:40–2:50 | `/dine/[id]` | Blackbird passport, the LLM's restaurant picks with reasons, draw $10 → FLY issued and `addDraw` tx | "Borrowers can even dine on their fees: a FLY dining line from Blackbird Flynet, repaid automatically out of the same fee stream." |
| 2:50–3:00 | `/loans/[id]` | Debt reaches 0. A **different** wallet clicks Release. `Released` event, and the fee rights are back with the borrower on Basescan | "Once the debt hits zero, anyone can call release, and the fees go back to the borrower. The desk never keeps them." |

## Rules for the edit
- Keep the DEMO_FORK red banner visible in every shot recorded on the fork. Say "on a Base fork" once in the VO at 2:05.
- Don't cut away from the result of any on-chain claim you make. Show the tx on Basescan, or the event with its hash.
- If a step failed on the day, say that it failed and show the error message. Don't swap in a staged screen.
- End card: repo URL, "@bankrbot @DefinitiveFi @dynamic_xyz @Uniswap", plus "Blackbird Flynet" by name, and the skill install line.
