// Records one crisp 1920x1080 clip per scene from the production site (CDP screencast -> ffmpeg) and, for every
// element the narration will talk about, a MARK: its viewport box plus the clip-time window during which the page
// is standing still on it. video/src/Gadai.tsx draws its callout boxes straight from these marks, so a highlight
// can never land on the wrong element. Also dumps live agent JSON to public/data.json for the render.
//
// Usage: PW=<dir containing node_modules/playwright> node capture/capture.mjs      (run from video/)
//        ONLY=board,dine node capture/capture.mjs                                   (re-do some clips)
//        NODATA=1 ...                                                               (skip the data.json refresh)
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from "node:fs";

const { chromium } = createRequire(process.env.PW + "/node_modules/")("playwright");
const SITE = "https://gadai-six.vercel.app";
const ROOT = "C:/Hackathons/bankrbot hackathon";
const AGENT = "http://localhost:8787";
const OUT = "public/clips";
const MARKS = "public/marks.json";
const sh = (c) => execSync(c, { cwd: ROOT + "/agent", stdio: "pipe", shell: "C:/Program Files/Git/bin/bash.exe", timeout: 300000 }).toString();
const api = async (p) => (await fetch(AGENT + p)).json();
const ONLY = process.env.ONLY?.split(",");
const LOAN = Number(process.env.LOAN ?? 1);
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
const now = () => Date.now() / 1000;

let frames = [], t0 = 0, dir = "", marks = [];
const allMarks = existsSync(MARKS) ? JSON.parse(readFileSync(MARKS, "utf8")) : {};
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
  frames = []; marks = [];
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1080 });
  t0 = now();
  await fn();
  const end = now();
  await cdp.send("Page.stopScreencast");
  const d = dir; dir = "";
  // concat demuxer with real per-frame durations -> constant 30fps H.264. -g 15 keeps seeks cheap: Remotion
  // time-remaps these clips per frame so the highlight can hold while the narration talks.
  const lines = frames.map((ts, i) => `file '${String(i).padStart(5, "0")}.jpg'\nduration ${Math.max(0.001, (frames[i + 1] ?? end) - ts).toFixed(4)}`);
  lines.push(`file '${String(frames.length - 1).padStart(5, "0")}.jpg'`);
  writeFileSync(`${d}/list.txt`, lines.join("\n"));
  execSync(`ffmpeg -y -loglevel error -f concat -safe 0 -i list.txt -vf "fps=30,format=yuv420p" -c:v libx264 -crf 16 -preset veryfast -g 15 ../${name}.mp4`, { cwd: d });
  rmSync(d, { recursive: true, force: true });
  // clip time 0 == the first screencast frame, which is what ffmpeg's concat list starts at
  const origin = frames[0] ?? t0;
  allMarks[name] = marks.map((m) => ({ ...m, tIn: +(m.tIn - origin).toFixed(2), tOut: +(m.tOut - origin).toFixed(2) }));
  allMarks[name].dur = +(end - origin).toFixed(2);
  writeFileSync(MARKS, JSON.stringify(allMarks, null, 1));
  console.log("clip", name, (end - origin).toFixed(1) + "s", frames.length, "frames,", marks.length, "marks");
}

const go = async (p) => { await page.goto(SITE + p, { waitUntil: "networkidle", timeout: 90000 }).catch(() => {}); await wait(1400); };
async function scrollTo(y, ms = 1500) {
  await page.evaluate(([y, ms]) => new Promise((r) => {
    const s = scrollY, t0 = performance.now();
    const f = (t) => { const k = Math.min(1, (t - t0) / ms), e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; scrollTo(0, s + (y - s) * e); k < 1 ? requestAnimationFrame(f) : r(); };
    requestAnimationFrame(f);
  }), [y, ms]);
  await wait(ms + 120);
}
const one = (sel) => (typeof sel === "string" ? page.locator(sel) : sel).first();

/**
 * Point at an element, hold on it, and record where it is. `off` is where its top should sit in the viewport.
 * tIn/tOut bracket a window in which nothing on the page moves, so the box stays true for the whole callout.
 */
