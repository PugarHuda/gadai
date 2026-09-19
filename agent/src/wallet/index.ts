// Dynamic agent wallet (agent signing token pattern, docs/integrations/dynamic.md §1).
// The underwriter agent is its own Dynamic user: it signs in with AGENT_SIGNING_TOKEN (SIWE), binds a P-256
// session key, and drives a 2-of-2 MPC wallet it owns. Every on-chain write the desk makes goes through here.
// The Dynamic MPC SDK ships Linux/macOS native addons only, so it is imported lazily: the rest of the agent
// (and its tests) still loads on Windows, and getAgentWallet() fails loudly there.
import { concat, createPublicClient, encodeFunctionData, http, parseAbi, type Abi, type Account, type Chain, type Transport, type WalletClient } from "viem";
import { readFileSync, writeFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { Attribution } from "ox/erc8021";
import { ADDR, ERC20_ABI, FEE_DESK_ABI, type Address, type Hex } from "@feedesk/shared";
import { need, type AgentWallet, type Ctx, type SentTx } from "../ctx.ts";

// Hand-typed subset of @dynamic-labs-wallet/{node,node-evm}@1.1.13 (their index.esm.d.ts re-exports an
// extensionless path that `moduleResolution: nodenext` can't follow, so tsc sees an empty module).
type WalletSecrets = { walletMetadata: { accountAddress: string } & Record<string, unknown>; externalServerKeyShares?: unknown[]; password?: string };
type EvmClient = {
  authenticateJwt(jwt: string, o: { getSessionSignature: (m: string) => Promise<string> }): Promise<void>;
  refreshAuthToken(): Promise<string>;
  createWalletAccount(o: { thresholdSignatureScheme: string; password?: string; backUpToDynamic?: boolean }): Promise<{ walletMetadata: WalletSecrets["walletMetadata"]; externalServerKeyShares: unknown[] }>;
  getWalletClient(o: WalletSecrets & { chain?: Chain; rpcUrl?: string }): Promise<WalletClient<Transport, Chain, Account>>;
};
type Dyn = {
  node: {
    createAuthClient(o: { environmentId: string; appOrigin?: string }): {
      wallet: { signIn(p: { address: string; signMessage: (m: string) => Promise<string>; sessionPublicKey?: string; statement?: string }): Promise<{ jwt: string; expiresAt: number; userId?: string }> };
    };
    signSessionMessage(message: string, privateKeyJwk: JsonWebKey): Promise<string>;
    generateSessionKeyPair(): Promise<{ publicKeyHex: string; privateKeyJwk: JsonWebKey }>;
    ThresholdSignatureScheme: { TWO_OF_TWO: string };
  };
  evm: { DynamicEvmWalletClient: new (o: { environmentId: string; enableMPCAccelerator?: boolean }) => EvmClient };
};
export async function loadSdk(): Promise<Dyn> {
  if (process.platform === "win32")
    throw new Error("Dynamic MPC SDK has no Windows binaries: run the agent in Docker (`pnpm agent:docker`) or WSL");
  const [node, evm] = await Promise.all([import("@dynamic-labs-wallet/node"), import("@dynamic-labs-wallet/node-evm")]);
  return { node, evm } as unknown as Dyn;
}

/** Signs the agent in (SIWE with the agent signing token) and returns an authenticated Dynamic EVM client. */
export async function signInAgent() {
  const sdk = await loadSdk();
  const environmentId = need("DYNAMIC_ENVIRONMENT_ID");
  const privateKeyJwk = JSON.parse(need("DYNAMIC_SESSION_KEY_JWK")) as JsonWebKey;
  const sessionPublicKey = need("DYNAMIC_SESSION_PUBLIC_KEY_HEX");
  const agent = privateKeyToAccount(need("AGENT_SIGNING_TOKEN") as Hex);
  const auth = sdk.node.createAuthClient({ environmentId, appOrigin: need("DYNAMIC_APP_ORIGIN") });
  const client = new sdk.evm.DynamicEvmWalletClient({ environmentId, enableMPCAccelerator: false });
  const getSessionSignature = (m: string) => sdk.node.signSessionMessage(m, privateKeyJwk);
  let expiresAtMs = 0;
  const siwe = async () => {
    const r = await siweGate(() => auth.wallet.signIn({
      address: agent.address,
      signMessage: (message) => agent.signMessage({ message }),
      sessionPublicKey,
      statement: "Gadai underwriter agent sign-in",
    }));
    const exp = r.expiresAt < 1e12 ? r.expiresAt * 1000 : r.expiresAt; // seconds or ms; not specified in typings
    await client.authenticateJwt(r.jwt, { getSessionSignature });
    expiresAtMs = exp;
    saveSession({ address: agent.address, jwt: r.jwt, expiresAtMs: exp });
  };
  /** Reuse the persisted JWT (same agent, same session key) until it expires; full SIWE only when there is none. */
  const login = async () => {
    const s = loadSession(agent.address);
    if (s) {
      try {
        await client.authenticateJwt(s.jwt, { getSessionSignature });
        expiresAtMs = s.expiresAtMs;
        return;
      } catch { /* revoked or bound to another session key: fall through to SIWE */ }
    }
    await siwe();
  };
  await login();
  /** Re-auth before expiry: refresh first, full SIWE sign-in if past refreshExp (no human needed). */
  const ensureFresh = async () => {
    if (Date.now() < expiresAtMs - 60_000) return;
    try {
      const jwt = await client.refreshAuthToken();
      expiresAtMs = jwtExpMs(jwt) ?? Date.now() + 5 * 60_000; // no exp claim: re-check in 5 min
      saveSession({ address: agent.address, jwt, expiresAtMs });
    } catch {
      await siwe();
    }
  };
  return { sdk, client, agentAddress: agent.address, login, ensureFresh };
}

// ─── SIWE rate-limit hygiene: Dynamic 429s sign-ins, and a restart loop or retrying callers keep that alive ───
/** Thrown (without touching the network) while a sign-in is backing off after a Dynamic 429. */
export class DynamicRateLimited extends Error {
  retryInSec: number;
  constructor(retryInSec: number) { super(`Dynamic sign-in rate-limited (429); retry in ${retryInSec}s`); this.retryInSec = retryInSec; }
}
const SESSION_FILE = () => process.env.DYNAMIC_SESSION_CACHE || "./.dynamic-session.json";
type Session = { address: string; jwt: string; expiresAtMs: number };
function loadSession(address: string): Session | null {
  try {
    const s = JSON.parse(readFileSync(SESSION_FILE(), "utf8")) as Session;
    return s.address === address && s.expiresAtMs - Date.now() > 2 * 60_000 ? s : null;
  } catch { return null; }
}
function saveSession(s: Session) {
  try { writeFileSync(SESSION_FILE(), JSON.stringify(s), { mode: 0o600 }); } catch { /* cache only */ }
}
const is429 = (e: unknown) => {
  const x = e as { status?: number; response?: { status?: number }; message?: string };
  return x?.status === 429 || x?.response?.status === 429 || /\b429\b/.test(String(x?.message ?? ""));
};
const retryAfterSec = (e: unknown) => {
  const h = (e as { response?: { headers?: Record<string, string> } })?.response?.headers?.["retry-after"];
  const n = Number(h);
  return Number.isFinite(n) && n > 0 ? n : null;
};
let blockedUntil = 0, backoffMs = 0, inflight: Promise<unknown> | null = null;
/** Single-flight SIWE with exponential backoff + jitter on 429 (honours Retry-After when exposed). Exported for tests. */
export async function siweGate<T>(signIn: () => Promise<T>, now = Date.now): Promise<T> {
  if (inflight) return inflight as Promise<T>;
  const wait = blockedUntil - now();
  if (wait > 0) throw new DynamicRateLimited(Math.ceil(wait / 1000));
  const p = signIn().then(
    (r) => { backoffMs = 0; return r; },
    (e) => {
      if (is429(e)) {
        backoffMs = Math.min(backoffMs ? backoffMs * 2 : 60_000, 30 * 60_000);
        const ra = retryAfterSec(e);
        blockedUntil = now() + (ra ? ra * 1000 : backoffMs * (0.8 + Math.random() * 0.4));
        throw new DynamicRateLimited(Math.ceil((blockedUntil - now()) / 1000));
      }
      throw e;
    },
  ).finally(() => { inflight = null; });
  inflight = p;
  return p;
}
export const resetSiweGate = () => { blockedUntil = 0; backoffMs = 0; inflight = null; };

export function readWalletSecrets() {
  const hint = "(run `pnpm --filter @feedesk/agent bootstrap:dynamic` once and paste its output into .env)";
  const meta = process.env.DYNAMIC_AGENT_WALLET_METADATA;
  const shares = process.env.DYNAMIC_AGENT_KEY_SHARES;
  if (!meta) throw new Error(`Missing env DYNAMIC_AGENT_WALLET_METADATA ${hint}`);
  if (!shares) throw new Error(`Missing env DYNAMIC_AGENT_KEY_SHARES ${hint}`);
  return { walletMetadata: JSON.parse(meta), externalServerKeyShares: JSON.parse(shares), password: process.env.DYNAMIC_WALLET_PASSWORD || undefined }; // ponytail: unset when the wallet was created without a password/Dynamic backup
}

/** `exp` claim of a JWT in ms, or undefined if it has none. */
export function jwtExpMs(jwt: string): number | undefined {
  try {
    const exp = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString()).exp;
    return typeof exp === "number" ? exp * 1000 : undefined;
  } catch { return undefined; }
}

