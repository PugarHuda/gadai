// Records one crisp 1920x1080 clip per scene from the production site (CDP screencast -> ffmpeg), while driving
// a fresh loan through the live DEMO_FORK agent. Also dumps live agent JSON to public/data.json for the render.
// Usage: PW=<dir containing node_modules/playwright> node capture/capture.mjs   (run from video/)
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdirSync, rmSync } from "node:fs";

const { chromium } = createRequire(process.env.PW + "/node_modules/")("playwright");
const SITE = "https://gadai-six.vercel.app";
const ROOT = "C:/Hackathons/bankrbot hackathon";
const OUT = "public/clips";
const ADMIN = readFileSync(ROOT + "/.env", "utf8").match(/^ADMIN_TOKEN=(.*)$/m)[1].trim();
const sh = (c) => execSync(c, { cwd: ROOT + "/agent", stdio: "pipe", shell: "C:/Program Files/Git/bin/bash.exe", timeout: 300000 }).toString();
const borrower = (a) => sh(`node --env-file=../.env src/demo/fork-borrower.ts ${a}`);
const api = async (p) => (await fetch("http://localhost:8787" + p)).json();
const ONLY = process.env.ONLY?.split(",");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ["--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessRespectPreflightResults,BlockInsecurePrivateNetworkRequests", "--hide-scrollbars"] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
// Synthetic cursor: a violet-ringed dot that glides between targets and survives navigations.
await ctx.addInitScript(() => {
  const mk = () => {
    if (document.getElementById("__cur")) return;
    const d = document.createElement("div");
    d.id = "__cur";
    const p = JSON.parse(sessionStorage.getItem("__cur") || "[960,700]");
    d.style.cssText = `position:fixed;left:0;top:0;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;background:rgba(252,252,250,.85);border:3px solid #5a2bb3;box-shadow:0 2px 10px rgba(22,24,29,.35);z-index:2147483647;pointer-events:none;transform:translate(${p[0]}px,${p[1]}px);transition:transform 900ms cubic-bezier(.22,1,.36,1), scale 180ms;`;
    document.documentElement.appendChild(d);
  };
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", mk) : mk();
  window.__move = (x, y, ms = 900) => { mk(); const d = document.getElementById("__cur"); d.style.transitionDuration = `${ms}ms, 180ms`; d.style.transform = `translate(${x}px,${y}px)`; sessionStorage.setItem("__cur", JSON.stringify([x, y])); };
  window.__click = () => { const d = document.getElementById("__cur"); d.style.scale = ".7"; setTimeout(() => (d.style.scale = "1"), 200); };
});
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
const wait = (ms) => page.waitForTimeout(ms);

let frames = [], t0 = 0, dir = "";
cdp.on("Page.screencastFrame", async (f) => {
  cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  if (!dir) return;
  const i = frames.length;
  writeFileSync(`${dir}/${String(i).padStart(5, "0")}.jpg`, Buffer.from(f.data, "base64"));
  frames.push(f.metadata.timestamp);
});
async function clip(name, fn) {
  if (ONLY && !ONLY.includes(name)) return;
  dir = `${OUT}/_${name}`; rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  frames = [];
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1080 });
  t0 = Date.now() / 1000;
  await fn();
  const end = Date.now() / 1000;
  await cdp.send("Page.stopScreencast");
  const d = dir; dir = "";
  // concat demuxer with real per-frame durations -> constant 30fps H.264
  const lines = frames.map((ts, i) => `file '${String(i).padStart(5, "0")}.jpg'\nduration ${Math.max(0.001, (frames[i + 1] ?? end) - ts).toFixed(4)}`);
  lines.push(`file '${String(frames.length - 1).padStart(5, "0")}.jpg'`);
  writeFileSync(`${d}/list.txt`, lines.join("\n"));
  execSync(`ffmpeg -y -loglevel error -f concat -safe 0 -i list.txt -vf "fps=30,format=yuv420p" -c:v libx264 -crf 16 -preset veryfast ../${name}.mp4`, { cwd: d });
  rmSync(d, { recursive: true, force: true });
  console.log("clip", name, (end - t0).toFixed(1) + "s", frames.length, "frames");
}

