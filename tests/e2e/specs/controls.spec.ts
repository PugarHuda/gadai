// Every visible control on every route, logged out, against the live DEMO_FORK agent.
// Signing flows need a Dynamic login (email OTP), so they are covered up to the login prompt.
import { test, expect, AGENT, NOBODY, POOL, WETH, settled, fundedLoanId, NO_FUNDED, type Page } from "../fixtures";

const authOpened = (page: Page) => expect(page.locator('input[type="email"], input[name="email"]').first()).toBeVisible({ timeout: 15_000 });

test.describe("home /", () => {
  test("hero CTAs and loan row navigate @smoke", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Apply for a loan" }).first()).toHaveAttribute("href", "/apply");
    await expect(page.getByRole("link", { name: "Fund a FeeNote" })).toHaveAttribute("href", "/notes");
    await settled(page);
    await page.getByRole("link", { name: "1", exact: true }).click();
    await expect(page).toHaveURL(/\/loans\/1$/);
  });

  test("desk registration card lists desk, agent wallet, treasury and 3 underwriters", async ({ page }) => {
    await page.goto("/");
    const card = page.locator("section.card").filter({ hasText: "Desk registration" });
    await expect(card).toContainText("8453");
    // DEMO_FORK: the desk exists only on the fork, so it is shown (with a "fork" tag) but never linked to Basescan
    await expect(card.getByText(/0x0Cc0…4A57/)).toBeVisible();
    await expect(card).toContainText("Dynamic");
    await expect(card).toContainText(/Prudent .*Momentum .*Skeptic/);
    await expect(card.getByText("fork", { exact: true }).first()).toBeVisible();
  });

  test("stats strip matches the agent's loan list", async ({ page, request }) => {
    const loans = (await (await request.get(`${AGENT}/api/loans`)).json()) as { status: string }[];
    await page.goto("/");
    await settled(page);
    const released = loans.filter((l) => l.status === "RELEASED").length;
    const stat = page.locator("div").filter({ has: page.locator(".label", { hasText: /^Released$/ }) }).last();
    await expect(stat.locator(".num")).toHaveText(String(released));
  });

  test("Refresh reloads the loan book", async ({ page }) => {
    await page.goto("/");
    await settled(page);
    const req = page.waitForRequest((r) => r.url() === `${AGENT}/api/loans`);
    await page.getByRole("button", { name: "Refresh" }).click();
    await req;
  });

  test("lifecycle explains all five stages", async ({ page }) => {
    await page.goto("/");
    const steps = page.getByRole("region", { name: "How a loan moves" }).getByRole("listitem");
    await expect(steps).toHaveCount(5);
    await expect(steps).toContainText(["Pledge", "Auction", "Disburse", "Repay", "Release"]);
  });

  test("DynamicWidget login opens the Dynamic auth flow", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Log in or sign up/i }).click();
    await authOpened(page);
  });
});

