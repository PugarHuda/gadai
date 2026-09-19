// Gadai agent entrypoint: builds Ctx, mounts every module's routes, starts loops.
// Each module lives in src/<name>/index.ts and follows the contract in SPEC §5 / ctx.ts.
// Run: node --env-file-if-exists=../.env src/index.ts  (Linux/macOS only — Dynamic MPC SDK has no Windows binaries; use `pnpm agent:docker`).
import { createPublicClient, http, type PublicClient } from "viem";
import { base } from "viem/chains";
import type { Address } from "@feedesk/shared";
import { need, opt, type AgentModule, type AgentWallet, type Ctx } from "./ctx.ts";

// Load order matters: db first, wallet before anything that writes on-chain; risk (x402 purchase) before underwriter.
const ALL = ["db", "bankr", "wallet", "uniswap", "risk", "underwriter", "cca", "keeper", "flash", "social", "flynet", "board", "erc8004", "server"] as const;
const enabled = (process.env.FEEDESK_MODULES ? process.env.FEEDESK_MODULES.split(",").map((s) => s.trim()) : [...ALL]) as string[]; // empty = all

const mods: Record<string, AgentModule & Record<string, unknown>> = {};
const missing: string[] = [];
for (const name of ALL) {
  if (!enabled.includes(name)) continue;
  try {
    mods[name] = await import(`./${name}/index.ts`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND" && String(e).replaceAll("\\", "/").includes(`/${name}/index.ts`)) missing.push(name);
    else throw e;
  }
}
if (missing.length) {
  throw new Error(`Modules not built yet: ${missing.join(", ")}. Build them or set FEEDESK_MODULES to a subset (e.g. FEEDESK_MODULES=db,bankr,underwriter,server).`);
}

const demoFork = process.env.DEMO_FORK === "1";
const rpcUrl = demoFork ? opt("FORK_RPC_URL", "http://127.0.0.1:8545") : opt("BASE_RPC_URL", "https://base-rpc.publicnode.com");
if (demoFork) console.warn("[gadai] DEMO_FORK=1 — all on-chain actions hit the Anvil fork at", rpcUrl, "(Flash disabled: mainnet-only)");

const openDb = mods.db?.openDb as ((path: string) => Ctx["db"]) | undefined;
if (!openDb) throw new Error("db module must export openDb(path)");

let walletP: Promise<AgentWallet> | undefined;
const ctx: Ctx = {
  db: openDb(opt("DB_PATH", demoFork ? "./feedesk-fork.db" : "./feedesk.db")),
  pub: createPublicClient({ chain: base, transport: http(rpcUrl) }) as PublicClient,
  rpcUrl,
  demoFork,
  deskAddress: need(demoFork ? "FORK_FEE_DESK_ADDRESS" : "FEE_DESK_ADDRESS") as Address,
  publicUrl: need("AGENT_PUBLIC_URL"),
  webUrl: opt("WEB_URL", "http://localhost:3000"),
  wallet: () => {
    const getAgentWallet = mods.wallet?.getAgentWallet as ((c: Ctx) => Promise<AgentWallet>) | undefined;
    if (!getAgentWallet) throw new Error("wallet module disabled/missing: on-chain writes unavailable");
    return (walletP ??= getAgentWallet(ctx).catch((e) => { walletP = undefined; throw e; }));
  },
  log: (m, msg, data) => console.log(`[${new Date().toISOString()}] [${m}] ${msg}`, data === undefined ? "" : JSON.stringify(data)),
};

const server = mods.server as (AgentModule & { createApp?: (c: Ctx) => import("hono").Hono; listen?: (app: import("hono").Hono, c: Ctx) => void }) | undefined;
if (!server?.createApp || !server.listen) throw new Error("server module must export createApp(ctx) and listen(app, ctx)");
const app = server.createApp(ctx);
for (const [name, m] of Object.entries(mods)) if (name !== "server") m.register?.(app, ctx);
server.register?.(app, ctx); // server's own routes last so it can add a 404/catch-all

const stops = Object.values(mods).flatMap((m) => (m.start ? [m.start(ctx)] : []));
process.on("SIGTERM", () => { stops.forEach((s) => s()); process.exit(0); });
process.on("SIGINT", () => { stops.forEach((s) => s()); process.exit(0); });
server.listen(app, ctx);
