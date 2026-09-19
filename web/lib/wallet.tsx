"use client";
import { DynamicContextProvider, overrideNetworkRpcUrl, useDynamicContext } from "@dynamic-labs/sdk-react-core";
import { EthereumWalletConnectors, isEthereumWallet } from "@dynamic-labs/ethereum";
import type { Address, Hex } from "viem";
import { CHAIN_ID_BASE, flashTypedData, type TxRequest } from "@feedesk/shared";
import { ENV } from "./env";
import { publicClient } from "./chain";

const cssOverrides = `.dynamic-widget-inline-controls{box-shadow:none!important;border:1px solid #c4c9cf!important}`;

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <DynamicContextProvider
      settings={{
        environmentId: ENV.DYNAMIC_ENVIRONMENT_ID,
        walletConnectors: [EthereumWalletConnectors],
        cssOverrides,
        // DEMO_FORK: embedded wallets broadcast to the Anvil fork (chain id stays 8453). Documented utility.
        overrides: ENV.DEMO_FORK
          ? { evmNetworks: (nets) => overrideNetworkRpcUrl(nets, { [String(CHAIN_ID_BASE)]: [ENV.FORK_RPC_URL] }) }
          : undefined,
      }}
    >
      {children}
    </DynamicContextProvider>
  );
}

/** Connected Dynamic wallet → send agent-built TxRequests, sign messages / Flash typed data. */
export function useSigner() {
  const { primaryWallet, setShowAuthFlow } = useDynamicContext();
  const address = primaryWallet?.address as Address | undefined;

  async function client() {
    if (!primaryWallet || !isEthereumWallet(primaryWallet)) {
      setShowAuthFlow(true);
      throw new Error("Log in with Dynamic first");
    }
    if (Number(await primaryWallet.getNetwork()) !== CHAIN_ID_BASE) await primaryWallet.switchNetwork(CHAIN_ID_BASE);
    return primaryWallet.getWalletClient(String(CHAIN_ID_BASE));
  }

  /** Sends and waits for the receipt (read through our fork-aware public client). Throws on revert. */
  async function sendTx(tx: TxRequest): Promise<Hex> {
    if (tx.chainId !== CHAIN_ID_BASE) throw new Error(`Refusing tx for chain ${tx.chainId}`);
    const wc = await client();
    if (ENV.DEMO_FORK) await assertForkWallet(wc);
    const hash = await wc.sendTransaction({ to: tx.to, data: tx.data, value: BigInt(tx.value ?? 0), account: wc.account, chain: wc.chain });
    const rc = await publicClient.waitForTransactionReceipt({ hash });
    if (rc.status !== "success") throw new Error(`${tx.label ?? "tx"} reverted: ${hash}`);
    return hash;
  }

  /** DEMO_FORK: fork-only addresses (vault, auction) must never receive a MAINNET tx. Injected wallets (MetaMask) keep
   *  their own RPC, so only Dynamic embedded wallets (RPC overridden above) may send, and only if their RPC answers as Anvil. */
  async function assertForkWallet(wc: Awaited<ReturnType<typeof client>>) {
    if (!primaryWallet?.connector.isEmbeddedWallet)
      throw new Error("DEMO_FORK: only a Dynamic embedded wallet can send fork txs (an extension wallet would broadcast to Base mainnet). Log in with email, or use the cast path.");
    let v = "";
    try {
      v = String(await wc.request({ method: "web3_clientVersion" } as never));
    } catch (e) {
      throw new Error(`DEMO_FORK: cannot verify the wallet's RPC is the Anvil fork (${(e as Error).message}); refusing to send. Use the cast path.`);
    }
    if (!/anvil/i.test(v)) throw new Error(`DEMO_FORK: wallet RPC reports "${v}", not Anvil; refusing to send a fork tx to mainnet. Use the cast path.`);
  }

  async function signMessage(message: string): Promise<Hex> {
    const wc = await client();
    return wc.signMessage({ account: wc.account, message });
  }

  /** Flash returns EIP-712 as a JSON string with string numbers; normalize with shared flashTypedData, then sign. */
  async function signTypedJson(json: string): Promise<Hex> {
    const wc = await client();
    return wc.signTypedData({ ...flashTypedData(json), account: wc.account } as Parameters<typeof wc.signTypedData>[0]);
  }

  return { address, connected: !!address, login: () => setShowAuthFlow(true), sendTx, signMessage, signTypedJson, wallet: primaryWallet };
}
