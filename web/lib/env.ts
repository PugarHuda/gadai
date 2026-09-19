// NEXT_PUBLIC_* are inlined at build time, so they must be referenced literally.
const AGENT_URL = (process.env.NEXT_PUBLIC_AGENT_URL ?? "").replace(/\/$/, "");
const FORK_RPC = process.env.NEXT_PUBLIC_FORK_RPC_URL ?? "";
const VIA_AGENT = !FORK_RPC || FORK_RPC === "agent";

export const ENV = {
  DYNAMIC_ENVIRONMENT_ID: process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID ?? "",
  AGENT_URL,
  DEMO_FORK: process.env.NEXT_PUBLIC_DEMO_FORK === "1",
  /** Browser reads (and raw-tx sends) on the fork. Default: the agent's read-only proxy (POST /api/rpc), so the public site
   *  never needs Anvil exposed. NEXT_PUBLIC_FORK_RPC_URL=<url> overrides it. */
  FORK_RPC_URL: VIA_AGENT ? (AGENT_URL ? `${AGENT_URL}/api/rpc` : "") : FORK_RPC,
  /** Fork-admin calls the proxy rejects (anvil_mine, impersonation in the cast snippet): Anvil itself, so they only work on the
   *  machine running it. ponytail: Anvil's default port; set NEXT_PUBLIC_FORK_RPC_URL to point elsewhere. */
  FORK_ADMIN_RPC_URL: VIA_AGENT ? "http://127.0.0.1:8545" : FORK_RPC,
};

/** Names of required vars that are unset. The layout renders a blocking error page if non-empty. */
export const missingEnv = (): string[] => {
  const m: string[] = [];
  if (!ENV.DYNAMIC_ENVIRONMENT_ID) m.push("NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID");
  if (!ENV.AGENT_URL) m.push("NEXT_PUBLIC_AGENT_URL");
  return m;
};
