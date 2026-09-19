"use client";
import { useState } from "react";
import Link from "next/link";
import { formatEther, type Hex } from "viem";
import type { ClaimFirst, LoanDetail, TxRequest } from "@feedesk/shared";
import { api } from "@/lib/api";
import { ENV } from "@/lib/env";
import { useSigner } from "@/lib/wallet";
import { Btn, Card, Tx } from "./ui";

/** SPEC flow B: three pledge paths, then POST /pledge (agent verifies shares on-chain and launches the CCA). */
export function PledgePanel({ loan, claimFirst, onDone }: { loan: LoanDetail; claimFirst?: ClaimFirst | null; onDone: (l: LoanDetail) => void }) {
  const s = useSigner();
  const [hash, setHash] = useState<Hex | null>(null);
  const [claimHash, setClaimHash] = useState<Hex | null>(null);
  const [copied, setCopied] = useState(false);
  const isBorrower = s.address?.toLowerCase() === loan.borrower.toLowerCase();
  const cast = `cast rpc anvil_setBalance ${loan.borrower} 0xDE0B6B3A7640000 --rpc-url ${ENV.FORK_ADMIN_RPC_URL}
cast rpc anvil_impersonateAccount ${loan.borrower} --rpc-url ${ENV.FORK_ADMIN_RPC_URL}
cast send --unlocked --from ${loan.borrower} ${loan.pledgeTx?.to ?? loan.feesManager} "updateBeneficiary(bytes32,address)" ${loan.poolId} ${loan.vault} --rpc-url ${ENV.FORK_ADMIN_RPC_URL}`;

  return (
    <Card title="Pledge your fee rights" right={<span>FeeVault <span className="font-mono break-all">{loan.vault}</span></span>}>
      <p className="max-w-[75ch] text-sm leading-relaxed">
        Move your Doppler beneficiary share to this loan&apos;s FeeVault. The vault can only give it back to you: <code>release()</code> is permissionless once the notes are repaid, and
        <code> cancel()</code> returns it if the auction fails. Any fees accrued but not yet collected go to the vault as your first repayment (claim-first).
      </p>
      {claimFirst && (
        <div className="mt-4 rounded-[3px] border border-dashed border-violet/50 p-3">
          <div className="font-semibold">Optional first: claim {Number(formatEther(BigInt(claimFirst.claimableWethRaw))).toFixed(6)} WETH of accrued fees</div>
          <p className="mt-1 max-w-[75ch] text-xs text-mute">{claimFirst.note}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Btn kind="ghost" onClick={async () => setClaimHash(await s.sendTx(claimFirst.tx))}>{s.connected ? "Sign claim tx (before pledging)" : "Log in to sign"}</Btn>
            {claimHash && <span className="text-xs">sent <Tx h={claimHash} /></span>}
          </div>
        </div>
      )}
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div className="box rounded-[3px] p-3">
          <div className="font-semibold">Connected wallet (Dynamic)</div>
          <p className="mt-1 text-xs text-mute">For creators whose beneficiary is an EOA you control. Signs the Bankr <code>build-transfer-beneficiary</code> tx.</p>
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
        <div className="box rounded-[3px] p-3">
          <div className="font-semibold">Bankr agent or Bankr wallet</div>
          <p className="mt-1 text-xs text-mute">Beneficiary is your Bankr wallet? Paste this into Bankr chat (or have your agent submit the pledgeTx via the Gadai skill):</p>
          <pre className="mt-2 whitespace-pre-wrap break-all rounded-[3px] border border-rule bg-ground/60 p-2 font-mono text-[11px]">{loan.pledgeChatText}</pre>
          <button className="link mt-1 text-xs" onClick={() => navigator.clipboard.writeText(loan.pledgeChatText ?? "").then(() => setCopied(true))}>{copied ? "Copied" : "Copy"}</button>
        </div>
        <div className={`rounded-[3px] border p-3 ${ENV.DEMO_FORK ? "border-dashed border-amber-ink/50" : "border-rule text-mute"}`}>
          <div className="font-semibold">Fork impersonation {ENV.DEMO_FORK ? "" : "(DEMO_FORK only)"}</div>
          {ENV.DEMO_FORK ? (
            <>
              <p className="mt-1 text-xs text-mute">Local Anvil fork only: impersonate the real beneficiary. Not possible on mainnet.</p>
              <pre className="mt-2 whitespace-pre-wrap break-all bg-ground/60 p-2 font-mono text-[11px]">{cast}</pre>
            </>
          ) : (
            <p className="mt-1 text-xs">Disabled on mainnet.</p>
          )}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-rule pt-4">
        <Btn
          onClick={async () => {
            const l = await api<LoanDetail>(`/api/loans/${loan.id}/pledge`, { body: hash ? { txHash: hash } : {} });
            onDone(l);
          }}
        >
          I&apos;ve pledged, verify on-chain
        </Btn>
        <span className="text-xs text-mute">The agent checks getShares(vault) &gt; 0 and getShares(you) = 0, confirms the pledge, then launches the FeeNote auction.</span>
        <Link href={`/loans/${loan.id}`} className="link text-xs">Loan page</Link>
      </div>
    </Card>
  );
}
