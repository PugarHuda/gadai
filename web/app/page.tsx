"use client";
import Link from "next/link";
import type { DeskInfo, Loan } from "@feedesk/shared";
import { api } from "@/lib/api";
import { publicClient, vaultAbi } from "@/lib/chain";
import { Addr, Card, Empty, Lifecycle, Loading, Pill, Stat, pct, usd, usdcRaw, useLoad, ago } from "@/components/ui";

type Row = Loan & { repaidPct: number | null };

/** repaid % = (face − (outstanding − drawDebt))/face, on-chain. debtOutstanding includes Flynet dining draws, which are not note principal. */
async function loadBook(): Promise<Row[]> {
  const loans = await api<Loan[]>("/api/loans");
  const funded = loans.filter((l) => l.vault && (l.status === "ACTIVE" || l.status === "RELEASED"));
  const res = funded.length
    ? await publicClient.multicall({
        contracts: funded.flatMap((l) => [
          { address: l.vault!, abi: vaultAbi, functionName: "faceValue" } as const,
          { address: l.vault!, abi: vaultAbi, functionName: "debtOutstanding" } as const,
          { address: l.vault!, abi: vaultAbi, functionName: "drawDebt" } as const,
        ]),
      })
    : [];
  const rp = new Map<number, number>();
  funded.forEach((l, i) => {
    const [f, o, d] = [res[3 * i], res[3 * i + 1], res[3 * i + 2]];
    if (f?.status === "success" && o?.status === "success" && d?.status === "success") {
      const face = Number(f.result as bigint), out = Math.max(0, Number(o.result as bigint) - Number(d.result as bigint));
      rp.set(l.id, face ? (Math.max(0, face - Math.min(out, face)) / face) * 100 : 0);
    }
  });
  return loans.map((l) => ({ ...l, repaidPct: rp.get(l.id) ?? null }));
}

