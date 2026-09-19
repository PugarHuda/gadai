// Loading / empty / offline / error states. The agent is simulated offline by aborting every request to it,
// and empty/error data is served with page.route, so the live fork state is never touched.
import { test, expect, AGENT, ROUTES, H1, agentOffline, mockAgent, settled, noHorizontalOverflow } from "../fixtures";

test.describe("agent offline", () => {
  test.use({ allowConsoleErrors: true }); // aborted fetches are logged by the browser

  for (const r of ROUTES) {
    test(`${r} shows the designed offline state, never a raw fetch error @smoke`, async ({ page }) => {
      await agentOffline(page);
      await page.goto(r);
      // /loans/1 has no heading while offline; that has its own test below.
      if (r !== "/loans/1") await expect(page.getByRole("heading", { level: 1 })).toHaveText(H1[r]);
      if (r === "/apply") {
        // The form needs no agent until you quote; it must still render and stay usable.
        await expect(page.getByRole("button", { name: "Get quote" })).toBeEnabled();
        return;
      }
      if (r === "/dine") {
        // Logged out: no agent call is made; the login empty state shows instead.
        await expect(page.getByText("Log in to open your dining line")).toBeVisible();
        return;
      }
      const off = page.getByRole("status").filter({ hasText: "The Gadai agent is offline" }).first();
      await expect(off).toBeVisible();
      await expect(off.getByRole("button", { name: "Try again" })).toBeVisible();
      const body = await page.locator("body").innerText();
      expect(body).not.toMatch(/Failed to fetch|TypeError|NetworkError|ERR_|Agent unreachable at/);
      await noHorizontalOverflow(page);
    });
  }

  test("/loans/1 offline keeps a heading and a way back", async ({ page }) => {
    await agentOffline(page);
    await page.goto("/loans/1");
    await expect(page.getByRole("status").filter({ hasText: "offline" }).first()).toBeVisible();
    // A page with only an offline box and no h1 is disorienting; the loan page should still say which loan it is.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("Try again recovers once the agent is back", async ({ page }) => {
    await agentOffline(page);
    await page.goto("/");
    const off = page.getByRole("status").filter({ hasText: "The Gadai agent is offline" });
    await expect(off.first()).toBeVisible();
    await page.unroute(`${AGENT}/**`);
    // Each retry re-renders its box, so click the first remaining one until none are left.
    await expect(async () => {
      const retry = page.getByRole("button", { name: "Try again" });
      if (await retry.count()) await retry.first().click({ timeout: 2_000 });
      await expect(off).toHaveCount(0, { timeout: 1_500 });
    }).toPass({ timeout: 30_000 });
    await expect(page.getByRole("link", { name: "1", exact: true })).toBeVisible();
  });

  test("/apply offline: Get quote shows the offline message, not a stack", async ({ page }) => {
    await agentOffline(page);
    await page.goto("/apply");
    await page.getByRole("button", { name: /fork demo: quote the GITLAWB test pool/ }).click();
    await page.getByRole("button", { name: "Get quote" }).click();
    await expect(page.locator("p[role=alert]").filter({ hasText: "The Gadai agent is offline" }).first()).toBeVisible();
  });

  test("a gateway 502/503 with no agent JSON is treated as offline", async ({ page }) => {
    await page.route(`${AGENT}/**`, (r) => r.fulfill({ status: 503, contentType: "text/html", body: "<html>Bad gateway</html>" }));
    await page.goto("/");
    await expect(page.getByRole("status").filter({ hasText: "The Gadai agent is offline" }).first()).toBeVisible();
  });

  test("the agent's own JSON 503 shows its reason (e.g. a missing key)", async ({ page }) => {
    await page.route(`${AGENT}/**`, (r) => r.fulfill({ status: 503, contentType: "application/json", body: '{"error":"Missing env UNISWAP_API_KEY (see .env.example)"}' }));
    await page.goto("/");
    await expect(page.locator("p[role=alert]").filter({ hasText: "Missing env UNISWAP_API_KEY" }).first()).toBeVisible();
  });
});

test.describe("loading", () => {
  test("home shows skeletons with an accessible Loading label while the agent is slow", async ({ page }) => {
    await page.route(`${AGENT}/**`, async (r) => {
      await new Promise((x) => setTimeout(x, 2_500));
      await r.continue();
    });
    await page.goto("/");
    const busy = page.locator("div[aria-busy=true]").first();
    await expect(busy).toBeVisible();
    await expect(busy.getByText("Loading")).toHaveCount(1);
    await settled(page);
  });
});