/** ERC-8021 Base Builder Code suffix (docs.base.org/specifications/builder-codes/for-agent-developers), or none if unset.
 *  Indexers read it from the calldata tail; ABI decoding ignores trailing bytes, so contracts are unaffected. */
export const builderSuffix = (code = process.env.BASE_BUILDER_CODE): Hex | undefined =>
  code ? (Attribution.toDataSuffix({ codes: [code] }) as Hex) : undefined;
/** Append the builder-code suffix to calldata (no-op when unset). */
export const withBuilderCode = (data: Hex, code = process.env.BASE_BUILDER_CODE): Hex => {
  const s = builderSuffix(code);
  return s ? concat([data, s]) : data;
};

const toAbi = (abi: Abi | readonly unknown[]): Abi =>
  (typeof abi[0] === "string" ? parseAbi(abi as readonly string[]) : abi) as Abi;

/** True only for a 401 from Dynamic's own API: WalletApiError(status 401) from @dynamic-labs-wallet/core, or the raw
 *  axios error it wraps. Walks viem's `cause` chain. An RPC 401 (viem HttpRequestError) or an `Unauthorized()` revert is NOT one. */
export function isDynamicAuthErr(e: unknown): boolean {
  for (let x = e as any, i = 0; x && i < 10; x = x.cause, i++) {
    if (x.name === "WalletApiError" && x.status === 401) return true;
    if (x.isAxiosError === true && x.response?.status === 401) return true;
  }
  return false;
}

