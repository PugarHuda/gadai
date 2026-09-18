"use client";
import { use, useState } from "react";
import Link from "next/link";
import { encodeFunctionData } from "viem";
import { CHAIN_ID_BASE, type DeskInfo, type LoanDetail, type TxRequest } from "@feedesk/shared";
import { api } from "@/lib/api";
import { noteAbi, publicClient, vaultAbi } from "@/lib/chain";
import { useSigner } from "@/lib/wallet";
import { Addr, Btn, Card, Loading, Pill, Tx, ago, pct, usdcRaw, useLoad } from "@/components/ui";
import { Memos } from "@/components/memo";
import { PledgePanel } from "@/components/pledge";
import { AuctionPanel } from "@/components/auction";

const KIND_LABEL: Record<string, string> = {
  applied: "applied",
  memo: "credit memo",
  declined: "declined",
  loan_created: "FeeVault created (Dynamic agent wallet)",
  pledged: "fee rights pledged",
  auction_started: "FeeNote CCA started",
  bid: "bid",
  disbursed: "USDC disbursed (Dynamic agent wallet)",
  collected: "fees collected",
  swapped: "WETH→USDC (Uniswap Trading API)",
  flash_twap: "token leg TWAP (Definitive Flash)",
  token_leg_sent: "token leg sent to keeper",
  repaid: "repaid",
  draw: "dining draw (Flynet)",
  desk_paid: "desk paid",
  released: "lien released",
  cancelled: "cancelled",
  error: "error",
};
const KEEPER = new Set(["collected", "swapped", "flash_twap", "token_leg_sent", "desk_paid", "repaid"]);

export default function LoanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const s = useSigner();
  const desk = useLoad(() => api<DeskInfo>("/api/desk"));
  const q = useLoad(() => api<LoanDetail>(`/api/loans/${id}`), [id], 15_000);
  const [override, setOverride] = useState<LoanDetail | null>(null);
  const loan = override && q.data && override.updatedAt > q.data.updatedAt ? override : q.data;
  const notes = useLoad(
    async () => (loan?.note && s.address ? ((await publicClient.readContract({ address: loan.note, abi: noteAbi, functionName: "balanceOf", args: [s.address] })) as bigint) : 0n),
    [loan?.note, s.address, loan?.updatedAt],
  );
  const [redeemAmt, setRedeemAmt] = useState("");

  return (
    <Loading l={q.loading} e={q.error}>
      {loan && (
        <div className="space-y-6">
          <header className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="label">loan #{loan.id} · via {loan.via}</p>
              <h1 className="h1 mt-1">${loan.symbol}</h1>
              <p className="mt-2 text-sm">
                borrower <Addr a={loan.borrower} /> · controller <Addr a={loan.controller} /> · token <Addr a={loan.token} /> · pool <span className="font-mono text-xs">{loan.poolId.slice(0, 10)}…</span>
              </p>
            </div>
            <div className="text-right">
              <Pill s={loan.status} />
              <p className="mt-2 text-xs">
                vault <Addr a={loan.vault} /> · note <Addr a={loan.note} /> · fees mgr <Addr a={loan.feesManager} />
              </p>
            </div>
          </header>

          {loan.terms && (
            <section className="grid grid-cols-2 gap-3 md:grid-cols-6">
              {[
                ["principal", usdcRaw(loan.terms.principalRaw)],
                ["note face", usdcRaw(loan.terms.faceValueRaw)],
                ["fee", pct(loan.terms.feeRatePct, 2)],
                ["floor px", loan.terms.floorPrice.toFixed(2)],
                ["term", `${loan.terms.termDays.toFixed(1)}d`],
                ["dining line", usdcRaw(loan.terms.drawLimitRaw)],
              ].map(([k, v]) => (
                <div key={k} className="border-[1.5px] border-ink bg-card px-3 py-2">
                  <div className="label">{k}</div>
                  <div className="num text-lg">{v}</div>
                </div>
              ))}
            </section>
          )}

          {loan.status === "APPROVED" && loan.vault && <PledgePanel loan={loan} onDone={setOverride} />}

          {loan.auction && (
            <AuctionPanel loan={loan} personas={desk.data?.personas} onChange={q.reload} />
          )}

          {loan.debt && (
            <Card title="Debt · read on-chain from the FeeVault" right={loan.debt.canRelease && <span className="pill bg-desk text-paper">repaid · releasable</span>}>
              <DebtBar loan={loan} />
              <div className="mt-4 flex flex-wrap items-start gap-6">
                {loan.debt.canRelease && (
                  <div>
                    <Btn
                      onClick={async () => {
                        await s.sendTx(await api<TxRequest>(`/api/loans/${loan.id}/release-tx`));
                        q.reload();
                      }}
                    >
                      Release lien → borrower
                    </Btn>
                    <p className="mt-1 max-w-xs text-xs text-mute">Anyone can call release(). Fee rights, leftover WETH/tokens and surplus USDC return to the borrower.</p>
                  </div>
                )}
                {loan.note && (loan.status === "ACTIVE" || loan.status === "RELEASED") && (
                  <div>
                    <div className="label">your FeeNotes: <span className="num text-ink">{usdcRaw(String(notes.data ?? 0n))}</span> face</div>
                    <div className="mt-1 flex gap-2">
                      <input className="input w-32" placeholder="notes" value={redeemAmt} onChange={(e) => setRedeemAmt(e.target.value)} />
                      <Btn
                        kind="ghost"
                        disabled={!notes.data}
                        onClick={async () => {
                          const raw = BigInt(Math.round(Number(redeemAmt || 0) * 1e6));
                          if (raw <= 0n || raw > (notes.data ?? 0n)) throw new Error("Amount must be > 0 and ≤ your note balance");
                          const data = encodeFunctionData({ abi: vaultAbi, functionName: "redeem", args: [raw] });
                          await s.sendTx({ to: loan.vault!, data, chainId: CHAIN_ID_BASE, label: "redeem" });
                          notes.reload();
                          q.reload();
                        }}
                      >
                        Redeem 1:1 USDC
                      </Btn>
                    </div>
                  </div>
                )}
                {(loan.status === "ACTIVE" || loan.status === "RELEASED") && (
                  <Link href={`/dine/${loan.id}`} className="btn btn-ghost self-start">Dine on these fees →</Link>
                )}
              </div>
            </Card>
          )}

          <Card title="Credit memos · Bankr LLM Gateway">
            <Memos memos={loan.memos} personas={desk.data?.personas} />
          </Card>

          <div className="grid gap-6 md:grid-cols-[1.4fr_1fr]">
            <Card title="Timeline" right={<button className="link" onClick={() => q.reload()}>refresh</button>}>
              <ol className="relative border-l-[1.5px] border-ink pl-5">
                {loan.events.map((e) => (
                  <li key={e.id} className="mb-4">
                    <span className={`absolute -left-[6px] mt-1.5 h-[11px] w-[11px] border-[1.5px] border-ink ${e.kind === "error" ? "bg-stamp" : KEEPER.has(e.kind) ? "bg-amber" : e.txHash ? "bg-desk" : "bg-paper"}`} />
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium">{KIND_LABEL[e.kind] ?? e.kind}</span>
                      <span className="text-xs text-mute" title={e.createdAt}>{ago(e.createdAt)}</span>
                    </div>
                    <div className="text-xs">
                      {e.txHash && <Tx h={e.txHash} />}
                      {e.data != null && <EventData d={e.data} />}
                    </div>
                  </li>
                ))}
                {loan.events.length === 0 && <li className="text-sm text-mute">No events.</li>}
              </ol>
            </Card>
            <Card title="Signals from this loan">
              {loan.signals.length === 0 ? (
                <p className="text-sm text-mute">No signals.</p>
              ) : (
                <ul className="space-y-3">
                  {loan.signals.map((sg) => (
                    <li key={sg.id} className="border-b border-ink/15 pb-2 text-sm">
                      <div className="flex items-center justify-between">
                        <b>{desk.data?.personas.find((p) => p.id === sg.personaId)?.name ?? sg.personaId}</b>
                        <span><Pill s={sg.decision} /> <span className="num ml-1">{Math.round(sg.score)}</span></span>
                      </div>
                      <p className="text-xs text-mute">{sg.rationale}</p>
                    </li>
                  ))}
                </ul>
              )}
              <Link href="/desk" className="link mt-3 inline-block text-xs">follow these underwriters →</Link>
            </Card>
          </div>
        </div>
      )}
    </Loading>
  );
}

