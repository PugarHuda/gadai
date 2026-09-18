# Fee Desk: build spec

Fee Desk is USDC credit for Bankr agents and creators. The collateral is the fee rights on their Doppler token, pledged on-chain on Base (8453).
This is the Runtime Agent Week build (Bankr x Propaganda). The deadline is Sun 2026-09-20 03:00 WIB.

The source facts are in `IDEAS.md` (Idea 1 and the verification table) and `docs/integrations/{bankr,dynamic,uniswap,flash,flynet}.md`. Interface changes go on `docs/COORDINATION.md`, which overrides this file where they differ.

**Ground rules**
- Everything here gets built now. Nothing is deferred to a roadmap.
- No mocks and no fake success paths. A missing key throws `Missing env X (see .env.example)`.
- Use only endpoints and functions confirmed in the integration docs.
- `DEMO_FORK=1` is the one allowed demo mode. It is an Anvil fork of Base, and the UI labels it on every page.

---

## 1. Architecture

```
                       ┌───────────── Bankr agent (chat) ── skill/fee-desk/SKILL.md ──┐
                       │                                                               │ REST
 Browser (web/, Next.js, Dynamic embedded wallets)                                     ▼
   loan book · apply/pledge · notes auction · desk leaderboard/follow · dine ──► agent/ (Hono, node:sqlite, Docker/Linux)
        │ signs: pledge, CCA bids, release, redeem, Flash mirror orders            │
        │                                                                          ├─ bankr/      fee APIs + LLM Gateway
        ▼                                                                          ├─ underwriter/ engine + persona memos
  Base 8453 (or Anvil fork)                                                        ├─ wallet/     Dynamic agent wallet (MPC)
   FeeDesk ─creates─► FeeVault (per loan) ─mints─► FeeNote ─sold via─► Uniswap CCA  ├─ keeper/     collect → swap → repay → release
   FeeVault = beneficiary of Doppler FeesManager(poolId)                           ├─ uniswap/    Trading API (ETH px, WETH→USDC)
   WETH leg ─Uniswap Trading API (SwapProxy)─► USDC                                ├─ flash/      Flash TWAP (token leg), orders
   token leg ─Definitive Flash TWAP (vault = EIP-1271 funder)─► USDC               ├─ social/     signals, leaderboard, mirrors
                                                                                   ├─ cca/        auction launch/settle/bid plans
                                                                                   └─ flynet/     Blackbird OAuth, recs, FLY draws
```

One process runs the agent: Hono REST, background loops and the SQLite file. The web app calls only the agent's REST API plus the chain (reads, and user-signed txs). All API keys stay on the agent.

## 2. Contracts (`contracts/`, Foundry)

The exact external interface is in **COORDINATION.md → "Contracts interface v1"**. Behavior that is not visible from the interface:
- **Per-loan vault.** Every token balance in a vault belongs to that loan. `FeeDesk.createLoan` deploys a `FeeVault`, and the vault's constructor deploys its `FeeNote`.
- **State machine:** `Created →(confirmPledge) Pledged →(startAuction) Auction →(disburse) Active →(release) Released`. `cancel()` goes to `Cancelled` from Created, from Pledged, and from an Auction that didn't graduate.
- **Lien:** once the pledge is confirmed, only the vault holds the shares. `release()` and `cancel()` are the only code paths that call `updateBeneficiary(poolId, borrower)`. `release()` is permissionless once `canRelease()` is true, so the borrower never depends on the desk to get the fee rights back.
- **Claim-first:** fees accrued before the pledge but not yet collected flow to the vault on the first `collect()` and count as repayment. The UI and memo show this amount (`claimableWethRaw`).
- **Debt:** `noteSupply` (face value, minus burned unsold and redeemed notes) + `drawDebt`. Notes are senior. `payDesk` pays only the surplus above `noteSupply`.
- **Uniswap swap** uses the no-Permit2 proxy flow (`x-permit2-disabled`). The keeper relays `/swap` calldata; the vault approves the exact amount, calls SwapProxy and enforces `minUsdcOut` on-chain.
- **Flash token leg:** the vault acts as an EIP-1271 funder. The keeper can only authorize orders with `swapper == recipient == vault`, `toToken == USDC` and `fromToken ∈ {creatorToken, WETH}`. The fallback is `sendTokenLegToKeeper`.

Files (contracts owner):
- `foundry.toml`
- `src/FeeDesk.sol`, `src/FeeVault.sol`, `src/FeeNote.sol`
- `src/interfaces/{IFeesManager,ICCA}.sol`
- `script/Deploy.s.sol`: env `DEPLOYER_PRIVATE_KEY`, `AGENT_WALLET_ADDRESS`, `DESK_TREASURY`; prints `FEE_DESK_ADDRESS`.
- `script/LaunchNoteAuction.s.sol`: manual CCA launch for a vault. It uses the same step math as `agent/src/cca`.
- `test/FeeVault.fork.t.sol`: runs on a Base fork against the real GITLAWB pool, `TEST_POOL` in shared. It impersonates the beneficiary `0xfdb6…76Bf` and covers:
  - pledge → confirm → auction → bid (Permit2) → disburse
  - collect → repay (USDC `deal` is a test fixture only) → redeem → release
  - cancel paths
  - the 1271 digest matching viem's `hashTypedData` for a fixed order
  - the `addDraw`/`payDesk` seniority rule

  Dependencies: forge-std, solady (ERC20, SafeTransferLib), and `Uniswap/continuous-clearing-auction@v2.1.0`, used for interfaces only.
