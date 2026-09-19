"use client";
import { use, useState } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { encodeFunctionData } from "viem";
import { CHAIN_ID_BASE, type DeskInfo, type LoanDetail, type TxRequest } from "@feedesk/shared";
import { api } from "@/lib/api";
import { noteAbi, publicClient, vaultAbi } from "@/lib/chain";
import { useSigner } from "@/lib/wallet";
import { Addr, Btn, Card, Lifecycle, Loading, Pill, Tx, ago, pct, usdcRaw, useLoad } from "@/components/ui";
import { Memos, MirrorTag } from "@/components/memo";
import { PledgePanel } from "@/components/pledge";
import { AuctionPanel } from "@/components/auction";
import { Erc8004Badge } from "@/components/erc8004";

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
  erc8004_registered: "borrower ERC-8004 agent linked",
  erc8004_feedback: "repayment feedback (ERC-8004 reputation)",
  erc8004_metadata: "loan outcome published (ERC-8004)",
};
const STAMP: Record<string, string> = { APPROVED: "text-violet", PLEDGED: "text-amber-ink", AUCTION: "text-amber-ink", ACTIVE: "text-desk", RELEASED: "text-violet", DECLINED: "text-stamp", CANCELLED: "text-stamp" };

/** One line that says what happens next for this loan (and who can do it). */
function nextStep(l: LoanDetail): string {
  if (l.debt?.canRelease && l.status !== "RELEASED") return "Debt is zero. Anyone can release the lien below; the fee rights go back to the borrower.";
  switch (l.status) {
    case "APPROVED": return "The borrower pledges the token's fee rights to this loan's FeeVault (below).";
    case "PLEDGED": return "Pledge verified on-chain. The FeeNote auction is launching.";
    case "AUCTION": return "Anyone can fund this loan by bidding for FeeNotes in the auction below.";
    case "ACTIVE": return "USDC is disbursed. Fees collected into the vault repay the FeeNotes; noteholders redeem 1:1 as they arrive.";
    case "RELEASED": return "Repaid and released. The fee rights are back with the borrower.";
    case "DECLINED": return "The lead underwriter declined this application. The memos below explain why.";
    case "CANCELLED":
      if (!l.vault) return "Approved, but the loan was never opened on-chain (no vault was created). Nothing was pledged or moved.";
      if (!l.auction) return "The vault was closed before any auction: the fee rights were never pledged, or were returned to the borrower by cancel().";
      return "The auction did not fund the loan, so cancel() returned the fee rights to the borrower.";
    default: return l.status;
  }
}
const KEEPER = new Set(["collected", "swapped", "flash_twap", "token_leg_sent", "desk_paid", "repaid"]);

