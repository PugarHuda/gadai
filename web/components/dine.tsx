"use client";
import { useState } from "react";
import Link from "next/link";
import type { DineMemberLogin, DinePick, DinePlace, DineSource, DineTrending, FlynetStatus } from "@feedesk/shared";
import { api } from "@/lib/api";
import { Card, Empty, Loading, ago, useLoad } from "@/components/ui";

export const priceTag = (p: number | null) => (p ? "$".repeat(p) : "price n/a");

/** One Blackbird venue from live Flynet data. Image from Flynet's asset CDN when the brand has one. */
export function PlaceCard({ p, children }: { p: DinePlace; children?: React.ReactNode }) {
  return (
    <article className="box flex flex-col overflow-hidden bg-card">
      <Link href={`/dine/r/${p.id}`} className="block aspect-[16/9] bg-rule/40" aria-label={`${p.name}, ${p.neighborhood ?? p.region ?? ""}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- remote Flynet CDN, no loader configured */}
        {p.image ? <img src={p.image} alt="" loading="lazy" className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center text-xs text-mute">no image on Flynet</span>}
      </Link>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <div className="flex items-baseline justify-between gap-2">
          <Link href={`/dine/r/${p.id}`} className="font-bold leading-tight hover:underline">
            {p.name}
          </Link>
          <span className="num text-xs text-mute">{priceTag(p.price)}</span>
        </div>
        <p className="text-xs text-mute">
          {[p.neighborhood, p.region].filter(Boolean).join(" · ")}
          {p.cuisine.length > 0 && ` · ${p.cuisine.slice(0, 3).join(", ")}`}
        </p>
        {children}
      </div>
    </article>
  );
}

export function PickCard({ x, rank, action }: { x: DinePick; rank: number; action?: React.ReactNode }) {
  const p = x.place;
  return (
    <PlaceCard p={p}>
      <div className="mt-1 flex flex-wrap gap-1.5">
        <span className="num text-xs text-mute">#{rank}</span>
        {x.openAtTime != null && <span className={`tag ${x.openAtTime ? "text-desk" : "text-stamp"}`}>{x.openAtTime ? "open then" : "closed then"}</span>}
        {x.hoursToday && <span className="tag num text-mute">today {x.hoursToday}</span>}
        {x.estCostUsd != null && (
          <span className={`tag num ${x.fitsBudget === false ? "text-amber-ink" : "text-mute"}`}>
            est. ${x.estCostUsd}
            {x.fitsBudget === false ? " · over budget" : x.fitsBudget ? " · in budget" : ""}
          </span>
        )}
        {x.visits != null && x.visits > 0 && <span className="tag text-mute">visited {x.visits}×</span>}
        {x.membership && <span className="tag text-violet">your card: {x.membership.tier}</span>}
        {x.weekCheckIns != null && <span className="tag num text-mute">{x.weekCheckIns} check-ins / 7d</span>}
      </div>
      <ul className="mt-2 list-disc space-y-0.5 pl-4 text-sm">
        {x.reasons.map((r, i) => (
          <li key={i} className={i === 0 ? "" : "text-mute"}>
            {r}
          </li>
        ))}
      </ul>
      {x.specials.map((s) => (
        <p key={s.label} className="text-xs">
          {s.emoji} {s.label}: <span className="text-mute">{s.description}</span>
        </p>
      ))}
      {x.challenges.map((c) => (
        <p key={c.title} className="text-xs">
          Challenge: {c.title}
        </p>
      ))}
      <PlaceLinks p={p} />
      {action}
    </PlaceCard>
  );
}

/** "Save to my Blackbird list" (write:save_to_list). Disabled with the reason while Blackbird has no published endpoint. */
export function SaveToList({ loanId, session, restaurantId, state }: { loanId: number; session: string; restaurantId: string; state: DineMemberLogin }) {
  const [r, setR] = useState<{ ok: boolean; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api(`/api/loans/${loanId}/dine/save`, { body: { session, restaurantId } });
      setR({ ok: true, msg: "Saved to your Blackbird list" });
    } catch (e) {
      setR({ ok: false, msg: `Not saved: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="pt-2 text-xs">
      <button className="btn btn-ghost" disabled={!state.available || busy} title={state.reason ?? undefined} onClick={save}>
        {busy ? "Saving…" : "Save to my Blackbird list"}
      </button>
      {r && <p className={`mt-1 ${r.ok ? "text-desk" : "text-stamp"}`} role="status">{r.msg}</p>}
    </div>
  );
}

/** Venues busiest on the Blackbird network: picked from the latest anonymized check-ins, ranked by their 7-day count. */
export function Trending({ region }: { region?: string }) {
  const t = useLoad(() => api<DineTrending>(`/api/flynet/trending${region ? `?region=${encodeURIComponent(region)}` : ""}`), [region]);
  const d = t.data;
  return (
    <Card title={`Trending on Blackbird this week${region ? ` · ${region}` : ""}`} right={d ? <SourceLine s={d.source} /> : "Flynet /check_ins"}>
      <Loading l={t.loading && !d} e={t.error} retry={t.reload} what="Blackbird check-in activity">
        {d && d.places.length === 0 && <Empty title="No recent check-ins here">The latest {d.sample.size} Blackbird check-ins include none{region ? ` in ${region}` : ""}. Try another city.</Empty>}
        {d && d.places.length > 0 && (
          <>
            <p className="mb-3 text-xs text-mute">
              Venues from the latest <span className="num">{d.sample.size}</span> network check-ins{d.sample.from && d.sample.to && <> ({ago(d.sample.from)} to {ago(d.sample.to)})</>}, ranked by check-ins in the last 7 days. Anonymized: Flynet shares no member identity.
            </p>
            {d.errors.length > 0 && <p className="mb-2 text-xs text-amber-ink">Some 7-day counts failed: {d.errors.slice(0, 2).join("; ")}</p>}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {d.places.map((r) => (
                <PlaceCard key={r.place.id} p={r.place}>
                  <p className="text-xs">
                    <b className="num">{r.weekCheckIns ?? "n/a"}</b> check-ins in 7 days · <span className="num">{r.recentCheckIns}</span> just now
                  </p>
                  <PlaceLinks p={r.place} />
                </PlaceCard>
              ))}
            </div>
          </>
        )}
      </Loading>
    </Card>
  );
}

export function PlaceLinks({ p }: { p: DinePlace }) {
  return (
    <p className="mt-auto flex flex-wrap gap-x-3 pt-2 text-xs">
      <Link className="link" href={`/dine/r/${p.id}`}>
        Hours &amp; offers
      </Link>
      {p.reservationUrl && (
        <a className="link" href={p.reservationUrl} target="_blank" rel="noreferrer">
          Reserve
        </a>
      )}
      {p.mapsUrl && (
        <a className="link" href={p.mapsUrl} target="_blank" rel="noreferrer">
          Map
        </a>
      )}
      {p.website && (
        <a className="link" href={p.website} target="_blank" rel="noreferrer">
          Website
        </a>
      )}
    </p>
  );
}

export const SourceLine = ({ s }: { s: DineSource }) => (
  <span>
    live Flynet data, fetched {ago(s.fetchedAt)}
    {s.stale && <b className="text-amber-ink"> · Flynet unreachable, showing the last good copy</b>}
  </span>
);

/** Environment + what the Flynet app is allowed to do, said plainly. */
export function FlynetNotes({ st }: { st: FlynetStatus | null }) {
  if (!st) return null;
  return (
    <div className="box space-y-1 bg-card px-4 py-3 text-xs text-mute">
      <p>
        <span className="label mr-2">Flynet</span>
        <b className={st.env === "production" ? "text-desk" : "text-amber-ink"}>{st.env}</b> · app “{st.appName ?? "unknown"}” · scopes: <span className="num">{st.allowedScopes.join(" ") || "n/a"}</span>
      </p>
      <p>
        <span className="label mr-2">Payment</span>
        <b className="text-stamp">not enabled</b>: {st.payments.reason}
      </p>
      <p>
        <span className="label mr-2">Member login</span>
        {st.memberLogin.available ? <b className="text-desk">available</b> : <b className="text-amber-ink">{st.memberLogin.reason}</b>}
      </p>
    </div>
  );
}
