"use client";
import { useState } from "react";
import Link from "next/link";
import type { Hex } from "viem";
import type { LoanDetail, TxRequest } from "@feedesk/shared";
import { api } from "@/lib/api";
import { ENV } from "@/lib/env";
import { useSigner } from "@/lib/wallet";
import { Btn, Card, Tx } from "./ui";

/** SPEC flow B: three pledge paths, then POST /pledge (agent verifies shares on-chain and launches the CCA). */
export function PledgePanel({ loan, onDone }: { loan: LoanDetail; onDone: (l: LoanDetail) => void }) {
  const s = useSigner();
  const [hash, setHash] = useState<Hex | null>(null);
  const [copied, setCopied] = useState(false);
  const isBorrower = s.address?.toLowerCase() === loan.borrower.toLowerCase();
  const cast = `cast rpc anvil_setBalance ${loan.borrower} 0xDE0B6B3A7640000 --rpc-url ${ENV.FORK_RPC_URL}
cast rpc anvil_impersonateAccount ${loan.borrower} --rpc-url ${ENV.FORK_RPC_URL}
cast send --unlocked --from ${loan.borrower} ${loan.pledgeTx?.to ?? loan.feesManager} "updateBeneficiary(bytes32,address)" ${loan.poolId} ${loan.vault} --rpc-url ${ENV.FORK_RPC_URL}`;

  return (
    <Card title="Pledge your fee rights" right={<span>vault <span className="font-mono">{loan.vault}</span></span>}>
      <p className="text-sm">
        Move your Doppler beneficiary share to this loan&apos;s FeeVault. The vault can only give it back to you: <code>release()</code> is permissionless once the notes are repaid, and
        <code> cancel()</code> returns it if the auction fails. Any fees accrued but not yet collected go to the vault as your first repayment (claim-first).
      </p>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div className="border-[1.5px] border-ink p-3">
          <div className="label">1 · connected wallet (Dynamic)</div>
          <p className="mt-1 text-xs">For creators whose beneficiary is an EOA you control. Signs the Bankr <code>build-transfer-beneficiary</code> tx.</p>
          {s.connected && !isBorrower && <p className="mt-1 text-xs text-stamp">Connected {s.address?.slice(0, 8)}… is not the beneficiary {loan.borrower.slice(0, 8)}…; the tx will revert.</p>}
          <div className="mt-2">
            <Btn
              onClick={async () => {
                // Always fresh: the agent re-reads vault status and 409s once the vault is no longer Created (never pledge into a closed vault).
                const tx = await api<TxRequest>(`/api/loans/${loan.id}/pledge-tx`);
                setHash(await s.sendTx({ ...tx, label: "pledge" }));
              }}
            >
              {s.connected ? "Sign pledge tx" : "Log in to sign"}
            </Btn>
          </div>
          {hash && <p className="mt-2 text-xs">sent <Tx h={hash} /></p>}
        </div>
        <div className="border-[1.5px] border-ink p-3">
          <div className="label">2 · Bankr agent / wallet</div>
          <p className="mt-1 text-xs">Beneficiary is your Bankr wallet? Paste this into Bankr chat (or have your agent submit the pledgeTx via the Gadai skill):</p>
          <pre className="mt-2 whitespace-pre-wrap break-all bg-ink p-2 font-mono text-[11px] text-paper">{loan.pledgeChatText}</pre>
          <button className="link mt-1 text-xs" onClick={() => navigator.clipboard.writeText(loan.pledgeChatText ?? "").then(() => setCopied(true))}>{copied ? "copied" : "copy"}</button>
        </div>
        <div className={`border-[1.5px] p-3 ${ENV.DEMO_FORK ? "border-stamp" : "border-ink/30 text-mute"}`}>
          <div className="label">3 · fork impersonation {ENV.DEMO_FORK ? "" : "(DEMO_FORK only)"}</div>
          {ENV.DEMO_FORK ? (
            <>
              <p className="mt-1 text-xs">Local Anvil fork only: impersonate the real beneficiary. Not possible on mainnet.</p>
              <pre className="mt-2 whitespace-pre-wrap break-all bg-stamp/10 p-2 font-mono text-[10px]">{cast}</pre>
            </>
          ) : (
            <p className="mt-1 text-xs">Disabled on mainnet.</p>
          )}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-ink/20 pt-4">
        <Btn
          onClick={async () => {
            const l = await api<LoanDetail>(`/api/loans/${loan.id}/pledge`, { body: hash ? { txHash: hash } : {} });
            onDone(l);
          }}
        >
          I&apos;ve pledged → verify on-chain
        </Btn>
        <span className="text-xs text-mute">The agent checks getShares(vault) &gt; 0 and getShares(you) = 0, confirms the pledge, then launches the FeeNote auction.</span>
        <Link href={`/loans/${loan.id}`} className="link text-xs">loan page →</Link>
      </div>
    </Card>
  );
}
