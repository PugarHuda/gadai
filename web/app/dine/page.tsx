"use client";
import { useState } from "react";
import Link from "next/link";
import type { DinePlaceList, FlynetStatus, Loan } from "@feedesk/shared";
import { api } from "@/lib/api";
import { useSigner } from "@/lib/wallet";
import { Card, Empty, Loading, Pill, usdcRaw, useLoad } from "@/components/ui";
import { FlynetNotes, PlaceCard, PlaceLinks, SourceLine, priceTag } from "@/components/dine";

export default function DineHome() {
  const s = useSigner();
  const me = s.address?.toLowerCase();
  const st = useLoad(() => api<FlynetStatus>("/api/flynet/status"), []);
  const loans = useLoad(async () => (me ? (await api<Loan[]>("/api/loans")).filter((l) => l.borrower.toLowerCase() === me || l.controller.toLowerCase() === me) : []), [me]);
  const [f, setF] = useState({ query: "", region: "", cuisine: "", price: "" });
  const [page, setPage] = useState(0);
  const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)), page: String(page) }).toString();
  const list = useLoad(() => api<DinePlaceList>(`/api/flynet/restaurants?${qs}`), [qs]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => (setF({ ...f, [k]: e.target.value }), setPage(0));
  const d = list.data;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="h1">Dine on your fees</h1>
        <p className="mt-4 max-w-[68ch] text-ink/85">
          Every Gadai loan carries a dining budget (its <span className="num">drawLimit</span>, set by the underwriter against pledged creator fees). The desk&apos;s concierge plans a
          meal inside that budget from live Blackbird Flynet data: venues, opening hours, specials and challenges. You pay at the table in the Blackbird app. Gadai moves no money
          for dining.
        </p>
      </header>

      <FlynetNotes st={st.data} />

      <Card title="Plan against a loan" right="borrower or controller wallet">
        {!s.connected ? (
          <Empty title="Log in to plan with your dining budget">
            <button className="link" onClick={s.login}>
              Log in with Dynamic
            </button>{" "}
            to see your loans. Browsing the venues below needs no login.
          </Empty>
        ) : (
          <Loading l={loans.loading} e={loans.error} retry={loans.reload} what="your loans">
            {loans.data?.length === 0 && (
              <Empty title="No loans for this wallet">
                The dining budget comes with a loan. <Link className="link" href="/apply">Apply for a loan</Link> first.
              </Empty>
            )}
            <ul className="divide-y divide-rule">
              {loans.data?.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm first:pt-0 last:pb-0">
                  <span>
                    <b>${l.symbol}</b> <span className="num text-mute">#{l.id}</span> · dining budget <span className="num">{usdcRaw(l.terms?.drawLimitRaw)}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <Pill s={l.status} />
                    {l.status === "DECLINED" || l.status === "CANCELLED" ? (
                      <span className="text-xs text-mute">No budget on a {l.status.toLowerCase()} loan</span>
                    ) : (
                      <Link className="btn btn-primary" href={`/dine/${l.id}`}>
                        Plan a meal
                      </Link>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </Loading>
        )}
      </Card>

      <Card title="Blackbird venues" right={d ? <SourceLine s={d.source} /> : "Flynet /locations"}>
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="sm:col-span-2">
            <span className="label">search</span>
            <input className="input mt-1 w-full" placeholder="name, cuisine, neighborhood" value={f.query} onChange={set("query")} />
          </label>
          <label>
            <span className="label">city</span>
            <select className="input mt-1 w-full" value={f.region} onChange={set("region")}>
              <option value="">all</option>
              {d?.regions.map((r) => <option key={r}>{r}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className="label">cuisine</span>
              <select className="input mt-1 w-full" value={f.cuisine} onChange={set("cuisine")}>
                <option value="">all</option>
                {d?.cuisines.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label>
              <span className="label">price</span>
              <select className="input mt-1 w-full" value={f.price} onChange={set("price")}>
                <option value="">any</option>
                {[1, 2, 3, 4].map((p) => (
                  <option key={p} value={p}>
                    {priceTag(p)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <div className="mt-5">
          <Loading l={list.loading && !d} e={list.error} retry={list.reload} what="Blackbird venues">
            {d && d.total === 0 && <Empty title="No Blackbird venue matches">Clear a filter or search for a cuisine or neighborhood.</Empty>}
            {d && d.total > 0 && (
              <>
                <p className="mb-3 text-xs text-mute">
                  <span className="num">{d.total}</span> venues · page <span className="num">{d.page + 1}</span> of <span className="num">{Math.ceil(d.total / d.pageSize)}</span>
                </p>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy={list.loading}>
                  {d.places.map((p) => (
                    <PlaceCard key={p.id} p={p}>
                      <PlaceLinks p={p} />
                    </PlaceCard>
                  ))}
                </div>
                <div className="mt-4 flex gap-3">
                  <button className="btn btn-ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>
                    Previous
                  </button>
                  <button className="btn btn-ghost" disabled={(page + 1) * d.pageSize >= d.total} onClick={() => setPage(page + 1)}>
                    Next
                  </button>
                </div>
              </>
            )}
          </Loading>
        </div>
      </Card>
    </div>
  );
}