- `pnpm contracts:test` runs `forge test --fork-url $BASE_RPC_URL`.

## 3. End-to-end flows

### A. Apply and underwrite. Tracks: Bankr GP, Dynamic (decision)
1. The borrower (web, or a Bankr agent through the Skill) sends `POST /api/loans {token, borrower, controller?, via}`.
2. `underwriter.quote` reads the Bankr API:
   - `GET /token-launches/{token}/fees?days=30`: pick the entry with `chain==="base" && source==="doppler"`; `feesManager = feesContract ?? initializer`; `share` gives `sharePct`.
   - `GET /public/doppler/claimable-fees/{token}?beneficiary=borrower` must return `eligible:true`.
   - It also reads ETH/USD from Uniswap `/quote`.

   Hard rejects:
   - not Base Doppler
   - numeraire ≠ WETH
   - not eligible
   - `lifetimeDays < 7`
   - fee rate = 0
   - `FeeDesk.activeVaultByPool(poolId) != 0`
3. The engine (§4) computes `Terms`. Then each persona (§4) asks the Bankr LLM Gateway for a JSON memo. The LLM can decline or lower the principal, never raise it. If the lead persona's memo fails to parse, the endpoint returns HTTP 502 and no loan is created. For any other persona, the failure is logged and that persona is skipped.
4. `social.publishSignals` stores one public signal per persona and queues mirror orders for that persona's followers (flow H).
5. If the lead persona declines, the loan is stored as `DECLINED` with its memo, and the flow ends.
6. If it approves:
   - `keeper.createLoanOnchain` has the **Dynamic agent wallet** call `FeeDesk.createLoan`, which yields the vault and note addresses.
   - `bankr.buildTransferBeneficiary({tokenAddress, currentBeneficiary: borrower, newBeneficiary: vault})` returns `pledgeTx`.
   - The response is a `Loan` with status `APPROVED`, plus `pledgeTx` and `pledgeChatText` (from `pledgeChatText()` in shared).

### B. Pledge. Tracks: Bankr, Dynamic (embedded wallet)
There are three signing paths. The UI shows all of them:
- (1) The web **Dynamic embedded or external wallet** sends `pledgeTx`. This works when the beneficiary is an EOA the user controls.
- (2) A Bankr agent submits `pledgeTx` through its own wallet (as the Skill describes), or uses the chat phrase `transfer my beneficiary share on token X to 0xVAULT`.
- (3) In DEMO_FORK only, `cast send --unlocked` impersonates the beneficiary. The UI labels this.

Then `POST /api/loans/:id/pledge {txHash?}` runs these checks:
- `getShares(poolId, vault) > 0` and `getShares(poolId, borrower) == 0`
- `claimable-fees?beneficiary=vault` returns `eligible`

If they pass, the agent wallet calls `vault.confirmPledge()`, the status becomes `PLEDGED`, and `cca.launchAuction` runs (flow C).

### C. Fund with a FeeNote CCA. Track: Uniswap (new asset and new agents)
1. `cca.launchAuction` computes the schedule:
   - `startBlock = head + 5`, `endBlock = startBlock + AUCTION_BLOCKS`, `claimBlock = endBlock + AUCTION_CLAIM_DELAY_BLOCKS`.
   - Steps: `N-1` blocks at `a = floor(6e6/(N-1))` mps, then 1 block at `1e7 − a(N−1)`, packed with `encodePacked(uint24, uint40)`.
   - `floorPriceQ96 = usdcPerNoteToQ96(principal/face)` and `tickSpacingQ96 = usdcPerNoteToQ96(0.01)`. The floor and all bid prices must be on the tick grid (floor + k·tick).
2. The agent wallet calls `vault.startAuction(...)`. The status becomes `AUCTION`.
3. The **desk anchor bid**: the agent wallet runs `USDC.approve(Permit2)`, then `Permit2.approve(USDC, auction, amt, exp)`, then `submitBid(maxPriceQ96 = lead memo maxNotePrice snapped to the tick grid, amt = principal·DESK_ANCHOR_BID_PCT/100, owner = agent, prevTickPrice, 0x)`.
4. Lenders bid in the web app with Dynamic wallets. `POST /api/loans/:id/auction/bid-plan` returns the same three txs, with `prevTickPrice` computed by walking `ticks()` from `floorPrice()`. The desk page shows each persona's `maxNotePrice` as a "copy this agent's bid" button, so agents set the price and humans follow.
5. The `cca` watcher loop acts once `block ≥ endBlock`:
   - If the auction graduated: the agent wallet calls `vault.disburse()`, which sends the USDC to the borrower (flow D). Then it exits and claims the desk's own bids, so the desk holds notes.
   - If it didn't: it calls `vault.cancel()`, which returns the lien. Bidders call `exitBid` themselves; the web app shows an exit button built from `exit-plan`.