async function mark(label, sel, { hold = 1800, off = 320, scroll = true, ms = 1300 } = {}) {
  const loc = one(sel);
  if (scroll) {
    const y = await loc.evaluate((e) => e.getBoundingClientRect().top + scrollY, null, { timeout: 8000 }).catch(() => null);
    if (y == null) return console.log("  MARK MISS (no element):", label);
    await scrollTo(Math.max(0, Math.round(y - off)), ms);
  }
  const b = await loc.boundingBox({ timeout: 8000 }).catch(() => null);
  if (!b) return console.log("  MARK MISS (no box):", label);
  await page.evaluate(([x, y]) => window.__move(x, y, 700), [Math.round(b.x + Math.min(b.width / 2, 130)), Math.round(b.y + b.height / 2)]);
  await page.mouse.move(b.x + Math.min(b.width / 2, 130), b.y + b.height / 2, { steps: 8 });
  await wait(820);
  const f = (await loc.boundingBox().catch(() => b)) ?? b;
  const tIn = now();
  await wait(hold);
  marks.push({ label, tIn, tOut: now(), x: Math.round(f.x), y: Math.round(f.y), w: Math.round(f.width), h: Math.round(f.height) });
  console.log("  mark", label, `${Math.round(f.x)},${Math.round(f.y)} ${Math.round(f.width)}x${Math.round(f.height)}`);
}
const stat = (k) => page.locator(".label", { hasText: new RegExp(`^\\s*${k}\\s*$`) }).first().locator("xpath=..");
const ev = (label) => page.locator("li", { has: page.locator(`span.font-semibold:text-is(${JSON.stringify(label)})`) }).first();
const txt = (s, exact = false) => page.getByText(s, { exact });

// Warm the site and the agent caches so no clip records a spinner.
await go("/");
await Promise.all([
  fetch(`${AGENT}/api/board`),
  fetch(`${AGENT}/api/flynet/restaurants?page=0`),
  fetch(`${AGENT}/api/signals/1/flash-quote`),
  fetch(`${AGENT}/api/flynet/trending`),
  fetch(`${AGENT}/api/loans/${LOAN}/dine/plan`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request: "somewhere in NYC for four, open late, burgers", partySize: 4 }) }),
].map((p) => p.catch(() => {})));
await go("/board");
await wait(4000);

await clip("board", async () => {
  await go("/board");
  await page.waitForSelector("table", { timeout: 90000 }).catch(() => {});
  await wait(1800);
  await mark("headline", "h1", { scroll: false, hold: 2600 });
  await mark("credit", stat("Credit available"), { off: 260, hold: 2200 });
  await mark("llm", stat("LLM tokens, 30d"), { scroll: false, hold: 1900 });
  await mark("line", page.locator("table.tbl tbody tr", { has: page.locator(".pill", { hasText: "pre-approved" }) }).first().locator("td").nth(1), { off: 330, hold: 2000 });
  await mark("signal", page.locator("table.tbl .pill", { hasText: "fee-funded compute" }), { off: 340, hold: 2400 });
  await mark("why", page.locator("tr", { hasText: "not eligible" }).first().locator("td").nth(7), { off: 380, hold: 2600 });
});

await clip("equities", async () => {
  await go("/board");
  await page.waitForSelector("#equities", { timeout: 90000 }).catch(() => {});
  await wait(1200);
  await mark("heading", "#eq-h", { off: 200, hold: 2400 });
  await mark("agents", stat("Equity-fee agents"), { off: 230, hold: 2200 });
  await mark("fees", stat("Equity fees, lifetime"), { scroll: false, hold: 2000 });
  await mark("px", page.locator("#equities p.num").first(), { off: 300, hold: 2000 });
  await mark("row", page.locator("#equities table.tbl tbody tr").first().locator("td").nth(1), { off: 340, hold: 2200 });
  await mark("indicative", page.locator("#equities table.tbl .pill", { hasText: "indicative" }).first(), { scroll: false, hold: 2400 });
});

await clip("loan", async () => {
  await go(`/loans/${LOAN}`);
  await wait(1800);
  await mark("stamp", ".stamp-mark", { scroll: false, hold: 2400 });
  await mark("terms", page.locator("section[aria-label='Terms']"), { off: 380, hold: 2200 });
  await mark("identity", ev("borrower ERC-8004 agent linked"), { off: 340, hold: 2400 });
  await mark("pledged", ev("fee rights pledged"), { off: 340, hold: 2800 });
});

await clip("timeline", async () => {
  await go(`/loans/${LOAN}`);
  await wait(1600);
  await mark("disbursed", ev("USDC disbursed (Dynamic agent wallet)"), { off: 300, hold: 2200 });
  await mark("collected", ev("fees collected"), { off: 330, hold: 1800 });
  await mark("swapped", ev("WETH→USDC (Uniswap Trading API)"), { off: 330, hold: 2400 });
  await mark("debt", page.locator("section.card", { hasText: "Debt · read on-chain" }).first(), { off: 250, hold: 2400 });
  await mark("released", ev("lien released"), { off: 340, hold: 2200 });
  await mark("feedback", ev("repayment feedback (ERC-8004 reputation)"), { off: 340, hold: 2600 });
});

await clip("desk", async () => {
  await go("/signals/1");
  await wait(1800);
  await mark("call", "h1", { scroll: false, hold: 2400 });
  await mark("share", txt("Share on X"), { off: 280, hold: 1900 });
  await mark("fee", stat("Flash fee"), { off: 330, hold: 2400 });
  await go("/desk");
  await wait(1800);
  await mark("auto", page.locator("label", { hasText: "Auto-mirror" }), { off: 330, hold: 2600 });
  await mark("bracket", stat("Bracket mode"), { off: 300, hold: 2000 });
  await mark("dca", stat("DCA mode"), { scroll: false, hold: 2000 });
  await mark("bps", page.locator(".label", { hasText: "Integrator fee" }).first().locator("xpath=.."), { off: 360, hold: 2400 });
});

