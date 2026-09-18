// Exports FeeDesk/FeeVault/FeeNote ABIs from forge artifacts into shared/:
//   - shared/src/abi/{FeeDesk,FeeVault,FeeNote}.json  (raw JSON ABI)
//   - the FEE_DESK_ABI / FEE_VAULT_ABI / FEE_NOTE_ABI human-readable constants in shared/src/index.ts
// Run after `forge build`:  node script/exportAbi.mjs   (from contracts/)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const shared = join(root, "shared", "src");
const type = (p) => {
  if (!p.type.startsWith("tuple")) return p.type;
  return `(${p.components.map(param).join(", ")})${p.type.slice(5)}`;
};
const param = (p) => [type(p), p.indexed ? "indexed" : "", p.name].filter(Boolean).join(" ");
const sig = (i) => {
  const ins = (i.inputs ?? []).map(param).join(", ");
  if (i.type === "function") {
    const mut = i.stateMutability === "nonpayable" ? "" : ` ${i.stateMutability}`;
    const outs = i.outputs?.length ? ` returns (${i.outputs.map(param).join(", ")})` : "";
    return `function ${i.name}(${ins})${mut}${outs}`;
  }
  if (i.type === "event") return `event ${i.name}(${ins})`;
  if (i.type === "error") return `error ${i.name}(${ins})`;
  return null; // constructor/fallback: not needed by consumers
};

mkdirSync(join(shared, "abi"), { recursive: true });
let src = readFileSync(join(shared, "index.ts"), "utf8");
for (const [name, konst] of [["FeeDesk", "FEE_DESK_ABI"], ["FeeVault", "FEE_VAULT_ABI"], ["FeeNote", "FEE_NOTE_ABI"]]) {
  const abi = JSON.parse(readFileSync(join(root, "contracts", "out", `${name}.sol`, `${name}.json`), "utf8")).abi;
  writeFileSync(join(shared, "abi", `${name}.json`), JSON.stringify(abi, null, 2) + "\n");
  const lines = abi.map(sig).filter(Boolean).map((s) => `  ${JSON.stringify(s)},`).join("\n");
  const re = new RegExp(`export const ${konst} = \\[[\\s\\S]*?\\] as const;`);
  if (!re.test(src)) throw new Error(`${konst} not found in shared/src/index.ts`);
  src = src.replace(re, `export const ${konst} = [\n${lines}\n] as const;`);
}
writeFileSync(join(shared, "index.ts"), src);
console.log("exported FeeDesk, FeeVault, FeeNote ABIs to shared/");