### D. Disburse. Track: Dynamic ("decides, then pays")
The lead memo's decision leads straight to wallet actions signed by the Dynamic agent wallet: `createLoan`, the anchor bid in USDC, and `disburse()`, which sends USDC to the borrower. Every tx hash goes into `loan_events` and appears on the loan page. The Skill then tells the borrower to run `bankr llm credits add <amount>`, so the loan becomes LLM credits.

### E. Service. Tracks: Uniswap, Flash
The keeper loop runs every `KEEPER_INTERVAL_SEC` for each `ACTIVE` loan and for any loan whose on-chain status is Pledged or Auction:
1. **Collect:** if `claimable-fees?beneficiary=vault` shows value, call `vault.collect()`.
2. **WETH → USDC** (Uniswap Trading API): when vault WETH ≥ `MIN_SWAP_WETH`, `uniswap.buildVaultSwap` sends:
   - `/quote` with `swapper=vault`, `protocols [V2,V3,V4]`, `slippageTolerance 0.5`, and the headers `x-permit2-disabled:true`, `x-universal-router-version`, `x-agent-info {decision_origin:"autonomous"}`.
   - `/swap` with `simulateTransaction:true` (on a simulation failure, retry once with `false`).

   It asserts `swap.to == SwapProxy` and `routing == CLASSIC`. Then the agent wallet calls `vault.swapWethToUsdc(data, amountIn, quoteOut·(1−0.5%))`. `/check_approval` is also called and logged, but the vault does its own exact approve.
3. **Token leg → USDC** (Flash TWAP) when the creator-token balance in the vault is above zero and no Flash order for this loan is open:
   - **Mode `vault1271`:**
     1. The agent calls `vault.approveFlash(token, amt)`.
     2. Flash `/quote` with `{side:"sell", orderType:"twap", durationSeconds:3600, twapBucketCount: 12, or 24 if estimatedPriceImpact > 2%, funderAddress: vault}`.
     3. Parse `orderTypedData`, assert the fields, then `vault.authorizeFlashOrder(msg)`. Assert that the returned digest equals viem `hashTypedData`.
     4. `userSignature` = agent `signTypedData` (the vault ignores the signature bytes and checks the approved hash).
     5. `/order`, then store the order in `flash_orders`.
   - **Mode `keeper`:**
     1. `vault.sendTokenLegToKeeper`.
     2. Run the standard Flash flow from the agent wallet (`approveTx`, the permit and the order signed by the Dynamic wallet).
     3. When it fills, `USDC.transfer(vault, proceeds)`. If the loan is already Released, send the proceeds to the borrower instead.
   - Poll `GET /orders/{id}?funderAddress=`. Fills become `flash_twap` events.
4. `vault.payDesk()` if `drawDebt > 0`.
5. `vault.release()` if `canRelease()`. The status becomes `RELEASED` (flow F).

### F. Repay, redeem, release
- Repayment is simply USDC building up in the vault. `GET /api/loans/:id` shows `DebtState`, read on-chain every time.
- Noteholders (desk and lenders) call `vault.redeem(notes)` from the loan page at any point while Active or Released.
- Anyone can press **Release** once `canRelease()` is true. The keeper also calls it automatically. The fee rights return to the borrower, who gets the leftover WETH, tokens and surplus USDC.

### G. Cancel
Cancellation covers three cases: the borrower never pledged (keeper), a pledge with no auction for 24 h (anyone), and an auction that didn't graduate (anyone after `endBlock`). The lien and all balances go back to the borrower.

### H. Follow the Desk. Tracks: Flash, Dynamic
- **Signal:** every persona memo creates a public signal `{decision, score = confidence·100, principal, maxNotePrice, rationale}`. The feed is at `/desk`.
- **Follow:** `POST /api/follows {follower, personaId, mode, sizeUsdc, tpPct, slPct, dcaDays, auto}`.
- **Mirror:** when a followed persona **approves**, the agent creates a `mirror_orders` row for each follower. It is a Flash buy of the borrower's creator token paid in USDC:
  - `bracket`: `orderType:"market"` with `attachedBracket {takeProfit:{notionalPrice: px·(1+tp)}, stopLoss:{notionalPrice: px·(1−sl)}}`, where px comes from Flash `/search`. The follower signs 2 EIP-712 payloads (entry and bracket) and up to 2 approves.
  - `dca`: `orderType:"twap", side:"buy", durationSeconds: dcaDays·86400, twapBucketCount: dcaDays`. The UI labels it "DCA (Flash TWAP)", because Flash has no native DCA.
  - **One-click** (default): `POST /api/mirrors/:id/quote` returns a `MirrorQuote`. The browser sends the approve txs, signs with the Dynamic wallet and calls `POST /api/mirrors/:id/submit`, and the agent posts Flash `/order`.
  - **Auto** (`auto:true`): the follower has granted Dynamic **delegated access** (`useWalletDelegation`). `POST /api/dynamic/webhook` verifies `x-dynamic-signature-256` and stores the encrypted share. The agent then signs the approves and typed data with `delegatedSignTransaction` / `delegatedSignTypedData`. Without the delegation env vars, `auto:true` is rejected with a 503 that names the missing var.
  - Before each order, the agent checks `/search.riskFlagged` and `estimatedPriceImpact ≤ 3%`. If either fails, the mirror is marked `failed` with the reason.