test.describe("empty", () => {
  test("home: empty loan book", async ({ page }) => {
    await mockAgent(page, "/api/loans", []);
    await page.goto("/");
    await expect(page.getByText("No loans on the book yet")).toBeVisible();
    await expect(page.getByRole("link", { name: "Apply for a loan" }).last()).toHaveAttribute("href", "/apply");
    await expect(page.getByText("Loans written")).toBeVisible();
  });

  test("notes: no auctions live", async ({ page }) => {
    await mockAgent(page, "/api/loans?status=AUCTION", []);
    await page.goto("/notes");
    await expect(page.getByText("No auctions live right now")).toBeVisible();
    await expect(page.getByText("Log in to see your notes")).toBeVisible();
  });

  test("desk: empty leaderboard and signals", async ({ page }) => {
    await mockAgent(page, "/api/leaderboard", []);
    await mockAgent(page, "/api/signals?*", []);
    await page.goto("/desk");
    await expect(page.getByText("No underwriters ranked yet")).toBeVisible();
    await expect(page.getByText("No signals yet")).toBeVisible();
    await expect(page.getByRole("combobox")).toContainText("Underwriters load from the agent");
  });

  test("loan page: no events / signals / memos", async ({ page }) => {
    const real = await (await page.request.get(`${AGENT}/api/loans/1`)).json();
    await mockAgent(page, "/api/loans/1", { ...real, events: [], signals: [], memos: [] });
    await page.goto("/loans/1");
    await expect(page.getByText("No events recorded yet.")).toBeVisible();
    await expect(page.getByText("No underwriter signals on this loan yet.")).toBeVisible();
    await expect(page.getByText("No credit memos written yet.")).toBeVisible();
  });
});

test.describe("errors", () => {
  test.use({ allowConsoleErrors: true }); // the browser logs every 4xx/5xx fetch as "Failed to load resource"
  test("home: agent 500 shows its error message in an alert", async ({ page }) => {
    await mockAgent(page, "/api/loans", { error: "database is locked" }, 500);
    await page.goto("/");
    await expect(page.locator("p[role=alert]").filter({ hasText: "database is locked" })).toBeVisible();
  });

  test("home: non-JSON 500 body is shown as a readable message", async ({ page }) => {
    await page.route(`${AGENT}/api/loans`, (r) => r.fulfill({ status: 500, contentType: "text/html", body: "<html>boom</html>" }));
    await page.goto("/");
    await expect(page.locator("p[role=alert]").first()).toContainText("500");
  });

  test("/loans/999999 unknown loan says not found", async ({ page }) => {
    await page.goto("/loans/999999");
    await expect(page.locator("p[role=alert]")).toContainText("loan 999999 not found");
  });

  test("/loans/abc malformed id is a friendly error", async ({ page }) => {
    await page.goto("/loans/abc");
    await expect(page.locator("p[role=alert]")).toContainText(/positive integer|not found/);
  });

  test("/dine/999999 unknown loan says not found", async ({ page }) => {
    await page.goto("/dine/999999");
    await expect(page.locator("p[role=alert]")).toContainText(/not found/);
  });

  test("unknown loan pages keep a heading (not a bare error box)", async ({ page }) => {
    await page.goto("/loans/999999");
    await expect(page.locator("p[role=alert]")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("/dine/abc does not show 'loan NaN'", async ({ page }) => {
    await page.goto("/dine/abc");
    await expect(page.locator("p[role=alert]").first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText("NaN");
  });

  test("notes: one broken auction does not blank the others", async ({ page }) => {
    const loan1 = await (await page.request.get(`${AGENT}/api/loans/1`)).json();
    await mockAgent(page, "/api/loans?status=AUCTION", [{ ...loan1, status: "AUCTION" }]);
    await mockAgent(page, "/api/loans/1/auction", { error: "rpc timeout" }, 500);
    await page.goto("/notes");
    await expect(page.getByText("rpc timeout")).toBeVisible();
    await expect(page.getByRole("link", { name: "Bid" })).toHaveAttribute("href", "/loans/1");
  });
});
