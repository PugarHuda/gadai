---
name: gadai-loan-watch
description: Check one Gadai loan and summarize its status, remaining debt and what changed since the last check. Built to run as a daily Grok Bot routine, and also works on demand. Use when someone asks how their Gadai loan is doing, how much is left to repay, whether the FeeNote auction filled, or whether the fee rights can be released. Read-only; it never signs or sends anything.
compatibility: Needs outbound HTTPS, curl, and write access to /workspace on the Grok Bot computer.
metadata:
  homepage: "https://gadai-six.vercel.app"
  source: "https://github.com/PugarHuda/gadai"
---

# Gadai loan watch (Grok Bot)

```bash
FD=https://aqua-economic-moss-modes.trycloudflare.com
```

`$FD` is the public tunnel to the Gadai agent. It can change between demo sessions. If it does not answer, report that and stop. Never fall back to old data.

## 1. When to use

- As a routine: once a day for one loan id.
- On demand: "How is Gadai loan 3 doing?", "How much do I still owe?", "Can I release my fee rights yet?"

## 2. Required inputs and access

- `LOAN_ID`: a positive integer. If the user only knows their wallet, list their loans with `curl -s "$FD/api/loans?borrower=<0x wallet>"` and ask which one.
- No login and no secrets. All calls are public GET requests.
- State file: `/workspace/gadai/loan-<LOAN_ID>.json` keeps the previous snapshot, so the next run can report changes.

## 3. Sequence of work

1. `curl -s -m 30 "$FD/api/loans/$LOAN_ID"`. This returns a `LoanDetail`: `id`, `status`, `symbol`, `token`, `borrower`, `vault`, `terms`, `debt`, `events[]` (each with `kind`, `txHash`, `createdAt`). The desk re-reads `debt` from the vault on every call.
2. If `status` is `AUCTION`, also run `curl -s -m 30 "$FD/api/loans/$LOAN_ID/auction"` for `currencyRaisedRaw`, `requiredRaw`, `clearingPrice`, `endBlock` and `currentBlock`.
3. Once per run, `curl -s -m 30 "$FD/api/desk"`. If it says `"demoFork": true`, the desk runs on a fork of Base, and its transaction hashes will not show up on basescan. Say so in the summary.
4. Read the previous snapshot from `/workspace/gadai/loan-$LOAN_ID.json`, if it exists.
5. Write the new snapshot (`status`, `debt`, the newest event `id`, and the time) to that file. Create `/workspace/gadai/` if needed.

## 4. How to validate the result

- `{ "error": "..." }` or a non-JSON body (a tunnel error page): report "Gadai desk unreachable / error: <message>" and **do not** overwrite the snapshot.
- `404 loan N not found`: report it and suggest checking the id with `?borrower=`.
- USDC amounts are `*Raw / 1e6`. `wethInVaultRaw` is WETH with 18 decimals. `tokenInVaultRaw` is the creator token with 18 decimals.
- `debt` can be `null` before a vault exists (for example `DECLINED`). Say "no vault" rather than 0.

## 5. What to return

Up to 6 lines:

```
Gadai loan #<id> <symbol>: <STATUS> (was <old status> yesterday | first check)
Debt left: <outstandingRaw/1e6> USDC of <terms.faceValueRaw/1e6> USDC face. USDC in vault <usdcInVaultRaw/1e6>, WETH waiting to swap <wethInVaultRaw/1e18>
Change since last check: <-X USDC repaid | no change>
New events: <kind @ time, ...> (tx hashes are from a Base fork if demoFork)
Next: <one line from the table below>
Link: https://gadai-six.vercel.app
```

| status | "Next" line |
|---|---|
| `DECLINED` | Declined. The same token can apply again after 24h. Nothing moved. |
| `APPROVED` | Waiting for the pledge. The desk cancels the vault if the share doesn't arrive within 24h. |
| `PLEDGED` | Fee rights are pledged, and the auction is starting. |
| `AUCTION` | Auction: raised <currencyRaisedRaw/1e6> of <requiredRaw/1e6> USDC, ends at block <endBlock> (now <currentBlock>). |
| `ACTIVE` | Fees are repaying the loan. If `debt.canRelease` is true: "Debt covered, and anyone can call release() now." |
| `RELEASED` | Repaid. The fee rights are back with the borrower. Suggest pausing this routine. |
| `CANCELLED` | Closed without a loan, and the vault returned everything. Never pledge to this vault. Suggest pausing this routine. |

## 6. What requires approval

Nothing this skill does needs approval, because it only reads. It must **never** repay, release, pledge, sign, or contact anyone. If the summary shows that an action is possible (for example `canRelease`), tell the user and point them to their Bankr wallet or the website.
