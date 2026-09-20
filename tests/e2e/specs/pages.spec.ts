// Pages added for the submission: /evidence, /demo, /signals/[id] (+ OG image), /dine/r/[id].
import { test, expect, AGENT, settled, noHorizontalOverflow, webUrl } from "../fixtures";

test.describe("/evidence", () => {
  test("mainnet table: every tx links to Basescan with a full 66-char hash @smoke", async ({ page }) => {
    const res = await page.goto("/evidence");
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Evidence");
    const table = page.locator("section.card").filter({ hasText: "Base mainnet transactions" });
    const rows = table.locator("tbody tr");
    expect(await rows.count()).toBeGreaterThanOrEqual(5);
    const txs = table.locator('a[href*="basescan.org/tx/"]');
    // one tx link per row at least, and the Flash row also links its approval tx
    expect(await txs.count()).toBeGreaterThanOrEqual(5);
    for (const a of await txs.all()) {
      const href = (await a.getAttribute("href"))!;
      expect(href).toMatch(/^https:\/\/basescan\.org\/tx\/0x[0-9a-f]{64}$/);
      expect(await a.getAttribute("title"), href).toBe(href.split("/tx/")[1]); // full hash on hover
      expect(await a.getAttribute("target")).toBe("_blank");
      expect(await a.getAttribute("rel")).toMatch(/noreferrer|noopener/);
    }
    // Every row is evidence: either a Basescan tx or, for an off-chain event (e.g. the Dynamic
    // delegation grant/revoke, which has no tx), a stated "why it matters".
    for (const row of await rows.all()) {
      const tx = row.locator('a[href*="basescan.org/tx/"]').first();
      if (await tx.count()) await expect(tx).toBeVisible();
      else await expect(row.locator("td").nth(2)).not.toBeEmpty();
    }
    // Honest split: what is mainnet, fork, or code only.
    const split = page.locator("section.card").filter({ hasText: "Live vs simulated" });
    for (const w of ["Base mainnet", "Fork", "Code only"]) await expect(split.getByText(w, { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "demo video" })).toHaveAttribute("href", "/demo");
    await expect(page.getByRole("navigation", { name: "Main" }).locator("[aria-current=page]")).toHaveText("Evidence");
    await noHorizontalOverflow(page);
  });

  test("the agent wallet is shown in full and linked", async ({ page }) => {
    await page.goto("/evidence");
    const a = page.locator('a[href$="/address/0x81b73786BF2dE819e66BB57d08effADe0085305D"]').filter({ hasText: /^0x[0-9a-fA-F]{40}$/ });
    await expect(a).toBeVisible();
  });
});

test.describe("/demo", () => {
  test("video with poster; the caption's duration matches the file @smoke", async ({ page }) => {
    await page.goto("/demo");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Demo");
    const v = page.locator("video");
    await expect(v).toHaveAttribute("src", "/gadai-demo.mp4");
    await expect(v).toHaveAttribute("poster", "/gadai-demo-poster.jpg");
    await expect(v).toHaveAttribute("controls", "");
    // The caption's duration is checked against the file itself, so replacing the MP4 without
    // re-probing fails here instead of shipping a wrong number.
    await expect(page.locator("figcaption")).toContainText(/\b\d+:\d{2}\b/);
    const secs = await v.evaluate(
      (el: HTMLVideoElement) => new Promise<number>((ok) => (el.readyState >= 1 ? ok(el.duration) : el.addEventListener("loadedmetadata", () => ok(el.duration), { once: true }))),
    );
    const mmss = `${Math.floor(Math.round(secs) / 60)}:${String(Math.round(secs) % 60).padStart(2, "0")}`;
    await expect(page.locator("figcaption"), `MP4 is ${mmss} (${Math.round(secs)}s)`).toContainText(mmss);
    await expect(page.getByRole("link", { name: "Download the MP4" })).toHaveAttribute("href", "/gadai-demo.mp4");
    await expect(page.getByRole("link", { name: "Watch on YouTube" })).toHaveAttribute("href", "https://youtu.be/F7joLyWWB0E");
    for (const h of ["/evidence", "/board", "/desk", "/dine"]) await expect(page.getByRole("main").locator(`a[href="${h}"]`)).toBeVisible();
  });

  test("poster and MP4 are served", async ({ request, baseURL }) => {
    const poster = await request.get(webUrl(baseURL, "/gadai-demo-poster.jpg"));
    expect(poster.status()).toBe(200);
    expect(poster.headers()["content-type"]).toMatch(/image\/jpeg/);
    const mp4 = await request.head(webUrl(baseURL, "/gadai-demo.mp4"));
    expect(mp4.status()).toBe(200);
    expect(mp4.headers()["content-type"]).toMatch(/video\/mp4/);
  });
});

test.describe("/signals/[id]", () => {
  test("/signals/1 renders the live card with share metadata @smoke", async ({ page }) => {
    const res = await page.goto("/signals/1");
    expect(res?.status()).toBe(200);
    await settled(page);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("body")).toContainText(/GITLAWB/);
    await expect(page).toHaveTitle(/(approves|declines) \$\w+/);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /\/signals\/1\/opengraph-image/);
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
    await noHorizontalOverflow(page);
  });

  test("/signals/1 OG image is a PNG @smoke", async ({ request, baseURL }) => {
    const r = await request.get(webUrl(baseURL, "/signals/1/opengraph-image"), { timeout: 60_000 });
    expect(r.status()).toBe(200);
    expect(r.headers()["content-type"]).toBe("image/png");
    const b = await r.body();
    expect(b.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  });

  test("/signals/999999 says there is no such signal", async ({ page }) => {
    await page.goto("/signals/999999");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("No signal #999999");
    await expect(page.getByRole("link", { name: /See the underwriters/ })).toHaveAttribute("href", "/desk");
  });
});

test.describe("/dine/r/[id]", () => {
  test("a Blackbird venue page shows hours and offers", async ({ page, request }) => {
    test.setTimeout(120_000);
    const l = await (await request.get(`${AGENT}/api/flynet/restaurants?page=0`, { timeout: 90_000 })).json();
    const id = l.places[0].id as string;
    await page.goto(`/dine/r/${id}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(l.places[0].name, { timeout: 90_000 });
    await expect(page.getByRole("heading", { name: "Opening hours" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Specials & challenges" })).toBeVisible();
    await expect(page.getByRole("link", { name: "All Blackbird venues" })).toHaveAttribute("href", "/dine");
  });

  test.describe("bad id", () => {
    test.use({ allowConsoleErrors: true }); // the 404 document load is logged by the browser
    test("/dine/r/not-a-uuid is a 404", async ({ page }) => {
      await page.goto("/dine/r/not-a-uuid");
      await expect(page.getByText(/could not be found|not found/i).first()).toBeVisible();
    });
  });
});
