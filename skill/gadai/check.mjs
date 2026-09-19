// Drift check between the skill text and the code it describes. Run: node skill/gadai/check.mjs
// 1. The 5-line apply message in SKILL.md (3a block + printf forms in SKILL.md and catalog.json) == shared applyMessage().
// 2. Hard rule 2's pledge-data rule == a LIVE Bankr build-transfer-beneficiary response for the real GITLAWB pool.
// 3. The apply error strings the skill tells the agent to handle still exist in the server.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, "..", "..");
const { applyMessage, TEST_POOL, API } = await import(pathToFileURL(join(ROOT, "shared/src/index.ts")).href);
const skill = readFileSync(join(HERE, "SKILL.md"), "utf8");
const catalog = JSON.parse(readFileSync(join(HERE, "catalog.json"), "utf8"));
const server = readFileSync(join(ROOT, "agent/src/server/index.ts"), "utf8");
const ok = (m) => console.log(`ok  ${m}`);

// 1. apply message
const token = "0x5F980Dcfc4c0fa3911554cf5ab288ed0eb13DBa3", borrower = "0xFDb6430011f6E4796Ca380CB39e47975b1f876Bf", nonce = "a1b2c3d4e5f60718";
const want = applyMessage(token, borrower, borrower, nonce);
const block = skill.match(/\*\*3a\.[\s\S]*?```\n([\s\S]*?)\n```/)?.[1];
assert.ok(block, "SKILL.md: 3a message block not found");
const fromBlock = block
  .replace("<token, lowercase 0x…>", token.toLowerCase())
  .replaceAll("<borrower, lowercase 0x…>", borrower.toLowerCase())
  .replace("<nonce>", nonce);
assert.equal(fromBlock, want, "SKILL.md 3a block ≠ shared applyMessage");
ok("SKILL.md 3a block == applyMessage");
const printf = (src, where) => {
  const fmt = src.match(/printf '([^']*)'/)?.[1];
  assert.ok(fmt, `${where}: printf form not found`);
  const args = [token.toLowerCase(), borrower.toLowerCase(), borrower.toLowerCase(), nonce];
  assert.equal(fmt.replaceAll("\\n", "\n").replace(/%s/g, () => args.shift()), want, `${where}: printf form ≠ applyMessage`);
  ok(`${where} printf == applyMessage`);
};
printf(skill, "SKILL.md");
printf(catalog.demo.code, "catalog.json");
assert.match(skill, /^FD=https:\/\/\S+$/m, "SKILL.md must define FD=https://<host>");
assert.match(catalog.demo.code, /^FD=https:\/\/\S+$/m, "catalog.json demo must define FD=https://<host>");
ok("$FD defined in SKILL.md and catalog.json");

// 2. pledge-data rule vs live Bankr builder
const vault = "0x000000000000000000000000000000000000dEaD";
const rule = ("0xd44f6738" + TEST_POOL.poolId.slice(2) + "0".repeat(24) + vault.slice(2)).toLowerCase();
assert.equal(rule.length, 138, "rule length");
assert.ok(skill.includes('"0xd44f6738"') && skill.includes("24 zeros") && skill.includes("138 characters"), "SKILL.md Hard rule 2 text changed");
const res = await fetch(`${API.BANKR}/public/doppler/build-transfer-beneficiary`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ tokenAddress: TEST_POOL.token, currentBeneficiary: TEST_POOL.beneficiary, newBeneficiary: vault }),
});
const body = await res.text();
assert.ok(res.ok, `Bankr build-transfer-beneficiary → ${res.status}: ${body.slice(0, 300)}`);
const tx = JSON.parse(body);
assert.equal(tx.chainId, 8453, "live chainId");
assert.equal(tx.to.toLowerCase(), TEST_POOL.feesManager.toLowerCase(), "live `to` ≠ FeesManager");
assert.equal(tx.data.toLowerCase(), rule, "live data ≠ Hard rule 2");
ok(`Hard rule 2 == live build-transfer-beneficiary (${tx.data.length} chars, to ${tx.to})`);

// 3. apply error strings the skill relies on
for (const s of ["nonce already used", "re-apply after 24h", "fee rights not moved yet", "pledge confirmed, but auction launch failed"]) {
  assert.ok(server.includes(s), `server no longer says "${s}"`);
  assert.ok(skill.includes(s), `SKILL.md does not mention "${s}"`);
}
assert.match(server, /bad\([^;]*applyMessage[^;]*, 401\)/, "server apply no longer 401s on a bad signature");
ok("apply/pledge error strings present in server and SKILL.md");

// 4. claim-first: offered before the pledge, with the collectFees(poolId) calldata rule the agent enforces (bankr assertClaimTx)
assert.ok(server.includes("claimFirst"), "server apply no longer returns claimFirst");
const iClaim = skill.indexOf("claimFirst.tx"), iPledge = skill.indexOf("**4b. Pledge.**");
assert.ok(iClaim > 0 && iPledge > iClaim, "SKILL.md must offer claimFirst.tx before the pledgeTx step (4a before 4b)");
assert.ok(skill.includes('"0x817db73b"') && skill.includes("74 characters"), "SKILL.md claimFirst calldata rule (collectFees selector 0x817db73b) changed");
ok("claimFirst.tx offered before pledgeTx, collectFees rule present");

// 5. the public API host must be filled in (placeholder left from the template)
const placeholders = [["SKILL.md", skill], ["catalog.json", JSON.stringify(catalog)]].filter(([, s]) => s.includes("FEEDESK_API_HOST")).map(([f]) => f);
if (placeholders.length) {
  console.error(`FAIL  FEEDESK_API_HOST placeholder still in ${placeholders.join(" and ")}: set FD=https://<public agent host> (AGENT_PUBLIC_URL) before publishing the skill`);
  process.exit(1);
}
ok("FD host filled in (no FEEDESK_API_HOST placeholder)");
console.log("skill check passed");
