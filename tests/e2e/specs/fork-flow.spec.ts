// Opt-in (E2E_FORK_FLOW=1): drives the real DEMO_FORK loan flow with agent/src/demo/fork-borrower.ts, then checks the UI.
// It MUTATES the fork (new loan, pledge, mined blocks, keeper pass), so it never runs by default.
// There is one real test pool: once loan #1 exists, a re-application may be rejected; that is asserted as a clean 4xx.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test, expect, AGENT, FORK_RPC, adminToken, settled } from "../fixtures";

const AGENT_DIR = fileURLToPath(new URL("../../../agent", import.meta.url));
const CAST = process.env.CAST ?? `${process.env.USERPROFILE ?? process.env.HOME}/.foundry/bin/cast.exe`;
const borrower = (...args: string[]) =>
  execFileSync("node", ["--env-file=../.env", "src/demo/fork-borrower.ts", ...args], { cwd: AGENT_DIR, encoding: "utf8", timeout: 300_000, stdio: "pipe" });

test.describe("fork loan flow", () => {
  test.skip(process.env.E2E_FORK_FLOW !== "1", "set E2E_FORK_FLOW=1 to run (mutates the fork)");
  test.setTimeout(600_000);

  test("apply → pledge → auction → keeper, or a clean rejection for the reused pool", async ({ page, request }) => {
    borrower("setup");
    let out: string;
    try {
      out = borrower("apply");
    } catch (e) {
      const msg = String((e as { stderr?: string }).stderr ?? e);
      // Re-applying for the only test pool: must be a readable 4xx from the agent, never a 500.
      expect(msg, msg).toMatch(/HTTP 4\d\d/);
      expect(msg).not.toMatch(/HTTP 5\d\d|internal error/);
      test.info().annotations.push({ type: "edge-case", description: msg.split("\n").find((l) => l.includes("HTTP")) ?? msg.slice(0, 300) });
      return;
    }
    const loan = JSON.parse(out.slice(out.indexOf("{")));
    test.info().annotations.push({ type: "loan", description: `#${loan.id} ${loan.status}` });
    if (loan.status === "DECLINED") {
      await page.goto(`/loans/${loan.id}`);
      await expect(page.getByLabel("Status: DECLINED")).toBeVisible();
      return;
    }
    expect(loan.status).toBe("APPROVED");

    await page.goto(`/loans/${loan.id}`);
    await expect(page.getByText("Pledge your fee rights")).toBeVisible();
    await expect(page.locator("pre").filter({ hasText: "anvil_impersonateAccount" })).toContainText(loan.vault);

    borrower("pledge", String(loan.id));
    execFileSync(CAST, ["rpc", "anvil_mine", "200", "--rpc-url", FORK_RPC], { timeout: 60_000 });
    const k = await request.post(`${AGENT}/api/admin/keeper/run`, { headers: { "x-admin-token": adminToken() }, data: {}, timeout: 300_000 });
    expect([200, 409]).toContain(k.status());

    await expect
      .poll(async () => (await (await request.get(`${AGENT}/api/loans/${loan.id}`)).json()).status, { timeout: 240_000, intervals: [5_000] })
      .toMatch(/ACTIVE|RELEASED|CANCELLED/);
    await page.goto(`/loans/${loan.id}`);
    await settled(page);
    await expect(page.getByText("FeeNote auction · Uniswap CCA")).toBeVisible();
    await expect(page.getByText("USDC disbursed (Dynamic agent wallet)").or(page.getByText("cancelled", { exact: true }))).toBeVisible();
  });
});