function DebtBar({ loan }: { loan: LoanDetail }) {
  const d = loan.debt!;
  const notes = Number(d.noteSupplyRaw), draws = Number(d.drawDebtRaw), cash = Number(d.usdcInVaultRaw);
  const total = Math.max(1, notes + draws);
  return (
    <div>
      <div className="flex h-6 border-[1.5px] border-ink bg-paper">
        <div className="bg-desk" style={{ width: `${Math.min(100, (cash / total) * 100)}%` }} title="USDC in vault" />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-3 text-sm md:grid-cols-6">
        <div><div className="label">notes outstanding</div><div className="num">{usdcRaw(d.noteSupplyRaw)}</div></div>
        <div><div className="label">dining debt</div><div className="num">{usdcRaw(d.drawDebtRaw)}</div></div>
        <div><div className="label">USDC in vault</div><div className="num text-desk">{usdcRaw(d.usdcInVaultRaw)}</div></div>
        <div><div className="label">outstanding</div><div className="num">{usdcRaw(d.outstandingRaw)}</div></div>
        <div><div className="label">WETH to swap</div><div className="num">{(Number(d.wethInVaultRaw) / 1e18).toFixed(5)}</div></div>
        <div><div className="label">${loan.symbol} to TWAP</div><div className="num">{(Number(d.tokenInVaultRaw) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 0 })}</div></div>
      </div>
    </div>
  );
}

function EventData({ d }: { d: unknown }) {
  if (typeof d !== "object" || d === null) return <span className="ml-2 font-mono text-mute">{String(d)}</span>;
  const entries = Object.entries(d as Record<string, unknown>).filter(([, v]) => v != null && typeof v !== "object");
  return (
    <span className="ml-2 font-mono text-mute">
      {entries.slice(0, 6).map(([k, v]) => `${k}=${String(v).length > 24 ? String(v).slice(0, 22) + "…" : v}`).join(" · ")}
    </span>
  );
}