/** Serial tx queue + Dynamic re-auth. `serial` runs one job at a time (nonces never collide across keeper/cca/flynet loops;
 *  ponytail: global lock, fine at desk volume). `authed` wraps ONLY the sign+broadcast call: a Dynamic 401 there means
 *  the MPC signature was never produced, so nothing was broadcast and one retry after a fresh sign-in cannot double-send.
 *  Receipt waits stay outside `authed`, so a failure after broadcast is never retried. */
export function txQueue(s: { ensureFresh(): Promise<void>; login(): Promise<void> }) {
  let lock: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = lock.then(async () => { await s.ensureFresh(); return fn(); });
    lock = run.catch(() => {});
    return run;
  };
  const authed = async <T>(fn: () => Promise<T>): Promise<T> => {
    try { return await fn(); } catch (e) {
      if (!isDynamicAuthErr(e)) throw e;
      await s.login(); // Dynamic session died mid-flight: sign in again, retry once
      return fn();
    }
  };
  return { serial, authed };
}

/** Same EIP-712 digest, shape the Dynamic MPC signer accepts: Flash's typed data carries an explicit EIP712Domain type and a
 *  string chainId, which made the relay drop the WebSocket (seen live on Base mainnet). viem derives EIP712Domain from `domain`. */
export function forMpcSigner<T extends { types?: Record<string, unknown>; domain?: { chainId?: unknown } }>(td: T): T {
  const { EIP712Domain: _d, ...types } = (td.types ?? {}) as Record<string, unknown>;
  const domain = td.domain && td.domain.chainId !== undefined ? { ...td.domain, chainId: Number(td.domain.chainId) } : td.domain;
  return { ...td, types, domain };
}