- **Poller:** it reads `GET /orders/{id}?funderAddress=follower` to get fills and bracket status. PnL = filled tokens × current `/search` price − USDC spent + bracket exit proceeds.
- **Leaderboard:** see §7.

### I. Dine on your fees. Track: Blackbird Flynet
1. On the loan page (borrower or controller), **Connect Blackbird**: `GET /api/flynet/connect?loanId&nonce&sig`, where `sig` signs `flynetLinkMessage`. This is Flynet OAuth with PKCE, scopes `read:profile read:wallets read:user_checkins read:memberships`. The callback stores the tokens in `flynet_links`.
2. `GET /api/loans/:id/dine`: member profile, SPENDING wallet FLY balance and USD value, draw limit and draws.
3. `GET /api/flynet/restaurants?loanId`:
   - Call `listLocations`, keep `paymentsEnabled`, drop `coordinate {0,0}`.
   - Add open hours, `listSpecials`/`listChallenges` for the top candidates, and the member's `listCheckIns`/`listMemberships`.
   - The Bankr LLM ranks the top 5 and writes a `reason` for each.
4. **Draw:** `POST /api/loans/:id/dine/draw {amountUsdCents, locationId?, nonce, signature}`:
   1. Verify the EIP-191 `drawMessage` from the borrower or controller, with a single-use nonce.
   2. Check the loan is Active and `drawn + amount ≤ drawLimit`.
   3. FLY amount = USD / FLY price. The price comes from the member wallet (`balanceUsd.value / balance.value`), and failing that from the app balance response. If neither gives a price, return 409 "cannot price FLY".
   4. Check the app FLY float with `rewards.getBalance()`. If it's short, return 409 "desk FLY float insufficient".
   5. `rewards.issueReward({userId: sub, amount, idempotencyKey:"draw-<loan>-<nonce>"})`.
   6. The agent wallet calls `vault.addDraw(usdcRaw)`. If this tx fails, the draw is stored `issued` with `txHash null` and the flynet loop retries it.
   7. The borrower pays at the restaurant in the Blackbird app (the only payee path the docs allow). The fee stream repays the draw through `payDesk`.
5. **Settle leftover FLY:** `POST /api/loans/:id/dine/settle` → `createPaymentIntent` + `confirmPaymentIntent` to our own merchant (member token), which pulls leftover FLY back. The agent then pays the equivalent USDC into the vault from the desk wallet, which reduces `drawDebt` through `payDesk` accounting.

### J. Bankr Skill (chat)
`skill/fee-desk/SKILL.md` + `catalog.json` (repo layout `<slug>/SKILL.md`). A Bankr agent installs it from our public GitHub URL. Steps in the Skill:
1. `GET $FEEDESK/api/quote?token&borrower`
2. Show the terms and formula. Get explicit confirmation.
3. `POST /api/loans`
4. Submit `pledgeTx` through the agent's own wallet, or use the chat phrase.
5. `POST /api/loans/:id/pledge {txHash}`
6. Poll `GET /api/loans/:id`.
7. When `ACTIVE`, `bankr llm credits add <amount>`.
8. After repayment, `GET /api/loans/:id/release-tx` and submit it.

## 4. Underwriting engine and personas (`agent/src/underwriter`)

Deterministic engine. All USD amounts are in USDC; WETH values are numbers.
```
lifetimeRate = lifetimeEarnedWeth / max(lifetimeDays,1)                  // WETH/day
recentRate   = (Σ dailyWeth[30d] + claimableWeth) / 30
rate         = min(lifetimeRate, recentRate)                               // decay-aware
usdPerDay    = rate · ethUsd                                               // ethUsd = Uniswap /quote 1 WETH→USDC
maxPrincipal = min(DESK_MAX_LOAN_USDC, advanceRate · usdPerDay · 30)       // advanceRate per persona (lead 30%)
cv           = stdev(daily 30d) / mean(daily 30d)                          // lumpiness
feeRatePct   = 5 + 10 · min(1, cv/3)
face         = principal · (1 + feeRatePct/100)      floorPrice = principal/face (snap down to 0.01 grid)
termDays     = face / usdPerDay                      drawLimit  = min(0.10 · principal, 50 USDC)
```
If Σ `dailyEarnings` does not match claimed within 1%, `dailyEarnings` is not the beneficiary's share. Multiply by `sharePct/100` instead, and record that in `formula`. See the COORDINATION open question.

**Personas** (`PERSONAS` in `underwriter/index.ts`). The first persona is the lead, and its decision is binding.

| id | model (Bankr Gateway) | advanceRate | style |
|---|---|---|---|
| `prudent` (lead) | `BANKR_LLM_MODEL` (default `claude-sonnet-4.6`) | 30% | lifetime-weighted, penalizes decay |
| `momentum` | `gemini-3-flash` | 45% | weights last 7 days and volume trend |
| `skeptic` | `gpt-5.4-mini` | 20% | assumes fees halve; declines thin history |

The LLM is called through `POST https://llm.bankr.bot/v1/chat/completions` with `X-API-Key`, `temperature 0`. The system prompt asks for **only** this JSON:
`{"decision":"approve|decline","principalUsdc":number,"maxNotePrice":number,"confidence":0..1,"rationale":string,"risks":[string]}`
Validation:
- `principalUsdc ≤ maxPrincipal`
- `maxNotePrice ∈ [floorPrice, 1]`
- otherwise it counts as a parse failure (fail closed)

