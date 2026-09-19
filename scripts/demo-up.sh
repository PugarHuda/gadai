#!/usr/bin/env bash
# DEMO_FORK bring-up (Windows + WSL). Run from Git Bash at the repo root AFTER Anvil is up in another terminal:
#   terminal 1:  ~/.foundry/bin/anvil.exe --fork-url https://base-rpc.publicnode.com --chain-id 8453 --host 0.0.0.0
#   terminal 2:  bash scripts/demo-up.sh
# Deploys FeeDesk to the fork (Anvil dev key #0 -> same address every time), funds the Dynamic agent wallet,
# then runs the agent in WSL in the foreground (Ctrl+C to stop). Web: https://gadai-six.vercel.app or `pnpm web`.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.foundry/bin:$PATH"
until cast block-number --rpc-url http://127.0.0.1:8545 >/dev/null 2>&1; do echo "waiting for Anvil on :8545..."; sleep 2; done

DEPLOYER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 FORK_RPC_URL=http://127.0.0.1:8545 \
  node --env-file=.env scripts/forge.mjs deploy:fork | grep -E "FEE_DESK_ADDRESS|keeper="

REPO_WSL="/mnt/c/Hackathons/bankrbot hackathon"
MSYS_NO_PATHCONV=1 wsl -d Ubuntu -- bash -c "
  export PATH=\$HOME/.node/bin:/usr/bin:/bin
  export FORK_RPC_URL=http://\$(ip route show default | cut -d' ' -f3):8545
  cd ~/feedesk && git pull -q '$REPO_WSL' main
  pnpm install -s --frozen-lockfile --filter @feedesk/agent...   # new deps (e.g. ox for ERC-8021 builder codes) land with the pull
  cd agent && rm -f feedesk.db* feedesk-fork.db*   # fresh fork = fresh loan book
  node --env-file=../.env src/wallet/bootstrap.ts --fund-fork 1000 | tail -1
  exec node --env-file=../.env src/index.ts"
