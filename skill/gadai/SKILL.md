---
name: gadai
description: Borrow USDC on Base against the creator-fee stream of your Bankr (Doppler) token. Use when the user wants a loan, advance, or credit line on their token's trading fees; wants a Gadai quote; wants to pledge fee rights (transfer the fee beneficiary to a Gadai vault); wants to check loan status, auction progress or remaining debt; wants to repay early; wants to release fee rights back after repayment; or wants to turn the loan into Bankr LLM credits.
tags: [lending, credit, fees, doppler, base, usdc, llm-credits]
version: 1
metadata:
  clawdbot:
    emoji: "🏦"
    homepage: "https://gadai-six.vercel.app"
    requires:
      bins: [curl]
---

# Gadai

Gadai lends USDC to Bankr agents and creators. The collateral is the creator-fee share of a Doppler token on Base (chain 8453).

1. The borrower pledges its fee rights by moving its beneficiary share to a per-loan **FeeVault** contract. This uses the standard Doppler `updateBeneficiary(poolId, vault)`, which Bankr builds for you.
2. The desk's underwriter agent reads your fee history from the Bankr API. Three LLM personas, running on the Bankr LLM Gateway, each write a credit memo. The lead persona's decision is binding.
3. The loan is sold as a FeeNote token in a Uniswap Continuous Clearing Auction. The desk's Dynamic agent wallet sends the USDC raised to you.
4. The vault collects your fees and converts them to USDC. WETH goes through the Uniswap Trading API. The token leg sells via a Definitive Flash TWAP. The loan repays itself from that USDC.
5. Once the debt is zero, **anyone** can call `release()`. The vault then gives the fee rights back to you. You never depend on the desk to get them back.

Gadai API base URL. Every call below uses `$FD`, so set it first:
```bash
FD=https://aqua-economic-moss-modes.trycloudflare.com
```
Writes (sign a message, submit a transaction) use your own wallet. **Inside Bankr**, use your built-in tools for signing a message and submitting an arbitrary transaction. **Outside Bankr** (any other agent with the Bankr CLI or Wallet API), use `bankr wallet sign` / `bankr wallet submit`, or `https://api.bankr.bot/wallet/sign` / `/wallet/submit` with your Bankr API key in `X-API-Key`.

All Gadai amounts ending in `Raw` are USDC base units with **6 decimals** (`"25000000"` = 25 USDC). All transactions are on Base, `chainId 8453`.

---

## Hard rules (read before doing anything)

1. **Never submit a transaction without the user's explicit "yes"** to a summary that shows the exact amounts. The pledge moves **all** of the user's fee share on that token, not part of it.
2. Before you submit `pledgeTx`, check:
   - `pledgeTx.chainId == 8453`
   - `pledgeTx.to` equals `inputs.feesManager` from the quote (case-insensitive)
   - `pledgeTx.data`, lowercased, is **exactly** `"0xd44f6738"` + `loan.poolId` without `0x` + 24 zeros + `loan.vault` without `0x`. This is `updateBeneficiary(poolId, vault)`, and the result is 138 characters. Example for pool `0xec33…b0b9` and vault `0x…dead`: `0xd44f6738ec33…b0b9000000000000000000000000…dead`

   If any of these fails, stop and tell the user.
3. Only sign the apply message with the **borrower** wallet (the fee beneficiary), and only after the user asked to apply.
4. Only pledge a loan whose `status` is `APPROVED`. Re-read `GET $FD/api/loans/<ID>` right before you submit. A pledge to a `CANCELLED` or `RELEASED` vault can never be returned, so the fee rights would be lost. Never pledge a `DECLINED` loan either.
5. Show the `formula` string from the quote. It is the exact underwriting math, and the user should see it.
6. If an endpoint returns `{ "error": "..." }`, show that message verbatim. Do not retry POST calls in a loop. Do not make up a status.
7. Read-only calls (quote, status, auction, leaderboard) need no confirmation.

---

## 1. Find the borrower wallet and its tokens

The borrower is the wallet that is **currently the fee beneficiary** of the token. For a token launched through Bankr, that is usually the user's Bankr wallet. You can get its address with `bankr whoami` or `GET https://api.bankr.bot/wallet/me`.

```bash
curl -s "$FD/api/creator-tokens?wallet=<BORROWER>"
# → [{ "token":"0x…", "symbol":"GITLAWB", "name":"…", "sharePct":57, "claimableWeth":0.097 }, …]
```

Only Base Doppler tokens are listed. `claimableWeth` is the unclaimed fee amount in the pool's quote token. That is WETH for most Bankr tokens, but a token paired with something else (e.g. BNKR) shows its amount in that token, and the quote in step 2 rejects it ("numeraire … is not WETH"). If the list is empty, this wallet has nothing to borrow against. Say so and stop.

