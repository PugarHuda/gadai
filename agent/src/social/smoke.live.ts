// Live smoke for flash+social against real Flash + Base mainnet (no wallet, no tx). Run: FLASH_API_KEY=... node src/social/smoke.live.ts
import { createPublicClient, http, hashTypedData, type PublicClient } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { Hono } from "hono";
import { createHmac } from "node:crypto";
import { ADDR, TEST_POOL, followMessage, type Memo, type Quote } from "@feedesk/shared";
import { openDb, insertLoan } from "../db/index.ts";
import { searchToken, flash, parseTypedData, assertVaultOrder } from "../flash/index.ts";
import * as social from "./index.ts";
import type { Ctx } from "../ctx.ts";

const ctx: Ctx = {
  db: openDb(":memory:"), pub: createPublicClient({ chain: base, transport: http("https://base-rpc.publicnode.com") }) as PublicClient,
  rpcUrl: "", demoFork: false, deskAddress: "0x0000000000000000000000000000000000000001", publicUrl: "", webUrl: "",
  wallet: () => { throw new Error("no wallet in smoke"); }, log: (m, s) => console.log(`[${m}] ${s}`),
};
const token = TEST_POOL.token as `0x${string}`;
console.log("search:", await searchToken(token));

// 1. token-leg TWAP quote as the vault would request it (funder = a contract), parsed + asserted + hashed
const fakeVault = "0x1074393effFCf1A15e306cD3931F48eDA9ABcd55";
const q = await flash("/quote", { targetChain: "base", contraChain: "base", targetAsset: token, contraAsset: ADDR.USDC, side: "sell", qty: "100000", orderType: "twap", durationSeconds: 3600, twapBucketCount: 12, funderAddress: fakeVault });
const td = parseTypedData(q.evm.orderTypedData);
assertVaultOrder(td, fakeVault, token, 100000n * 10n ** 18n);
console.log("twap quote ok: impact", q.estimatedPriceImpact, "usdcOut", q.to.amount, "digest", hashTypedData(td));

// 2. follow via signed REST, then an approval signal queues a mirror, then quote it (bracket), and a dca one
const app = new Hono();
social.register(app, ctx);
const acct = privateKeyToAccount(generatePrivateKey());
const mk = async (mode: "bracket" | "dca") => {
  const f = { follower: acct.address, personaId: "prudent", mode, sizeUsdc: 5, tpPct: 50, slPct: 20, dcaDays: 3, auto: false };
  const nonce = crypto.randomUUID();
  const r = await app.request("/api/follows", { method: "POST", body: JSON.stringify({ ...f, nonce, signature: await acct.signMessage({ message: followMessage(f, nonce) }) }) });
  console.log("POST /api/follows", mode, r.status, await r.text());
};
await mk("bracket"); await mk("dca");
const bad = await app.request("/api/follows", { method: "POST", body: JSON.stringify({ follower: acct.address, personaId: "prudent", mode: "dca", sizeUsdc: 5, tpPct: 0, slPct: 0, dcaDays: 3, auto: false, nonce: "abcdefgh12", signature: "0x" + "11".repeat(65) }) });
console.log("forged follow ->", bad.status, await bad.text());

const loanId = insertLoan(ctx.db, { status: "APPROVED", borrower: TEST_POOL.beneficiary as any, token, symbol: "GITLAWB", poolId: TEST_POOL.poolId as any, feesManager: TEST_POOL.feesManager as any });
const memo: Memo = { personaId: "prudent", model: "m", decision: "approve", principalRaw: "10000000", maxNotePrice: 0.93, confidence: 0.72, rationale: "steady fees", risks: [] };
const quote = { inputs: { token, symbol: "GITLAWB" } } as unknown as Quote;
console.log("signals:", social.publishSignals(ctx, loanId, [memo, { ...memo, personaId: "skeptic", decision: "decline", confidence: 0.4 }], quote));
const mirrors = await (await app.request(`/api/mirrors?follower=${acct.address}`)).json();
console.log("mirrors:", mirrors.map((m: any) => `${m.id}:${m.mode}:${m.status}`));
const qids: Record<number, string> = {};
for (const m of mirrors) {
  const r = await app.request(`/api/mirrors/${m.id}/quote`, { method: "POST" });
  const mq = await r.json();
  qids[m.id] = mq.quoteId;
  console.log(`quote mirror ${m.id} (${m.mode}) ->`, r.status, JSON.stringify({ ...mq, orderTypedData: mq.orderTypedData?.slice(0, 60), bracket: mq.bracket && { approveTxs: mq.bracket.approveTxs.map((t: any) => t.label), permit: !!mq.bracket.permitTypedData } }));
}
// submit with a garbage signature: Flash must reject, mirror -> failed with Flash's error (no fake success)
const sub = await app.request(`/api/mirrors/${mirrors[0].id}/submit`, { method: "POST", body: JSON.stringify({ quoteId: qids[mirrors[0].id], userSignature: "0x" + "22".repeat(65), bracketUserSignature: "0x" + "22".repeat(65), bracketPermitSignature: "0x" + "22".repeat(65), evmPermitSignature: "0x" + "22".repeat(65) }) });
console.log("bogus submit ->", sub.status, (await sub.text()).slice(0, 300));
console.log("leaderboard:", JSON.stringify(await (await app.request("/api/leaderboard")).json()));
console.log("signals route:", (await (await app.request("/api/signals?personaId=prudent")).json()).length);

// 3. webhook HMAC
process.env.DYNAMIC_WEBHOOK_SECRET = "whsec_test";
const body = JSON.stringify({ eventName: "wallet.delegation.created", eventId: crypto.randomUUID(), timestamp: new Date().toISOString(), userId: "u1", data: { chain: "EVM", publicKey: acct.address, walletId: "w1", userId: "u1", encryptedDelegatedShare: { alg: "x", iv: "", ct: "", tag: "", ek: "" }, encryptedWalletApiKey: { alg: "x", iv: "", ct: "", tag: "", ek: "" } } });
const sig = "sha256=" + createHmac("sha256", "whsec_test").update(body).digest("hex");
console.log("webhook good ->", (await app.request("/api/dynamic/webhook", { method: "POST", body, headers: { "x-dynamic-signature-256": sig } })).status,
  "bad ->", (await app.request("/api/dynamic/webhook", { method: "POST", body, headers: { "x-dynamic-signature-256": "sha256=00" } })).status,
  "stored:", ctx.db.prepare("SELECT address, wallet_id, revoked_at FROM delegations").all());

// 4. real signature from the follower key over parsed typed data: Flash must pass sig verification (then fail on funds/allowance)
const r2 = await app.request(`/api/mirrors/${mirrors[0].id}/quote`, { method: "POST" });
const mq2 = await r2.json();
const s2 = await app.request(`/api/mirrors/${mirrors[0].id}/submit`, { method: "POST", body: JSON.stringify({ quoteId: mq2.quoteId, userSignature: await acct.signTypedData(parseTypedData(mq2.orderTypedData) as any) }) });
console.log("signed submit ->", s2.status, (await s2.text()).slice(0, 400));
