# Gadai contracts (Foundry, Base 8453)

| File | What it does |
|---|---|
| `src/FeeDesk.sol` | Registry and factory. `createLoan` (keeper only) deploys one `FeeVault` per loan. It allows one open loan per pool. |
| `src/FeeVault.sol` | The lien on Doppler fee rights. It confirms the pledge, runs the FeeNote CCA, disburses, collects fees, swaps WETH→USDC via the Uniswap SwapProxy, handles Flash EIP-1271 orders, dining draws, redemption and permissionless release. |
| `src/FeeNote.sol` | Per-loan ERC-20 (6 decimals). 1 note = 1 USDC of face value. Only the vault can mint or burn it. |
| `src/interfaces/` | FeesManager (verified Blockscout source) and CCA v2.1.0 (vendored from the tag). |
| `script/Deploy.s.sol` | Deploys FeeDesk and prints `FEE_DESK_ADDRESS=`. |
| `script/LaunchNoteAuction.s.sol` | Manual CCA launch for a Pledged vault, run as the keeper. |
| `script/exportAbi.mjs` | Writes the ABIs to `shared/src/abi/*.json` and the `FEE_*_ABI` constants in `shared/src/index.ts`. |
| `test/FeeVault.fork.t.sol` | Base-fork tests against the real GITLAWB pool (`TEST_POOL`). |

```bash
export PATH="$HOME/.foundry/bin:$PATH"
forge build && node script/exportAbi.mjs        # always re-export after changing a contract

# tests: pin a block, because forge caches RPC state per block and an unpinned run takes about 9 min on publicnode
forge test --fork-url https://base-rpc.publicnode.com --fork-block-number $(cast block-number --rpc-url https://base-rpc.publicnode.com) -vv

# deploy (mainnet, or the Anvil fork with --rpc-url $FORK_RPC_URL)
DEPLOYER_PRIVATE_KEY=0x.. AGENT_WALLET_ADDRESS=0x.. forge script script/Deploy.s.sol --rpc-url $BASE_RPC_URL --broadcast
```

Price grid (CCA v2.1.0 requires `price % tickSpacing == 0` for every tick, the floor included):
- `tick = 2**96 / 100` (0.01 USDC per note)
- `floor = cents · tick`
- Bid prices must be `k · tick`.

Pick `face` so that `floor · face >= principal`. Then selling every note at the floor graduates.

The DEMO_FORK needs an archive-capable RPC for anvil. publicnode refuses historical state ("Archive requests require a personal token") a few minutes after the fork block. Re-fork right before the demo, or use a keyed RPC.

`startAuction` enforces this on-chain (`floorPriceQ96 · faceValue >= principal · Q96`) and bounds timing: start within 300 blocks, length ≤ 43,200 blocks (~1 day), claim delay ≤ 1,800 blocks.

## Loan terms, stated plainly

- **Non-recourse, no maturity, no default.** The only collateral is the pledged fee stream. The loan is repaid when the vault holds `noteSupply + drawDebt` USDC, whenever that happens. If fees dry up, noteholders wait; nobody can seize anything else.
- **Notes redeem 1:1 in USDC, first come, first served.** Anyone can `redeem` while repayment USDC sits in the vault, so early redeemers are paid in full and late ones wait for more fees. Dining draws are junior: `payDesk` only pays from USDC above outstanding notes.
- **Notes sent to the vault are burned at `release()`** (and by `returnStrayShares()`), and the USDC that backed them goes to the borrower. Don't send notes to the vault.
- **Keeper powers are bounded.** WETH leaves the vault only through `swapWethToUsdc`, whose `minUsdcOut` must be ≥ 95% of Chainlink ETH/USD (feed `0x7104…Bb70`, no older than the desk's `maxOracleAge`: `ORACLE_MAX_AGE_SEC`, 3600 on mainnet, 86400 on the fork). Output that doesn't land in the vault reverts. Flash orders and the custodial `sendTokenLegToKeeper` fallback cover the creator token only, and the fallback works only in vaults created with `keeperTokenCustody`. Draws are capped by `drawLimit` and paid to `treasury`, which `Deploy.s.sol` refuses to set to the keeper (default: the deployer address).
- **One open Flash order per vault.** `approveFlash` sets the allowance, it does not add to it. The agent enforces this with `hasOpenFlashOrder`.
- **Flash EIP-1271 funders are unverified** (docs/integrations/flash.md). Before the demo, run one small mainnet TWAP from a vault. If Flash rejects it, new loans are created with `keeperTokenCustody: true` so the keeper can use the `sendTokenLegToKeeper` fallback (existing vaults cannot switch).

## Trust model

- **Owner** (FeeDesk deployer): can only `setKeeper`, `setTreasury` and `setOwner`. It cannot touch vault funds. Replacing the keeper hands every keeper power below, in all vaults, to the new address. Redirecting the treasury redirects future `payDesk` payments.
- **Keeper** (the Dynamic agent wallet): creates loans and picks their terms, `maxOracleAge` excepted (it is fixed per desk at deploy). It starts auctions within the bounds above, disburses first, cancels before an auction, and services the vault. It can move WETH only through the oracle-floored `swapWethToUsdc`. It can authorize Flash orders for the creator token that pay USDC back to the vault, and those authorizations stop validating (`isValidSignature` fails) once the vault is Released or Cancelled. It books dining draws only with a fresh borrower signature (below), up to `drawLimit`, payable to `treasury`. It can take the creator token into its own custody (`sendTokenLegToKeeper`) only in vaults created with `keeperTokenCustody = true`. That flag is immutable, emitted as `KeeperTokenCustodyEnabled` at creation, and readable before the borrower pledges. There, a leaked keeper key can take the token leg. That is the one custodial path.
- **Borrower**: consents twice. First by pledging, after it can read the vault's terms and `keeperTokenCustody`. Then per dining draw, by personal-signing (EIP-191 for an EOA, EIP-1271 for a contract wallet) `drawMessage(amount, drawNonce, deadline)`, lines joined by `\n`, no trailing newline:
  ```
  Gadai dining draw
  Vault: <vault, lowercase 0x hex>
  Chain: <chainId>
  Amount (USDC raw): <amount>
  Nonce: <drawNonce>
  Deadline: <unix seconds>
  ```
  The nonce is per vault and increments on every draw, so a signature books at most one draw. The borrower gets the lien and all surplus back at `release()` (anyone can call it once debt is covered), and through `cancel` / `returnStrayShares`.
- **Noteholders**: senior claim. They can `redeem` 1:1 against USDC in the vault while it is Active or Released, first come first served. Draws are paid only from USDC above outstanding notes. They depend on the keeper only for conversion speed: `collect`, `payDesk`, `release` and the post-grace `disburse` are permissionless.
