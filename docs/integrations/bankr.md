# Bankr integration notes (Fee Desk)

Researched 2026-09-18. Every item below was checked against official docs (docs.bankr.bot `.md` pages from https://docs.bankr.bot/llms.txt), live API calls, on-chain `cast` reads on Base, or verified Blockscout source.
Legend: **[VERIFIED-LIVE]** = called or read it today. **[DOCS]** = in official docs but not called (usually needs a key). **[UNVERIFIED]** = inference, test before relying on it.

---

## 1. Doppler fee APIs (base `https://api.bankr.bot`, no auth)

Docs: https://docs.bankr.bot/docs/token-launching/reading-fees.md, /transferring-fees.md, /claiming-fees.md, /api-reference/get-token-fees.md

| Endpoint | Status | Notes |
|---|---|---|
| `GET /token-launches/{token}/fees?days=N` | [VERIFIED-LIVE] | **Preferred path.** Same response shape as the legacy route. `days` is 1..90, default 30. |
| `GET /public/doppler/token-fees/{token}?days=N` | [VERIFIED-LIVE] | Legacy. It still returns 200 but sends `Deprecation: 22 Apr 2026`, `Sunset: 22 May 2026`, and `Link: </token-launches/:tokenAddress/fees>; rel="successor-version"`. Past its sunset date, so it could disappear at any time. Don't use it. |
| `GET /public/doppler/creator-fees/{wallet}?days=N` | [VERIFIED-LIVE] | Every Doppler and Clanker token the wallet is beneficiary on. **Includes other chains** (`chain: "robinhood"`/`"base"` per token), so filter on `chain === "base"`. No deprecation header. |
| `GET /public/doppler/claimable-fees/{token}?beneficiary=0x..` | [VERIFIED-LIVE] | `{eligible, share, claimableFees{token0,token1,token0Label,token1Label}}`, or `{eligible:false}`. |
| `POST /public/doppler/build-transfer-beneficiary` body `{tokenAddress,currentBeneficiary,newBeneficiary}` | [VERIFIED-LIVE] | Returns `{to,data,chainId,description}`. `data` = `updateBeneficiary` selector `0xd44f6738`. Accepts a contract as `newBeneficiary`. Returns 403 if `currentBeneficiary` holds no shares. **Resolves the correct fees manager automatically (initializer or hook).** |
| `POST /public/doppler/build-claim` body `{beneficiaryAddress,tokenAddresses[≤50]}` | [VERIFIED-LIVE] | Returns `{transactions:[{to,data,chainId,gasEstimate(+30%),maxFeePerGas,...}],errors:[]}`. `data` = `collectFees(bytes32)` selector `0x817db73b`. |
| `GET /token-launches` | [VERIFIED-LIVE] | The 50 most recent launches. Fields include `chain, launchType, poolId, feeRecipient.walletAddress, pairedToken, creatorFeeMode, venue`. |
| `POST /token-launches/{token}/fees/claim` | [DOCS] | Custodial claim. Needs a `bk_usr_` key with `walletApiEnabled` that is not read-only. Only for Bankr wallets. The FeeVault can't use it. |

Live response fields for a token entry (more than the docs list):
`tokenAddress,name,symbol,poolId,initializer,feesContract?,share("57.00%"),token0Label,token1Label,numeraire,tokenIsToken0,claimable{token0,token1},claimed{token0,token1,count},source("doppler"),chain`.
Top level: `dailyEarnings[{date,weth}]`, `allTimeDailyEarnings[...]`, `lifetimeEarnedWeth`, `lifetimeDays`, `lifetimeBestDay`, `totals{claimableWeth,claimedWeth,claimCount}`.

Rate limit (live headers): `RateLimit-Policy: 20;w=60`, i.e. **20 requests/min/IP** on these routes. The docs say 100 per 15 min for `/public/*`. Plan for 20/min, cache 2 min (the server caches 2 min anyway), and cache `poolId`/`initializer`/`feesContract` permanently.

```ts
// underwriting input: realized fee history + current share
const r = await fetch(`https://api.bankr.bot/token-launches/${token}/fees?days=30`);
if (!r.ok) throw new Error(`bankr token-fees ${r.status}`);
const { tokens, dailyEarnings, totals } = await r.json();
const t = tokens.find((x: any) => x.chain === "base");
if (!t) throw new Error("not a Base Doppler token");
const feesManager = t.feesContract ?? t.initializer;   // see §2
const sharePct = parseFloat(t.share);                  // "57.00%" -> 57 (display/underwrite)
```

### Real test data (Base)
- Test pool token = **`0x5f980dcfc4c0fa3911554cf5ab288ed0eb13dba3` (GITLAWB)**, poolId `0xec33…b0b9`, initializer `0xD59c…1178`, beneficiary `0xfdb6…76Bf`, share 57%. Today: claimable 0.097203 WETH + 2,464,937 GITLAWB, claimed 2.5728 WETH over 2 claims. 30d daily WETH: 2.1565 (09-15), 0.416 (09-18), zeros on other days, so the fees are **very lumpy**.
- The same beneficiary holds several more 57% pools with sizable claimable WETH, e.g. `0xbcad78501b939494d13e5af8b724a4bce69b2ba3` (1.29 WETH) and `0x42827ecff0424b86971dcda92504056252f90ba3` (1.36 WETH).

---

## 2. Fees-manager variants on Base (the hook / quote-only question, now resolved)

On-chain checks were `cast call` against https://base-rpc.publicnode.com. Source was verified on base.blockscout.com.

| Contract | Blockscout name | Where creator shares live | Share semantics |
|---|---|---|---|
| `0xD59cE43E53D69F190E15d9822Fb4540dCcc91178` | DecayMulticurveInitializer | initializer | `getShares` = 0.57e18 and API says 57%, so they match. [VERIFIED-LIVE] |
| `0xBDF938149ac6a781F94FAa0ed45E6A0e984c6544` | DopplerHookInitializer (current launches, 95%) | initializer when the API has no `feesContract` | API says 95%. |
| `0x9982538f41f2ae29ddb9d3d9307010052984fdbb` | **RehypeDopplerHookInitializer** (hook fees manager, quote-only / 1.75% schedule) | **hook**. The API sets `feesContract` to this address, and `initializer` still shows `0xBDF9…` | Example token `0xef28a27a7572d8586e6ea144bc3724a6d337aba3` (EMBE), pool `0xfe82…3ff4`: hook `getShares(fr)` = **482758620689655174** (0.4828e18), initializer `getShares(fr)` = 0, API says "95.00%". [VERIFIED-LIVE] |

Findings:
- **The hook fees manager is `feesContract` from the API.** It is the same address on Robinhood Chain. `build-transfer-beneficiary` and `build-claim` for EMBE both returned `to = 0x9982…fdbb` with the same selectors (`0xd44f6738`, `0x817db73b`). [VERIFIED-LIVE]
- Rehype inherits the same `src/base/FeesManager.sol` (`collectFees(bytes32)`, `updateBeneficiary(bytes32,address)`, `getShares`, `getCumulatedFees0/1`, `getLastCumulatedFees0/1`). It has **no EOA/code.length check**, so a vault works here the same way it does on the initializer. [VERIFIED source]
- `updateBeneficiary` requires `newBeneficiary != msg.sender` and `getShares[msg.sender] > 0`. It releases already-cumulated fees to **both** the old and the new beneficiary first, then moves **all** of the caller's shares (`+=` onto the new one). [VERIFIED source]
- On the hook, `_collectFees` only drains `getHookFees[poolId].beneficiaryFees0/1`, which the hook accrues during swaps. "Uncollected" here means hook storage, not pool LP fees. The claim-first nuance still applies because `updateBeneficiary` does not call `_collectFees`.
- **Share gotcha:** on the hook, raw shares are a fraction of the hook's *beneficiary bucket*. 0.4828 = 0.665/1.3775 = creator ÷ (creator 0.665 + protocol 0.475 + buyback 0.2375). The API's "95%" means 95% of the 0.7% pool fee. **Never compare raw `getShares` across variants.** Use the API `share` for display and `claimable`/`claimed` WETH for cash-flow underwriting. Pledge verification (post-pledge `getShares(vault) > 0` and `getShares(borrower) == 0`) works the same on all variants.
- `getFeeRoutingMode(poolId)` returns `1` (`RouteToBeneficiaryFees`) for EMBE. The enum is `{DirectBuyback, RouteToBeneficiaryFees}`. [VERIFIED-LIVE]
- Quote-only means creator fees arrive in the quote token only. The docs say so (claiming-fees.md note). Not tested on a quote-only pool that actually has fees, because EMBE has 0 claimable. [DOCS]
- A second `collectFees(address asset)` overload exists on Rehype. Keep using `collectFees(bytes32 poolId)`.
- **Other launch types exist:** `launchType: "bankr_v3"` (`venue: "uniswap_v3"`, e.g. chain `arc`, USDC-paired, `creatorFeeMode: "quote"`). These are not Doppler FeesManager pools. **Reject anything that isn't `source === "doppler"` and `chain === "base"`.** Clanker tokens also show up in `creator-fees` and must be rejected too.

Vault logic that fits all variants:
```ts
const fm = t.feesContract ?? t.initializer;     // call collectFees/updateBeneficiary here
// or trust the builder: const { to } = await buildTransfer(...); assert(to === fm)
```

---

## 3. Pledge path for the borrower (how a Bankr agent signs `updateBeneficiary`)

1. **Build**: `POST /public/doppler/build-transfer-beneficiary {tokenAddress, currentBeneficiary: borrower, newBeneficiary: FeeVault}` [VERIFIED-LIVE].
2. **Sign/submit**, depending on the wallet type:
   - Bankr-managed wallet via the API: `POST https://api.bankr.bot/wallet/submit` with `X-API-Key`, body `{transaction:{to,chainId:8453,data}, description, waitForConfirmation:true}`, response `{success, transactionHash, status, signer}`. Needs `walletApiEnabled`, a non-read-only key, and **no `allowedRecipients` on the key** (raw submits are blocked when the allowlist is set). [DOCS] https://docs.bankr.bot/docs/wallet-api/submit.md
   - Bankr chat / Agent API: `"transfer my beneficiary share on token 0x.. to 0xVAULT"` (documented phrase, fee-splitting.md). Gas is sponsored (up to 10 tx or $3/day). [DOCS]
   - Bankr web UI: `bankr.bot/launches/<token>` → "Transfer Fee Recipient". [DOCS]
   - External EOA (Dynamic embedded wallet in our web app): sign `{to,data}` directly. It needs Base ETH for gas. [DOCS]
3. **Claim-first choice**: pre-pledge accrued-but-uncollected fees go to the vault. Either tell the borrower to `build-claim` first, or (our design) count them as the first repayment. `claimable-fees?beneficiary=borrower` before the pledge gives the amount to credit.

The docs label beneficiary transfers "**permanent and irreversible**" (fee-splitting.md). That's true for the EOA, but our vault's `release()` calls `updateBeneficiary(poolId, borrower)`, which is the same mechanism. The UI copy has to explain that release depends on the vault contract.

**Vesting does NOT move with the pledge**: the 15% creator vesting recipient is fixed at launch (overview.md). The pledge only covers the fee stream. [DOCS]

---

## 4. Bankr LLM Gateway (underwriter credit memo)

Docs: https://docs.bankr.bot/docs/llm-gateway/overview.md, /api-reference.md, /ai-sdk.md, /models.md

- **Base URL** `https://llm.bankr.bot`. OpenAI-compatible `POST /v1/chat/completions` and Anthropic-compatible `POST /v1/messages`. Both formats work with all models. [DOCS]
- **Auth** `X-API-Key: bk_...` or `Authorization: Bearer bk_...`. The key needs **`llmGatewayEnabled`**, which is **off by default** (toggle it at bankr.bot/api-keys). [DOCS] Unauthenticated calls return `401 {"error":{"message":"API key required","type":"auth_error"}}` [VERIFIED-LIVE].
- **Credits**: prepaid USD and separate from wallet crypto. **New accounts have $0, so every request returns 402** until you top up (`bankr llm credits add 25`, default Base USDC, or bankr.bot/llm?tab=credits). 402 types: `insufficient_credits`, `daily_budget_exceeded`. [DOCS]
- Other endpoints: `GET /v1/models`, `GET /v1/credits` (`{balanceUsd, effectiveBalanceUsd, undeductedCostUsd, dailyBudget?}`), `GET /v1/usage?days=30`, `GET /health` (no auth, [VERIFIED-LIVE] 200). Errors: 401/402/429/503 `provider_unavailable` (retry or switch model)/500.
- **Models** (IDs from models.md, confirm live with `/v1/models`): `claude-opus-5`, `claude-sonnet-5`, `claude-sonnet-4.6`, `claude-haiku-4.5`, `gemini-3.1-pro`, `gemini-3-flash`, `gpt-5.4`, `gpt-5.4-mini`, `deepseek-v4-flash`, `glm-5.3-flash`, and others. Suggested: `claude-sonnet-4.6` for the memo, with a cheap fallback (`gemini-3-flash`) on 503.
- Privacy tiers: `"privacy":"zdr"|"private"` field, or a `:zdr`/`:private` model suffix, or a `/zdr/v1/...` base path. They fail closed (422). Optional.
- The body is forwarded to the provider, so "any parameter it accepts works" [DOCS]. `response_format` JSON mode is **not documented per model** [UNVERIFIED]. For structured decisions, use tool calling (documented via the AI SDK) or strict JSON parsing with a zod check, and fail closed on a parse error.

Packages (npm registry today): `ai@7.0.106`, `@ai-sdk/openai-compatible@3.0.52`, `openai@7.18.0`, `@anthropic-ai/sdk@0.126.0`, `@bankr/cli@0.3.38`, `viem@2.56.8`.
**Gotcha:** do NOT use `@ai-sdk/openai`. It uses the Responses API, which the gateway doesn't support (ai-sdk.md warning).

Minimal (no SDK):
```ts
const key = process.env.BANKR_LLM_KEY ?? process.env.BANKR_API_KEY;
if (!key) throw new Error("BANKR_LLM_KEY (or BANKR_API_KEY with LLM Gateway enabled) is required");
const res = await fetch("https://llm.bankr.bot/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-API-Key": key },
  body: JSON.stringify({ model: process.env.BANKR_LLM_MODEL ?? "claude-sonnet-4.6",
    messages: [{ role: "system", content: SYSTEM }, { role: "user", content: JSON.stringify(feeData) }],
    max_tokens: 1200, temperature: 0 }),
});
if (res.status === 402) throw new Error("Bankr LLM credits exhausted (402) — top up at bankr.bot/llm");
if (!res.ok) throw new Error(`Bankr LLM ${res.status}: ${await res.text()}`);
const memo = (await res.json()).choices[0].message.content;
```
AI SDK variant (documented):
```ts
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";
const llm = createOpenAICompatible({ name: "bankr", baseURL: "https://llm.bankr.bot/v1",
  headers: { "X-API-Key": process.env.BANKR_LLM_KEY! } });
const { text } = await generateText({ model: llm("claude-sonnet-4.6"), prompt });
```

### "Borrowers use the loan for LLM credits"
- Documented: `bankr llm credits add <amount> [--token <addr>]` pays from the borrower's Bankr wallet (default Base USDC). So USDC disbursed to a Bankr wallet can become credits. [DOCS]
- Documented: **sending credits to another Bankr user** by X handle or `0x` address via the web "Send Credits" card or chat (`"send $20 of my LLM credits to @user"`). Min $1, $500 rolling 24h cap, recipient must already have a Bankr account, final. **There's no documented REST endpoint** for credit transfers, only web/chat (and so probably `/agent/prompt`) [UNVERIFIED over the Agent API]. Don't build disbursement on it. Disburse USDC (Dynamic wallet) and let the borrower top up.
- The overview's "Launch Fee Funding" (auto-allocating launch fees to AI) has **no documented mechanism** beyond auto top-up from wallet balance [UNVERIFIED]. Either way, once fees go to the FeeVault the borrower's wallet stops receiving them, so any fee-funded auto top-up on their side stops too. The UI should say so.

---

## 5. Bankr Skill (so any Bankr agent can apply for a loan by chat)

Docs: https://docs.bankr.bot/docs/skills/in-bankr/skill-format.md, /skills/for-other-agents/contributing-skills.md, /skills/in-bankr/from-github.md. Repo: https://github.com/BankrBot/skills (main, pushed 2026-09-18).

- **Format**: `SKILL.md` = YAML frontmatter + markdown body. Required: `name` (slug), `description` (the agent loads skills by matching it, so be concrete). Optional: `tags[]`, `version` (number), `visibility: private|public`, `metadata.clawdbot.{emoji,homepage,requires.bins[],requires.packages[]}`. Optional `references/*.md` (≤100 KB each, fetched on demand) and `scripts/`. SKILL.md ≤1 MB. [DOCS]
- **Actual repo layout** (verified): top-level folder per skill, `<slug>/SKILL.md` + **`<slug>/catalog.json`** (+ optional `references/`, `scripts/`, logo svg). The docs' `provider/skill/` nesting is **not** what the repo uses. The repo root has `README.md` (skills table, add a row), `featured.json`, `.github/CODEOWNERS`. No root `catalog.json`.
- `catalog.json` schema (from bankr/, berry-juicer/, uniswap-cca/):
```json
{ "schemaVersion": 1, "slug": "fee-desk", "provider": "Fee Desk", "providerUrl": "https://<our-url>",
  "logo": null, "demo": null, "setup": [],
  "install": { "type": "bankr", "repoPath": "fee-desk",
    "command": "install the fee-desk skill from https://github.com/BankrBot/skills/tree/main/fee-desk" } }
```
- **Install without the PR being merged** (this is what matters for the demo): the Bankr agent installs from **any public GitHub URL**: `install the skill at https://github.com/<us>/<repo>/tree/main/skill/fee-desk`. Folder URL, blob URL, or raw `SKILL.md` URL all work. So ship `skill/fee-desk/SKILL.md` + `catalog.json` in our public repo and open a PR to BankrBot/skills as a bonus. PR merge = maintainer review, **not under our control**. [DOCS]
- The skill body should tell the agent to (1) GET our Fee Desk API `/quote?token=`, (2) show terms, (3) on user confirm, get pledge calldata (ours, or `build-transfer-beneficiary` with `newBeneficiary=FeeVault`), (4) submit it via its own wallet (Bankr's native "sign and submit raw transactions" capability, i.e. `/wallet/submit`), (5) POST the tx hash to our `/apply`. Keep side effects behind explicit user confirmation.
- Frontmatter example:
```yaml
---
name: fee-desk
description: Borrow USDC against your Bankr/Doppler token's creator-fee stream on Base. Use when the user wants a loan, credit line, or advance on their token trading fees, to check a Fee Desk quote, pledge fee rights, check loan status/repayment, or release fee rights after repayment.
tags: [lending, fees, doppler, base, usdc]
version: 1
metadata:
  clawdbot:
    emoji: "🏦"
    homepage: "https://<our-url>"
    requires:
      bins: [curl]
---
```
- Adjacent prior art in the catalog: `berry-juicer` (fees → USDC → inference wallet) and `signals` (trade signals). Neither lends against Doppler fee rights. Mention them to show we're different.

---

## 6. Env vars

| Var | Needed for | Notes |
|---|---|---|
| `BANKR_LLM_KEY` | underwriter memo | `bk_...` with LLM Gateway enabled + credits > $0. Fall back to `BANKR_API_KEY` if the same key has both flags (documented convention). **Fail loudly if missing.** |
| `BANKR_API_KEY` | only if the desk itself uses Wallet/Agent API (e.g. demo borrower that is a Bankr wallet submitting pledge via `/wallet/submit`) | Not needed for the public fee endpoints. |
| `BANKR_LLM_MODEL` | optional | default `claude-sonnet-4.6`. |
| `BANKR_API_BASE` | optional | default `https://api.bankr.bot`. |

No key is needed for: `/token-launches/*/fees`, `/token-launches`, `/public/doppler/*`, `llm.bankr.bot/health`.

---

## 7. Gotchas

1. Legacy `/public/doppler/token-fees` is past sunset. Use `/token-launches/{token}/fees`.
2. **20 req/min/IP** on fee reads (live header). Batch with `creator-fees/{wallet}` and cache.
3. `creator-fees` mixes Robinhood Chain (4663), Base, Clanker, and bankr_v3. Filter `chain==="base" && source==="doppler"`.
4. Use `feesContract ?? initializer` as the fees manager. Raw `getShares` isn't comparable across variants (0.57e18 vs 0.4828e18 = "95%").
5. Fee income is lumpy (whole days of 0 WETH). Underwrite on a 30-day sum/median, not the latest day.
6. Pledge is all-or-nothing: `updateBeneficiary` moves **all** of the caller's shares. There's no partial pledge.
7. Pre-pledge uncollected fees follow the new beneficiary (vault). Credit them to the borrower.
8. A raw `/wallet/submit` is blocked if the borrower's Bankr key has `allowedRecipients` set. Then they must pledge via chat or the web UI.
9. Gateway: new keys have LLM Gateway **off** and $0 credits, so you get 401/402. Don't use `@ai-sdk/openai`.
10. Bankr gas sponsorship (10 tx or $3/day) covers only Bankr-managed wallets. Our vault/keeper pays its own gas.
11. Deprecated Clanker-style routes (`/agent/doppler/claim`, etc.) emit Sunset headers. Avoid them.

## 8. What is NOT possible / not verified

- No partial or fractional pledge of fee shares (contract moves all shares).
- No official REST endpoint to send LLM credits to another user (web/chat only). [UNVERIFIED via Agent API]
- No official Bankr endpoint to *read who the beneficiary is* besides per-address `claimable-fees?beneficiary=` / `getShares`. The `DecayMulticurveInitializer` and `DopplerHookInitializer` ABIs have `getBeneficiaries`, but Rehype does not (not tested).
- Can't get a Skill into the official catalog on our own (PR review), but installing from our own public repo URL is documented and enough.
- Quote-only pool with nonzero fees: claim payout in quote token only is [DOCS], not live-tested.
- `response_format`/JSON mode on the gateway: [UNVERIFIED]. Use tool calling or validated JSON.
- Did not call any authenticated endpoint (no `BANKR_API_KEY`/`BANKR_LLM_KEY` in this environment).
