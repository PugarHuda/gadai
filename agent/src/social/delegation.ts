// Dynamic delegated access for auto-mirroring (docs/integrations/dynamic.md §3; webhook docs
// /react/wallets/embedded-wallets/mpc/delegated-access/{receiving,revoking}-delegation.md).
// We store only the ENCRYPTED webhook payload and decrypt per signature. Dynamic's MPC SDK is Linux/macOS-only,
// so it is imported lazily: the rest of social keeps working on Windows.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { PublicClient } from "viem";
import type { Address, Hex } from "@feedesk/shared";
import { need, type Ctx } from "../ctx.ts";
import { now, useNonce } from "../db/index.ts";
import { parseTypedData } from "../flash/index.ts";

export const DELEGATION_ENV = ["DYNAMIC_ENVIRONMENT_ID", "DYNAMIC_AUTH_TOKEN", "DYNAMIC_WEBHOOK_SECRET", "DYNAMIC_DELEGATION_PRIVATE_KEY"] as const;
export const missingDelegationEnv = () => DELEGATION_ENV.filter((k) => !process.env[k]);

/** `x-dynamic-signature-256` = "sha256=" + HMAC-SHA256(secret, body). Docs HMAC JSON.stringify(parsed); we accept raw or re-serialized. */
export function verifyWebhook(raw: string, header: string | undefined, secret: string): boolean {
  if (!header) return false;
  const ok = (payload: string) => {
    const want = Buffer.from(`sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`, "ascii");
    const got = Buffer.from(header, "ascii");
    return want.length === got.length && timingSafeEqual(want, got);
  };
  try { return ok(raw) || ok(JSON.stringify(JSON.parse(raw))); } catch { return false; }
}

/** Apply a verified webhook: created → upsert encrypted share; revoked → mark revoked. Other events ignored.
 *  Replay-safe: `eventId` is single-use (Dynamic: "use the eventId as an idempotency key"), and event `timestamp`
 *  ordering is enforced per wallet, so a late/replayed `created` can never undo a newer revoke. */
export function applyWebhook(ctx: Ctx, body: any): string {
  const ev = body?.eventName, ts = body?.timestamp, walletId = body?.data?.walletId;
  if (ev !== "wallet.delegation.created" && ev !== "wallet.delegation.revoked") return "ignored";
  if (typeof body.eventId !== "string" || typeof ts !== "string" || Number.isNaN(Date.parse(ts)) || !walletId) return "ignored: missing eventId/timestamp/walletId";
  const at = new Date(ts).toISOString(); // normalized so string comparison == time comparison
  if (!useNonce(ctx.db, `dynamic-webhook:${body.eventId}`)) return "ignored: duplicate eventId";
  const revokedAt = (ctx.db.prepare("SELECT value FROM kv WHERE key = ?").get(`dynamic-revoked:${walletId}`) as { value: string } | undefined)?.value;
  if (ev === "wallet.delegation.created") {
    const d = body.data;
    if (d?.chain !== "EVM" || !d.publicKey) return "ignored: not an EVM delegation";
    if (revokedAt && revokedAt >= at) return "ignored: created event older than a revoke";
    const cur = ctx.db.prepare("SELECT created_at FROM delegations WHERE address = ?").get(String(d.publicKey).toLowerCase()) as { created_at: string } | undefined;
    if (cur && cur.created_at >= at) return "ignored: older than the stored delegation";
    ctx.db.prepare(`INSERT INTO delegations (address,wallet_id,user_id,encrypted_json,created_at,revoked_at) VALUES (?,?,?,?,?,NULL)
      ON CONFLICT(address) DO UPDATE SET wallet_id=excluded.wallet_id, user_id=excluded.user_id, encrypted_json=excluded.encrypted_json,
      created_at=excluded.created_at, revoked_at=NULL`)
      .run(String(d.publicKey).toLowerCase(), walletId, d.userId ?? body.userId, JSON.stringify({
        encryptedDelegatedShare: d.encryptedDelegatedShare, encryptedWalletApiKey: d.encryptedWalletApiKey, shareSetId: d.shareSetId ?? null,
      }), at);
    return "stored";
  }
  if (!revokedAt || revokedAt < at)
    ctx.db.prepare("INSERT INTO kv (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at")
      .run(`dynamic-revoked:${walletId}`, at, now());
  // Revokes anything created at or before this event (a revoke that arrives before its created is remembered in kv).
  ctx.db.prepare("UPDATE delegations SET revoked_at = ? WHERE wallet_id = ? AND created_at <= ?").run(at, walletId, at);
  return "revoked";
}

export const hasDelegation = (ctx: Ctx, address: Address) =>
  !!ctx.db.prepare("SELECT 1 FROM delegations WHERE address = ? AND revoked_at IS NULL").get(address.toLowerCase());

/** Signer that acts for a follower through Dynamic delegated MPC signing. Throws naming the missing env / delegation. */
export async function delegatedSigner(ctx: Ctx, address: Address, pub: PublicClient) {
  const row = ctx.db.prepare("SELECT * FROM delegations WHERE address = ? AND revoked_at IS NULL").get(address.toLowerCase()) as Record<string, string> | undefined;
  if (!row) throw new Error(`no active Dynamic delegation for ${address} (grant it on /desk)`);
  const enc = JSON.parse(row.encrypted_json);
  // ponytail: the packages' .d.ts uses an extensionless re-export nodenext cannot resolve, so these are typed any; shapes checked against node-evm/src/delegatedClient.d.ts 1.1.13.
  const { decryptDelegatedWebhookData }: any = await import("@dynamic-labs-wallet/node");
  const evm: any = await import("@dynamic-labs-wallet/node-evm");
  const { decryptedDelegatedShare: keyShare, decryptedWalletApiKey: walletApiKey } = decryptDelegatedWebhookData({
    privateKeyPem: need("DYNAMIC_DELEGATION_PRIVATE_KEY").replace(/\\n/g, "\n"),
    encryptedDelegatedKeyShare: enc.encryptedDelegatedShare,
    encryptedWalletApiKey: enc.encryptedWalletApiKey,
  });
  const client = evm.createDelegatedEvmWalletClient({ environmentId: need("DYNAMIC_ENVIRONMENT_ID"), apiKey: need("DYNAMIC_AUTH_TOKEN") });
  const auth = { walletId: row.wallet_id, walletApiKey, keyShare, ...(enc.shareSetId ? { shareSetId: enc.shareSetId } : {}) };
  return {
    signTypedData: async (json: string) => (await evm.delegatedSignTypedData(client, { ...auth, typedData: parseTypedData(json) as any })) as Hex,
    /** Full EIP-1559 tx on Base mainnet, signed by delegation, broadcast, receipt awaited. */
    send: async (tx: { to: Address; data: Hex }) => {
      const [nonce, gas, fees] = await Promise.all([
        pub.getTransactionCount({ address, blockTag: "pending" }),
        pub.estimateGas({ account: address, to: tx.to, data: tx.data }),
        pub.estimateFeesPerGas(),
      ]);
      const signed = await evm.delegatedSignTransaction(client, {
        ...auth,
        transaction: { type: "eip1559", chainId: 8453, to: tx.to, data: tx.data, value: 0n, nonce, gas: (gas * 12n) / 10n, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas },
      });
      const hash = await pub.sendRawTransaction({ serializedTransaction: signed as Hex });
      const receipt = await pub.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`delegated tx ${hash} reverted`);
      return hash;
    },
  };
}
