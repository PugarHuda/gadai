import type { NextConfig } from "next";

// One .env for the whole repo (root). web/.env.local still wins if present.
try {
  process.loadEnvFile("../.env");
} catch {
  /* no root .env: NEXT_PUBLIC_* must come from the shell; lib/env.ts shows a loud error page */
}

const config: NextConfig = {
  agentRules: false,
  transpilePackages: ["@feedesk/shared"],
  async redirects() {
    return [
      { source: "/leaderboard", destination: "/desk", permanent: false },
      { source: "/loan/:id", destination: "/loans/:id", permanent: false },
    ];
  },
};
export default config;
