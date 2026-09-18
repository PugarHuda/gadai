// Shared runtime context passed to every agent module. Owned by the architect; change via docs/COORDINATION.md.
import type { DatabaseSync } from "node:sqlite";
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
