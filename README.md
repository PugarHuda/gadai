# Gadai

**Gadai lends USDC to Bankr agents and creators against their token's creator-fee stream, and holds that stream as an on-chain lien the desk can't keep.**

Built for Runtime Agent Week (Bankr x Propaganda). Chain: Base (8453).

A Bankr token launched through Doppler pays its creator a share of every trade. Many agents need cash now (LLM credits, x402 APIs, inventory) and have steady fees coming in later. Bankr's guidance for an agent whose fees don't cover its compute is to cut operations or top up by hand. Before Gadai, nothing on Bankr let a creator borrow against those future fees. Gadai does, using a primitive Doppler already ships: `updateBeneficiary(poolId, newBeneficiary)`.

1. **Underwrite.** The desk's agent reads the token's real fee history from the Bankr API. A deterministic engine sets the maximum it can lend. Three underwriter personas, each on a different model through the **Bankr LLM Gateway**, write credit memos. The lead persona's decision is binding. An LLM can only decline a loan or lower the amount, never raise it.
2. **Pledge.** The borrower moves its fee beneficiary share to a per-loan **FeeVault** contract. It can do this from a Dynamic embedded wallet in the web app, through Bankr chat, or with its own Bankr agent via our **Bankr Skill**.
3. **Fund.** The loan becomes a new ERC-20, the **FeeNote**, whose face value is the debt. FeeNotes are sold for USDC in a **Uniswap Continuous Clearing Auction**. The desk's **Dynamic agent wallet** places an anchor bid at its own underwriter's price, and lenders bid alongside it. When the auction graduates, the same agent wallet sends the USDC to the borrower. The borrower can turn it straight into LLM credits with `bankr llm credits add`.
4. **Service.** The keeper collects fees into the vault. WETH is swapped to USDC through the **Uniswap Trading API**, with the vault itself as the swapper. The creator-token leg is sold via a **Definitive Flash TWAP**, with the vault as an EIP-1271 funder, so the borrower's own token isn't dumped. USDC building up in the vault is the repayment, and noteholders redeem 1:1.
5. **Release.** Once the notes are covered, **anyone** can call `release()`. The vault gives the fee rights back to the borrower and forwards any surplus. The borrower never depends on the desk to get its fees back.

Two more things run on the same loan:
- **Follow the Desk.** Every credit decision is a public, scored signal. Underwriter personas are ranked on a leaderboard by realized repayment and follower PnL. Followers can mirror approved borrowers' tokens as a Flash market entry with an attached **Bracket** (take-profit and stop-loss), or as a DCA built from a long Flash TWAP.
- **Dine on your fees.** An active borrower can draw a small dining line in FLY through **Blackbird Flynet**. The draw becomes on-chain junior debt in the vault, and the fee stream repays it.

> Nothing in this repo is mocked. A missing key makes the process throw `Missing env X (see .env.example)`. The one demo mode, `DEMO_FORK=1`, runs on an Anvil fork of Base and every web page labels it.

---

## Architecture

```mermaid
flowchart LR
  subgraph Borrowers & lenders
    BA[Bankr agent<br/>skill/gadai/SKILL.md]
    WEB[web/ Next.js<br/>Dynamic embedded wallets]
  end
  subgraph Agent["agent/ (Node 26, Hono, SQLite)"]
    UW[underwriter<br/>engine + 3 LLM personas]
    BK[bankr<br/>fee APIs + LLM Gateway]
    WL[wallet<br/>Dynamic agent wallet]
    KP[keeper<br/>collect / swap / payDesk / release]
    UNI[uniswap<br/>Trading API]
    CCA[cca<br/>FeeNote auction]
    FL[flash<br/>TWAP token leg]
    SO[social<br/>signals, leaderboard, mirrors]
    FN[flynet<br/>OAuth, recs, FLY draws]
  end
  subgraph Base["Base 8453"]
    FD[FeeDesk]
    FV[FeeVault<br/>per loan]
    NOTE[FeeNote ERC-20]
    AUC[Uniswap CCA]
    FM[Doppler FeesManager]
  end
  BA -- REST --> Agent
  WEB -- REST --> Agent
  WEB -- pledge, bids, redeem, release --> Base
  BK <--> BAPI[(api.bankr.bot<br/>llm.bankr.bot)]
  UNI <--> UAPI[(Uniswap Trading API)]
  FL <--> FAPI[(Definitive Flash)]
  SO <--> FAPI
  FN <--> FLY[(Blackbird Flynet)]
  WL -- signs --> FD & FV & AUC
  FD -- deploys --> FV -- deploys/mints --> NOTE -- sold in --> AUC
  FM -- beneficiary = vault --> FV
```