test.describe("/apply", () => {
  test("Get quote validates the token and beneficiary before calling the agent", async ({ page }) => {
    await page.goto("/apply");
    await page.getByRole("button", { name: "Get quote" }).click();
    await expect(page.locator("p[role=alert]")).toHaveText("Enter the token address (0x…)");
    await page.getByPlaceholder("0x…", { exact: true }).fill(POOL.token);
    await page.getByRole("button", { name: "Get quote" }).click();
    await expect(page.locator("p[role=alert]")).toHaveText("Enter the beneficiary wallet (0x…)");
  });

  test("inputs have accessible labels", async ({ page }) => {
    await page.goto("/apply");
    await expect(page.getByLabel("Fee beneficiary wallet")).toBeVisible();
    await expect(page.getByLabel("Token (Base, Doppler)")).toBeVisible();
  });

  test("fork demo button fills the GITLAWB pool; quote renders terms, chart and formula @smoke", async ({ page }) => {
    await page.goto("/apply");
    await page.getByRole("button", { name: /fork demo: quote the GITLAWB test pool/ }).click();
    await expect(page.getByLabel("Fee beneficiary wallet")).toHaveValue(new RegExp(POOL.beneficiary, "i"));
    await expect(page.getByLabel("Token (Base, Doppler)")).toHaveValue(new RegExp(POOL.token, "i"));
    await page.getByRole("button", { name: "Get quote" }).click();
    const q = page.locator("section.card").filter({ hasText: "2. Quote" });
    await expect(q).toBeVisible({ timeout: 60_000 });
    await expect(q.getByRole("heading", { name: "$GITLAWB" })).toBeVisible();
    await expect(q).toContainText("30d fees");
    await page.getByText("How this quote was priced").click();
    await expect(q.locator("pre")).toContainText("WETH/day");
    // Eligible → apply button (logged out: log in first); it opens Dynamic.
    const eligible = await q.getByText("approve", { exact: true }).isVisible();
    if (eligible) {
      await expect(q).toContainText("max principal");
      await page.getByRole("button", { name: "Log in to apply" }).click();
      await authOpened(page);
    } else {
      await expect(q.locator("ul li").first()).toBeVisible();
    }
  });

  test("creator-token chips appear for a beneficiary and pick the token", async ({ page }) => {
    await page.goto("/apply");
    await page.getByLabel("Fee beneficiary wallet").fill(POOL.beneficiary);
    const chips = page.locator("button").filter({ hasText: /share .*% · claimable/ });
    await expect(chips.first()).toBeVisible({ timeout: 60_000 });
    await chips.first().click();
    await expect(page.getByLabel("Token (Base, Doppler)")).not.toHaveValue("");
    // Selection must not be conveyed by colour alone (PRODUCT.md a11y): the picked chip says so.
    await expect(chips.first()).toHaveAttribute("aria-pressed", "true");
  });

  test("a wallet with no Doppler tokens says so", async ({ page }) => {
    await page.goto("/apply");
    await page.getByLabel("Fee beneficiary wallet").fill(NOBODY);
    await expect(page.getByText("No Base Doppler tokens with this wallet as beneficiary.")).toBeVisible({ timeout: 60_000 });
  });

  test("non-beneficiary quote is declined with reasons", async ({ page }) => {
    await page.goto("/apply");
    await page.getByLabel("Fee beneficiary wallet").fill(NOBODY);
    await page.getByLabel("Token (Base, Doppler)").fill(POOL.token);
    await page.getByRole("button", { name: "Get quote" }).click();
    const q = page.locator("section.card").filter({ hasText: "2. Quote" });
    await expect(q.getByText("decline", { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(q.locator("ul li").first()).toContainText(/beneficiary/);
    await expect(page.getByRole("button", { name: /apply/i })).toHaveCount(0);
  });

  test.describe("ineligible token", () => {
    test.use({ allowConsoleErrors: true });
    test("a non-Doppler token (WETH) is declined with a reason, not an internal error", async ({ page }) => {
      await page.goto("/apply");
      await page.getByLabel("Fee beneficiary wallet").fill(POOL.beneficiary);
      await page.getByLabel("Token (Base, Doppler)").fill(WETH);
      await page.getByRole("button", { name: "Get quote" }).click();
      await expect(page.getByText(/not a Base Doppler token/)).toBeVisible({ timeout: 60_000 });
      await expect(page.locator("body")).not.toContainText("internal error");
    });
  });
});

test.describe("/notes", () => {
  test("refresh, empty auctions and login prompt", async ({ page }) => {
    await page.goto("/notes");
    await settled(page);
    const req = page.waitForRequest((r) => r.url().startsWith(`${AGENT}/api/loans?status=AUCTION`));
    await page.getByRole("button", { name: "refresh" }).click();
    await req;
    await expect(page.getByRole("main").getByRole("link", { name: "loan book" })).toHaveAttribute("href", "/");
    await page.getByRole("button", { name: "Log in with Dynamic" }).click();
    await authOpened(page);
  });
});

test.describe("/desk", () => {
  test("DEMO_FORK Flash notice is shown @smoke", async ({ page }) => {
    await page.goto("/desk");
    await expect(page.getByText(/Flash: mainnet only\. This is a DEMO_FORK build/)).toBeVisible();
  });

  test("leaderboard filter toggles the signal feed", async ({ page }) => {
    await page.goto("/desk");
    await settled(page);
    const prudent = page.getByRole("button", { name: /Prudent/ }).first();
    await expect(prudent).toHaveAttribute("aria-pressed", "false");
    const req = page.waitForRequest((r) => r.url().includes("/api/signals") && r.url().includes("personaId=prudent"));
    await prudent.click();
    await req;
    await expect(prudent).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("heading", { name: "Signals · Prudent" })).toBeVisible();
    await page.getByRole("button", { name: "all", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Signal feed" })).toBeVisible();
    await expect(prudent).toHaveAttribute("aria-pressed", "false");
  });

  test("leaderboard 'follow' link jumps to the form with that underwriter selected", async ({ page }) => {
    await page.goto("/desk");
    await settled(page);
    await page.getByRole("link", { name: "follow", exact: true }).nth(1).click();
    await expect(page).toHaveURL(/#follow$/);
    await expect(page.getByRole("combobox")).toHaveValue("momentum");
  });

  test("follow form: underwriter select, mode toggle, inputs, auto checkbox, login", async ({ page }) => {
    await page.goto("/desk");
    await settled(page);
    const form = page.locator("#follow");
    await form.getByRole("combobox").selectOption("skeptic");
    await expect(form.getByRole("combobox")).toHaveValue("skeptic");
    await expect(form.getByText("take profit +%")).toBeVisible();
    await form.getByRole("button", { name: /DCA/ }).click();
    await expect(form.getByText("DCA days")).toBeVisible();
    await expect(form.getByText("take profit +%")).toHaveCount(0);
    await form.getByRole("button", { name: /Bracket/ }).click();
    await expect(form.getByText("take profit +%")).toBeVisible();
    const auto = form.getByRole("checkbox");
    await auto.check();
    await expect(auto).toBeChecked();
    await form.getByRole("button", { name: "Log in to follow" }).click();
    await authOpened(page);
  });

  test("follow form inputs have accessible names and the mode toggle exposes its state", async ({ page }) => {
    await page.goto("/desk");
    const form = page.locator("#follow");
    await expect(form.getByLabel("underwriter")).toBeVisible();
    await expect(form.getByLabel("USDC per approved signal")).toBeVisible();
    await expect(form.getByRole("button", { name: /Bracket/ })).toHaveAttribute("aria-pressed", "true");
  });

  test("signal rows link to their loan", async ({ page }) => {
    await page.goto("/desk");
    await settled(page);
    const link = page.getByRole("link", { name: /^loan #\d+$/ }).first();
    await expect(link).toHaveAttribute("href", /^\/loans\/\d+$/);
  });
});

test.describe("/dine and /dine/1", () => {
  test("/dine logged out asks for a Dynamic login", async ({ page }) => {
    await page.goto("/dine");
    await page.getByRole("button", { name: "Log in with Dynamic" }).click();
    await authOpened(page);
  });

  test("/dine shows trending venues and the Blackbird venue browser @smoke", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/dine");
    await expect(page.getByRole("heading", { name: /^Trending on Blackbird this week/ })).toBeVisible();
    await expect(page.getByText(/Venues from the latest \d+ network check-ins|No recent check-ins here/)).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(/\d+ venues · page 1 of \d+/)).toBeVisible({ timeout: 90_000 });
    const venue = page.getByRole("link", { name: "Hours & offers" }).first();
    await expect(venue).toHaveAttribute("href", /^\/dine\/r\/[0-9a-f-]{36}$/);
    await expect(page.getByText("Gadai moves no money for dining", { exact: false })).toBeVisible();
  });

  test("/dine/1 shows the budget, the honest payment note and a back link @smoke", async ({ page }) => {
    await page.goto("/dine/1");
    await settled(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Dine on \$\w+ fees$/);
    const budget = page.locator("section.card").filter({ hasText: "Dining budget" });
    await expect(budget).toContainText(/\$[\d.,]+/);
    // Honest live state from GET /api/flynet/status, not a hard-coded line.
    await expect(budget).toContainText(/FLY payments: (enabled|pending Blackbird review|unknown)\./);
    await expect(page.getByText(/No draws yet|drawn of/)).toHaveCount(0); // FLY draws were removed
    // Logged out there is no way to move money: the FLY checkout needs a Blackbird member session.
    await expect(page.getByRole("button", { name: /Pay .* FLY with Blackbird/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Back to loan #1" })).toHaveAttribute("href", "/loans/1");
    await page.getByRole("button", { name: "Log in with Dynamic first" }).click();
    await authOpened(page);
  });

  // One live concierge call; same body as the api.spec plan test, so the agent's 10-min plan cache serves both.
  test("/dine/1 concierge: Find a table returns a shortlist with reasons (or an honest note)", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/dine/1");
    await settled(page);
    await page.getByRole("button", { name: "Find a table" }).click();
    const list = page.locator("section.card").filter({ hasText: /Shortlist for/ });
    await expect(list).toBeVisible({ timeout: 150_000 });
    await expect(list).toContainText(/deterministic ranker|Bankr LLM/);
    await expect(list).toContainText("plan until the loan is funded");
    const picks = list.locator("ul.list-disc");
    if (await picks.count()) {
      for (const ul of await picks.all()) await expect(ul.locator("li").first()).not.toBeEmpty();
    } else {
      await expect(list.locator("p.text-amber-ink").first()).toBeVisible(); // e.g. Flynet 429: the note says why
    }
  });
});

test.describe("funded loan page /loans/:id", () => {
  let id = 0;
  test.beforeAll(async () => {
    const f = await fundedLoanId();
    test.skip(f === null, NO_FUNDED);
    id = f!;
  });

  test("header, stamp, lifecycle, next step and terms @smoke", async ({ page }) => {
    await page.goto(`/loans/${id}`);
    await settled(page);
    await expect(page.getByLabel(/^Status: (ACTIVE|RELEASED|AUCTION)$/)).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Next" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Terms" })).toContainText("principal");
    for (const k of ["Borrower", "Controller", "Token", "Pool", "FeeVault", "FeeNote", "Fees manager"]) await expect(page.locator("dt", { hasText: new RegExp(`^${k}$`) })).toBeVisible();
  });

  test("auction panel shows the graduated CCA with bids", async ({ page }) => {
    await page.goto(`/loans/${id}`);
    const panel = page.locator("section.card").filter({ hasText: "FeeNote auction · Uniswap CCA" });
    await expect(panel.getByText(/^(graduated|live|not started|ended · settling)$/)).toBeVisible({ timeout: 30_000 });
    await expect(panel.locator("tbody tr").first()).toBeVisible();
  });

  test("fork-only '+10' block button mines blocks", async ({ page }) => {
    await page.goto(`/loans/${id}`);
    const panel = page.locator("section.card").filter({ hasText: "FeeNote auction · Uniswap CCA" });
    const blk = panel.getByText(/^block \d+$/);
    await expect(blk).toBeVisible({ timeout: 30_000 });
    const before = Number((await blk.innerText()).replace(/\D/g, ""));
    await panel.getByRole("button", { name: "+10" }).click();
    await expect.poll(async () => Number((await blk.innerText()).replace(/\D/g, "")), { timeout: 20_000 }).toBeGreaterThanOrEqual(before + 10);
    await expect(panel.getByRole("button", { name: "to end" })).toBeVisible();
  });

  test("debt card, redeem control and dine link", async ({ page }) => {
    await page.goto(`/loans/${id}`);
    const debt = page.locator("section.card").filter({ hasText: "Debt · read on-chain" });
    await expect(debt).toContainText("notes outstanding");
    await expect(debt.getByLabel("Notes to redeem")).toBeVisible();
    await expect(debt.getByRole("button", { name: "Redeem 1:1 USDC" })).toBeDisabled(); // logged out: no notes
    await debt.getByRole("link", { name: "Dine on these fees" }).click();
    await expect(page).toHaveURL(new RegExp(`/dine/${id}$`));
  });

  test("memos: 3 underwriters, lead marked binding, engine-only fallback labelled", async ({ page, request }) => {
    const loan = await (await request.get(`${AGENT}/api/loans/${id}`)).json();
    await page.goto(`/loans/${id}`);
    const memos = page.locator("section.card").filter({ hasText: "Credit memos · Bankr LLM Gateway" }).locator("article");
    await expect(memos).toHaveCount(3);
    await expect(memos.getByText("lead, binding")).toHaveCount(1);
    const noLlm = loan.memos.filter((m: { model: string }) => /^(engine-only|rules)/.test(m.model)).length;
    await expect(memos.getByText(/(engine only|rule-based persona), no LLM review/)).toHaveCount(noLlm);
  });

  test("engine-only memos do not leak raw upstream error JSON into the rationale", async ({ page }) => {
    await page.goto(`/loans/${id}`);
    const memos = page.locator("section.card").filter({ hasText: "Credit memos" }).locator("article");
    await expect(memos.first()).toBeVisible();
    await expect(memos.first()).not.toContainText('{"error"');
  });

  test("timeline: refresh, fork-tagged txs, links to desk", async ({ page }) => {
    await page.goto(`/loans/${id}`);
    const tl = page.locator("section.card").filter({ hasText: "Timeline" });
    await expect(tl.getByText("FeeNote CCA started")).toBeVisible();
    await expect(tl.getByText("fork", { exact: true }).first()).toBeVisible();
    const req = page.waitForRequest((r) => r.url() === `${AGENT}/api/loans/${id}`);
    await tl.getByRole("button", { name: "refresh" }).click();
    await req;
    await page.getByRole("link", { name: "Follow these underwriters" }).click();
    await expect(page).toHaveURL(/\/desk$/);
  });

  test("main nav highlights a section on nested loan pages", async ({ page }) => {
    await page.goto(`/loans/${id}`);
    // A loan page belongs to the loan book; with no aria-current the user loses their place.
    await expect(page.getByRole("navigation", { name: "Main" }).locator("[aria-current=page]")).toHaveCount(1);
  });
});

test.describe("/board (credit lines)", () => {
  test("equities section lists Robinhood Chain agents with totals @smoke", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/board");
    const eq = page.locator("section#equities");
    await expect(eq.getByRole("heading", { name: "Onchain equities · Robinhood Chain" })).toBeVisible({ timeout: 90_000 });
    for (const k of ["Equity-fee agents", "Equity fees, lifetime", "Indicative equity credit", "All Robinhood lines"]) await expect(eq.getByText(k, { exact: true })).toBeVisible();
    await expect(eq.getByText(/^\d+ agents$/)).toBeVisible();
    // The intro links to the section.
    await expect(page.locator('a[href="#equities"]').first()).toBeVisible();
  });

  test("totals, filter, sort and Apply deep link", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/board");
    await expect(page.getByText("Credit available")).toBeVisible({ timeout: 90_000 });
    const lines = page.getByRole("region", { name: "Credit lines" });
    const filter = lines.getByRole("checkbox", { name: "Pre-approved only" });
    await filter.check();
    await expect(filter).toBeChecked();
    // Sortable headers expose aria-sort; clicking one moves it there.
    const sortable = lines.locator("th button");
    if (await sortable.count()) {
      await sortable.first().click();
      await expect(lines.locator("th[aria-sort]")).toHaveCount(1);
    }
    const req = page.waitForRequest((r) => r.url() === `${AGENT}/api/board`);
    await lines.getByRole("button", { name: "Refresh" }).click();
    await req;
    const apply = lines.getByRole("link", { name: "Apply" }).first();
    if (await apply.count()) {
      await expect(apply).toHaveAttribute("href", /^\/apply\?token=0x[0-9a-fA-F]{40}(&borrower=0x[0-9a-fA-F]{40})?$/);
      await apply.click();
      await expect(page.getByLabel("Token (Base, Doppler)")).not.toHaveValue("");
    }
  });

  test("/apply?token=&borrower= deep link prefills both fields", async ({ page }) => {
    await page.goto(`/apply?token=${POOL.token}&borrower=${POOL.beneficiary}`);
    await expect(page.getByLabel("Token (Base, Doppler)")).toHaveValue(new RegExp(POOL.token, "i"));
    await expect(page.getByLabel("Fee beneficiary wallet")).toHaveValue(new RegExp(POOL.beneficiary, "i"));
  });
});

test.describe("cancelled before any vault existed", () => {
  test("the loan page does not claim an auction or cancel() happened", async ({ page, request }) => {
    const loans = (await (await request.get(`${AGENT}/api/loans`)).json()) as { id: number; status: string; vault: string | null }[];
    const l = loans.find((x) => x.status === "CANCELLED" && !x.vault);
    test.skip(!l, "no CANCELLED loan without a vault on this fork");
    await page.goto(`/loans/${l!.id}`);
    const next = page.getByRole("status").filter({ hasText: "Next" });
    await expect(next).toBeVisible();
    // createLoan never ran on-chain, so no auction, no cancel(), and the fee rights never left the borrower.
    await expect(next).not.toContainText(/auction did not fund|cancel\(\) returned/);
  });
});
