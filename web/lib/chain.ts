import { createPublicClient, http, parseAbi, type Hex } from "viem";
import { base } from "viem/chains";
import { BASESCAN, FEE_VAULT_ABI, FEE_NOTE_ABI, CCA_AUCTION_ABI, ERC20_ABI } from "@feedesk/shared";
import { ENV } from "./env";

export const RPC_URL = ENV.DEMO_FORK ? ENV.FORK_RPC_URL : "https://base-rpc.publicnode.com";
export const publicClient = createPublicClient({ chain: base, transport: http(RPC_URL) });

export const vaultAbi = parseAbi(FEE_VAULT_ABI);
export const noteAbi = parseAbi(FEE_NOTE_ABI);
export const auctionAbi = parseAbi(CCA_AUCTION_ABI);
export const erc20Abi = parseAbi(ERC20_ABI);

/** Basescan link, or null for txs that only exist on the local fork. Addresses deployed before the fork block still resolve. */
export const txUrl = (h: Hex) => (ENV.DEMO_FORK ? null : `${BASESCAN}/tx/${h}`);
/** On DEMO_FORK an address may exist only on the fork (vaults, notes, auctions): no Basescan link. */
export const addrUrl = (a: string) => (ENV.DEMO_FORK ? null : `${BASESCAN}/address/${a}`);

/** Fork only: advance blocks (CCA start/end) via anvil_mine. */
export async function mineBlocks(n: number) {
  if (!ENV.DEMO_FORK) throw new Error("mineBlocks is DEMO_FORK only");
  const r = await fetch(ENV.FORK_ADMIN_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "anvil_mine", params: ["0x" + n.toString(16)] }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`anvil_mine: ${j.error.message}`);
}
