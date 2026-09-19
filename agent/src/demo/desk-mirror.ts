// The desk mirrors its own approved credit signal on Base MAINNET: a Definitive Flash TWAP buy of the approved
// borrower's token, funded and signed by the Dynamic agent wallet (the same order shape a DCA follower mirror uses).
// Usage (Linux/WSL): node --env-file=../.env src/demo/desk-mirror.ts <token> <usdc qty, e.g. 0.25> [minutes=10] [buckets=2]
import { createPublicClient, formatUnits, http, verifyTypedData, type Address, type Hex } from "viem";
import { base } from "viem/chains";
import { opt } from "../ctx.ts";
import { readWalletSecrets, signInAgent, withBuilderCode } from "../wallet/index.ts";
import { attributionFields, feeFields, flash } from "../flash/index.ts";

const [token, qty, minutes = "10", buckets = "2"] = process.argv.slice(2) as [Address, string, string?, string?];
if (!/^0x[0-9a-fA-F]{40}$/.test(token ?? "") || !(Number(qty) > 0) || Number(qty) > 1) throw new Error("usage: desk-mirror.ts <token> <usdc qty 0-1> [minutes] [buckets]");
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const rpcUrl = opt("BASE_RPC_URL", "https://mainnet.base.org");
const pub = createPublicClient({ chain: base, transport: http(rpcUrl) });

const s = await signInAgent();
const wc = await s.client.getWalletClient({ ...readWalletSecrets(), chain: base, rpcUrl });
const me = wc.account.address as Address;
const bal = await pub.readContract({ address: USDC, abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }], functionName: "balanceOf", args: [me] });
console.log(`desk ${me}: ${formatUnits(bal, 6)} USDC`);

const order = {
  targetChain: "base", contraChain: "base", targetAsset: token, contraAsset: USDC, side: "buy", qty,
  orderType: "twap", durationSeconds: Number(minutes) * 60, funderAddress: me, ...feeFields(),
};
const q = await flash("/quote", { ...order, twapBucketCount: Number(buckets) });
console.log(`flash quote ${q.quoteId}: impact ${q.estimatedPriceImpact}, est out ${q.to?.amount ?? "?"}`);
if (!q.evm?.orderTypedData) throw new Error("no evm.orderTypedData in quote");

if (q.evm.approveTx?.to) {
  const hash = await wc.sendTransaction({ to: q.evm.approveTx.to, data: withBuilderCode(q.evm.approveTx.data as Hex), account: wc.account, chain: base });
  const r = await pub.waitForTransactionReceipt({ hash });
  console.log(`approve (${r.status}): https://basescan.org/tx/${hash}`);
}
// Normalize for the Dynamic MPC signer (same EIP-712 digest): drop the explicit EIP712Domain type (viem derives it from
// `domain`) and make chainId a number. Verified below: the signature must recover to the desk wallet over Flash's typed data.
const norm = (raw: unknown) => {
  const t = typeof raw === "string" ? JSON.parse(raw) : structuredClone(raw);
  const { EIP712Domain: _drop, ...types } = t.types;
  return { ...t, types, domain: { ...t.domain, chainId: Number(t.domain.chainId) } };
};
const td = norm(q.evm.orderTypedData);
const userSignature = await wc.signTypedData({ account: wc.account, ...td });
if (!(await verifyTypedData({ address: me, ...td, signature: userSignature }))) throw new Error("signature does not recover to the desk wallet");
const extra = q.evm.permitTypedData
  ? { evmPermitTypedData: q.evm.permitTypedData, evmPermitSignature: await wc.signTypedData({ account: wc.account, ...norm(q.evm.permitTypedData) }) }
  : {};
const { orderId } = await flash("/order", { ...order, twapBucketCount: Number(buckets), quoteId: q.quoteId, userSignature, evmOrderTypedData: q.evm.orderTypedData, ...extra, ...attributionFields() });
console.log(`FLASH ORDER ${orderId} submitted (TWAP buy ${qty} USDC of ${token}, ${buckets} buckets / ${minutes} min)`);
for (let i = 0; i < 6; i++) {
  await new Promise((r) => setTimeout(r, 20_000));
  const o = await flash(`/orders/${orderId}?funderAddress=${me}`);
  console.log(`status ${o.order?.status ?? o.status} fills ${(o.fills ?? []).length}`, (o.fills ?? []).map((f: any) => f.transactionId ?? f.txHash).filter(Boolean).join(" "));
  if (/FILLED|COMPLETE|CANCEL|FAIL|EXPIRED/i.test(String(o.order?.status ?? o.status))) break;
}