export default function LoanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  if (!/^[1-9]\d{0,14}$/.test(id)) notFound();
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
    <>
    {!loan && <h1 className="h1 mb-6">Loan #{id}</h1>}
    <Loading l={q.loading} e={q.error} retry={q.reload} what="loan details">
      {loan && (
        <div className="space-y-6">
          <header className="card overflow-hidden">
            <div className="flex flex-wrap items-start justify-between gap-4 p-4 sm:p-6">
              <div className="min-w-0">
                <h1 className="h1">
                  ${loan.symbol} <span className="num align-middle text-xl font-normal text-mute">loan #{loan.id}</span>
                </h1>
                <p className="mt-3 text-sm text-mute">Filed via {loan.via}</p>
                <Erc8004Badge />
              </div>
              <span key={loan.status} className={`stamp-mark ${STAMP[loan.status] ?? "text-mute"}`} aria-label={`Status: ${loan.status}`}>
                {loan.status}
              </span>
            </div>
            <dl className="grid grid-cols-1 gap-px border-t border-rule bg-rule text-sm sm:grid-cols-2 lg:grid-cols-4">
              {(
                [
                  ["Borrower", <Addr key="b" a={loan.borrower} />],
                  ["Controller", <Addr key="c" a={loan.controller} />],
                  ["Token", <Addr key="t" a={loan.token} />],
                  ["Pool", <span key="p" className="font-mono text-xs" title={loan.poolId}>{loan.poolId.slice(0, 10)}…</span>],
                  ["FeeVault", <Addr key="v" a={loan.vault} />],
                  ["FeeNote", <Addr key="n" a={loan.note} />],
                  ["Fees manager", <Addr key="f" a={loan.feesManager} />],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="bg-card px-4 py-2.5 sm:px-6">
                  <dt className="label">{k}</dt>
                  <dd className="mt-0.5">{v}</dd>
                </div>
              ))}
            </dl>
          </header>

          {loan.status === "DECLINED" || loan.status === "CANCELLED" ? null : <Lifecycle status={loan.status} />}
          <p role="status" className="flex flex-wrap items-baseline gap-x-2 rounded-[3px] border border-violet/30 bg-violet-tint px-4 py-3 text-sm">
            <span className="font-bold text-violet-deep">Next</span>
            <span>{nextStep(loan)}</span>
          </p>

          {loan.terms && (
            <section aria-label="Terms" className="card grid grid-cols-2 gap-px overflow-hidden bg-rule md:grid-cols-6">
              {[
                ["principal", usdcRaw(loan.terms.principalRaw)],
                ["note face", usdcRaw(loan.terms.faceValueRaw)],
                ["fee", pct(loan.terms.feeRatePct, 2)],
                ["floor px", loan.terms.floorPrice.toFixed(2)],
                ["term", `${loan.terms.termDays.toFixed(1)}d`],
                ["dining line", usdcRaw(loan.terms.drawLimitRaw)],
              ].map(([k, v]) => (
                <div key={k} className="bg-card px-4 py-3">
                  <div className="label">{k}</div>
                  <div className="num mt-0.5 text-lg">{v}</div>
                </div>
              ))}
            </section>
          )}

          {loan.status === "APPROVED" && loan.vault && <PledgePanel loan={loan} onDone={setOverride} />}

          {loan.auction && (
            <AuctionPanel loan={loan} personas={desk.data?.personas} onChange={q.reload} />
          )}

          {loan.debt && (
            <Card title="Debt · read on-chain from the FeeVault" right={loan.debt.canRelease && <span className="pill text-desk">repaid, releasable</span>}>
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
                      Release lien to borrower
                    </Btn>
                    <p className="mt-1 max-w-xs text-xs text-mute">Anyone can call release(). Fee rights, leftover WETH/tokens and surplus USDC return to the borrower.</p>
                  </div>
                )}
                {loan.note && (loan.status === "ACTIVE" || loan.status === "RELEASED") && (
                  <div>
                    <div className="label">Your FeeNotes: <span className="num normal-case text-ink">{usdcRaw(String(notes.data ?? 0n))}</span> face</div>
                    <div className="mt-1 flex gap-2">
                      <input className="input w-32" inputMode="decimal" aria-label="Notes to redeem" placeholder="notes" value={redeemAmt} onChange={(e) => setRedeemAmt(e.target.value)} />
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
                  <Link href={`/dine/${loan.id}`} className="btn btn-ghost self-start">Dine on these fees</Link>
                )}
              </div>
            </Card>
          )}

          <Card title="Credit memos · Bankr LLM Gateway">
            <Memos memos={loan.memos} personas={desk.data?.personas} />
          </Card>

          <div className="grid gap-6 md:grid-cols-[1.4fr_1fr]">
            <Card title="Timeline" right={<button className="link" onClick={() => q.reload()}>refresh</button>}>
              <ol className="relative ml-1.5 border-l border-rule pl-5">
                {loan.events.map((e) => (
                  <li key={e.id} className="mb-4">
                    <span className={`absolute -left-[6px] mt-1.5 size-[11px] rounded-full border border-card ring-1 ${e.kind === "error" ? "bg-stamp ring-stamp" : KEEPER.has(e.kind) ? "bg-amber ring-amber-ink/40" : e.txHash ? "bg-desk ring-desk" : "bg-paper ring-rule"}`} />
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-semibold">{KIND_LABEL[e.kind] ?? e.kind}</span>
                      <span className="text-xs text-mute" title={e.createdAt}>{ago(e.createdAt)}</span>
                    </div>
                    <div className="text-xs">
                      {e.txHash && <Tx h={e.txHash} />}
                      {e.data != null && <EventData d={e.data} />}
                    </div>
                  </li>
                ))}
                {loan.events.length === 0 && <li className="text-sm text-mute">No events recorded yet.</li>}
              </ol>
            </Card>
            <Card title="Signals from this loan">
              {loan.signals.length === 0 ? (
                <p className="text-sm text-mute">No underwriter signals on this loan yet.</p>
              ) : (
                <ul className="space-y-3">
                  {loan.signals.map((sg) => (
                    <li key={sg.id} className="border-b border-rule pb-2 text-sm">
                      <div className="flex items-center justify-between">
                        <b>{desk.data?.personas.find((p) => p.id === sg.personaId)?.name ?? sg.personaId}</b>
                        <span><Pill s={sg.decision} /> <span className="num ml-1">{Math.round(sg.score)}</span></span>
                      </div>
                      <p className="text-xs text-mute">{sg.rationale}</p>
                      <MirrorTag s={sg} />
                    </li>
                  ))}
                </ul>
              )}
              <Link href="/desk" className="link mt-3 inline-block text-xs">Follow these underwriters</Link>
            </Card>
          </div>
        </div>
      )}
    </Loading>
    </>
  );
}

function DebtBar({ loan }: { loan: LoanDetail }) {
  const d = loan.debt!;
  const notes = Number(d.noteSupplyRaw), draws = Number(d.drawDebtRaw), cash = Number(d.usdcInVaultRaw);
  const total = Math.max(1, notes + draws);
  return (
    <div>
      <div className="flex h-3 bg-rule/60">
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
