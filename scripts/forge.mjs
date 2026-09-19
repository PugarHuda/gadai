// Cross-platform wrapper for the Foundry root scripts (pnpm runs scripts with cmd.exe on Windows, so no ${X:-y}).
// Env comes from the repo-root .env via `node --env-file-if-exists=.env` (forge itself only reads contracts/.env).
//   node scripts/forge.mjs fork | test | deploy | deploy:fork
import { spawnSync } from "node:child_process";

const env = process.env;
const base = env.BASE_RPC_URL || "https://base-rpc.publicnode.com";
const need = (k) => env[k] || (console.error(`Missing env ${k} (see .env.example)`), process.exit(1));
const cmds = {
  fork: ["anvil", ["--fork-url", base, "--chain-id", "8453", "--host", "0.0.0.0", "--port", new URL(env.FORK_RPC_URL || "http://127.0.0.1:8545").port || "8545"]],
  test: ["forge", ["test", "--fork-url", base, "--fork-block-number", env.FORK_BLOCK || "51480600", "-vv"]],
  deploy: ["forge", ["script", "script/Deploy.s.sol", "--rpc-url", base, "--broadcast"]],
  "deploy:fork": ["forge", ["script", "script/Deploy.s.sol", "--rpc-url", env.FORK_RPC_URL || "", "--broadcast"]],
};
const c = cmds[process.argv[2]];
if (!c) { console.error(`usage: node scripts/forge.mjs ${Object.keys(cmds).join("|")}`); process.exit(1); }
if (process.argv[2].startsWith("deploy")) { need("DEPLOYER_PRIVATE_KEY"); need("AGENT_WALLET_ADDRESS"); }
if (process.argv[2] === "deploy:fork") need("FORK_RPC_URL"); // lazy: an eager need() here broke every other command without .env
// fork chain time drifts past the frozen Chainlink round, so fork desks get a 1-day oracle age (mainnet default 3600)
const runEnv = process.argv[2] === "deploy:fork" ? { ...env, ORACLE_MAX_AGE_SEC: env.ORACLE_MAX_AGE_SEC || "86400" } : env;
// forge test/anvil-less runs ignore EIP-170; a real deploy does not. Fail test/deploy early if a contract is over 24,576 B.
if (c[0] === "forge") {
  const s = spawnSync("forge", ["build", "--sizes", "--skip", "test", "--skip", "script"], { cwd: "contracts", stdio: ["ignore", "pipe", "inherit"], env: runEnv, encoding: "utf8" });
  if (s.error) { console.error(`forge not found: add ~/.foundry/bin to PATH (${s.error.message})`); process.exit(1); }
  if (s.status !== 0) { console.error(s.stdout, "\ncontract size check failed (EIP-170 24,576 B runtime limit)"); process.exit(1); }
}
const r = spawnSync(c[0], c[1], { cwd: c[0] === "forge" ? "contracts" : ".", stdio: "inherit", env: runEnv });
if (r.error) { console.error(`${c[0]} not found: add ~/.foundry/bin to PATH (${r.error.message})`); process.exit(1); }
process.exit(r.status ?? 1);
