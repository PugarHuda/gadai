// Records the live Gadai demo (Vercel site talking to the local DEMO_FORK agent) and logs caption timings.
import { chromium } from "playwright";
import { execSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";

const SITE = "https://gadai-six.vercel.app";
const AGENT_DIR = "C:/Hackathons/bankrbot hackathon/agent";
const ADMIN = readFileSync("C:/Hackathons/bankrbot hackathon/.env", "utf8").match(/^ADMIN_TOKEN=(.*)$/m)[1].trim();
const sh = (c) => execSync(c, { cwd: AGENT_DIR, stdio: "pipe", shell: "C:/Program Files/Git/bin/bash.exe", timeout: 300000 }).toString();
const borrower = (a) => sh(`node --env-file=../.env src/demo/fork-borrower.ts ${a}`);
const loans = async () => await (await fetch("http://localhost:8787/api/loans")).json();
const status = async () => (await loans()).find((l) => l.id === ID)?.status;
let ID = 0;

const browser = await chromium.launch({ args: ["--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessRespectPreflightResults,BlockInsecurePrivateNetworkRequests"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: "raw", size: { width: 1280, height: 720 } } });
const page = await ctx.newPage();
const t0 = Date.now();
const caps = [];
const cap = (text) => { caps.push({ t: (Date.now() - t0) / 1000, text }); console.log(caps.at(-1)); };
const wait = (ms) => page.waitForTimeout(ms);
const go = async (p) => { await page.goto(SITE + p, { waitUntil: "networkidle" }).catch(() => {}); await wait(1500); };
const scroll = async (px, steps = 6) => { for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, px / steps); await wait(350); } };

await go("/");
cap("Gadai lends USDC to Bankr agents and creators, secured by their token's creator-fee rights.");
await wait(7000);
await scroll(500);
cap("A loan moves in five steps: pledge, auction, disburse, repay, release. Everything runs on a Base fork with a real Bankr pool.");
await wait(8000);

await go("/apply");
cap("A creator applies with their Bankr token. The underwriter reads live fee data from Bankr's public fee API.");
await wait(7000);

borrower("setup");
borrower("apply");
ID = Math.max(...(await loans()).map((l) => l.id));
if ((await loans()).length !== 1) throw new Error("expected exactly one loan on a fresh fork");
await go(`/loans/${ID}`);
cap("Three underwriter personas write credit memos. With no Bankr LLM credits they are labeled engine-only, never passed off as AI.");
await wait(5000);
await scroll(900, 8);
await wait(4000);
cap("Approved. The desk's Dynamic agent wallet created the loan and its vault on-chain.");
await wait(6000);

borrower(`pledge ${ID}`);
await go(`/loans/${ID}`);
cap("The borrower pledges fee rights: updateBeneficiary moves their 57 percent fee share into the vault. That is the lien.");
await wait(8000);
await go("/notes");
cap("Lenders fund the loan by buying FeeNotes, a new ERC-20, in a Uniswap Continuous Clearing Auction. The desk places an anchor bid.");
await wait(8000);

sh("~/.foundry/bin/cast.exe rpc anvil_mine 200 --rpc-url http://127.0.0.1:8545");
for (let i = 0; i < 60 && (await status()) === "AUCTION"; i++) await wait(2000);
await go(`/loans/${ID}`);
cap("The auction clears and the Dynamic agent wallet disburses the USDC to the borrower.");
await wait(8000);

sh(`curl -s -X POST -H "x-admin-token: ${ADMIN}" localhost:8787/api/admin/keeper/run`);
await go(`/loans/${ID}`);
cap("The keeper collects fees from the pool and swaps WETH to USDC through the Uniswap Trading API.");
await wait(6000);
await scroll(1400, 10);
cap("Debt reaches zero, FeeNote holders can redeem, and release() hands the fee rights back. Every step is a transaction.");
await wait(9000);

await go("/desk");
cap("Follow the Desk: every credit decision is a public signal. Followers mirror approved borrowers with Definitive Flash bracket or DCA orders.");
await wait(9000);
await go("/dine");
cap("Dine on your fees: borrowers draw a small Flynet dining line against pledged fees at Blackbird restaurants.");
await wait(8000);
await go("/");
cap("Gadai. Credit for agents, secured by the fees they already earn. github.com/PugarHuda/gadai");
await wait(7000);

const dur = (Date.now() - t0) / 1000;
await ctx.close(); await browser.close();
writeFileSync("captions.json", JSON.stringify({ dur, caps }, null, 1));
console.log("done", dur);