const go = async (p) => { await page.goto(SITE + p, { waitUntil: "networkidle" }).catch(() => {}); await wait(1200); };
async function point(loc, ms = 900) {
  const b = await loc.first().boundingBox({ timeout: 4000 }).catch(() => null);
  if (!b) return console.log("no box", loc);
  const x = b.x + Math.min(b.width / 2, 160), y = b.y + b.height / 2;
  await page.evaluate(([x, y, ms]) => window.__move(x, y, ms), [x, y, ms]);
  await page.mouse.move(x, y, { steps: 12 });
  await wait(ms);
}
async function click(loc) { await point(loc); await page.evaluate(() => window.__click()); await loc.first().click(); }
async function scrollTo(y, ms = 1600) {
  await page.evaluate(([y, ms]) => new Promise((r) => {
    const s = scrollY, t0 = performance.now();
    const f = (t) => { const k = Math.min(1, (t - t0) / ms), e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; scrollTo(0, s + (y - s) * e); k < 1 ? requestAnimationFrame(f) : r(); };
    requestAnimationFrame(f);
  }), [y, ms]);
  await wait(ms + 150);
}
const scrollToEl = async (loc, off = 140, ms) => { const y = await loc.first().evaluate((e) => e.getBoundingClientRect().top + scrollY, null, { timeout: 4000 }).catch(() => null); if (y == null) return console.log("no el"); await scrollTo(Math.max(0, y - off), ms); };
const txt = (s) => page.getByText(s, { exact: false });

// Warm the site so the first clip has fonts/data cached.
await go("/"); await go("/board"); await wait(3000);

await clip("home", async () => {
  await go("/");
  await wait(2500);
  await point(page.locator("h1"));
  await wait(1500);
  await scrollTo(620, 2400);
  await wait(4000);
});

await clip("board", async () => {
  await go("/board");
  await page.waitForSelector("table", { timeout: 60000 }).catch(() => {});
  await wait(1500);
  await point(page.locator("h1"));
  await wait(3000);
  await point(txt("LLM tokens, 30d"));
  await wait(2000);
  await scrollToEl(page.locator("table"), 160, 1800);
  await point(page.locator("tbody tr").nth(1).locator("td").nth(1));
  await wait(1500);
  await point(page.locator("tbody tr").nth(1).locator(".pill").nth(1));
  await wait(2500);
  await scrollToEl(page.locator("tbody tr:has-text('not eligible')"), 420, 2200);
  await point(page.locator("tbody tr:has-text('not eligible') .pill").first());
  await wait(2000);
  await point(page.locator("tbody tr:has-text('not eligible') p").first());
  await wait(3500);
});

await clip("apply", async () => {
  await go("/apply");
  await wait(1500);
  await click(page.getByRole("button", { name: /fork demo: quote/ }));
  await wait(1200);
  await click(page.getByRole("button", { name: "Get quote" }));
  await wait(3500);
  await scrollTo(420, 1800);
  await wait(4500);
});

// ---- drive the loan (off camera) ----
let ID = (await api("/api/loans")).at(-1)?.id;
if (!ONLY || ONLY.includes("memos")) {
  borrower("setup");
  const agentId = borrower("register-agent").match(/ERC-8004 agent (\d+)/)[1];
  borrower(`apply ${agentId}`);
  ID = Math.max(...(await api("/api/loans")).map((l) => l.id));
  console.log("loan", ID, "agent", agentId);
}

await clip("memos", async () => {
  await go(`/loans/${ID}`);
  await wait(1500);
  await point(page.locator(".stamp-mark"));
  await wait(2000);
  await point(txt("ERC-8004"));
  await wait(2000);
  await scrollToEl(txt("Credit memos"), 120, 2000);
  const memos = page.locator("section:has-text('Credit memos') article, section:has-text('Credit memos') li");
  const n = Math.min(3, await memos.count());
  for (let i = 0; i < n; i++) { await point(memos.nth(i)); await wait(1800); }
  await point(txt("no LLM review"));
  await wait(3000);
});

if (!ONLY || ONLY.includes("pledge")) borrower(`pledge ${ID}`);
await clip("pledge", async () => {
  await go(`/loans/${ID}`);
  await wait(1500);
  await point(page.locator(".stamp-mark"));
  await wait(2000);
  await scrollToEl(txt("Timeline"), 120, 2000);
  await point(txt(/pledge/i).last());
  await wait(4000);
});

