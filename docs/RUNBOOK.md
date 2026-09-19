# Gadai runbook

Exact commands to run everything, what each step needs, and what it proves. Every command below was run on
2026-09-19 (Windows 11 + Git Bash, Node 26.3, pnpm 11.21, Foundry). Where a step needs a key we don't have yet, it says so.

## 0. Toolchain

```bash
export PATH="$HOME/.foundry/bin:$PATH"     # forge / anvil / cast
cp .env.example .env                       # then fill in the keys in §5
pnpm install
```

Windows: pnpm runs `package.json` scripts with `cmd.exe`. The root scripts (`fork`, `contracts:*`) go through
`scripts/forge.mjs` so they work there too; run everything else from Git Bash.

## 1. Checks that need no keys

| Command | Result on 2026-09-19 |
|---|---|
| `pnpm -r typecheck` | shared, agent, web: all clean |
| `pnpm contracts:test` (fork pinned at `FORK_BLOCK=51480600`) | 18/18 pass |
| `cd agent && pnpm test` | 52 pass, 0 fail, 1 skipped (the fork e2e test, which needs `FORK_E2E_RPC`) |
| `pnpm web:build` | builds |
| `node docs/anchors.mjs` | "README anchors OK (55 links)" |
| `node skill/gadai/check.mjs` | passes, including the live Bankr `build-transfer-beneficiary` call |

## 2. On-chain end to end on a Base fork (no keys)

Each of these needs a **fresh** fork, because the pledge moves the real pool's fee shares.

```bash
# terminal A
anvil --fork-url https://base-rpc.publicnode.com --chain-id 8453 --port 8546
# terminal B
cd contracts && forge build && cd ../agent
FORK_E2E_RPC=http://127.0.0.1:8546 node --test src/keeper/keeper.fork.test.ts
```

The keeper test runs the production keeper and cca code against the real FeesManager, the real GITLAWB pool (`TEST_POOL`)
and the real CCA factory. The desk signer is an Anvil key standing in for the Dynamic wallet. Steps: createLoan, then
pledge (the beneficiary is impersonated), then confirmPledge, the FeeNote CCA and the anchor bid, then collect of the
real fees, disburse, repay and release. Result on 2026-09-19 (fork block 51481331):

- collected 0.1071 WETH and 2.77M GITLAWB from the pool;
- events: `pledged, bid, auction_started, collected, disbursed, bid, bid, error(swap), released`;
- the fee shares are back with `0xfdb6…76Bf`, and 11.2 USDC stays in the vault for noteholders.

`error(swap)` is `Missing env UNISWAP_API_KEY`. Without the key, the test repays the debt with a direct USDC transfer
(an early repayment). With the key set, the same test requires a real Trading API `swapped` event instead.

```bash
# restart anvil on 8546 first (fresh fork), then:
FORK_RPC_URL=http://127.0.0.1:8546 node src/cca/fork-check.ts             # lender + desk bids
FORK_RPC_URL=http://127.0.0.1:8546 DESK_ONLY=1 node src/cca/fork-check.ts # desk anchor bid only (fresh fork again)
```

The CCA check passed: exactly one desk bid under concurrent launches, the lender bid, graduation, 104.13 USDC disbursed
to the borrower, then the desk claims its FeeNotes and redeems 30 USDC of them.

## 3. The agent server in DEMO_FORK

```bash
pnpm fork                                   # anvil on FORK_RPC_URL (default :8545)
# deploy FeeDesk to the fork. On the fork, Anvil key #0 is fine as deployer; AGENT_WALLET_ADDRESS = the Dynamic wallet (§4)
DEPLOYER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  AGENT_WALLET_ADDRESS=<dynamic wallet> pnpm contracts:deploy:fork   # prints FEE_DESK_ADDRESS=…  → FORK_FEE_DESK_ADDRESS in .env
# .env: DEMO_FORK=1, NEXT_PUBLIC_DEMO_FORK=1, FORK_FEE_DESK_ADDRESS, AGENT_PUBLIC_URL, ADMIN_TOKEN
pnpm agent          # on Windows this runs, but every on-chain write fails: "Dynamic MPC SDK has no Windows binaries". Use Docker (§4)
pnpm web            # http://localhost:3000
```

On 2026-09-19 the server ran on the fork (keys missing, desk deployed at `0x0Cc0…4A57`) and returned:

| Endpoint | Result |
|---|---|
| `GET /api/health` | 200 `{ok:true, demoFork:true, block}` |
| `GET /api/desk` | 200: desk, keeper, treasury, personas |
| `GET /api/creator-tokens?wallet=0xfdb6…76Bf` | 200: live Bankr data (shares, claimable WETH) |
| `GET /api/loans`, `/api/signals`, `/api/leaderboard`, `/api/follows?follower=` | 200 |
| `GET /api/quote?token=GITLAWB&borrower=0xfdb6…` | **503** `Missing env UNISWAP_API_KEY …` (ETH/USD comes from the Trading API) |
| `POST /api/loans` without a signature | 401 |
| `POST /api/admin/keeper/run` with header `x-admin-token` | 200 `{ran:[]}`; without it, 401 |

A missing key is now a 503 naming the env var, not a generic 500 (`agent/src/server/index.ts`, covered by `server.test.ts`).

### Applying for the test pool on the fork

The test-pool beneficiary `0xfdb6…76Bf` is an EIP-7702 account, and nobody on the team holds its key. On the fork only:

```bash
cd agent
pnpm fork:borrower setup          # points the 7702 delegation at contracts/src/demo/ForkDelegate.sol (ERC-1271 for DEMO_BORROWER_KEY)
pnpm fork:borrower apply          # signs applyMessage and POSTs /api/loans (the server's normal ERC-1271 check)
pnpm fork:borrower pledge <id>    # impersonates the beneficiary, sends /pledge-tx, POSTs /pledge {txHash}
curl -X POST -H "x-admin-token: $ADMIN_TOKEN" localhost:8787/api/admin/keeper/run   # keeper tick
# mine past the auction: cast rpc anvil_mine 200 --rpc-url $FORK_RPC_URL
```

Verified on 2026-09-19: `setup` passed its ERC-1271 self-check, and `apply` got past the signature check. It then stopped
at underwriting with the 503 for `UNISWAP_API_KEY`. After that come `BANKR_LLM_KEY` for the memos and the Dynamic
wallet for `createLoan`. `setup` refuses to run on anything that isn't Anvil.

For a mainnet demo, use a Bankr token whose beneficiary is a wallet you control. Then the web app (Dynamic embedded
wallet) or the Bankr Skill signs the application for real, with no fork steps.

## 4. Dynamic agent wallet (Linux only: Docker or WSL)

```bash
docker compose run --rm agent sh -c "npm i -g pnpm@11 >/dev/null && pnpm install --filter @feedesk/agent... && pnpm --filter @feedesk/agent bootstrap:dynamic"
#   → paste AGENT_SIGNING_TOKEN, DYNAMIC_SESSION_KEY_JWK, DYNAMIC_SESSION_PUBLIC_KEY_HEX, DYNAMIC_AGENT_WALLET_METADATA,
#     DYNAMIC_AGENT_KEY_SHARES and AGENT_WALLET_ADDRESS into .env
# DEMO_FORK: fund it on the fork and prove one MPC-signed tx
docker compose run --rm -e FORK_RPC_URL=http://host.docker.internal:8545 agent sh -c "… bootstrap:dynamic --fund-fork 1000"
pnpm agent:docker    # the agent on Linux. Set FORK_RPC_URL=http://host.docker.internal:8545 if anvil runs on the host
                     # (or `docker compose --profile fork up anvil`)
```

The FeeDesk `keeper` must be the Dynamic wallet: deploy with `AGENT_WALLET_ADDRESS` set to it, or call `setKeeper`.
`DESK_TREASURY` must differ from it (the default is the deployer).

## 5. Keys needed from the user

| Key(s) | Where to get it | What it unblocks |
|---|---|---|
| `UNISWAP_API_KEY` | developers.uniswap.org/dashboard | **All underwriting** (ETH/USD via `/quote`) and the keeper's WETH→USDC swap from the vault |
| `BANKR_LLM_KEY` (LLM Gateway on, credits > $0) | bankr.bot/api-keys, then `bankr llm credits add 10` | The three persona credit memos; without it, `POST /api/loans` returns 502/503 and no loan is created |
| `DYNAMIC_ENVIRONMENT_ID` = `NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID`, `DYNAMIC_WALLET_PASSWORD` (then bootstrap output) | console.dynamic.xyz (enable embedded wallets + Base 8453, CORS `http://localhost:3000`) | The agent wallet (createLoan, disburse, keeper txs, anchor bid) and every browser signature |
| `DYNAMIC_AUTH_TOKEN`, `DYNAMIC_WEBHOOK_SECRET`, `DYNAMIC_DELEGATION_PRIVATE_KEY` | Dynamic Console API token, webhook, and the delegated-access key | Auto-mirror follows (not needed for manual mirrors) |
| `FLASH_API_KEY` | app.definitive.fi → Flash → Create Flash Key | Own attribution for the token-leg TWAP and the mirror brackets (the public dev key works, but credits Definitive) |
| `FLYNET_API_KEY`, `FLYNET_CLIENT_ID/SECRET`, `FLYNET_REDIRECT_URI`, `FLYNET_AUDIENCE` + FLY in the staging app wallet | make.flynet.org, support@blackbird.xyz (the audience value and FLY funding are undocumented) | The `/dine` credit line |
| `DEPLOYER_PRIVATE_KEY` + ~0.001 ETH on Base | your wallet | Mainnet `pnpm contracts:deploy` → `FEE_DESK_ADDRESS` |
| USDC in the Dynamic agent wallet (≥ 1.01 × principal) | fund it on Base | Desk anchor bid, i.e. funding a real loan |
| `AGENT_PUBLIC_URL` (tunnel or deploy), `ADMIN_TOKEN` | cloudflared/ngrok; any long random string | Bankr Skill, Flynet OAuth callback, Dynamic webhook; admin keeper route |
| A Bankr token with fees whose beneficiary you control | Launch via Bankr | A real (mainnet) borrower who can sign; see §3 |

## 6. Known sharp edges

- **publicnode forks:** a fork kept open a long time can hit "Archive requests require a personal token". Anvil retries,
  but if reads start failing, restart the fork (and redeploy) or use an archive RPC in `BASE_RPC_URL`.
- **`contracts:test`** needs an RPC that still serves `FORK_BLOCK`. It worked on publicnode on 2026-09-19. If it
  starts failing, set `FORK_BLOCK` to a recent block.
- **Flash is mainnet only.** In DEMO_FORK, the token leg and mirrors are disabled on purpose and the UI says so.
- **Draws:** if a `flash_orders` row is stuck at `SETTLING` with an `error` event, USDC is sitting in the agent wallet.
  Send it by hand, then mark the row `SETTLED` (see COORDINATION, agent-social-flash).