The raw text is stored in `memos.raw_text`. HTTP 401 and 402 errors surface as `"Bankr LLM credits/key: …"`.

## 5. Agent modules: ownership and exports

The contract in `agent/src/ctx.ts` applies. Each `src/<m>/index.ts` may export `register(app, ctx)` for routes and `start(ctx) → stop` for loops, plus the named functions below. Cross-module imports go **only** through `../<m>/index.ts`. The loader in `src/index.ts` imports modules in the order db, bankr, wallet, uniswap, underwriter, cca, keeper, flash, social, flynet, server. `FEEDESK_MODULES` picks a subset.

| module (owner) | exports (signatures are binding) |
|---|---|
| `db` (agent-core) | `openDb(path): DatabaseSync` (runs `schema.sql`, WAL) · `insertLoan(db, row): number` · `getLoan(db, id): Loan \| null` · `listLoans(db, {status?, borrower?}): Loan[]` · `updateLoan(db, id, patch: Partial<LoanRow>): void` · `addEvent(db, loanId, kind: LoanEventKind, txHash: Hex \| null, data?: unknown): void` · `listEvents(db, loanId): LoanEvent[]` · `useNonce(db, nonce): boolean` (false if already used) |
| `bankr` (agent-core) | `tokenFees(token, days?)` · `claimableFees(token, beneficiary)` · `creatorFees(wallet)` · `buildTransferBeneficiary({tokenAddress,currentBeneficiary,newBeneficiary}): Promise<TxRequest>` · `buildClaim(beneficiary, tokens[])` · `llmChat(messages, {model, maxTokens?}): Promise<string>`. Built-in limiter of 20 req/min with a 2-min cache for fee reads. |
| `underwriter` (agent-core) | `PERSONAS: Persona[]` · `quote(ctx, token, borrower): Promise<Quote>` · `underwrite(ctx, token, borrower): Promise<{quote: Quote; memos: Memo[]; lead: Memo}>` |
| `server` (agent-core) | `createApp(ctx): Hono` (CORS for `WEB_URL`, JSON errors `{error}`) · `listen(app, ctx)` (port `AGENT_PORT`) · `register`: `/api/health`, `/api/desk`, `/api/quote`, `/api/loans*` (except auction and dine), `/api/admin/*`. Orchestrates flows A and B by calling the other modules. |
| `wallet` (agent-wallet-keeper) | `getAgentWallet(ctx): Promise<AgentWallet>` (Dynamic agent signing token → `DynamicEvmWalletClient` → viem wallet client on Base or the fork; re-signs in on 401) · `src/wallet/bootstrap.ts` prints the one-time env values |
| `uniswap` (agent-wallet-keeper) | `ethUsd(): Promise<number>` (60 s cache) · `buildVaultSwap(ctx, vault, amountIn: bigint): Promise<{data: Hex; minOut: bigint; quoteOut: bigint; requestId: string}>` |
| `keeper` (agent-wallet-keeper) | `createLoanOnchain(ctx, {borrower, poolId, feesManager, creatorToken, symbol, terms}): Promise<{onchainId: number; vault: Address; note: Address; txHash: Hex}>` · `confirmPledge(ctx, loan): Promise<Hex>` · `readDebt(ctx, vault): Promise<DebtState>` · `runKeeperOnce(ctx, loanId): Promise<void>` · `start` (loop) · `register`: `POST /api/admin/keeper/run` |
| `flash` (agent-social-flash) | `flash(path, body?, method?)` (throws on non-2xx with the Flash error) · `searchToken(token): Promise<{priceUsd: number; riskFlagged: boolean}>` · `twapSellTokenLeg(ctx, loan, amount: bigint): Promise<{orderId: string}>` (both modes) · `pollFlashOrders(ctx): Promise<void>` |
| `social` (agent-social-flash) | `publishSignals(ctx, loanId, memos: Memo[], quote: Quote): Signal[]` (also queues mirrors) · `register`: `/api/signals`, `/api/leaderboard`, `/api/follows*`, `/api/mirrors*`, `/api/dynamic/webhook` · `start`: mirror poller + auto-mirror executor |
| `cca` (agent-flynet-cca) | `launchAuction(ctx, loan): Promise<{auction: Address; txHash: Hex}>` (includes the anchor bid) · `auctionState(ctx, loan): Promise<AuctionState>` · `bidPlan(ctx, loan, req: BidPlanRequest): Promise<BidPlan>` · `exitPlan(ctx, loan, req): Promise<ExitPlan>` · `start`: settle watcher (disburse/cancel, desk exit + claim) · `register`: `/api/loans/:id/auction*` |
| `flynet` (agent-flynet-cca) | `recommend(ctx, loanId): Promise<Recommendation[]>` · `register`: `/api/flynet/*`, `/api/loans/:id/dine*` · `start`: retries `addDraw` for `issued` draws with no tx, and refreshes tokens |

## 6. Data model (`agent/src/db/schema.sql`, owned by agent-core; other modules request changes via COORDINATION)

