---
name: gadai-credit
description: Quote a Gadai USDC credit line for a Bankr (Doppler) token on Base, explain how pledging the token's creator-fee rights works, read the Gadai Credit Line Board, and fetch the paid Gadai credit report over x402. Use when someone asks how much they could borrow against a Bankr token's trading fees, what a Gadai loan would cost, how the pledge and release of fee rights works, or which Bankr agents have the largest pre-approved credit lines. Read-only by default; the paid report and anything on-chain need the user's approval.
compatibility: Needs outbound HTTPS and curl on the Grok Bot computer. The paid report also needs Node.js (npx) and a BANKR_API_KEY Bot secret.
metadata:
  homepage: "https://gadai-six.vercel.app"
  source: "https://github.com/PugarHuda/gadai"
---

# Gadai credit (Grok Bot)

Gadai lends USDC on Base (chain 8453) against the creator-fee share of a Bankr (Doppler) token. This skill quotes lines, explains the flow and reads the public board. It never moves funds.

Set the API base first. It is the public tunnel to the Gadai agent, and it can change between demo sessions. If it stops answering, say so and use the website https://gadai-six.vercel.app instead:

```bash
FD=https://aqua-economic-moss-modes.trycloudflare.com
```

## 1. When to use

- "How much could I borrow against my Bankr token / my agent's fees?"
- "What would a Gadai loan on <token> cost, and how long to repay?"
- "How does pledging fee rights work? Do I get them back?"
- "Which Bankr agents have the biggest credit lines?" (the Credit Line Board)
- "Get me a credit report on <token>" (paid, $0.02 USDC; see 3c)

For status checks on an existing loan, use the `gadai-loan-watch` skill.

## 2. Required inputs and access

- `TOKEN`: a Base token address (0x + 40 hex). Ask for it if it is missing.
- `BORROWER` (optional): the wallet that is currently the token's fee beneficiary. The quote runs the on-chain checks only when it is given.
- No login is needed for sections 3a, 3b and 3d. They are public GET requests.
- For the paid report (3c) only: a Bot secret named `BANKR_API_KEY` (Bot → Secrets → Add secret) holding a Bankr API key whose wallet has at least $0.02 USDC on Base. The Bankr CLI reads that variable. Never ask for the key in chat.

## 3. Sequence of work

### 3a. Quote (free, read-only)

```bash
curl -s "$FD/api/quote?token=$TOKEN&borrower=$BORROWER"
```

The response has `eligible`, `reasons[]`, `inputs` (`symbol`, `sharePct`, `weth30d`, `claimableWethRaw`, `ethUsd`, `poolId`, `feesManager`), `terms` (`maxPrincipalRaw`, `principalRaw`, `faceValueRaw`, `feeRatePct`, `floorPrice`, `termDays`, `drawLimitRaw`) and `formula`.

Every field ending in `Raw` is USDC with 6 decimals (`"25000000"` = 25 USDC), except `claimableWethRaw`, which is WETH with 18 decimals.

- If `eligible` is false, list `reasons[]` word for word and stop.
- If it is true, report: "Up to **principalRaw/1e6 USDC** now. You repay **faceValueRaw/1e6 USDC** (fee **feeRatePct%**) out of your fees, expected in about **termDays days** at the current rate." Then show `formula` verbatim. It is the exact underwriting math.

### 3b. Explain the pledge flow (no calls)

When asked how borrowing works, explain these steps in plain words:

1. **Apply.** The borrower signs a 5-line message with its Bankr wallet (no funds move). The desk's underwriter sizes the line from the fee history, and three credit personas write memos. The lead memo can only lower the amount.
2. **Pledge.** The borrower moves **100%** of its fee share on that token to a per-loan FeeVault contract with Doppler's `updateBeneficiary(poolId, vault)`. Only pledge a loan whose status is `APPROVED`.
3. **Funding.** Lenders buy FeeNotes (an ERC-20) with USDC in a Uniswap Continuous Clearing Auction. When it fills, the desk's agent wallet sends the USDC to the borrower (`ACTIVE`).
4. **Repayment.** Fees flow to the vault, WETH is swapped to USDC, and the debt goes down. While the loan is open the borrower's fees go to the vault, not the wallet. Borrowers can also repay early by sending USDC to the vault.
5. **Release.** When the debt is zero, anyone can call `release()`, and the vault hands the fee rights back (`RELEASED`). The borrower never depends on the desk to get them back.

Unfilled or never-pledged loans are `CANCELLED`, and anything the vault held goes back to the borrower in the same transaction.

**This skill does not apply or pledge.** Those steps need the borrower's own wallet. Send the user to the Bankr skill (install `https://github.com/PugarHuda/gadai/tree/main/skill/gadai` in Bankr) or to https://gadai-six.vercel.app.

### 3c. Paid credit report over x402 ($0.02 USDC, needs approval)

Use this when the user wants a report on a token they don't own, or when `$FD` is down. Ask first: "This report costs $0.02 USDC from the Bankr wallet behind BANKR_API_KEY. Go ahead?" Run it only after a clear yes:

```bash
npx -y @bankr/cli@latest x402 call "https://x402.bankr.bot/0x0455408228f460722ecbe80789bcf1628b479e98/gadai-credit?token=$TOKEN" --max-payment 0.02 --yes --raw
```

`--yes` skips the CLI's own prompt, so the user's yes in chat is the only confirmation. Add `&borrower=$BORROWER` to the URL if you have it. The response has `eligible`, `reasons[]`, `history` (r7/r30/rLife in WETH/day, slope30d, cv30d), `terms` (`maxPrincipalUsdc`, `feeRatePct`, `floorPrice`, `termDays`, `drawLimitUsdc`) and `formula`. A `400` means a bad address, and no payment was taken. The report is a pre-approval without on-chain checks. To borrow, the user still applies through Bankr or the website.

### 3d. Credit Line Board (free, read-only)

```bash
curl -s "$FD/api/board"
```

Returns `generatedAt`, `ethUsd`, `totals` (`agents`, `eligible`, `totalCreditUsdc`, `lifetimeFeesWeth`, `claimableWeth`, `llmTokens30d`) and `rows[]`. Each row has `name`, `symbol`, `token`, `beneficiary`, `sharePct`, `lifetimeWeth`, `weeklyWeth`, `llmTokens30d`, `maxLoanUsdc`, `feeRatePct`, `eligible` and `reason`. Amounts here are already in USDC and WETH, not raw units. Default answer: the totals line, then the top 5 eligible rows by `maxLoanUsdc`. Link https://gadai-six.vercel.app/board.

## 4. How to validate the result

- `TOKEN` and `BORROWER` match `^0x[0-9a-fA-F]{40}$` before you call anything.
- The response is JSON. `{ "error": "..." }` means show the message verbatim and stop. Do not retry in a loop.
- Every USDC amount you print comes from dividing a `*Raw` value by 1e6. Do not round the `formula` string.
- The quote and the board are read live on each call. Never answer from memory or an earlier run.
- If `$FD` does not answer (timeout, 5xx, or an HTML error page from the tunnel), say "the Gadai desk is unreachable right now" and offer the paid report (3c) or the website.

## 5. What to return

A short answer with the numbers the user asked for, the `formula` string for quotes, and links: the website https://gadai-six.vercel.app, the board at /board, and the source at https://github.com/PugarHuda/gadai. Keep the source of each number clear: the free desk quote or the paid x402 report.

## 6. What requires approval

- **The paid report (3c)**: ask before every call, and state the $0.02 price.
- **Never** sign messages, submit transactions, transfer tokens, or pledge fee rights from this skill, even when asked. Those steps belong to the borrower's own Bankr wallet.
- Never paste or print `BANKR_API_KEY`.