/** Build the desk's AgentWallet. Checks the address matches AGENT_WALLET_ADDRESS and FeeDesk.keeper(). */
export async function getAgentWallet(ctx: Ctx): Promise<AgentWallet> {
  const s = await signInAgent();
  const secrets = readWalletSecrets();
  const wc = await s.client.getWalletClient({ ...secrets, chain: base, rpcUrl: ctx.rpcUrl });
  const address = wc.account.address as Address;

  const expected = process.env.AGENT_WALLET_ADDRESS;
  if (expected && expected.toLowerCase() !== address.toLowerCase())
    throw new Error(`Dynamic wallet ${address} != AGENT_WALLET_ADDRESS ${expected}: wrong DYNAMIC_AGENT_WALLET_METADATA or signing token`);
  const keeper = (await ctx.pub.readContract({ address: ctx.deskAddress, abi: parseAbi(FEE_DESK_ABI), functionName: "keeper" })) as Address;
  if (keeper.toLowerCase() !== address.toLowerCase())
    throw new Error(`FeeDesk ${ctx.deskAddress}.keeper() is ${keeper}, not the Dynamic agent wallet ${address}: call setKeeper(${address})`);

  const { serial, authed } = txQueue(s);
  const wait = async (hash: Hex): Promise<SentTx> => {
    const receipt = await ctx.pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
    if (receipt.status !== "success") throw new Error(`tx ${hash} reverted`);
    return { hash, receipt };
  };

  const w: AgentWallet = {
    address,
    walletClient: wc,
    write: ({ address: to, abi, functionName, args = [], value }) =>
      serial(async () => {
        // simulate first: surfaces the decoded revert reason instead of a bare "reverted"
        await ctx.pub.simulateContract({ account: wc.account, address: to, abi: toAbi(abi), functionName, args, value });
        // single send chokepoint: encode ourselves and append the ERC-8021 suffix (wc.writeContract's dataSuffix
        // depends on the Dynamic SDK's bundled viem honouring it; plain concat does not)
        const data = withBuilderCode(encodeFunctionData({ abi: toAbi(abi), functionName, args } as never));
        const hash = await authed(() => wc.sendTransaction({ to, data, value, account: wc.account, chain: base }));
        ctx.log("wallet", `${functionName} → ${to}`, { hash });
        return wait(hash);
      }),
    send: ({ to, data, value }) =>
      serial(async () => {
        const hash = await authed(() => wc.sendTransaction({ to, data: withBuilderCode(data), value, account: wc.account, chain: base }));
        ctx.log("wallet", `raw tx → ${to}`, { hash });
        return wait(hash);
      }),
    signTypedData: (json) =>
      serial(() => authed(() => wc.signTypedData({ account: wc.account, ...(forMpcSigner(JSON.parse(json)) as Parameters<typeof wc.signTypedData>[0]) }))),
    signMessage: (message) => serial(() => authed(() => wc.signMessage({ account: wc.account, message }))),
  };
  ctx.log("wallet", `Dynamic agent wallet ready ${address} on ${ctx.demoFork ? "DEMO_FORK " : ""}${ctx.rpcUrl}`);
  return w;
}

/** DEMO_FORK only: give the agent wallet gas + USDC on the Anvil fork (anvil_* cheatcodes; refuses on a real chain). */
export async function fundOnFork(rpcUrl: string, to: Address, usdcRaw: bigint): Promise<void> {
  const pub = createPublicClient({ chain: base, transport: http(rpcUrl) });
  const rpc = (method: string, params: unknown[]) => pub.request({ method, params } as never);
  try {
    await rpc("anvil_nodeInfo", []);
  } catch {
    throw new Error(`${rpcUrl} is not an Anvil node: refusing to use cheatcodes (DEMO_FORK only)`);
  }
  const whale = "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB"; // Aave v3 aBasUSDC, holds ~$21M USDC on Base (checked 2026-09-18)
  await rpc("anvil_setBalance", [to, "0x8AC7230489E80000"]); // 10 ETH
  await rpc("anvil_setBalance", [whale, "0x8AC7230489E80000"]);
  await rpc("anvil_impersonateAccount", [whale]);
  const data = encodeFunctionData({ abi: parseAbi(ERC20_ABI), functionName: "transfer", args: [to, usdcRaw] });
  const hash = (await rpc("eth_sendTransaction", [{ from: whale, to: ADDR.USDC, data }])) as Hex;
  await rpc("anvil_stopImpersonatingAccount", [whale]);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`fork USDC funding tx ${hash} reverted`);
}
