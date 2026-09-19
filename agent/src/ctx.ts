// Shared runtime context passed to every agent module. Owned by the architect; change via docs/COORDINATION.md.
import type { DatabaseSync } from "node:sqlite";
import { HTTPException } from "hono/http-exception";
import type { Hono } from "hono";
import type { Abi, PublicClient, TransactionReceipt, WalletClient } from "viem";
import type { Address, Hex } from "@feedesk/shared";

/** Required env var: throws with a pointer to .env.example. No silent defaults for secrets. */
export function need(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env ${key} (see .env.example)`);
  return v;
}
export const opt = (key: string, fallback: string): string => process.env[key] || fallback;

/**
 * Request body as a JSON object. Malformed JSON or a non-object (null, array, number) → HTTP 400 {error}, never a 500.
 * `optional`: an empty body reads as {}. Use this instead of a bare `await c.req.json()` in every route.
 */
export async function jsonBody<T = Record<string, unknown>>(c: { req: { text(): Promise<string> } }, optional = false): Promise<T> {
  const text = await c.req.text();
  if (optional && !text.trim()) return {} as T;
  let v: unknown;
  try { v = JSON.parse(text); } catch { throw new HTTPException(400, { message: "request body must be valid JSON" }); }
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new HTTPException(400, { message: "request body must be a JSON object" });
  return v as T;
}

/** Route/query ids and counts: a positive safe integer, else 400 (never NaN reaching a DB lookup). */
export function posInt(v: unknown, name: string): number {
  const n = typeof v === "string" && /^\d{1,15}$/.test(v) ? Number(v) : NaN;
  if (!(n >= 1)) throw new HTTPException(400, { message: `${name} must be a positive integer` });
  return n;
}
/** 0x address query/body value, else 400. Returned lowercase (how the social tables store it). */
export function addrParam(v: unknown, name: string): string {
  if (typeof v !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(v)) throw new HTTPException(400, { message: `${name} must be a 0x address` });
  return v.toLowerCase();
}

export type SentTx = { hash: Hex; receipt: TransactionReceipt };

/** Dynamic agent wallet (module `wallet`). Every on-chain write by the desk goes through `write`/`send`. */
export type AgentWallet = {
  address: Address;
  walletClient: WalletClient;
  /** encode + send + wait for receipt; throws on revert. */
  write(args: { address: Address; abi: Abi | readonly unknown[]; functionName: string; args?: readonly unknown[]; value?: bigint }): Promise<SentTx>;
  /** raw tx (e.g. Uniswap/Flash approve calldata) */
  send(args: { to: Address; data: Hex; value?: bigint }): Promise<SentTx>;
  signTypedData(typedDataJson: string): Promise<Hex>;
  signMessage(message: string): Promise<Hex>;
};

export type Ctx = {
  db: DatabaseSync;
  pub: PublicClient;
  rpcUrl: string;
  demoFork: boolean;
  deskAddress: Address;
  publicUrl: string; // AGENT_PUBLIC_URL (tunnel/deployed), used for OAuth + webhooks + skill
  webUrl: string;
  wallet: () => Promise<AgentWallet>; // memoized; throws loudly if Dynamic env missing
  log: (module: string, msg: string, data?: unknown) => void;
};

/** Every module's index.ts may export these; plus the named functions listed in SPEC §5. */
export type AgentModule = {
  register?: (app: Hono, ctx: Ctx) => void;
  start?: (ctx: Ctx) => () => void;
};
