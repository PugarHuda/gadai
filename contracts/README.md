# Fee Desk contracts (Foundry, Base 8453)

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
- **Keeper powers are bounded.** WETH leaves the vault only through `swapWethToUsdc`, whose `minUsdcOut` must be ≥ 95% of Chainlink ETH/USD (feed `0x7104…Bb70`, ≤ 1 day old). Output that doesn't land in the vault reverts. Flash orders and the custodial `sendTokenLegToKeeper` fallback cover the creator token only. Draws are capped by `drawLimit` and paid to `treasury`, which `Deploy.s.sol` refuses to set to the keeper (default: the deployer address).
- **One open Flash order per vault.** `approveFlash` sets the allowance, it does not add to it. The agent enforces this with `hasOpenFlashOrder`.
- **Flash EIP-1271 funders are unverified** (docs/integrations/flash.md). Before the demo, run one small mainnet TWAP from a vault. If Flash rejects it, the keeper uses the `sendTokenLegToKeeper` fallback.
