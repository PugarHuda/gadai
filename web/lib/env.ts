// NEXT_PUBLIC_* are inlined at build time, so they must be referenced literally.
export const ENV = {
  DYNAMIC_ENVIRONMENT_ID: process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID ?? "",
  AGENT_URL: (process.env.NEXT_PUBLIC_AGENT_URL ?? "").replace(/\/$/, ""),
  DEMO_FORK: process.env.NEXT_PUBLIC_DEMO_FORK === "1",
  FORK_RPC_URL: process.env.NEXT_PUBLIC_FORK_RPC_URL ?? "",
};

/** Names of required vars that are unset. The layout renders a blocking error page if non-empty. */
export const missingEnv = (): string[] => {
  const m: string[] = [];
  if (!ENV.DYNAMIC_ENVIRONMENT_ID) m.push("NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID");
  if (!ENV.AGENT_URL) m.push("NEXT_PUBLIC_AGENT_URL");
  if (ENV.DEMO_FORK && !ENV.FORK_RPC_URL) m.push("NEXT_PUBLIC_FORK_RPC_URL");
  return m;
};
