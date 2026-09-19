"use client";
import { use, useState } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { diningSettleMessage, drawMessage, flynetLinkMessage, type DineState, type Draw, type DrawQuote, type LoanDetail, type Recommendation } from "@feedesk/shared";
import { api } from "@/lib/api";
import { ENV } from "@/lib/env";
import { useSigner } from "@/lib/wallet";
import { Btn, Card, Loading, Tx, ago, usd, usdcRaw, useLoad } from "@/components/ui";

export default function Dine({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  if (!/^[1-9]\d{0,14}$/.test(id)) notFound(); // /dine/abc is a 404, never "loan #NaN"
  const loanId = Number(id);
  const s = useSigner();
  const loan = useLoad(() => api<LoanDetail>(`/api/loans/${loanId}`), [loanId]);
  const st = useLoad(() => api<DineState>(`/api/loans/${loanId}/dine`), [loanId]);
  const linked = !!st.data?.linked;
  const recs = useLoad(async () => (linked ? api<Recommendation[]>(`/api/flynet/restaurants?loanId=${loanId}`) : []), [loanId, linked]);
  const [pick, setPick] = useState<string | null>(null);
  const [amount, setAmount] = useState("20");

  const connect = async () => {
    const nonce = crypto.randomUUID();
    const sig = await s.signMessage(flynetLinkMessage(loanId, nonce));
    window.location.href = `${ENV.AGENT_URL}/api/flynet/connect?loanId=${loanId}&nonce=${nonce}&sig=${sig}`;
  };
  const draw = async () => {
    const cents = Math.round(Number(amount) * 100);
    if (!(cents > 0)) throw new Error("Amount must be > 0");
    // The vault's own drawMessage (current drawNonce + deadline); FeeVault.addDraw re-checks this exact signature on-chain.
    const q = await api<DrawQuote>(`/api/loans/${loanId}/dine/draw-message?amountUsdCents=${cents}`);
    const vault = loan.data?.vault;
    if (!vault || q.message !== drawMessage(vault, 8453, q.amountRaw, q.nonce, q.deadline))
      throw new Error("Agent returned an unexpected draw message; not signing");
    const signature = await s.signMessage(q.message);
    await api<Draw>(`/api/loans/${loanId}/dine/draw`, { body: { amountUsdCents: cents, locationId: pick ?? undefined, nonce: q.nonce, deadline: q.deadline, signature } });
    st.reload();
  };
  const settle = async () => {
    const nonce = crypto.randomUUID();
    const signature = await s.signMessage(diningSettleMessage(loanId, nonce));
    await api<DineState>(`/api/loans/${loanId}/dine/settle`, { body: { nonce, signature } });
    st.reload();
  };

  const d = st.data;
  const limit = Number(d?.drawLimitRaw ?? 0),
    drawn = Number(d?.drawnRaw ?? 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="h1">Dine on {loan.data ? `$${loan.data.symbol}` : "your"} fees</h1>
          <p className="mt-2 text-sm text-mute">Blackbird Flynet dining line on loan #{loanId}</p>
        </div>
        <Link href={`/loans/${loanId}`} className="link text-sm">
          Back to loan #{loanId}
        </Link>
      </header>

      <Loading l={st.loading} e={st.error} retry={st.reload} what="this dining line">
        {d && (
          <div className="grid gap-6 md:grid-cols-[1fr_1.5fr]">
            <div className="space-y-6">
              <Card title="Member passport">
                {!linked ? (
                  <div>
                    <p className="text-sm">Link your Blackbird account (Flynet OAuth: profile, wallets, check-ins, memberships). Sign with the borrower or controller wallet.</p>
                    <div className="mt-3">
                      <Btn onClick={connect}>{s.connected ? "Connect Blackbird" : "Log in first"}</Btn>
                    </div>
                  </div>
                ) : (
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <div className="col-span-2">
                      <dt className="label">member</dt>
                      <dd className="font-display text-2xl">{d.member?.name ?? "Blackbird member"}</dd>
                    </div>
                    <div>
                      <dt className="label">FLY balance</dt>
                      <dd className="num">{(Number(d.member?.flyBalanceWei ?? 0) / 1e18).toFixed(2)}</dd>
                    </div>
                    <div>
                      <dt className="label">≈ USD</dt>
                      <dd className="num">{usd((d.member?.flyBalanceUsdCents ?? 0) / 100)}</dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="label">spending wallet</dt>
                      <dd className="break-all font-mono text-xs">{d.member?.spendingWallet ?? "—"}</dd>
                    </div>
                  </dl>
                )}
              </Card>

              <Card title="Dining line">
                <div className="flex h-2.5 bg-rule/60">
                  <div className="bg-amber" style={{ width: `${limit ? Math.min(100, (drawn / limit) * 100) : 0}%` }} />
                </div>
                <p className="num mt-1 text-xs">
                  {usdcRaw(d.drawnRaw)} drawn of {usdcRaw(d.drawLimitRaw)} · repaid from fees after FeeNotes (junior)
                </p>
                {linked && (
                  <div className="mt-4 space-y-2">
                    <label className="block">
                      <span className="label">draw (USD)</span>
                      <input className="input mt-1" value={amount} onChange={(e) => setAmount(e.target.value)} />
                    </label>
                    <p className="text-xs text-mute">{pick ? `for ${recs.data?.find((r) => r.locationId === pick)?.name ?? pick}` : "pick a restaurant (optional)"}</p>
                    <Btn onClick={draw}>Sign & draw FLY</Btn>
                    <p className="text-[11px] text-mute">
                      Issues FLY to your Blackbird wallet (Flynet issue_reward) and records the debt on-chain (FeeVault.addDraw). Pay in the Blackbird app.
                    </p>
                    <div className="border-t border-rule pt-3">
                      <Btn kind="ghost" onClick={settle}>
                        Return unused FLY
                      </Btn>
                      <p className="mt-1 text-[11px] text-mute">Pulls leftover FLY back via a Flynet payment intent; the desk credits the equivalent USDC to your vault.</p>
                    </div>
                  </div>
                )}
              </Card>
            </div>

            <div className="space-y-6">
              <Card title="Where to eat · desk agent picks (Bankr LLM over Flynet data)">
                {!linked ? (
                  <p className="text-sm text-mute">Link Blackbird to get picks based on your check-ins and memberships.</p>
                ) : (
                  <Loading l={recs.loading} e={recs.error} retry={recs.reload} what="restaurant picks">
                    <ul className="space-y-3">
                      {recs.data?.map((r, i) => (
                        <li key={r.locationId}>
                          <div
                            role="button"
                            aria-pressed={pick === r.locationId}
                            tabIndex={0}
                            onClick={() => setPick(pick === r.locationId ? null : r.locationId)}
                            onKeyDown={(e) => e.key === "Enter" && setPick(pick === r.locationId ? null : r.locationId)}
                            className={`w-full cursor-pointer rounded-[3px] border p-3 text-left transition-colors ${pick === r.locationId ? "border-violet bg-violet-tint ring-1 ring-violet" : "border-rule bg-paper hover:border-mute"}`}
                          >
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="font-display text-lg leading-tight">
                                <span className="num mr-2 text-base text-mute">{i + 1}</span>
                                {r.name}
                              </span>
                              {r.openNow != null && <span className={`tag ${r.openNow ? "text-desk" : "text-stamp"}`}>{r.openNow ? "open" : "closed"}</span>}
                            </div>
                            <p className="mt-1 text-xs text-mute">{r.address}</p>
                            <p className="mt-2 text-sm">{r.reason}</p>
                            {r.specials.length > 0 && <p className="mt-1 text-xs">specials: {r.specials.join(" · ")}</p>}
                            {r.reservationUrl && (
                              <a className="link mt-1 inline-block text-xs" href={r.reservationUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                                Reserve
                              </a>
                            )}
                          </div>
                        </li>
                      ))}
                      {recs.data?.length === 0 && <li className="text-sm text-mute">No payment-enabled Flynet locations found.</li>}
                    </ul>
                  </Loading>
                )}
              </Card>
              <Card title="Draws">
                {d.draws.length === 0 ? (
                  <p className="text-sm text-mute">No draws yet.</p>
                ) : (
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th className="text-right">USDC</th>
                        <th className="text-right">FLY</th>
                        <th>status</th>
                        <th>addDraw</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {d.draws.map((x) => (
                        <tr key={x.id}>
                          <td className="num">{x.id}</td>
                          <td className="num text-right">{usdcRaw(x.amountRaw)}</td>
                          <td className="num text-right">{(Number(x.flyWei) / 1e18).toFixed(2)}</td>
                          <td className={x.status === "failed" ? "text-stamp" : ""}>
                            {x.status}
                            {x.error && <span className="block text-[11px]">{x.error}</span>}
                          </td>
                          <td>{x.txHash ? <Tx h={x.txHash} /> : <span className="text-xs text-mute">pending retry</span>}</td>
                          <td className="text-xs text-mute">{ago(x.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>
            </div>
          </div>
        )}
      </Loading>
    </div>
  );
}
