import { defineConfig, devices } from "@playwright/test";

// Chromium blocks a public (https) page from calling http://localhost unless these are off.
// Needed for the Vercel build, which talks to the agent on localhost:8787.
const LAUNCH_ARGS = ["--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessRespectPreflightResults,BlockInsecurePrivateNetworkRequests"];

export const PROD_URL = "https://gadai-six.vercel.app";

export default defineConfig({
  testDir: "./specs",
  globalSetup: "./global-setup.ts",
  // Memory is tight on the demo box: one browser, one worker.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["json", { outputFile: "test-results/results.json" }], ["html", { open: "never" }]],
  use: {
    ...devices["Desktop Chrome"],
    launchOptions: { args: LAUNCH_ARGS },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "local",
      use: { baseURL: process.env.BASE_URL ?? "http://localhost:3000" },
    },
    {
      // Smaller smoke run against the deployed Vercel build (tests tagged @smoke).
      name: "prod-smoke",
      grep: /@smoke/,
      use: { baseURL: process.env.PROD_URL ?? PROD_URL },
    },
  ],
});
