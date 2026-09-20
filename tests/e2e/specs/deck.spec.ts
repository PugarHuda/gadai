// /deck: the 12-slide pitch deck. One slide at a time, keyboard/arrow/button nav, #id deep links, mobile.
import { test, expect, noHorizontalOverflow } from "../fixtures";

const SLIDES = 12;
const FIRST = "title";
const LAST = "scope";
const counter = (page: import("../fixtures").Page) => page.getByText(new RegExp(`^\\d\\d / ${SLIDES}$`));

test.describe("/deck", () => {
  test("renders slide 1 of 12 with the deck nav @smoke", async ({ page }) => {
    const res = await page.goto("/deck");
    expect(res?.status()).toBe(200);
    await expect(counter(page)).toHaveText(`01 / ${SLIDES}`);
    await expect(page.getByRole("heading", { name: "Gadai", exact: true })).toBeVisible();
    // the deck writes the slide id into the hash so a slide can be linked
    await expect(page).toHaveURL(new RegExp(`/deck#${FIRST}$`));
    const deckNav = page.getByRole("navigation", { name: "Slides" });
    await expect(deckNav.getByRole("button", { name: "Previous slide" })).toBeDisabled();
    await expect(deckNav.getByRole("button", { name: "Next slide" })).toBeEnabled();
    await expect(deckNav.getByRole("link", { name: "Download the video" })).toHaveAttribute("href", "/demo");
    await expect(page.getByRole("navigation", { name: "Main" }).locator("[aria-current=page]")).toHaveText("Deck");
  });

  test("arrow keys, Home and End move through the deck @smoke", async ({ page }) => {
    await page.goto("/deck");
    await expect(counter(page)).toHaveText(`01 / ${SLIDES}`);

    await page.keyboard.press("ArrowRight");
    await expect(counter(page)).toHaveText(`02 / ${SLIDES}`);
    await expect(page).toHaveURL(/#problem$/);

    await page.keyboard.press("ArrowDown"); // same as ArrowRight
    await expect(counter(page)).toHaveText(`03 / ${SLIDES}`);

    await page.keyboard.press("ArrowLeft");
    await expect(counter(page)).toHaveText(`02 / ${SLIDES}`);

    await page.keyboard.press("End");
    await expect(counter(page)).toHaveText(`${SLIDES} / ${SLIDES}`);
    await expect(page).toHaveURL(new RegExp(`#${LAST}$`));
    await expect(page.getByRole("button", { name: "Next slide" })).toBeDisabled();

    await page.keyboard.press("Home");
    await expect(counter(page)).toHaveText(`01 / ${SLIDES}`);
    await expect(page.getByRole("button", { name: "Previous slide" })).toBeDisabled();
  });

  test("the next/previous buttons move a slide", async ({ page }) => {
    await page.goto("/deck");
    await page.getByRole("button", { name: "Next slide" }).click();
    await expect(counter(page)).toHaveText(`02 / ${SLIDES}`);
    await page.getByRole("button", { name: "Previous slide" }).click();
    await expect(counter(page)).toHaveText(`01 / ${SLIDES}`);
  });

  // A judge is sent straight to a slide: /deck#board, /deck#evidence.
  for (const [hash, n, heading] of [
    ["board", "07", "Credit Line Board"],
    ["evidence", "11", "Mainnet evidence"],
  ] as const) {
    test(`/deck#${hash} opens that slide @smoke`, async ({ page }) => {
      await page.goto(`/deck#${hash}`);
      await expect(counter(page)).toHaveText(`${n} / ${SLIDES}`);
      await expect(page.getByText(heading, { exact: true }).first()).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`#${hash}$`));
    });
  }

  test("an unknown #hash falls back to slide 1", async ({ page }) => {
    await page.goto("/deck#not-a-slide");
    await expect(counter(page)).toHaveText(`01 / ${SLIDES}`);
  });

  test("every slide renders with no overflow, on desktop and mobile @smoke", async ({ page }) => {
    for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(vp);
      await page.goto("/deck");
      for (let i = 1; i <= SLIDES; i++) {
        await expect(counter(page)).toHaveText(`${String(i).padStart(2, "0")} / ${SLIDES}`);
        // the slide body is never empty
        await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
        await noHorizontalOverflow(page);
        if (i < SLIDES) await page.keyboard.press("ArrowRight");
      }
    }
  });
});