## 2. Get a quote (read-only, no LLM)

```bash
curl -s "$FD/api/quote?token=<TOKEN>&borrower=<BORROWER>"
```

The response is a `Quote`:
- `eligible` (bool), and `reasons[]` when it is false. Examples of reasons: not a Base Doppler token, history under 7 days, zero fees, an open loan already exists on this pool.
- `inputs`: `symbol`, `sharePct`, `weth30d`, `claimableWethRaw` (fees that accrued but were never claimed; they move to the vault and count as your first repayment), `ethUsd` (from Uniswap), `feesManager`, `poolId`.
- `terms`: `maxPrincipalRaw`, `principalRaw`, `faceValueRaw`, `feeRatePct`, `floorPrice`, `termDays`, `drawLimitRaw`.
- `formula`: a human-readable string. Show it.

Present the quote like this: "Up to **X USDC** now. You repay **Y USDC** (fee **Z%**) out of your fees, expected in about **N days** at the current rate. Fees you haven't claimed yet (**W WETH**) go to the vault and count as your first repayment. While the loan is open, your fees go to the vault and not to your wallet, so any fee-funded auto top-up stops too."

### 2a. Paid credit report (x402, works without the desk)

The same engine math is also sold on Bankr x402 Cloud for **$0.02 USDC** per call, for any Base Doppler token. Use it when `$FD` is unreachable, or when the user wants a credit report on a token they don't own. It costs money, so ask the user first ("This report costs $0.02 USDC. Go ahead?").
```bash
bankr x402 call "https://x402.bankr.bot/0x0455408228f460722ecbe80789bcf1628b479e98/gadai-credit?token=<TOKEN>&borrower=<BORROWER>" --max-payment 0.02
```
Inside Bankr, use your built-in x402 call tool with that URL. `borrower` is optional. The response has `eligible`, `reasons[]`, `history` (r7/r30/rLife in WETH/day, slope30d, cv30d), `terms` (`maxPrincipalUsdc`, `feeRatePct`, `floorPrice`, `termDays`, `drawLimitUsdc`) and `formula`. Show the `formula`. This report is a pre-approval without on-chain checks: to borrow, still get the quote in step 2 and apply in step 3. A `400` means a bad address, and no payment was taken.

## 3. Apply (the LLM credit decision)

Continue only after the user says to apply. The desk only accepts an application signed by the borrower wallet, so nobody can apply against someone else's fees.

**3a. Build the message.** Pick a fresh nonce: any string of 8 to 128 characters that you have never used before (e.g. 32 random hex characters, or the current Unix time in ms plus a random suffix). Each nonce works once. The message is exactly these **5 lines**, joined by a single newline `\n` (no `\r`, no trailing newline). Both addresses are **lowercase**, and `Controller` is the borrower again:
```
Gadai: apply for a loan against my creator fees
Token: <token, lowercase 0x…>
Borrower: <borrower, lowercase 0x…>
Controller: <borrower, lowercase 0x…>
Nonce: <nonce>
```

**3b. Sign it** with EIP-191 `personal_sign` from the borrower wallet. Signing a message moves no funds and sends no transaction.
- Inside Bankr: your built-in sign-message tool (personal_sign) with that exact text.
- Bankr CLI: `bankr wallet sign --type personal_sign --message "$MSG"`, where `MSG="$(printf 'Gadai: apply for a loan against my creator fees\nToken: %s\nBorrower: %s\nController: %s\nNonce: %s' "$TOKEN_LC" "$BORROWER_LC" "$BORROWER_LC" "$NONCE")"`.
- Wallet API: `POST https://api.bankr.bot/wallet/sign` with `{"signatureType":"personal_sign","message":"<the 5 lines, joined with \n>"}`. It returns `{ "success": true, "signature": "0x…", "signer": "0x…" }`.

If `signer` is not the borrower address, stop. The desk would reject it with 401.

**3c. Apply:**
```bash
curl -s -X POST "$FD/api/loans" -H 'content-type: application/json' \
  -d '{"token":"<TOKEN>","borrower":"<BORROWER>","via":"bankr-skill","nonce":"<NONCE>","signature":"<SIGNATURE>"}'
```
If the borrower has an ERC-8004 agent identity (Base IdentityRegistry), you may add `"erc8004AgentId":"<AGENT_ID>"` (decimal string) to that body. The agent must be owned by the borrower wallet, or the desk answers `400`. Its Gadai repayment record can only **lower** the line, never raise it, and a repaid loan adds positive feedback to it.