await clip("notes", async () => {
  await go("/notes");
  await wait(2000);
  await point(page.locator("h1"));
  await wait(1500);
  await scrollToEl(txt("Open auctions"), 140, 1600);
  await point(txt(/anchor|clearing|floor/i).first());
  await wait(3500);
  await scrollTo(900, 1800);
  await wait(3000);
});

if (!ONLY || ONLY.includes("active")) {
  sh("~/.foundry/bin/cast.exe rpc anvil_mine 200 --rpc-url http://127.0.0.1:8545");
  for (let i = 0; i < 90 && (await api(`/api/loans/${ID}`)).loan?.status !== "ACTIVE" && (await api("/api/loans")).find((l) => l.id === ID)?.status !== "ACTIVE"; i++) await wait(2000);
}
await clip("active", async () => {
  await go(`/loans/${ID}`);
  await wait(1500);
  await point(page.locator(".stamp-mark"));
  await wait(2000);
  await scrollToEl(txt("Timeline"), 120, 2000);
  await point(txt(/disburs/i).last());
  await wait(4000);
});

if (!ONLY || ONLY.includes("released")) {
  sh(`curl -s -X POST -H "x-admin-token: ${ADMIN}" localhost:8787/api/admin/keeper/run`);
  for (let i = 0; i < 60 && (await api("/api/loans")).find((l) => l.id === ID)?.status !== "RELEASED"; i++) await wait(2000);
}
await clip("released", async () => {
  await go(`/loans/${ID}`);
  await wait(1200);
  await point(page.locator(".stamp-mark"));
  await wait(3500);
  await scrollToEl(txt("Debt · read on-chain"), 120, 1800);
  await point(txt("Debt · read on-chain"));
  await wait(2500);
  await scrollToEl(txt("Timeline"), 120, 1800);
  await point(txt(/swap/i).last());
  await wait(2000);
  await point(txt(/erc8004|reputation|feedback/i).last());
  await wait(3500);
});

await clip("desk", async () => {
  await go("/desk");
  await wait(1500);
  await point(page.locator("h1"));
  await wait(1500);
  await point(txt("Flash: mainnet only"));
  await wait(2500);
  await scrollTo(640, 1800);
  await point(page.locator(".pill", { hasText: /approve/i }));
  await wait(2000);
  await point(txt("Bracket").last());
  await wait(1500);
  await point(page.getByText("DCA", { exact: true }).last());
  await wait(2500);
});

await clip("dine", async () => {
  await go("/dine");
  await wait(2000);
  await point(page.locator("h1"));
  await wait(2500);
  await point(txt(/Flynet/).first());
  await wait(2500);
  await scrollTo(400, 1600);
  await point(page.locator("a, button").filter({ hasText: /dine|draw|open/i }).first());
  await wait(3500);
});

await browser.close();
// live data for the composition
const board = await api("/api/board");
const loans = await api("/api/loans");
const detail = await api(`/api/loans/${ID}`);
// ERC-8021 builder-code suffix from the real disburse tx calldata
const disb = detail.events.find((e) => e.kind === "disbursed")?.txHash;
let builder = null;
if (disb) {
  const input = execSync(`~/.foundry/bin/cast.exe tx ${disb} input --rpc-url http://127.0.0.1:8545`, { shell: "C:/Program Files/Git/bin/bash.exe" }).toString().trim().slice(2);
  if (input.endsWith("80218021802180218021802180218021")) {
    const n = parseInt(input.slice(-36, -34), 16);
    const suffix = input.slice(-36 - n * 2);
    builder = { tx: disb, kind: "disburse", body: input.slice(-36 - n * 2 - 24, -36 - n * 2), suffix, code: Buffer.from(suffix.slice(0, n * 2), "hex").toString() };
  }
}
const x402 = await fetch("https://x402.bankr.bot/0x0455408228f460722ecbe80789bcf1628b479e98/gadai-credit?token=0x5F980Dcfc4c0fa3911554cf5ab288ed0eb13DBa3");
const x402Body = await x402.text();
writeFileSync("public/data.json", JSON.stringify({ capturedAt: new Date().toISOString(), board: { generatedAt: board.generatedAt, totals: board.totals, ethUsd: board.ethUsd }, loan: detail, loanSummary: loans.find((l) => l.id === ID), builder, x402: { status: x402.status, body: JSON.parse(x402Body) } }, null, 1));
console.log("done loan", ID);
