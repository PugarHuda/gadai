import { test as base, expect, type Page } from "@playwright/test";
export type { Page };
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const AGENT = (process.env.AGENT_URL ?? "http://localhost:8787").replace(/\/$/, "");
export const FORK_RPC = process.env.FORK_RPC_URL ?? "http://127.0.0.1:8545";

/** ADMIN_TOKEN from the env, else from the repo root .env (never logged). */
export function adminToken(): string {
  if (process.env.ADMIN_TOKEN) return process.env.ADMIN_TOKEN;
  try {
    const env = readFileSync(fileURLToPath(new URL("../../.env", import.meta.url)), "utf8");
    return env.match(/^ADMIN_TOKEN=(.*)$/m)?.[1]?.trim() ?? "";
  } catch {
    return "";
  }
}

/** The real GITLAWB test pool on the fork (shared/src TEST_POOL). */
export const POOL = {
  token: "0x5F980Dcfc4c0fa3911554cf5ab288ed0eb13DBa3",
  beneficiary: "0xfdb6430011f6E4796Ca380CB39e47975b1f876Bf",
};
export const DESK = "0x0Cc07121b250aDFCeE36347602c8F77Dd8c34A57";
export const WETH = "0x4200000000000000000000000000000000000006";
export const NOBODY = "0x1111111111111111111111111111111111111111"; // no Bankr launches (0x…01 has test tokens)

export const ROUTES = ["/", "/apply", "/board", "/notes", "/desk", "/dine", "/dine/1", "/loans/1"] as const;
/** Main nav labels, in order. */
export const NAV = ["Loan book", "Borrow", "Credit lines", "Lend", "Follow the Desk", "Dine", "Demo", "Evidence"];
/** Headline per route, so a route test knows the page really rendered. */
export const H1: Record<string, RegExp> = {
  "/": /Borrow USDC against your token/,
  "/apply": /Apply for credit/,
  "/board": /credit/i,
  "/notes": /Lend through FeeNotes/,
  "/desk": /Follow the Desk/,
  "/dine": /Dine on your fees/,
  "/dine/1": /Dine on .* fees/,
  "/loans/1": /loan #1/,
};

/** Abort every call to the agent: the page must show its designed offline state. */
export const agentOffline = (page: Page) => page.route(`${AGENT}/**`, (r) => r.abort("connectionrefused"));

/** Serve a canned JSON response for one agent path (glob after the agent origin). */
export const mockAgent = (page: Page, path: string, body: unknown, status = 200) =>
  page.route(`${AGENT}${path}`, (r) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }));

export async function noHorizontalOverflow(page: Page) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(o.sw, `page scrollWidth ${o.sw} > viewport ${o.cw}`).toBeLessThanOrEqual(o.cw);
}

/** Wait until no skeleton (aria-busy loading block) is left on the page. */
export async function settled(page: Page) {
  await expect(page.locator("div[aria-busy=true]")).toHaveCount(0, { timeout: 30_000 });
}

type Fx = { allowConsoleErrors: boolean; consoleErrors: string[]; webUpstream: void };

/**
 * Every test fails on console errors / uncaught page errors unless it opts out with
 * test.use({ allowConsoleErrors: true }) (offline tests expect failed fetches).
 */
export const test = base.extend<Fx>({
  allowConsoleErrors: [false, { option: true }],
  consoleErrors: [
    async ({ page, allowConsoleErrors }, use) => {
      const errs: string[] = [];
      // Dynamic's SDK API rate-limits nonce prefetches (429 without CORS headers) during long runs: third-party noise, not ours.
      const dynamicNoise = (m: import("@playwright/test").ConsoleMessage) =>
        /dynamicauth\.com/.test(m.location().url + m.text()) || /Failed to prefetch nonces/.test(m.text());
      page.on("console", (m) => m.type() === "error" && !dynamicNoise(m) && errs.push(`console: ${m.text().slice(0, 300)}`));
      page.on("pageerror", (e) => errs.push(`pageerror: ${e.message.slice(0, 300)}`));
      await use(errs);
      if (!allowConsoleErrors) expect(errs, "console errors on the page").toEqual([]);
    },
    { auto: true },
  ],
  // WEB_UPSTREAM=http://localhost:3001: the browser still sees baseURL (so the agent's CORS allowlist matches) while
  // every document/asset is served by the upstream build. For when :3000 is taken by a server you must not stop.
  webUpstream: [
    async ({ page, baseURL }, use) => {
      const up = process.env.WEB_UPSTREAM?.replace(/\/$/, "");
      const origin = baseURL?.replace(/\/$/, "");
      if (up && origin)
        await page.route(`${origin}/**`, async (r) => {
          const res = await r.fetch({ url: up + r.request().url().slice(origin.length), maxRedirects: 0 }).catch(() => null);
          if (!res) return r.abort().catch(() => {}); // page closed mid-fetch
          const loc = res.headers()["location"];
          // A fulfilled 3xx is followed without re-entering this handler, so the target would come from `origin` itself.
          if (loc && r.request().isNavigationRequest())
            return r.fulfill({ contentType: "text/html", body: `<script>location.replace(${JSON.stringify(loc)})</script>` }).catch(() => {});
          await r.fulfill({ response: res }).catch(() => {}); // "response disposed" when the page navigated away
        });
      await use();
    },
    { auto: true },
  ],
});
export { expect };

/** Id of a funded loan (has a vault + auction: ACTIVE/RELEASED/AUCTION) on the current fork, or null. Env LOAN_ID wins. */
export async function fundedLoanId(): Promise<number | null> {
  if (process.env.LOAN_ID) return Number(process.env.LOAN_ID);
  const loans = (await (await fetch(`${AGENT}/api/loans`)).json()) as { id: number; status: string; vault: string | null; auction: string | null }[];
  const l = loans.find((x) => x.vault && x.auction && ["ACTIVE", "RELEASED", "AUCTION"].includes(x.status));
  return l?.id ?? null;
}
export const NO_FUNDED = "no funded loan (vault + auction) on this fork: run the fork flow (E2E_FORK_FLOW=1) or set LOAN_ID";

/** Absolute URL of a web path for the `request` fixture (which page.route does not see): the upstream build when set. */
export const webUrl = (baseURL: string | undefined, path: string) => (process.env.WEB_UPSTREAM ?? baseURL ?? "").replace(/\/$/, "") + path;