await clip("dine", async () => {
  await go("/dine");
  await page.waitForSelector("article.box", { timeout: 90000 }).catch(() => {});
  await wait(1600);
  await mark("budget", "h1", { scroll: false, hold: 2400 });
  await mark("trending", page.locator("section.card", { hasText: "Trending" }).first().locator("article.box").first(), { off: 250, hold: 2600 });
  await mark("venues", page.locator("section.card", { hasText: "Blackbird venues" }).first().locator("p", { hasText: "venues · page" }).first(), { off: 300, hold: 2200 });
  await go(`/dine/${LOAN}`);
  await wait(2000);
  await mark("pay", page.locator("b", { hasText: "FLY payments" }).first().locator("xpath=.."), { off: 320, hold: 2400 });
  await mark("passport", page.locator("section.card", { hasText: "Blackbird passport" }).first(), { off: 300, hold: 2400 });
  // the concierge runs for real against Flynet production; it takes a few seconds
  const ask = page.getByRole("button", { name: "Find a table" }).first();
  const b = await ask.boundingBox().catch(() => null);
  if (b) {
    await page.evaluate(([x, y]) => (window.__move(x, y, 700), window.__click()), [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)]);
    await ask.click().catch(() => {});
  }
  await page.waitForSelector("article.box .tag", { timeout: 240000 }).catch(() => {});
  await wait(2500);
  await mark("pick", page.locator("article.box", { has: page.locator(".tag") }).first(), { off: 190, hold: 3200 });
  await mark("fly", page.locator("article.box", { has: page.locator(".tag") }).first().locator("xpath=..").locator("text=/pending Blackbird review|Pay with FLY|FLY/i").first(), { scroll: false, hold: 2000 });
});

await clip("evidence", async () => {
  await go("/evidence");
  await wait(1600);
  await mark("desk", page.locator("table.tbl tbody tr").nth(1), { off: 300, hold: 2200 });
  await mark("id", page.locator("table.tbl tbody tr").nth(2), { scroll: false, hold: 2200 });
  await mark("x402", page.locator("table.tbl tbody tr").nth(3), { off: 340, hold: 2400 });
  await mark("flash", page.locator("table.tbl tbody tr").nth(4), { scroll: false, hold: 2400 });
  await mark("split", page.locator("section.card", { hasText: "Live vs simulated" }).first(), { off: 190, hold: 3000 });
  await mark("wallet", page.locator("section.card", { hasText: "Dynamic wallet pattern" }).first(), { off: 300, hold: 2400 });
});

await browser.close();

if (!process.env.NODATA) {
  const board = await api("/api/board");
  const detail = await api(`/api/loans/${LOAN}`);
  const signal = await api("/api/signals/1");
  const quote = await api("/api/signals/1/flash-quote").catch(() => null);
  const flash = await api("/api/flash/info").catch(() => null);
  const flynet = await api("/api/flynet/status").catch(() => null);
  const venues = await api("/api/flynet/restaurants?page=0").catch(() => null);
  // ERC-8021 builder-code suffix from the real disburse tx calldata
  const disb = detail.events.find((e) => e.kind === "disbursed")?.txHash;
  let builder = null;
  if (disb) {
    const input = sh(`~/.foundry/bin/cast.exe tx ${disb} input --rpc-url http://127.0.0.1:8545`).trim().slice(2);
    if (input.endsWith("80218021802180218021802180218021")) {
      const n = parseInt(input.slice(-36, -34), 16);
      const suffix = input.slice(-36 - n * 2);
      builder = { tx: disb, kind: "disburse", body: input.slice(-36 - n * 2 - 24, -36 - n * 2), suffix, code: Buffer.from(suffix.slice(0, n * 2), "hex").toString() };
    }
  }
  const x402 = await fetch("https://x402.bankr.bot/0x0455408228f460722ecbe80789bcf1628b479e98/gadai-credit?token=0x5F980Dcfc4c0fa3911554cf5ab288ed0eb13DBa3");
  const x402Body = await x402.text();
  writeFileSync("public/data.json", JSON.stringify({
    capturedAt: new Date().toISOString(),
    board: { generatedAt: board.generatedAt, ethUsd: board.ethUsd, totals: board.totals },
    loan: detail, signal, quote, flash, flynet, venues: venues && { total: venues.total, source: venues.source },
    builder, x402: { status: x402.status, body: JSON.parse(x402Body) },
  }, null, 1));
  console.log("data.json written; loan", LOAN);
}