```mermaid
sequenceDiagram
  autonumber
  participant B as Borrower (Bankr agent / web)
  participant D as Gadai agent
  participant L as Bankr LLM Gateway
  participant W as Dynamic agent wallet
  participant V as FeeVault
  participant A as Uniswap CCA
  participant K as Keeper
  B->>D: POST /api/loans {token, borrower}
  D->>D: Bankr fee history + Uniswap ETH/USD → deterministic cap
  D->>L: 3 persona memos (JSON), lead is binding
  D->>W: createLoan → FeeVault + FeeNote
  D-->>B: pledgeTx (Bankr build-transfer-beneficiary → vault)
  B->>V: updateBeneficiary(poolId, vault)
  B->>D: POST /pledge {txHash}
  W->>V: confirmPledge, startAuction
  W->>A: anchor bid at lead persona price
  Note over A: lenders bid USDC (Permit2)
  W->>V: disburse() → USDC to borrower
  B->>B: bankr llm credits add
  loop every KEEPER_INTERVAL_SEC
    K->>V: collect → swapWethToUsdc (Uniswap) → Flash TWAP token leg → payDesk
  end
  B->>V: release() (anyone, once covered) → fee rights back
```

**Trust model.**
- The lien is enforced by the contract. Only `release()` and `cancel()` can move the fee share, and both move it back to the borrower.
- The keeper (the Dynamic agent wallet) can relay swap calldata, but the vault approves only the exact amount and enforces `minUsdcOut` on-chain.
- It can authorize Flash orders only when the swapper and recipient are the vault itself, the output is USDC, and the input is WETH or the creator token.
- Two assumptions remain, and we state them openly:
  - Flash enforces slippage off-chain, because the signed Flash order has no min-out.
  - The desk chooses when to sell.

---

## Sponsor tracks: where each integration lives

Line ranges are generated from symbol names by [`docs/anchors.mjs`](docs/anchors.mjs); `node docs/anchors.mjs` fails if any range is stale.

### Bankr: grand prize
Bankr is the product's foundation, not a plug-in. The collateral, the underwriting data, the credit decision, the borrower channel and the use of the funds all run on Bankr.

