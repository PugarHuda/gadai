// ERC-8004 pure helpers: loan-outcome encoding + agent card shape. Run: pnpm --filter @feedesk/agent test
import { test } from "node:test";
import assert from "node:assert/strict";
import { toFunctionSelector } from "viem";
import { IDENTITY_REGISTRY, REPUTATION_REGISTRY, agentCard, cardUrl, decodeLoanOutcome, encodeLoanOutcome, identityAbi, outcomeKey, reputationAbi } from "./index.ts";

test("loan outcome round-trips through abi encoding", () => {
  const o = { status: "RELEASED", principalRaw: 10_000_000n, repaidRaw: 10_500_000n, txs: [`0x${"ab".repeat(32)}`, `0x${"01".repeat(32)}`] as `0x${string}`[] };
  const b = encodeLoanOutcome(o);
  assert.deepEqual(decodeLoanOutcome(b), o);
  assert.equal(outcomeKey(7), "gadai.loan.7");
});

test("ABI selectors match the deployed v2.0.0 registries (checked with cast code on Base)", () => {
  const sel = (abi: readonly unknown[], name: string) => toFunctionSelector((abi as { type: string; name: string }[]).find((x) => x.type === "function" && x.name === name) as never);
  assert.equal(sel(identityAbi, "register"), "0xf2c298be");
  assert.equal(sel(identityAbi, "setMetadata"), "0x466648da");
  assert.equal(sel(reputationAbi, "giveFeedback"), "0x3c036a7e");
  assert.equal(sel(reputationAbi, "getSummary"), "0x81bbba58");
});

test("agent card is an ERC-8004 registration-v1 file pointing at our registries", () => {
  const c = agentCard({ publicUrl: "https://agent.example/", webUrl: "https://web.example", agentId: 42n, wallet: "0x81b73786BF2dE819e66BB57d08effADe0085305D", personas: [{ id: "prudent", name: "Prudent", model: "m", style: "s" }] });
  assert.equal(c.type, "https://eips.ethereum.org/EIPS/eip-8004#registration-v1");
  assert.equal(c.name, "Gadai underwriter desk");
  assert.deepEqual(c.supportedTrust, ["reputation"]);
  assert.equal(c.chainId, 8453);
  assert.deepEqual(c.registrations, [{ agentId: 42, agentRegistry: `eip155:8453:${IDENTITY_REGISTRY}` }]);
  assert.equal(c.registries.reputation, `eip155:8453:${REPUTATION_REGISTRY}`);
  assert.ok(c.services.some((s) => s.name === "api" && s.endpoint === "https://agent.example/api"));
  assert.ok(c.services.some((s) => s.name === "agentWallet" && s.endpoint.endsWith("0x81b73786BF2dE819e66BB57d08effADe0085305D")));
  assert.equal(c.personas[0]!.id, "prudent");
  assert.equal(cardUrl("https://agent.example/"), "https://agent.example/.well-known/agent-card.json");
  assert.deepEqual(agentCard({ publicUrl: "x", webUrl: "y", agentId: null, wallet: null, personas: [] }).registrations, []);
});