export default function Home() {
  const desk = useLoad(() => api<DeskInfo>("/api/desk"));
  const book = useLoad(loadBook, [], 30_000);
  const loans = book.data ?? [];
  const live = loans.filter((l) => l.status !== "DECLINED" && l.status !== "CANCELLED");
  const principal = live.reduce((s, l) => s + (l.terms ? Number(l.terms.principalRaw) / 1e6 : 0), 0);
  const face = live.reduce((s, l) => s + (l.terms ? Number(l.terms.faceValueRaw) / 1e6 : 0), 0);

  const count = (st: string) => loans.filter((l) => l.status === st).length;

  return (
    <div className="space-y-12">
      <section className="grid gap-8 md:grid-cols-[1.35fr_1fr] md:items-start">
        <div>
          <h1 className="h1 max-w-[16ch]">Borrow USDC against your token&apos;s creator fees.</h1>
          <p className="mt-5 max-w-[60ch] text-base leading-relaxed text-ink/85">
            Gadai is a registry of pledged fee rights on Base. A Bankr agent or creator pledges its Doppler fee stream to a FeeVault, lenders fund the loan by buying FeeNotes in a
            Uniswap auction, and the fees repay the notes. When the debt is zero, anyone can release the lien and the rights go back.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/apply" className="btn btn-primary">Apply for a loan</Link>
            <Link href="/notes" className="btn btn-ghost">Fund a FeeNote</Link>
          </div>
        </div>
        <Card title="Desk registration" right={desk.data?.demoFork ? <span className="pill text-amber-ink">fork</span> : undefined}>
          <Loading l={desk.loading} e={desk.error} retry={desk.reload} what="the desk's addresses and underwriters">
            {desk.data && (
              <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-2 text-sm">
                <dt className="label">Chain</dt><dd className="num">{desk.data.chainId}</dd>
                <dt className="label">FeeDesk</dt><dd><Addr a={desk.data.desk} /></dd>
                <dt className="label">Agent wallet</dt><dd><Addr a={desk.data.agentWallet} /> <span className="tag text-mute">Dynamic</span></dd>
                <dt className="label">Treasury</dt><dd><Addr a={desk.data.treasury} /></dd>
                <dt className="label">Underwriters</dt>
                <dd className="text-xs leading-relaxed">{desk.data.personas.map((p) => `${p.name} (${p.model})`).join(" · ")}</dd>
              </dl>
            )}
          </Loading>
        </Card>
      </section>

      <section aria-labelledby="how">
        <h2 id="how" className="mb-3 text-lg font-bold [font-stretch:108%]">How a loan moves</h2>
        <Lifecycle detail />
      </section>

      <section aria-labelledby="book" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="book" className="text-lg font-bold [font-stretch:108%]">Loan book</h2>
          <button className="link text-sm" onClick={() => book.reload()}>Refresh</button>
        </div>
        {book.data && (
          <div className="card grid grid-cols-2 gap-px overflow-hidden bg-rule md:grid-cols-4">
            <Stat k="Loans written" v={live.length} sub={`${count("DECLINED")} declined by the lead underwriter`} />
            <Stat k="Active" v={count("ACTIVE")} sub={`${count("AUCTION")} in auction`} />
            <Stat k="Principal" v={usd(principal, 0)} sub={`face ${usd(face, 0)}`} />
            <Stat k="Released" v={count("RELEASED")} sub="liens returned to borrowers" />
          </div>
        )}
        <div className="card p-4 sm:p-5">
          <Loading l={book.loading} e={book.error} retry={book.reload} what="the loan book">
            {loans.length === 0 ? (
              <Empty title="No loans on the book yet">
                The first approved application will appear here with its FeeVault, FeeNote and repayment progress. <Link className="link" href="/apply">Apply for a loan</Link>.
              </Empty>
            ) : (
              <>
                <ul className="divide-y divide-rule md:hidden">
                  {loans.map((l) => (
                    <li key={l.id} className="py-3 first:pt-0 last:pb-0">
                      <Link href={`/loans/${l.id}`} className="flex items-center justify-between gap-3">
                        <span className="font-semibold">${l.symbol} <span className="num text-sm font-normal text-mute">#{l.id}</span></span>
                        <Pill s={l.status} />
                      </Link>
                      <div className="num mt-1 flex justify-between text-sm">
                        <span>{usdcRaw(l.terms?.principalRaw)} <span className="text-mute">/ {usdcRaw(l.terms?.faceValueRaw)}</span></span>
                        <span className="text-mute">{l.repaidPct == null ? ago(l.createdAt) : `${pct(l.repaidPct)} repaid`}</span>
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="hidden overflow-x-auto md:block">
                  <table className="tbl">
                    <thead>
                      <tr><th>#</th><th>Status</th><th>Token</th><th>Borrower</th><th className="text-right">Principal / face</th><th>Repaid</th><th>Vault · note</th><th>Via</th><th>Opened</th></tr>
                    </thead>
                    <tbody>
                      {loans.map((l) => (
                        <tr key={l.id} className="transition-colors hover:bg-violet-tint/50">
                          <td><Link className="link num" href={`/loans/${l.id}`}>{l.id}</Link></td>
                          <td><Pill s={l.status} /></td>
                          <td><Addr a={l.token} label={`$${l.symbol}`} /></td>
                          <td><Addr a={l.borrower} /></td>
                          <td className="num text-right whitespace-nowrap">{usdcRaw(l.terms?.principalRaw)} <span className="text-mute">/ {usdcRaw(l.terms?.faceValueRaw)}</span></td>
                          <td className="min-w-28">
                            {l.repaidPct == null ? <span className="text-mute">—</span> : (
                              <div>
                                <div className="h-1.5 bg-rule/60"><div className="h-full bg-desk" style={{ width: `${l.repaidPct}%` }} /></div>
                                <span className="num text-xs">{pct(l.repaidPct)}</span>
                              </div>
                            )}
                          </td>
                          <td className="text-xs whitespace-nowrap"><Addr a={l.vault} /> · <Addr a={l.note} /></td>
                          <td className="text-xs">{l.via}</td>
                          <td className="text-xs whitespace-nowrap text-mute" title={l.createdAt}>{ago(l.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Loading>
        </div>
      </section>
    </div>
  );
}