The response is a `LoanDetail`: `id`, `status`, `vault`, `note`, `terms`, `leadMemo`, `memos[]`, `pledgeTx`, `pledgeChatText`, `events[]`, plus `claimFirst` (an optional transaction, or `null`; see step 4). Keep `claimFirst`: it is returned only by this call.
- `status: "DECLINED"`: show `leadMemo.rationale` and `leadMemo.risks`, then stop.
- `status: "APPROVED"`: show every memo in `memos[]` (persona, model, decision, principal, confidence, rationale). The desk's Dynamic agent wallet has already deployed the loan's vault on-chain; the `loan_created` event has the tx hash.
- HTTP `401`: missing nonce/signature, or the signature is not the borrower's over that exact message. Check the 5 lines (lowercase addresses, `\n` separators, Controller = borrower) and that you signed with the borrower wallet. Sign again with a **new** nonce.
- HTTP `409`: `nonce already used` (sign again with a new nonce), an open loan already exists for this token, or the token was `declined … re-apply after 24h`.
- HTTP `422`: not eligible. `502`: the underwriter could not produce a valid memo.
- In all of these cases no loan was created. Show the error.

## 4. Pledge the fee rights (on-chain, needs a "yes")

Tell the user exactly what is about to happen: "This moves 100% of your fee share on <SYMBOL> to vault <VAULT>. Fees will pay down the loan. When the debt reaches zero, anyone (including you) can call `release()` to move the share back to you."

**4a. Optional: claim accrued fees first.** If the apply response had a non-null `claimFirst`, offer it **before** the pledge: "You have <claimFirst.claimableWethRaw / 1e18> WETH of unclaimed fees. Claim them to your wallet first? If you skip this, they go to the vault and count as your first repayment." Only on a "yes", check `claimFirst.tx.chainId == 8453`, `claimFirst.tx.to` equals `inputs.feesManager` (case-insensitive) and `claimFirst.tx.data`, lowercased, is **exactly** `"0x817db73b"` + `loan.poolId` without `0x` (that is `collectFees(poolId)`, 74 characters). Submit it the same way as Option A below, with `claimFirst.tx` in place of `pledgeTx`, and wait for it to confirm. Then continue with the pledge. Skipping it is safe.

**4b. Pledge.** If `pledgeTx` is `null`, fetch it with `GET $FD/api/loans/<ID>/pledge-tx`. Run the checks from Hard rule 2. Then submit with **one** of these options:

**Option A: submit the raw transaction** `{ "to": pledgeTx.to, "chainId": 8453, "value": "0", "data": pledgeTx.data }`:
- Inside Bankr: your built-in tool for submitting an arbitrary transaction, with exactly those fields.
- Bankr CLI: `bankr wallet submit json '{"to":"<pledgeTx.to>","chainId":8453,"value":"0","data":"<pledgeTx.data>"}'`
- Wallet API (outside Bankr):
```bash
curl -s -X POST "https://api.bankr.bot/wallet/submit" -H "X-API-Key: $BANKR_API_KEY" -H 'content-type: application/json' \
  -d '{"transaction":{"to":"<pledgeTx.to>","chainId":8453,"value":"0","data":"<pledgeTx.data>"},
       "description":"Gadai: pledge <SYMBOL> fee rights to vault <VAULT>","waitForConfirmation":true}'
# → { "success": true, "transactionHash": "0x…", "status": "…" }
```
A raw submit is blocked if the API key has `allowedRecipients` set. In that case, use Option B.

**Option B: Bankr chat**. Send the exact phrase from `pledgeChatText`:
`transfer my beneficiary share on token <TOKEN> to <VAULT>`
Then read the resulting tx hash from the agent's reply.

Then tell Gadai. It checks on-chain that the share has moved, confirms the pledge from the desk wallet, and opens the FeeNote auction:
```bash
curl -s -X POST "$FD/api/loans/<ID>/pledge" -H 'content-type: application/json' -d '{"txHash":"<TX_HASH>"}'
```
- `200`: `status` becomes `AUCTION` (or `PLEDGED` for a moment).
- `409 "fee rights not moved yet"`: the pledge tx hasn't landed, or it was sent from a wallet that is not the beneficiary. Check the hash and try again after it confirms.
- `502 "pledge confirmed, but auction launch failed"`: POST the same request again. It is retry-safe.

## 5. Watch the loan

```bash
curl -s "$FD/api/loans/<ID>"            # status, debt, events (each with txHash)
curl -s "$FD/api/loans/<ID>/auction"    # FeeNote CCA: clearingPrice, currencyRaisedRaw / requiredRaw, endBlock, currentBlock
```