All timestamps are ISO text. Amounts are TEXT decimal base units (`*_raw`) or REAL for display.
```sql
CREATE TABLE IF NOT EXISTS loans (id INTEGER PRIMARY KEY, status TEXT NOT NULL, via TEXT NOT NULL,
  borrower TEXT NOT NULL, controller TEXT NOT NULL, token TEXT NOT NULL, symbol TEXT NOT NULL,
  pool_id TEXT NOT NULL, fees_manager TEXT NOT NULL, onchain_id INTEGER, vault TEXT, note TEXT, auction TEXT,
  terms_json TEXT, quote_json TEXT, lead_memo_json TEXT, pledge_tx_json TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS loan_events (id INTEGER PRIMARY KEY, loan_id INTEGER NOT NULL, kind TEXT NOT NULL,
  tx_hash TEXT, data_json TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memos (id INTEGER PRIMARY KEY, loan_id INTEGER NOT NULL, persona_id TEXT NOT NULL,
  model TEXT NOT NULL, decision TEXT NOT NULL, principal_raw TEXT NOT NULL, max_note_price REAL NOT NULL,
  confidence REAL NOT NULL, rationale TEXT NOT NULL, risks_json TEXT NOT NULL, raw_text TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS signals (id INTEGER PRIMARY KEY, loan_id INTEGER NOT NULL, persona_id TEXT NOT NULL,
  token TEXT NOT NULL, symbol TEXT NOT NULL, decision TEXT NOT NULL, score REAL NOT NULL, principal_raw TEXT NOT NULL,
  max_note_price REAL NOT NULL, rationale TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS follows (id INTEGER PRIMARY KEY, follower TEXT NOT NULL, persona_id TEXT NOT NULL,
  mode TEXT NOT NULL, size_usdc REAL NOT NULL, tp_pct REAL NOT NULL, sl_pct REAL NOT NULL, dca_days INTEGER NOT NULL,
  auto INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mirror_orders (id INTEGER PRIMARY KEY, follow_id INTEGER NOT NULL, signal_id INTEGER NOT NULL,
  follower TEXT NOT NULL, token TEXT NOT NULL, symbol TEXT NOT NULL, mode TEXT NOT NULL, size_usdc REAL NOT NULL,
  status TEXT NOT NULL, flash_order_id TEXT, bracket_status TEXT, quote_json TEXT, filled_token_raw TEXT,
  avg_price_usd REAL, pnl_usd REAL, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS delegations (address TEXT PRIMARY KEY, wallet_id TEXT NOT NULL, user_id TEXT NOT NULL,
  encrypted_json TEXT NOT NULL, created_at TEXT NOT NULL, revoked_at TEXT);   -- store encrypted webhook payload only
CREATE TABLE IF NOT EXISTS flash_orders (id TEXT PRIMARY KEY, loan_id INTEGER NOT NULL, mode TEXT NOT NULL,
  funder TEXT NOT NULL, token TEXT NOT NULL, amount_raw TEXT NOT NULL, status TEXT NOT NULL, usdc_out_raw TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS flynet_links (loan_id INTEGER PRIMARY KEY, member_id TEXT NOT NULL, access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS oauth_states (state TEXT PRIMARY KEY, loan_id INTEGER NOT NULL, code_verifier TEXT NOT NULL,
  created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS draws (id INTEGER PRIMARY KEY, loan_id INTEGER NOT NULL, amount_raw TEXT NOT NULL,
  fly_wei TEXT NOT NULL, location_id TEXT, flynet_reward_id TEXT, tx_hash TEXT, status TEXT NOT NULL, error TEXT,
  created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS nonces (nonce TEXT PRIMARY KEY, used_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL); -- caches
```

## 7. REST API (agent, default `http://localhost:8787`, JSON, errors `{error}` with a proper HTTP status)

DTO names refer to `shared/src/index.ts`.