**Fee APIs drive the underwriting.**
- [`agent/src/bankr/index.ts#L73-L129`](agent/src/bankr/index.ts#L73-L129): `/token-launches/{token}/fees`, `creator-fees`, `claimable-fees`, `build-transfer-beneficiary` and `build-claim`, plus `llmChat` against `llm.bankr.bot/v1/chat/completions`.
- [`agent/src/underwriter/index.ts#L30-L78`](agent/src/underwriter/index.ts#L30-L78): `quote()` hard-rejects anything that isn't a Base Doppler token. It uses the API `share` and the unclaimed fees at pledge time, which follow the vault and count as the first repayment.
- [`agent/src/underwriter/engine.ts#L46-L115`](agent/src/underwriter/engine.ts#L46-L115): the decay-aware rate (the minimum of the 7-day, 30-day and lifetime rates, with a slope haircut), the lumpiness-priced fee, and the tick-aligned floor.

**The LLM Gateway makes the credit decision.**
- [`agent/src/underwriter/index.ts#L12-L16`](agent/src/underwriter/index.ts#L12-L16): three personas on three Gateway models.
- [`#L80-L152`](agent/src/underwriter/index.ts#L80-L152): each persona's memo and the binding lead decision.
- [`engine.ts#L121-L141`](agent/src/underwriter/engine.ts#L121-L141): `parseMemo` fails closed. If the model tries to exceed the cap or returns a bad price, the result is a parse failure, which returns 502 and creates no loan.

**The pledge is Bankr's own primitive.**
- [`agent/src/server/index.ts#L110-L185`](agent/src/server/index.ts#L110-L185): `apply` accepts only a borrower-signed `applyMessage` (EIP-191, single-use nonce), then builds `pledgeTx` via `build-transfer-beneficiary` with `newBeneficiary = FeeVault` and checks it byte-for-byte.
- [`#L227-L286`](agent/src/server/index.ts#L227-L286): verifies the pledge on-chain with `getShares` (authoritative) and cross-checks Bankr's `claimable-fees` for the vault.

**Enforceable lien.**
- [`contracts/src/FeeVault.sol#L242-L250`](contracts/src/FeeVault.sol#L242-L250): `confirmPledge`.
- [`#L439-L448`](contracts/src/FeeVault.sol#L439-L448): `release`, which is permissionless.
- [`#L477-L485`](contracts/src/FeeVault.sol#L477-L485): `_returnLien`, which calls `updateBeneficiary(poolId, borrower)`.

**Bankr Skill.** Any Bankr agent can borrow by chat:
- [`skill/gadai/SKILL.md`](skill/gadai/SKILL.md) and [`skill/gadai/catalog.json`](skill/gadai/catalog.json) use the `<slug>/SKILL.md + catalog.json` layout of `BankrBot/skills`.
- The skill walks through quote → apply → pledge via `/wallet/submit` or the documented chat phrase → status → `bankr llm credits add` → early repay → release, and it puts every write behind explicit user confirmation.

**The loan becomes LLM credits.** See step 6 of the skill, plus the `disbursed` event on the loan page.

The dining recommendations are also written by the Bankr LLM ([`agent/src/flynet/index.ts#L137-L192`](agent/src/flynet/index.ts#L137-L192)).

### Dynamic: an agent that decides, then pays

**Agent wallet** (Node SDK, agent signing token pattern):
- [`agent/src/wallet/index.ts#L42-L89`](agent/src/wallet/index.ts#L42-L89): SIWE sign-in with the agent signing token, then `authenticateJwt` and the `DynamicEvmWalletClient` MPC wallet.
- [`#L202-L248`](agent/src/wallet/index.ts#L202-L248): `getAgentWallet`, the viem client that every desk transaction goes through.
- [`agent/src/wallet/bootstrap.ts`](agent/src/wallet/bootstrap.ts): the one-time identity and key-share bootstrap.

**Decision → payment.** Right after the lead memo approves, the same wallet signs:
- `createLoan`: [`agent/src/keeper/index.ts#L23-L44`](agent/src/keeper/index.ts#L23-L44)
- the USDC anchor bid in the note auction: [`agent/src/cca/index.ts#L129-L204`](agent/src/cca/index.ts#L129-L204)
- `disburse()`, which sends USDC to the borrower: [`agent/src/cca/index.ts#L317-L352`](agent/src/cca/index.ts#L317-L352), backed by [`FeeVault.sol#L291-L306`](contracts/src/FeeVault.sol#L291-L306)

After that, it signs every keeper transaction ([`keeper/index.ts#L102-L237`](agent/src/keeper/index.ts#L102-L237)).

**Embedded wallets** (React SDK):
- [`web/lib/wallet.tsx#L11-L80`](web/lib/wallet.tsx#L11-L80): `DynamicContextProvider` + `EthereumWalletConnectors`, and `useSigner`, which sends the transactions.
- Borrowers sign the pledge in [`web/components/pledge.tsx#L12-L88`](web/components/pledge.tsx#L12-L88).
- Lenders sign Permit2 approvals and `submitBid` in [`web/components/auction.tsx#L10-L149`](web/components/auction.tsx#L10-L149).

**Delegated access** (auto-mirroring for Follow the Desk):
- [`agent/src/social/delegation.ts#L16-L95`](agent/src/social/delegation.ts#L16-L95): verifies the webhook HMAC, stores the encrypted share, and signs with `delegatedSignTypedData` / `delegatedSignTransaction`.
- [`agent/src/social/index.ts#L240-L255`](agent/src/social/index.ts#L240-L255): the auto executor.
- [`web/app/desk/page.tsx#L151-L232`](web/app/desk/page.tsx#L151-L232): the follow form, which asks for delegation with `useWalletDelegation`.

### Uniswap: New Assets, New Agents

**A new on-chain asset.** A FeeNote is an ERC-20 claim on one loan's repayment stream.
- [`contracts/src/FeeNote.sol`](contracts/src/FeeNote.sol): the token itself.
- [`contracts/src/FeeDesk.sol#L52-L72`](contracts/src/FeeDesk.sol#L52-L72): `createLoan` deploys a vault and a note for every loan.
- [`FeeVault.sol#L430-L435`](contracts/src/FeeVault.sol#L430-L435): holders redeem notes 1:1 for USDC.

**The CCA funds the loan.**
- [`contracts/src/FeeVault.sol#L253-L287`](contracts/src/FeeVault.sol#L253-L287): `startAuction` calls the v2.1.0 factory `create`, with `requiredCurrencyRaised = principal`, mints exactly the face value to the auction, then calls `onTokensReceived`.
- [`agent/src/cca/index.ts#L33-L38`](agent/src/cca/index.ts#L33-L38): step packing with `encodePacked(uint24 mps, uint40 blocks)`.
- [`#L129-L204`](agent/src/cca/index.ts#L129-L204): launch plus the agent's anchor bid.
- [`#L241-L272`](agent/src/cca/index.ts#L241-L272): bid plans, with the `prevTickPrice` hint computed by walking `ticks()`.
- [`#L275-L309`](agent/src/cca/index.ts#L275-L309): exit and partial-exit hints from walking the checkpoints.
- [`#L317-L352`](agent/src/cca/index.ts#L317-L352): settles with `checkpoint()` before reading `isGraduated()`.

**Agents price the notes.** Each underwriter persona publishes a `maxNotePrice`. The desk agent bids at the lead's price, and the auction panel has a "copy this agent's bid" button for human lenders ([`web/components/auction.tsx#L10-L149`](web/components/auction.tsx#L10-L149)).

**Trading API** (`/check_approval` → `/quote` → `/swap`, no-Permit2 SwapProxy flow, contract swapper):
- [`agent/src/uniswap/index.ts#L13-L22`](agent/src/uniswap/index.ts#L13-L22): headers, including `x-permit2-disabled`, `x-universal-router-version` and `x-agent-info` with `decision_origin: autonomous`.
- [`#L120-L145`](agent/src/uniswap/index.ts#L120-L145): `buildVaultSwap`.
- [`#L87-L94`](agent/src/uniswap/index.ts#L87-L94): the calldata guards.
- [`#L107-L116`](agent/src/uniswap/index.ts#L107-L116): ETH/USD for underwriting.
- On-chain execution: [`contracts/src/FeeVault.sol#L351-L372`](contracts/src/FeeVault.sol#L351-L372) (`swapWethToUsdc`: exact approve, SwapProxy call, `minUsdcOut`).
- The keeper call: [`agent/src/keeper/index.ts#L164-L187`](agent/src/keeper/index.ts#L164-L187).

**Developer feedback:** [`FEEDBACK.md`](FEEDBACK.md).

### Definitive Flash: Best Social Trading Build (@DefinitiveFi)

**TWAP.** The keeper sells the creator-token fee leg so it doesn't dump the borrower's token.
- [`agent/src/flash/index.ts#L84-L162`](agent/src/flash/index.ts#L84-L162): quote with `orderType:"twap"`, 12 or 24 buckets depending on price impact, and `funderAddress = vault`. It then calls `vault.authorizeFlashOrder` (checking the digest against viem's `hashTypedData`) and posts `/order`.
- [`#L165-L184`](agent/src/flash/index.ts#L165-L184): polls for fills.
- On-chain side: [`contracts/src/FeeVault.sol#L198-L228`](contracts/src/FeeVault.sol#L198-L228) (EIP-1271 `isValidSignature`, the Flash EIP-712 domain) and [`#L382-L399`](contracts/src/FeeVault.sol#L382-L399) (`authorizeFlashOrder` / `authorizeFlashCancel`).

**Follow the Desk** (social):
- [`agent/src/social/index.ts#L56-L89`](agent/src/social/index.ts#L56-L89): every persona memo becomes a public signal, and each follower gets a queued mirror.
- [`#L94-L131`](agent/src/social/index.ts#L94-L131) + [`score.ts#L39-L57`](agent/src/social/score.ts#L39-L57): the leaderboard, scored only on realized on-chain repayment and follower PnL from Flash fills. A persona with no realized data gets no score.
- [`#L154-L196`](agent/src/social/index.ts#L154-L196): the mirror quote. It is either a **market entry with an attached Bracket** (TP/SL) or a **DCA (Flash TWAP)** that buys one slice per day.
- [`#L199-L237`](agent/src/social/index.ts#L199-L237): submits the follower-signed entry and bracket.
- [`web/app/desk/page.tsx#L25-L149`](web/app/desk/page.tsx#L25-L149): the leaderboard, signal feed, follow form and the "my mirrors" queue, where followers sign.
- The auto mode runs through Dynamic delegation, as described above.

### Blackbird Flynet: dine on your fees
- [`agent/src/flynet/index.ts#L137-L192`](agent/src/flynet/index.ts#L137-L192): restaurant picks. `listLocations` (only locations with payments enabled), open hours, specials and challenges, and the member's check-ins and memberships go to the Bankr LLM, which ranks the options and gives a reason for each.
- [`#L196-L216`](agent/src/flynet/index.ts#L196-L216): the member passport and FLY wallet, from OAuth with PKCE.
- [`#L256-L355`](agent/src/flynet/index.ts#L256-L355): the draw. The borrower personal_signs the vault's own `drawMessage` (amount, `drawNonce`, deadline), the draw is checked against the vault's `drawLimit`, the Dynamic agent wallet books it with `vault.addDraw(amount, deadline, sig)` (the vault verifies the signature on-chain), then `rewards.issueReward` sends FLY to the member.
- [`#L372-L407`](agent/src/flynet/index.ts#L372-L407): leftover FLY comes back via `createPaymentIntent` + `confirmPaymentIntent`.
- Repayment is taken from the fee stream automatically: [`contracts/src/FeeVault.sol#L413-L427`](contracts/src/FeeVault.sol#L413-L427) (`addDraw`, `payDesk`; notes are senior, dining draws are junior).
- The member pays at the restaurant in the Blackbird app. The Flynet API has no partner call that pays a venue directly, so we don't pretend one exists.

### Credit Line Board
`GET /api/board` ([`agent/src/board/index.ts`](agent/src/board/index.ts), page [`web/app/board/page.tsx`](web/app/board/page.tsx)) gives every Bankr agent with a Base token a live, pre-approved credit limit. For each profile from `GET https://api.bankr.bot/agent-profiles?sort=marketCap&limit=100` (offsets 0 and 100), the agent fetches `GET /token-launches/{token}/fees?days=30` and `GET /agent-profiles/{slug}/llm-usage?days=30`. It runs the same deterministic engine as a real quote (`computeTerms`, the lead underwriter's advance rate, `DESK_MAX_LOAN_USDC`, ETH/USD from a Uniswap Trading API quote) to get the max principal, fee rate and floor price. When the engine rejects an agent, its row says `not eligible: <reason>`.
- Response: `{ generatedAt, ethUsd, totals: { agents, eligible, totalCreditUsdc, lifetimeFeesWeth, claimableWeth, llmTokens30d, failed, nonBase }, rows: [...] }`.
- The agent makes 6 requests at a time, each with a 15 s timeout, and keeps results in memory for 10 minutes. If a fetch fails, the row stays on the board with an `error` and is counted in `totals.failed`.
- This is a pre-approval, not a binding quote. On-chain checks (an open vault on the pool, the claimable-fees beneficiary check) and the LLM memos run when the agent applies. Each row's Apply button opens `/apply?token=…&borrower=…`.
- Tests: `agent/src/board/board.test.ts`, which runs on real API responses captured on 2026-09-19 (`agent/src/board/fixtures-captured-2026-09-19/`).

### Paid credit report on Bankr x402 Cloud
`gadai-credit` is the Gadai engine sold as a paid API: **$0.02 USDC on Base per call**, no desk server needed.
- URL: `GET https://x402.bankr.bot/0x0455408228f460722ecbe80789bcf1628b479e98/gadai-credit?token=<0x…>[&borrower=<0x…>]`. Without payment it answers `402` with the x402 v2 payment requirements (`exact`, USDC `0x8335…2913`, amount `20000`).
- Call it: `bankr x402 call "https://x402.bankr.bot/0x0455408228f460722ecbe80789bcf1628b479e98/gadai-credit?token=0x5F980Dcfc4c0fa3911554cf5ab288ed0eb13DBa3"`. Schema: `bankr x402 schema <url>`.
- Handler: [`x402/gadai-credit/index.ts`](x402/gadai-credit/index.ts), config: [`bankr.x402.json`](bankr.x402.json). It reads `GET https://api.bankr.bot/public/doppler/token-fees/{token}?days=30` and ETH/USD from Coinbase spot (CoinGecko fallback), builds the same inputs as the board row, and runs a verbatim copy of `computeTerms` and its helpers from `agent/src/underwriter/engine.ts` (lead persona: 30% advance, $250 cap). x402 Cloud bundles one self-contained file, so the engine is copied, not imported; the header names the source commit.
- Response: `{ token, symbol, beneficiary, sharePct, history { days, lifetimeWeth, claimableWeth, r7, r30, rLife, slope30d, cv30d }, ethUsd, ethUsdSource, terms { maxPrincipalUsdc, feeRatePct, floorPrice, termDays, drawLimitUsdc }, eligible, reasons[], formula, generatedAt, source }`.
- A bad `token`/`borrower` address returns `400` and an upstream failure `502`, so no payment settles. A token Bankr never launched (e.g. WETH) is still a valid report: `200` with `eligible: false` and a reason.
- Like the board, this is a pre-approval (no on-chain reads). The on-chain checks run when you apply.
- Check: `node x402/check.ts` calls the handler on live data and asserts its terms equal `buildRow()` for the same fees and ETH price (GITLAWB, Surplus, Ratspeak, WETH, bad input). Redeploy: `npx -y @bankr/cli@latest x402 deploy gadai-credit`.

### ERC-8004 identity + repayment reputation, ERC-8021 builder code
[`agent/src/erc8004/index.ts`](agent/src/erc8004/index.ts) uses the ERC-8004 registries already deployed on Base (IdentityRegistry `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`, ReputationRegistry `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`, v2.0.0). Every write is signed by the Dynamic agent wallet.
- **Desk identity.** On start, the agent wallet registers the desk as an ERC-8004 agent. This runs once: the id is stored in the db, or you can pin it with `ERC8004_DESK_AGENT_ID`. The `agentURI` is `GET /.well-known/agent-card.json`, a registration-v1 file listing endpoints, personas, `supportedTrust: ["reputation"]`, chain 8453 and the registry addresses. `GET /api/erc8004/desk` returns the id, and the loan page shows it with a link to the registry.
- **Borrower reputation.** `GET /api/erc8004/:agentId` returns `getSummary(agentId, [desk wallet], "gadai", "")`, which is what this desk has said on-chain about that agent's repayments.
- **On repayment** (loan `RELEASED`), the keeper publishes the outcome. If the borrower gave an ERC-8004 agentId, it calls `giveFeedback(agentId, 100, 0, "gadai", "repaid", <loan API url>, <memo url>, keccak256(memo))`. In every case, the desk also writes `setMetadata(deskAgentId, "gadai.loan.<id>", abi.encode(status, principal, repaid, txs[]))` on its own identity, since the registry refuses feedback an agent gives itself. Both writes show up in the loan timeline.
- **Builder code.** Every desk transaction ends with the ERC-8021 suffix for `BASE_BUILDER_CODE` (`bc_32d4pc8g`, registered for the agent wallet with `POST https://api.base.dev/v1/agents/builder-codes`). The suffix is added in the wallet's single send path ([`agent/src/wallet/index.ts`](agent/src/wallet/index.ts)).
- Fork check: `node --env-file=../.env src/demo/erc8004-check.ts` (Linux/WSL, `FORK_RPC_URL` = Anvil). It registers the desk, writes and reads back outcome metadata, sends feedback to a freshly registered borrower agent, confirms that self-feedback is refused, and confirms the builder-code suffix on each tx.

---

## Run it

Requirements:
- Node 26 and pnpm 11.
- Foundry, for the contracts and the fork.
- Docker, for the agent. Dynamic's MPC SDK ships no Windows binaries.

Keys and where to get them are listed in [`.env.example`](.env.example).

```bash
pnpm install
cp .env.example .env                     # fill it in; missing required values fail loudly
pnpm contracts:test                      # fork tests against the real GITLAWB pool on Base
pnpm contracts:deploy                    # prints FEE_DESK_ADDRESS
pnpm --filter @feedesk/agent bootstrap:dynamic   # one-time Dynamic agent identity + wallet
pnpm agent:docker                        # agent on :8787
pnpm web                                 # web on :3000
```

**DEMO_FORK:**
1. Start the fork with `docker compose --profile fork up anvil`.
2. Deploy to the fork and set `FORK_FEE_DESK_ADDRESS`, `DEMO_FORK=1` and `NEXT_PUBLIC_DEMO_FORK=1`.
3. The borrower is the real GITLAWB beneficiary, an EIP-7702 account whose key we don't hold. `pnpm --filter @feedesk/agent fork:borrower setup|apply|pledge <id>` (Anvil only) points its 7702 delegation at [`contracts/src/demo/ForkDelegate.sol`](contracts/src/demo/ForkDelegate.sol), so the server's normal ERC-1271 check verifies a real signature; the pledge tx itself is sent by fork impersonation. Full commands and results: [`docs/RUNBOOK.md`](docs/RUNBOOK.md).

What still runs live in fork mode:
- The Bankr fee APIs and the LLM Gateway.
- Uniswap `/swap` calldata, which is quoted on mainnet and executed on the fork.
- Flynet, on its staging environment.

Flash doesn't run in fork mode, because it settles only on mainnet. The UI shows "Flash: mainnet only".

**Bankr agent:** `install the gadai skill from https://github.com/PugarHuda/gadai/tree/main/skill/gadai`.

Tests:
- `pnpm --filter @feedesk/agent test`: engine, CCA math, Uniswap guards, leaderboard scoring, Flynet helpers.
- `pnpm contracts:test`.

## Repo layout
```
contracts/  FeeDesk, FeeVault, FeeNote (Foundry, fork tests)
agent/      underwriter + keeper agent (bankr, underwriter, wallet, keeper, uniswap, cca, flash, social, flynet, server)
web/        Next.js app with Dynamic embedded wallets
shared/     ABIs, addresses, DTOs shared by agent and web
skill/      Bankr Skill (gadai)
x402/       Bankr x402 Cloud handler (gadai-credit paid credit report); config in bankr.x402.json
docs/       integration notes, coordination log, demo script, submission checklist
```
