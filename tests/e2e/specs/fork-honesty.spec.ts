// DEMO_FORK honesty (PRODUCT.md): on-chain state is local, so nothing may link to a Basescan page that does not
// reflect it. Tx links are already suppressed; this checks addresses too, by asking mainnet whether they exist.
import { test, expect, FORK_RPC, settled, fundedLoanId, NO_FUNDED } from "../fixtures";

const MAINNET_RPC = "https://base-rpc.publicnode.com";

async function code(rpc: string, addr: string): Promise<string> {
  const r = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [addr, "latest"] }),
  });
  return ((await r.json()) as { result?: string }).result ?? "0x";
}

for (const r of ["/", "/loans/:funded"]) {
  test(`${r}: Basescan address links only point at contracts that exist on mainnet`, async ({ page }) => {
    test.setTimeout(120_000);
    const id = r === "/" ? 0 : await fundedLoanId();
    test.skip(id === null, NO_FUNDED);
    await page.goto(r === "/" ? "/" : `/loans/${id}`);
    await settled(page);
    await page.waitForTimeout(1_000);
    const hrefs = await page.locator('a[href*="basescan.org/address/"]').evaluateAll((as) => [...new Set(as.map((a) => (a as HTMLAnchorElement).href))]);
    // DEMO_FORK renders addresses unlinked (with a "fork" tag), so zero links is the expected, honest outcome.
    const forkOnly: string[] = [];
    for (const h of hrefs) {
      const addr = h.split("/address/")[1];
      const [onFork, onMain] = await Promise.all([code(FORK_RPC, addr), code(MAINNET_RPC, addr)]);
      // A contract that exists only on the fork has no Basescan page: the link would mislead a judge.
      if (onFork !== "0x" && onMain === "0x") forkOnly.push(addr);
    }
    expect(forkOnly, `fork-only contracts linked to Basescan: ${forkOnly.join(", ")}`).toEqual([]);
  });
}

test("fork txs are labelled 'fork' and carry the full hash in a title @smoke", async ({ page }) => {
  const id = await fundedLoanId();
  test.skip(id === null, NO_FUNDED);
  await page.goto(`/loans/${id}`);
  const tag = page.getByText("fork", { exact: true }).first();
  await expect(tag).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('span[title*="fork-only tx, not on Basescan"]').first()).toHaveAttribute("title", /^0x[0-9a-fA-F]{64} \(fork-only tx/);
});

test("the banner states the RPC and is on top of every page (sticky)", async ({ page }) => {
  await page.goto("/desk");
  const banner = page.getByRole("note").filter({ hasText: "Demo fork" });
  await expect(banner).toContainText(FORK_RPC);
  await page.mouse.wheel(0, 2000);
  await page.waitForTimeout(300);
  const box = await banner.boundingBox();
  expect(box?.y ?? 99).toBeLessThanOrEqual(1);
});
