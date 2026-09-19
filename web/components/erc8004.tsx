"use client";
import { api } from "@/lib/api";
import { ENV } from "@/lib/env";
import { useLoad } from "@/components/ui";

type DeskId = { agentId: string | null; identityRegistry: string; agentURI: string };

/** The desk's ERC-8004 identity (agent NFT in the Base IdentityRegistry) + its agent card. Renders nothing until registered. */
export function Erc8004Badge() {
  const d = useLoad(() => api<DeskId>("/api/erc8004/desk"));
  if (!d.data?.agentId) return null;
  const { agentId, identityRegistry, agentURI } = d.data;
  return (
    <p className="text-xs text-mute">
      Underwriter desk is ERC-8004 agent{" "}
      {ENV.DEMO_FORK ? (
        <span className="num text-ink" title={`${identityRegistry} (Anvil fork of Base)`}>#{agentId} (fork)</span>
      ) : (
        <a className="link num" href={`https://basescan.org/nft/${identityRegistry}/${agentId}`} target="_blank" rel="noreferrer">#{agentId}</a>
      )}{" "}
      in the Base IdentityRegistry ·{" "}
      <a className="link" href={agentURI} target="_blank" rel="noreferrer">agent card</a> · repayments are published on-chain.
    </p>
  );
}