| Method and path | Owner | Request | Response |
|---|---|---|---|
| GET `/api/health` | core | none | `{ok:true, demoFork, block}` |
| GET `/api/desk` | core | none | `DeskInfo` |
| GET `/api/quote?token&borrower` | core | none | `Quote` (engine only, no LLM) |
| POST `/api/loans` | core | `ApplyRequest` | `LoanDetail` (APPROVED or DECLINED). 502 if the lead memo fails |
| GET `/api/loans?status&borrower` | core | none | `Loan[]` (`debt` is null in the list) |
| GET `/api/loans/:id` | core | none | `LoanDetail` (`debt` read on-chain) |
| POST `/api/loans/:id/pledge` | core | `PledgeRequest` | `LoanDetail` (PLEDGED→AUCTION), 409 if shares aren't moved yet |
| GET `/api/loans/:id/release-tx` | core | none | `TxRequest` (`vault.release()`), 409 if `!canRelease` |
| POST `/api/admin/keeper/run` | keeper | header `x-admin-token`, `{loanId?}` | `{ran: number[]}` |
| GET `/api/loans/:id/auction` | cca | none | `AuctionState` |
| POST `/api/loans/:id/auction/bid-plan` | cca | `BidPlanRequest` | `BidPlan` |
| POST `/api/loans/:id/auction/exit-plan` | cca | `ExitPlanRequest` | `ExitPlan` (exit or partial exit + claim, with hints computed) |
| GET `/api/signals?personaId&limit` | social | none | `Signal[]` |
| GET `/api/leaderboard` | social | none | `LeaderboardRow[]` |
| GET `/api/follows?follower` · POST `/api/follows` · DELETE `/api/follows/:id` | social | `FollowRequest` | `Follow[]` / `Follow` / `{ok}` |
| GET `/api/mirrors?follower` | social | none | `MirrorOrder[]` |
| POST `/api/mirrors/:id/quote` | social | none | `MirrorQuote` |
| POST `/api/mirrors/:id/submit` | social | `MirrorSubmit` | `MirrorOrder` |
| POST `/api/mirrors/:id/cancel` | social | `{userSignature}` (signs `flashCancelMessage`) | `MirrorOrder` |
| POST `/api/dynamic/webhook` | social | Dynamic webhook body | `{ok}` (HMAC `x-dynamic-signature-256`) |
| GET `/api/flynet/connect?loanId&nonce&sig` | flynet | none | 302 to the Flynet authorize URL |
| GET `/api/flynet/callback?code&state` | flynet | none | 302 to `${WEB_URL}/dine/:loanId` |
| GET `/api/flynet/restaurants?loanId` | flynet | none | `Recommendation[]` |
| GET `/api/loans/:id/dine` | flynet | none | `DineState` |
| POST `/api/loans/:id/dine/draw` | flynet | `DrawRequest` | `Draw` |
| POST `/api/loans/:id/dine/settle` | flynet | `{nonce, signature}` (`drawMessage` with amount 0) | `DineState` |

**Leaderboard score** (social):
- `repaidPct` = Σ(face − outstanding) / Σ face over loans the persona approved that reached Active, read on-chain.
- `followerPnlPct` = Σ pnl / Σ spent over its mirror orders.
- `score = round(60·repaidPct/100 + 40·clamp(0.5 + followerPnlPct/100, 0, 1))`.
- A persona with no funded loans and no fills shows `score: null` → rank last with the label "no realized data yet". Nothing is invented.

## 8. Web (`web/`, Next.js App Router + Dynamic React SDK)

`@dynamic-labs/sdk-react-core@5.9.0` + `@dynamic-labs/ethereum@5.9.0`, viem. `next.config.ts` has `transpilePackages: ['@feedesk/shared']`. Every call goes to `NEXT_PUBLIC_AGENT_URL`. Chain reads use viem against Base, or `NEXT_PUBLIC_FORK_RPC_URL` when `NEXT_PUBLIC_DEMO_FORK=1`. A red "DEMO_FORK" banner then shows on every page.

| route | content |
|---|---|
| `/` | Loan book: every loan, status, borrower, token, principal/face, repaid %, and links to the vault, note and tx hashes (Basescan). Desk stats. |
| `/apply` | Dynamic login → token input (prefilled from `creator-fees` via `/api/quote`) → quote with the formula → Apply → memo cards for each persona → pledge panel with 3 paths (sign with the connected wallet / Bankr chat phrase copy / DEMO_FORK instruction) → "I've pledged" |
| `/loans/[id]` | Terms, memos, timeline (`loan_events` with tx links), debt bar, auction panel (clearing price, raised/required, bid form with a copy-persona-price button, exit/claim), keeper activity (swaps, Flash fills), Redeem notes, Release button |
| `/notes` | Open FeeNote auctions and the user's bids and notes |
| `/desk` | Leaderboard, signal feed, follow form (bracket TP/SL or DCA days, auto toggle with delegation via `useWalletDelegation`), "my mirrors" queue with Sign & submit, and cancel |
| `/dine/[id]` | Connect Blackbird, member passport (from `/dine`), restaurant picks with reasons, draw form (signs `drawMessage`), draws list with FLY amounts and `addDraw` tx |

## 9. Track integration map (the README links these files; skill-docs fills in the line numbers at the end)

