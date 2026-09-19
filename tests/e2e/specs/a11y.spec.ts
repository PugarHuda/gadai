// Accessibility basics: axe (WCAG 2.1 A/AA) on every route, keyboard reachability and visible focus.
import AxeBuilder from "@axe-core/playwright";
import { test, expect, ROUTES, NAV, settled } from "../fixtures";

for (const r of ROUTES) {
  test(`axe: ${r} has no serious/critical WCAG A/AA violations`, async ({ page }) => {
    await page.goto(r);
    await settled(page);
    const res = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .exclude("#dynamic-widget") // third-party Dynamic widget (shadow DOM), not our markup
      .analyze();
    const bad = res.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    const report = bad.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
    expect(report, report.join("\n")).toEqual([]);
  });
}

test("keyboard: Tab reaches the brand link and main nav first, with a visible focus ring", async ({ page }) => {
  await page.goto("/");
  const seen: string[] = [];
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("Tab");
    const f = await page.evaluate(() => {
      let el = document.activeElement as HTMLElement | null;
      while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement as HTMLElement; // e.g. the Dynamic widget
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const ring = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== "none");
      return { label: (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 40), ring };
    });
    if (!f) continue;
    seen.push(f.label);
    expect(f.ring, `no visible focus indicator on "${f.label}"`).toBeTruthy();
  }
  // the skip link comes first (tested below), then the brand link
  expect(seen.filter((s) => !/^Skip to content$/.test(s))[0]).toMatch(/Gadai/);
  for (const l of NAV) expect(seen).toContain(l);
});

test("keyboard: a skip link lets keyboard users jump past the header", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const first = await page.evaluate(() => (document.activeElement?.textContent ?? "").trim());
  expect(first).toMatch(/skip/i);
});

test("keyboard: Enter on a focused nav link navigates", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Lend" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/notes$/);
});

test("keyboard: leaderboard filter works with Space/Enter", async ({ page }) => {
  await page.goto("/desk");
  await settled(page);
  const prudent = page.getByRole("button", { name: /Prudent/ }).first();
  await prudent.focus();
  await page.keyboard.press("Enter");
  await expect(prudent).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Space");
  await expect(prudent).toHaveAttribute("aria-pressed", "false");
});

test("html lang, one h1 per page, landmarks", async ({ page }) => {
  for (const r of ROUTES) {
    await page.goto(r);
    await settled(page);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { level: 1 }), r).toHaveCount(1);
    await expect(page.getByRole("main"), r).toHaveCount(1);
    await expect(page.getByRole("contentinfo"), r).toHaveCount(1);
  }
});