What each status means:

| status | meaning |
|---|---|
| `DECLINED` | The lead underwriter said no. Nothing was deployed and nothing moved. The same token can apply again after 24h |
| `APPROVED` | Vault deployed, waiting for the pledge. If the share is not moved within 24h, the desk cancels the vault |
| `PLEDGED` | Lien confirmed, auction starting |
| `AUCTION` | Lenders are buying FeeNotes with USDC. The loan funds when `currencyRaisedRaw ≥ requiredRaw` at `endBlock` |
| `ACTIVE` | USDC was sent to the borrower (the `disbursed` event has the tx and amount). Fees now repay the loan |
| `RELEASED` | Debt is paid and the fee rights are back with the borrower |
| `CANCELLED` | The vault was closed without a loan: nobody pledged within 24h, or the pledge landed but the auction never launched or did not fill. Any fee share the vault held, and all its balances, went back to the borrower in the same transaction. **Never pledge to a `CANCELLED` vault**: a share sent there later cannot be returned |

`debt` (from `GET /api/loans/<ID>`) holds `outstandingRaw`, `usdcInVaultRaw`, `noteSupplyRaw`, `drawDebtRaw`, `wethInVaultRaw`, `tokenInVaultRaw` and `canRelease`. The desk reads it from the vault on-chain on every call.

If the share lands late (for example a Bankr chat pledge with no `POST /pledge`), the desk's keeper still sees it while the vault is `APPROVED`, confirms it and starts the auction.

Poll no more than once every 30 seconds.

## 6. Turn the loan into LLM credits

When the loan is `ACTIVE`, the USDC is in the borrower wallet. If the user wants inference, confirm the amount, then:
```bash
bankr llm credits add <USDC_AMOUNT>
```
The payment comes from Base USDC by default. Check the result with `bankr llm credits`.

## 7. Repay early (optional)

The loan repays itself from fees; the desk's keeper collects and swaps them. To repay faster, send USDC **to the vault**. Any USDC in the vault counts toward the debt. Get the amount from `debt.outstandingRaw`, convert it to USDC (divide by 1e6), confirm with the user, and then:
```bash
bankr wallet transfer --to <VAULT> --token USDC --amount <USDC_AMOUNT> --chain base
```
Never send more than `outstandingRaw`. Any surplus is returned to the borrower on release, but it is still pointless.

## 8. Release the fee rights

When `debt.canRelease` is `true`:
```bash
curl -s "$FD/api/loans/<ID>/release-tx"
# → { "to":"<VAULT>", "data":"0x…", "chainId":8453, "label":"Release fee rights (FeeVault.release)" }
```
Check that `to` equals the loan's `vault`. After the user confirms, submit it as a raw transaction as in step 4, Option A. `409` means the debt is not covered yet. The desk's keeper also calls `release()` automatically, so the loan may already show `RELEASED`.

## 9. Other things the user may ask about (read-only)

- **Desk info / who the agents are:** `GET $FD/api/desk` returns the desk contract, the Dynamic agent wallet, and the personas with their models.
- **Follow the Desk:** `GET $FD/api/signals?limit=20` (every credit decision, scored) and `GET $FD/api/leaderboard` (personas ranked by realized repayment and follower PnL). Following a persona and mirroring its picks as Definitive Flash bracket or DCA orders needs a wallet signature in the web app: `https://gadai-six.vercel.app/desk`.
- **Dine on your fees:** an `ACTIVE` loan with a `drawLimitRaw` can draw a small FLY dining line through Blackbird. This needs a Blackbird OAuth login in the browser, at `https://gadai-six.vercel.app/dine/<ID>`.

## Errors

Every error body is `{ "error": "<message>" }`.

| HTTP | meaning | what to do |
|---|---|---|
| 400 | bad address or body | fix the input |
| 401 | apply signature missing, or not the borrower's over the exact message | rebuild the 5-line message and sign again with a new nonce (step 3) |
| 404 | unknown loan | check the id with `GET $FD/api/loans?borrower=<BORROWER>` |
| 409 | `nonce already used`; declined in the last 24h (`re-apply after 24h`); wrong state (open loan exists, pledge not landed, loan not `APPROVED` for pledge-tx, cannot release yet) | new nonce for the first; otherwise show the message and wait |
| 422 | not eligible | show `reasons` or the message and stop |
| 502 | upstream failure (LLM memo, on-chain tx, auction launch) | show the message. For `/pledge`, one retry is fine |
| 500 / 503 | a desk-side failure, e.g. `Missing env …` or a module not loaded | tell the user the desk is unavailable right now and show the message. Don't retry in a loop |