| Track | Deep integration | Files |
|---|---|---|
| **Bankr GP** | Fee APIs drive underwriting. `build-transfer-beneficiary` is the pledge, and the pledge is an enforceable lien. The LLM Gateway writes every credit memo (3 personas and models) and the restaurant picks. A Bankr Skill lets any Bankr agent borrow by chat. The loan turns into LLM credits. | `agent/src/bankr/`, `agent/src/underwriter/`, `skill/fee-desk/`, `contracts/src/FeeVault.sol` |
| **Dynamic** | The agent wallet (agent signing token, MPC) signs createLoan, the anchor bid, `disburse`, and every keeper tx after the LLM decision. Embedded wallets sign pledges, bids, releases, redeems and mirror orders. Delegated access runs auto-mirroring. | `agent/src/wallet/`, `agent/src/keeper/`, `agent/src/social/` (delegation), `web/app/providers.tsx`, `web/app/apply`, `web/app/desk` |
| **Uniswap** | FeeNote is a new ERC-20 asset (a claim on the loan's fee stream), sold in a CCA that funds the loan. Agents price it: persona `maxNotePrice` and the desk anchor bid. The Trading API gives ETH pricing and the keeper's WETH→USDC swap through SwapProxy from a contract swapper. Also FEEDBACK.md. | `contracts/src/FeeVault.sol` (`startAuction`, `swapWethToUsdc`), `contracts/src/FeeNote.sol`, `agent/src/cca/`, `agent/src/uniswap/`, `web/app/loans/[id]` (bids), `FEEDBACK.md` |
| **Definitive Flash** | The keeper sells the creator-token leg with a Flash **TWAP**, with the vault as the EIP-1271 funder. Follow the Desk turns public credit signals into a leaderboard, and followers mirror them with a Flash market entry plus an **attached Bracket** (TP/SL), or a DCA built as a long TWAP. Tag @DefinitiveFi. | `agent/src/flash/`, `agent/src/social/`, `contracts/src/FeeVault.sol` (`authorizeFlashOrder`, `isValidSignature`), `web/app/desk` |
| **Blackbird Flynet** | The borrower draws a FLY dining line against pledged fees: Flynet OAuth member context, restaurant data (locations, hours, specials, challenges, check-ins), `issue_reward` to the member, `addDraw` on-chain, and repayment auto-deducted from the fee stream (`payDesk`). Leftover FLY comes back through a payment intent. | `agent/src/flynet/`, `contracts/src/FeeVault.sol` (`addDraw`, `payDesk`), `web/app/dine/[id]` |

## 10. DEMO_FORK
1. `pnpm fork` (or `docker compose --profile fork up anvil`), then deploy FeeDesk to the fork and set `FORK_FEE_DESK_ADDRESS`.
2. Fund the agent wallet on the fork: `anvil_setBalance` for gas, and USDC with `anvil_impersonateAccount` from a USDC whale followed by `transfer`.
3. Borrower = `TEST_POOL.beneficiary`. Pledge with `cast send --unlocked --from 0xfdb6… <feesManager> "updateBeneficiary(bytes32,address)" <poolId> <vault>`. The UI labels this "fork impersonation".
4. Bankr fee reads and the LLM are live mainnet APIs. Uniswap `/swap` calldata comes from mainnet state and runs on the fresh fork. CCA runs on the fork, with `anvil_mine` to advance blocks (web button, fork only). Flash is **disabled** on the fork (mainnet-only settlement), so the token leg stays in the vault and the UI shows "Flash: mainnet only". Flynet runs on staging as usual.
5. The real-money path (mainnet, a small $5–20 loan) is the same code with `DEMO_FORK=0`.

## 11. Env vars
See `.env.example`, which lists every variable with where to get it. The REQUIRED ones throw at first use through `need()`.

## 12. Module ownership (write ONLY in your dirs)

| builder | dirs |
|---|---|
| architect | `SPEC.md`, `shared/`, `agent/package.json`, `agent/tsconfig.json`, `agent/src/index.ts`, `agent/src/ctx.ts`, root `package.json`, `pnpm-workspace.yaml`, `docker-compose.yml`, `.env.example` |
| contracts | `contracts/**`; also the `FEE_DESK_ABI`/`FEE_VAULT_ABI`/`FEE_NOTE_ABI` constants in `shared/src/index.ts` |
| agent-core | `agent/src/{server,db,underwriter,bankr}/` |
| agent-wallet-keeper | `agent/src/{wallet,keeper,uniswap}/` |
| agent-social-flash | `agent/src/{flash,social}/` |
| agent-flynet-cca | `agent/src/{flynet,cca}/` |
| web | `web/**` |
| skill-docs | `skill/**`, `README.md`, `FEEDBACK.md`, `docs/DEMO.md`, `docs/SUBMISSION.md` |

Everyone can append to `docs/COORDINATION.md`. A module that needs a new dependency adds it to its own package.json: `agent/package.json` is shared, so post a line and add only your own dependencies.

## 13. Build order (about 20 h, parallel)
- **H0–6:**
  - contracts: v1 plus the fork test green.
  - agent-core: `quote` + `underwrite` against live Bankr (lead memo needs `BANKR_LLM_KEY`).
  - wallet: Dynamic bootstrap + a live `getAgentWallet` in Docker.
  - web: shell, Dynamic login, loan book.
  - skill-docs: SKILL.md draft.
  - social-flash: Flash client + a mainnet 1271 test.
  - flynet-cca: CCA step math + bid plan, and Flynet staging access.
- **H6–12:** full fork e2e: apply → pledge (impersonate) → CCA (anchor bid, mine) → disburse → collect → Uniswap swap → release. Web pages wired.
- **H12–16:** mainnet deploy plus one real small loan. Flash TWAP on the real leg. Follow/mirror bracket order. Flynet draw on staging.
- **H16–20:** README with file/line links, FEEDBACK.md, DEMO.md, SUBMISSION.md, then record the 3-minute demo.

## 14. Day-1 checks (each owner posts the result on COORDINATION)
The first four are also listed as open questions on the board.
1. Flash accepts a FeeVault (1271) funder.
2. Uniswap `/quote` works with a contract `swapper`.
3. Dynamic signing works against the fork.
4. Flynet staging: `write:rewards`, FLY float funding, and the `audience` value.
5. Bankr LLM key has the Gateway enabled and credits above zero.
6. `dailyEarnings` semantics.

If a check fails, the owner switches to the documented fallback in this spec (`FLASH_TOKEN_LEG_MODE=keeper`, `simulateTransaction:false`, or a real Base mainnet demo instead of fork signing) and says so honestly in the README. Nothing gets faked.
