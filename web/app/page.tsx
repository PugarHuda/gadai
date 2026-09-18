"use client";
import Link from "next/link";
import type { DeskInfo, Loan } from "@feedesk/shared";
import { api } from "@/lib/api";
import { publicClient, vaultAbi } from "@/lib/chain";
import { Addr, Card, Loading, Pill, Stat, pct, usd, usdcRaw, useLoad, ago } from "@/components/ui";

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

  return (
    <div className="space-y-8">
      <section className="grid gap-6 md:grid-cols-[1.4fr_1fr] md:items-end">
        <div>
          <p className="label">Credit desk for Bankr agents · Base</p>
          <h1 className="h1 mt-2">
            Borrow against your <em className="text-desk">creator fees</em>.
          </h1>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed">
            Pledge the fee rights of your Bankr-launched token to a per-loan FeeVault. Three LLM underwriters (Bankr Gateway) write the credit memo, lenders fund it in a
            Uniswap CCA for a new asset — the <b>FeeNote</b> — and the desk&apos;s Dynamic agent wallet disburses USDC. Fees repay the notes; the lien releases itself.
          </p>
          <div className="mt-5 flex gap-3">
            <Link href="/apply" className="btn btn-primary">Apply for a loan</Link>
            <Link href="/notes" className="btn btn-ghost">Fund a FeeNote</Link>
          </div>
        </div>
        <Card title="Desk">
          <Loading l={desk.loading} e={desk.error}>
            {desk.data && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="label">chain</dt><dd className="num">{desk.data.chainId}{desk.data.demoFork && <span className="tag ml-2 text-stamp">fork</span>}</dd>
                <dt className="label">FeeDesk</dt><dd><Addr a={desk.data.desk} /></dd>
                <dt className="label">agent wallet</dt><dd><Addr a={desk.data.agentWallet} /> <span className="tag">Dynamic</span></dd>
                <dt className="label">treasury</dt><dd><Addr a={desk.data.treasury} /></dd>
                <dt className="label">underwriters</dt><dd className="text-xs">{desk.data.personas.map((p) => `${p.name} (${p.model})`).join(" · ")}</dd>
              </dl>
            )}
          </Loading>
        </Card>
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat k="loans written" v={live.length} sub={`${loans.filter((l) => l.status === "DECLINED").length} declined by the lead underwriter`} />
        <Stat k="active" v={loans.filter((l) => l.status === "ACTIVE").length} sub={`${loans.filter((l) => l.status === "AUCTION").length} in auction`} />
        <Stat k="principal" v={usd(principal, 0)} sub={`face ${usd(face, 0)}`} />
        <Stat k="released" v={loans.filter((l) => l.status === "RELEASED").length} sub="liens returned to borrowers" />
      </section>

      <Card title="Loan book" right={<button className="link" onClick={() => book.reload()}>refresh</button>}>
        <Loading l={book.loading} e={book.error}>
          {loans.length === 0 ? (
            <p className="text-sm text-mute">No loans yet. <Link className="link" href="/apply">Be the first.</Link></p>
          ) : (
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr><th>#</th><th>status</th><th>token</th><th>borrower</th><th className="text-right">principal / face</th><th>repaid</th><th>vault · note</th><th>via</th><th>opened</th></tr>
                </thead>
                <tbody>
                  {loans.map((l) => (
                    <tr key={l.id} className="hover:bg-ink/5">
                      <td><Link className="link num" href={`/loans/${l.id}`}>{l.id}</Link></td>
                      <td><Pill s={l.status} /></td>
                      <td><Addr a={l.token} label={`$${l.symbol}`} /></td>
                      <td><Addr a={l.borrower} /></td>
                      <td className="num text-right">{usdcRaw(l.terms?.principalRaw)} <span className="text-mute">/ {usdcRaw(l.terms?.faceValueRaw)}</span></td>
                      <td className="min-w-28">
                        {l.repaidPct == null ? <span className="text-mute">—</span> : (
                          <div>
                            <div className="h-1.5 bg-ink/10"><div className="h-full bg-desk" style={{ width: `${l.repaidPct}%` }} /></div>
                            <span className="num text-xs">{pct(l.repaidPct)}</span>
                          </div>
                        )}
                      </td>
                      <td className="text-xs"><Addr a={l.vault} /> · <Addr a={l.note} /></td>
                      <td className="text-xs">{l.via}</td>
                      <td className="text-xs text-mute" title={l.createdAt}>{ago(l.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Loading>
      </Card>
    </div>
  );
}
