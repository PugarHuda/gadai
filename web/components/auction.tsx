"use client";
import { useState } from "react";
import type { AuctionState, BidPlan, ExitPlan, LoanDetail, Persona } from "@feedesk/shared";
import { api } from "@/lib/api";
import { mineBlocks } from "@/lib/chain";
import { useSigner } from "@/lib/wallet";
import { Addr, Btn, Card, ForkOnly, Loading, pct, usdcRaw, useLoad } from "./ui";

/** FeeNote CCA (Uniswap Continuous Clearing Auction v2.1.0): state, bid, exit/claim. SPEC flow C. */
export function AuctionPanel({ loan, personas, onChange }: { loan: LoanDetail; personas?: Persona[]; onChange?: () => void }) {
  const s = useSigner();
  const st = useLoad(() => api<AuctionState>(`/api/loans/${loan.id}/auction`), [loan.id], 8_000);
  const floor = loan.terms?.floorPrice ?? 0;
  const [amount, setAmount] = useState("10");
  const [price, setPrice] = useState(() => String(loan.leadMemo?.maxNotePrice ?? floor));
  const [log, setLog] = useState<string[]>([]);

  const runTxs = async (txs: BidPlan["txs"]) => {
    for (const tx of txs) {
      const h = await s.sendTx(tx);
      setLog((l) => [...l, `${tx.label ?? "tx"}: ${h}`]);
    }
    st.reload();
    onChange?.();
  };

  const bid = async () => {
    if (!s.address) return s.login();
    const amt = Number(amount), px = Number(price);
    if (!(amt > 0)) throw new Error("Bid amount must be > 0 USDC");
    if (!(px >= floor && px <= 1)) throw new Error(`Max price must be between the floor ${floor.toFixed(2)} and 1.00 USDC per note`);
    const plan = await api<BidPlan>(`/api/loans/${loan.id}/auction/bid-plan`, {
      body: { bidder: s.address, amountRaw: String(Math.round(amt * 1e6)), maxPrice: px },
    });
    await runTxs(plan.txs);
  };
  const exit = async (bidId: string) => runTxs((await api<ExitPlan>(`/api/loans/${loan.id}/auction/exit-plan`, { body: { bidId } })).txs);

  const a = st.data;
  const raised = a ? Number(a.currencyRaisedRaw) : 0, need = a ? Number(a.requiredRaw) : 1;
  const mine = a?.bids.filter((b) => b.owner.toLowerCase() === s.address?.toLowerCase()) ?? [];
  const approving = loan.memos.filter((m) => m.decision === "approve");
  // isGraduated is stale until the auction is checkpointed, so "not graduated" is only final once the loan is CANCELLED.
  const phase = !a ? "" : a.currentBlock < a.startBlock ? "not started" : a.currentBlock < a.endBlock ? "live" : a.graduated ? "graduated" : loan.status === "CANCELLED" ? "failed (not graduated)" : "ended · settling";
  const canClaim = (b: AuctionState["bids"][number]) => !!a && a.graduated && b.exited && BigInt(b.tokensFilledRaw) > 0n && a.currentBlock >= a.claimBlock;

  return (
    <Card title="FeeNote auction · Uniswap CCA" right={a && <span className="font-mono">{phase}</span>}>
      <Loading l={st.loading} e={st.error}>
        {a && (
          <div className="grid gap-6 md:grid-cols-[1.2fr_1fr]">
            <div>
              <div className="flex items-end justify-between">
                <div>
                  <div className="label">raised / required</div>
                  <div className="num text-3xl">{usdcRaw(a.currencyRaisedRaw)} <span className="text-base text-mute">/ {usdcRaw(a.requiredRaw)}</span></div>
                </div>
                <div className="text-right">
                  <div className="label">clearing price</div>
                  <div className="num text-3xl">{a.clearingPrice.toFixed(4)}</div>
                </div>
              </div>
              <div className="mt-2 h-3 border-[1.5px] border-ink bg-paper">
                <div className={`h-full ${a.graduated ? "bg-desk" : "bg-amber"}`} style={{ width: `${Math.min(100, (raised / need) * 100)}%` }} />
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-mute num">
                <span>block {a.currentBlock}</span>
                <span>start {a.startBlock} · end {a.endBlock} · claim {a.claimBlock}</span>
                <span>{pct((raised / need) * 100, 0)}</span>
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                <div><dt className="label">floor</dt><dd className="num">{a.floorPrice.toFixed(4)}</dd></div>
                <div><dt className="label">notes offered</dt><dd className="num">{usdcRaw(a.totalSupplyRaw)}</dd></div>
                <div><dt className="label">auction</dt><dd><Addr a={a.auction} /></dd></div>
              </dl>
              <table className="tbl mt-4">
                <thead><tr><th>bid</th><th>owner</th><th className="text-right">max px</th><th className="text-right">amount</th><th className="text-right">filled</th><th /></tr></thead>
                <tbody>
                  {a.bids.map((b) => (
                    <tr key={b.bidId}>
                      <td className="num">{b.bidId}</td>
                      <td><Addr a={b.owner} />{b.owner.toLowerCase() === s.address?.toLowerCase() && <span className="tag ml-1">you</span>}</td>
                      <td className="num text-right">{b.maxPrice.toFixed(4)}</td>
                      <td className="num text-right">{usdcRaw(b.amountRaw)}</td>
                      <td className="num text-right">{b.exited ? usdcRaw(b.tokensFilledRaw) : "—"}</td>
                      <td className="text-right text-xs">{b.exited ? "exited" : ""}</td>
                    </tr>
                  ))}
                  {a.bids.length === 0 && <tr><td colSpan={6} className="text-mute">No bids yet.</td></tr>}
                </tbody>
              </table>
            </div>

            <div className="space-y-4">
              {phase === "not started" && <p className="border-[1.5px] border-ink p-3 text-sm">Bidding opens at block {a.startBlock} (now {a.currentBlock}).</p>}
              {phase === "live" && (
                <div className="border-[1.5px] border-ink p-3">
                  <div className="label">place a bid</div>
                  <p className="mt-1 text-xs text-mute">You pay ≤ your max price per note; each note repays 1 USDC from the fee stream. Signs USDC→Permit2 approvals and submitBid.</p>
                  {approving.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {approving.map((m) => (
                        <button key={m.personaId} className="border border-ink px-2 py-0.5 font-mono text-[11px] hover:bg-ink hover:text-paper" onClick={() => setPrice(String(m.maxNotePrice))}>
                          copy {personas?.find((p) => p.id === m.personaId)?.name ?? m.personaId} @ {m.maxNotePrice.toFixed(2)}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <label><span className="label">USDC</span><input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
                    <label><span className="label">max px / note</span><input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
                  </div>
                  <p className="mt-1 text-xs num">
                    ≥ {Number(price) > 0 ? (Number(amount) / Number(price)).toFixed(2) : "—"} notes → {Number(price) > 0 ? pct((1 / Number(price) - 1) * 100) : "—"} yield at max price
                  </p>
                  <div className="mt-2"><Btn onClick={bid}>{s.connected ? "Bid" : "Log in to bid"}</Btn></div>
                </div>
              )}
              {mine.length > 0 && (
                <div className="border-[1.5px] border-ink p-3">
                  <div className="label">your bids</div>
                  {mine.map((b) => (
                    <div key={b.bidId} className="mt-2 flex items-center justify-between gap-2 text-sm">
                      <span className="num">#{b.bidId} · {usdcRaw(b.amountRaw)} @ ≤{b.maxPrice.toFixed(3)}</span>
                      {!b.exited && a.currentBlock >= a.endBlock && <Btn kind="ghost" onClick={() => exit(b.bidId)}>{a.graduated ? "Exit & claim notes" : "Exit & refund"}</Btn>}
                      {canClaim(b) && <Btn kind="ghost" onClick={() => exit(b.bidId)}>Claim notes</Btn>}
                    </div>
                  ))}
                </div>
              )}
              <ForkOnly>
                <div className="border-[1.5px] border-stamp p-3">
                  <div className="label !text-stamp">fork: advance blocks</div>
                  <div className="mt-2 flex gap-2">
                    <Btn kind="ghost" onClick={async () => (await mineBlocks(10), st.reload())}>+10</Btn>
                    <Btn kind="ghost" onClick={async () => (await mineBlocks(Math.max(1, a.endBlock - a.currentBlock)), st.reload())}>to end</Btn>
                  </div>
                </div>
              </ForkOnly>
              {log.length > 0 && <pre className="whitespace-pre-wrap break-all bg-ink/5 p-2 font-mono text-[10px]">{log.join("\n")}</pre>}
            </div>
          </div>
        )}
      </Loading>
    </Card>
  );
}
