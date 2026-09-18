// README line anchors are derived from symbol names, not typed by hand (they drift on every edit).
//   node docs/anchors.mjs          → check: exit 1 if any README link range is stale
//   node docs/anchors.mjs --write  → rewrite README.md link ranges in place
// Each SPECS row = [file, startRegex, endRegex?] in README link order. Range = start line of startRegex
// through the end of the bracket block that starts at endRegex (or startRegex).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const A = "agent/src/", V = "contracts/src/FeeVault.sol";
const launchAnchor = [A + "cca/index.ts", /^export const launchAuction\b/, /^async function placeAnchorBidOnce\b/];
const settle = [A + "cca/index.ts", /^export async function settleOnce\b/];
const auctionPanel = ["web/components/auction.tsx", /^export function AuctionPanel\b/];
const recommend = [A + "flynet/index.ts", /^export function recommend\b/, /^async function recommendFresh\b/];
const SPECS = [
  [A + "bankr/index.ts", /^export const tokenFees\b/, /^export async function llmChat\b/],
  [A + "underwriter/index.ts", /^export async function quote\b/],
  [A + "underwriter/engine.ts", /^export function analyzeRate\b/, /^export function computeTerms\b/],
  [A + "underwriter/index.ts", /^export const PERSONAS\b/],
  [A + "underwriter/index.ts", /^const SYSTEM\b/, /^export async function underwrite\b/],
  [A + "underwriter/engine.ts", /^export function parseMemo\b/],
  [A + "server/index.ts", /^async function apply\b/],
  [A + "server/index.ts", /^async function pledge\b/, /^async function pledgeLocked\b/],
  [V, /function confirmPledge\(/],
  [V, /function release\(/],
  [V, /function _returnLien\(/],
  recommend,
  [A + "wallet/index.ts", /^export async function signInAgent\b/],
  [A + "wallet/index.ts", /^export async function getAgentWallet\b/],
  [A + "keeper/index.ts", /^export async function createLoanOnchain\b/],
  launchAnchor,
  settle,
  [V, /function disburse\(/],
  [A + "keeper/index.ts", /^export async function runKeeperOnce\b/],
  ["web/lib/wallet.tsx", /^export function Providers\b/, /^export function useSigner\b/],
  ["web/components/pledge.tsx", /^export function PledgePanel\b/],
  auctionPanel,
  [A + "social/delegation.ts", /^export function verifyWebhook\b/, /^export async function delegatedSigner\b/],
  [A + "social/index.ts", /^async function executeAuto\b/],
  ["web/app/desk/page.tsx", /^function FollowForm\b/],
  ["contracts/src/FeeDesk.sol", /function createLoan\(/],
  [V, /function redeem\(/],
  [V, /function startAuction\(/],
  [A + "cca/index.ts", /^export function stepsData\b/],
  launchAnchor,
  [A + "cca/index.ts", /^export async function bidPlan\b/],
  [A + "cca/index.ts", /^export async function exitPlan\b/],
  settle,
  auctionPanel,
  [A + "uniswap/index.ts", /^export function headers\b/],
  [A + "uniswap/index.ts", /^export async function buildVaultSwap\b/],
  [A + "uniswap/index.ts", /^export function assertSwapTx\b/],
  [A + "uniswap/index.ts", /^export async function ethUsd\b/],
  [V, /function swapWethToUsdc\(/],
  [A + "keeper/index.ts", /await step\("swap"/],
  [A + "flash/index.ts", /^export async function twapSellTokenLeg\b/, /^async function placeTokenLegOrder\b/],
  [A + "flash/index.ts", /^export async function pollFlashOrders\b/],
  [V, /function isValidSignature\(/, /function flashDomainSeparator\(/],
  [V, /function authorizeFlashOrder\(/, /function authorizeFlashCancel\(/],
  [A + "social/index.ts", /^export function publishSignals\b/],
  [A + "social/index.ts", /^export async function leaderboard\b/],
  [A + "social/score.ts", /^export function leaderboardRow\b/],
  [A + "social/index.ts", /^export async function quoteMirror\b/],
  [A + "social/index.ts", /^export async function submitMirror\b/],
  ["web/app/desk/page.tsx", /^export default function Desk\b/],
  recommend,
  [A + "flynet/index.ts", /^async function memberWallets\b/, /^export async function dineState\b/],
  [A + "flynet/index.ts", /^export async function draw\b/, /^async function issueDrawFly\b/],
  [A + "flynet/index.ts", /^export async function settle\b/],
  [V, /function addDraw\(/, /function payDesk\(/],
];

const find = (lines, re, from, file) => {
  const i = lines.findIndex((l, k) => k >= from && re.test(l));
  if (i < 0) throw new Error(`${file}: no line matches ${re}`);
  return i;
};
// End of the bracket block opened on line i (strings and // comments stripped before counting).
function blockEnd(lines, i, file) {
  let depth = 0, opened = false;
  const indent = (l) => l.length - l.trimStart().length;
  const base = indent(lines[i]);
  for (let k = i; k < lines.length; k++) {
    const code = lines[k].replace(/\/\/.*$/, "").replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, "");
    for (const ch of code) {
      if ("{([".includes(ch)) (depth++, (opened = true));
      else if ("})]".includes(ch)) depth--;
    }
    // a more-indented next line continues the declaration (Solidity modifiers/returns before `{`)
    const next = lines[k + 1] ?? "";
    if (opened && depth <= 0 && (next.trim() === "" || (indent(next) <= base && !next.trim().startsWith("{")))) return k;
  }
  throw new Error(`${file}:${i + 1}: unbalanced block`);
}
export function rangeOf([file, start, end]) {
  const lines = readFileSync(join(ROOT, file), "utf8").split(/\r?\n/);
  const s = find(lines, start, 0, file);
  const e = blockEnd(lines, end ? find(lines, end, s, file) : s, file);
  if (e - s > 200) throw new Error(`${file}:${s + 1}: range ${e - s + 1} lines, block detection likely wrong`);
  return `#L${s + 1}-L${e + 1}`;
}

const readmePath = join(ROOT, "README.md");
let readme = readFileSync(readmePath, "utf8");
const LINK = /\[`([^`]*?)(#L\d+-L\d+)?`\]\(([^)#]+)#L\d+-L\d+\)/g;
const links = [...readme.matchAll(LINK)];
const problems = [];
if (links.length !== SPECS.length) problems.push(`README has ${links.length} line links, SPECS has ${SPECS.length}: update SPECS in README order`);
// Files the Run-it section and track sections point at must exist.
for (const f of [...readme.matchAll(/\]\(((?:agent|web|contracts|skill|docs|shared)\/[^)#\s]+)/g)].map((m) => m[1]))
  if (!existsSync(join(ROOT, f))) problems.push(`README links missing file ${f}`);
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
for (const [name, cmd] of Object.entries(pkg.scripts ?? {}))
  for (const m of cmd.matchAll(/(script\/\S+\.s\.sol)/g))
    if (readme.includes(`pnpm ${name}`) && !existsSync(join(ROOT, "contracts", m[1]))) problems.push(`README runs \`pnpm ${name}\` but contracts/${m[1]} does not exist`);

let i = 0;
readme = readme.replace(LINK, (whole, label, _old, file) => {
  const spec = SPECS[i++];
  if (!spec) return whole;
  if (spec[0] !== file) { problems.push(`link ${i}: README file ${file} ≠ SPECS file ${spec[0]}`); return whole; }
  let r;
  try { r = rangeOf(spec); } catch (e) { problems.push(`link ${i}: ${e.message}`); return whole; }
  const fixed = `[\`${label}${r}\`](${file}${r})`;
  if (fixed !== whole) problems.push(`stale: ${whole}  →  ${fixed}`);
  return fixed;
});

const write = process.argv.includes("--write");
if (write) writeFileSync(readmePath, readme);
const stale = problems.filter((p) => p.startsWith("stale:"));
const hard = problems.filter((p) => !p.startsWith("stale:"));
for (const p of write ? hard : problems) console.log(p);
if (write && stale.length) console.log(`rewrote ${stale.length} README anchor(s)`);
if (hard.length || (!write && stale.length)) process.exit(1);
console.log(`README anchors OK (${links.length} links)`);
