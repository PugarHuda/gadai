// Checks the Grok Bot package against Agent Plugins 1.1.0 (plugin.json) and the Agent Skills spec (SKILL.md).
// Run: node grok/check.mjs   (zero deps; the full JSON Schema check is in docs/distribution.md)
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const HERE = dirname(fileURLToPath(import.meta.url));
const ok = (m) => console.log(`ok  ${m}`);

// plugin.json: closed schema, required $schema + name, name pattern (spec §5.2-5.5)
const p = JSON.parse(readFileSync(join(HERE, "plugin.json"), "utf8"));
const ALLOWED = ["$schema", "name", "version", "description", "author", "homepage", "repository", "license", "keywords", "extensions"];
for (const k of Object.keys(p)) assert.ok(ALLOWED.includes(k), `plugin.json: unknown top-level field ${k}`);
assert.equal(p.$schema, "https://agent-plugins.org/schemas/1.1.0/plugin.schema.json");
assert.match(p.name, /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/);
assert.ok(p.name.length <= 64);
for (const k of Object.keys(p.author ?? {})) assert.ok(["name", "email", "url"].includes(k), `author.${k} not allowed`);
ok(`plugin.json valid (${p.name} ${p.version})`);

// skills/<dir>/SKILL.md: name == dir, a-z0-9- ≤64, description 1..1024, compatibility ≤500, metadata string map
const dirs = readdirSync(join(HERE, "skills"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
assert.ok(dirs.length > 0, "no skills");
for (const dir of dirs) {
  const md = readFileSync(join(HERE, "skills", dir, "SKILL.md"), "utf8");
  const fm = md.match(/^---\n([\s\S]*?)\n---\n/)?.[1];
  assert.ok(fm, `${dir}: no frontmatter`);
  const field = (k) => fm.match(new RegExp(`^${k}: (.+)$`, "m"))?.[1];
  assert.equal(field("name"), dir, `${dir}: name must match folder`);
  assert.match(dir, /^(?!-)(?!.*--)[a-z0-9-]{1,64}(?<!-)$/, `${dir}: bad skill name`);
  const desc = field("description");
  assert.ok(desc && desc.length <= 1024, `${dir}: description missing or > 1024 chars`);
  assert.ok((field("compatibility") ?? "").length <= 500, `${dir}: compatibility > 500 chars`);
  for (const [, v] of fm.matchAll(/^  [a-z_-]+: (.+)$/gm)) assert.match(v, /^".*"$/, `${dir}: metadata values must be strings`);
  // Grok Bot's six parts of a useful skill (docs.x.ai/grok-bot/skills-routines-and-automations)
  for (const h of ["When to use", "Required inputs and access", "Sequence of work", "How to validate the result", "What to return", "What requires approval"])
    assert.ok(md.includes(`. ${h}`), `${dir}: missing section "${h}"`);
  assert.match(md, /^FD=https:\/\/\S+$/m, `${dir}: FD host not set`);
  assert.equal(md.match(/^FD=/gm).length, 1, `${dir}: FD= must be defined exactly once`);
  // demo-fork guard: check demoFork via /api/health or /api/desk and forbid writes on a fork
  assert.match(md, /\$FD\/api\/(health|desk)"/, `${dir}: missing demo-fork check (curl $FD/api/health)`);
  assert.ok(md.includes("demoFork") && md.includes("DEMO fork of Base") && /not[*]* build, sign or submit/i.test(md), `${dir}: demo-fork guard must say DEMO fork of Base and not build, sign or submit`);
  ok(`skills/${dir}/SKILL.md valid (${desc.length}-char description)`);
}
