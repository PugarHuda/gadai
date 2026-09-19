// Every route renders its real content against the live DEMO_FORK agent, with no console errors,
// the DEMO_FORK banner, well-formed outbound links, and no horizontal overflow (desktop + 390x844).
import { test, expect, ROUTES, H1, NAV, noHorizontalOverflow, settled } from "../fixtures";

const BASESCAN = /^https:\/\/basescan\.org\/(address\/0x[0-9a-fA-F]{40}|tx\/0x[0-9a-fA-F]{64})$/;

for (const vp of [
  { name: "desktop", viewport: { width: 1280, height: 800 } },
  { name: "mobile", viewport: { width: 390, height: 844 } },
]) {
  test.describe(`routes @ ${vp.name}`, () => {
    test.use({ viewport: vp.viewport });

    for (const r of ROUTES) {
      test(`${r} renders with banner, links and no overflow @smoke`, async ({ page }) => {
        const res = await page.goto(r);
        expect(res?.status()).toBe(200);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(H1[r]);
        await settled(page);

        // DEMO_FORK banner: visible, names the fork RPC, and states the Flash limit.
        const banner = page.getByRole("note").filter({ hasText: "Demo fork" });
        await expect(banner).toBeVisible();
        await expect(banner).toContainText("Anvil fork of Base");
        await expect(banner).toContainText("Flash orders are mainnet only");

        // Main nav: every section, one aria-current (loan pages are covered in controls.spec).
        const nav = page.getByRole("navigation", { name: "Main" });
        await expect(nav.getByRole("link")).toHaveText(NAV);
        if (!r.startsWith("/loans")) await expect(nav.locator("[aria-current=page]")).toHaveCount(1);

        // Outbound links well-formed and safe.
        for (const a of await page.locator('a[href^="http"]').all()) {
          const href = (await a.getAttribute("href"))!;
          if (href.includes("basescan")) expect(href).toMatch(BASESCAN);
          if (href.includes("github.com")) expect(href).toMatch(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+/);
          expect(await a.getAttribute("target"), href).toBe("_blank");
          expect(await a.getAttribute("rel"), href).toMatch(/noreferrer|noopener/);
        }
        // In DEMO_FORK no tx link may point at Basescan (fork txs don't exist there).
        await expect(page.locator('a[href*="basescan.org/tx/"]')).toHaveCount(0);

        await noHorizontalOverflow(page);
      });
    }
  });
}

test("redirect /leaderboard → /desk @smoke", async ({ page }) => {
  await page.goto("/leaderboard");
  await expect(page).toHaveURL(/\/desk$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Follow the Desk/);
});

test("redirect /loan/1 → /loans/1 @smoke", async ({ page }) => {
  await page.goto("/loan/1");
  await expect(page).toHaveURL(/\/loans\/1$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("loan #1");
});

test("redirects are temporary (307), not cached 308s", async ({ request }) => {
  for (const [from, to] of [["/leaderboard", "/desk"], ["/loan/7", "/loans/7"]]) {
    const r = await request.get(from, { maxRedirects: 0 });
    expect(r.status()).toBe(307);
    expect(r.headers()["location"]).toBe(to);
  }
});

test.describe("404", () => {
  test.use({ allowConsoleErrors: true }); // the browser logs the 404 document load itself
  test("unknown route returns 404 with a way back @smoke", async ({ page }) => {
    const res = await page.goto("/definitely-not-a-page");
    expect(res?.status()).toBe(404);
    await expect(page.getByText(/could not be found|not found/i).first()).toBeVisible();
    // The site chrome (nav) stays so the user can get back.
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    await expect(page.getByRole("link", { name: /loan book/i }).first()).toBeVisible();
  });
});

test("document title and meta description are set @smoke", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Gadai/);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /USDC loans/);
});

test("pages have distinct titles", async ({ page }) => {
  const titles = new Set<string>();
  for (const r of ["/", "/apply", "/board", "/notes", "/desk"]) {
    await page.goto(r);
    titles.add(await page.title());
  }
  expect(titles.size, `titles: ${[...titles].join(" | ")}`).toBe(5);
});
