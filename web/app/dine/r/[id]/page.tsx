"use client";
import { use } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { DinePlaceDetail } from "@feedesk/shared";
import { api } from "@/lib/api";
import { Card, Loading, useLoad } from "@/components/ui";
import { PlaceCard, PlaceLinks, SourceLine, priceTag } from "@/components/dine";

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

export default function Place({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const q = useLoad(() => api<DinePlaceDetail>(`/api/flynet/restaurants/${id}`), [id]);
  const d = q.data;
  const p = d?.place;
  return (
    <div className="space-y-6">
      <Link href="/dine" className="link text-sm">
        All Blackbird venues
      </Link>
      <Loading l={q.loading} e={q.error} retry={q.reload} what="this venue">
        {d && p && (
          <>
            <header className="grid gap-6 md:grid-cols-[2fr_3fr]">
              {/* eslint-disable-next-line @next/next/no-img-element -- remote Flynet CDN */}
              {p.image ? <img src={p.image} alt={p.name} className="box aspect-[16/9] w-full object-cover" /> : <div className="box aspect-[16/9] bg-rule/40" />}
              <div>
                <h1 className="h1">{p.name}</h1>
                <p className="mt-2 text-sm text-mute">
                  {p.branch && p.branch !== p.address.split(",")[0] ? `${p.branch} · ` : ""}
                  {p.address}
                </p>
                <p className="mt-2 text-sm">
                  {[p.neighborhood, p.region].filter(Boolean).join(" · ")} · <span className="num">{priceTag(p.price)}</span> · {p.cuisine.join(", ") || "cuisine n/a"} ·{" "}
                  {p.cohort === "fsr" ? "full service" : p.cohort === "qsr" ? "quick service" : p.cohort}
                </p>
                <p className="mt-2 flex flex-wrap gap-2">
                  {d.openNow != null && <span className={`tag ${d.openNow ? "text-desk" : "text-stamp"}`}>{d.openNow ? "open now" : "closed now"}</span>}
                  <span className={`tag ${p.paymentsEnabled ? "text-desk" : "text-mute"}`}>{p.paymentsEnabled ? "Blackbird Pay accepted" : "no Blackbird Pay"}</span>
                  {p.reservationsEnabled && <span className="tag text-mute">reservations</span>}
                  {p.isClub && <span className="tag text-mute">club</span>}
                </p>
                <PlaceLinks p={p} />
                <p className="mt-3 text-xs text-mute">
                  <SourceLine s={d.source} /> · times in {p.timeZone}
                </p>
              </div>
            </header>
            {d.errors.length > 0 && (
              <p role="alert" className="rounded-[3px] border border-amber/50 bg-amber/10 px-3 py-2 text-xs text-amber-ink">
                Some Flynet reads failed, so parts of this page are missing: {d.errors.join("; ")}
              </p>
            )}
            <div className="grid gap-6 md:grid-cols-2">
              <Card title="Opening hours" right="Flynet open_hours">
                {!d.hours ? (
                  <p className="text-sm text-mute">Could not load hours from Flynet.</p>
                ) : d.hours.length === 0 ? (
                  <p className="text-sm text-mute">This venue publishes no hours on Flynet.</p>
                ) : (
                  <table className="tbl">
                    <tbody>
                      {DAYS.map((day) => {
                        const hs = d.hours!.filter((h) => h.day === day);
                        return (
                          <tr key={day}>
                            <td className="capitalize">{day}</td>
                            <td className="num">{hs.length ? hs.map((h) => `${h.open}–${h.close}`).join(", ") : "closed"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </Card>
              <Card title="Specials & challenges" right="earn FLY in the Blackbird app">
                {d.specials.length === 0 && d.challenges.length === 0 && <p className="text-sm text-mute">No specials or challenges published for this restaurant right now.</p>}
                <ul className="space-y-2 text-sm">
                  {d.specials.map((s) => (
                    <li key={s.label}>
                      {s.emoji} <b>{s.label}</b>
                      <span className="block text-xs text-mute">{s.description}</span>
                    </li>
                  ))}
                  {d.challenges.map((c) => (
                    <li key={c.title}>
                      <b>Challenge: {c.title}</b>
                      <span className="block text-xs text-mute">
                        {c.description}
                        {c.endTime && ` · ends ${new Date(c.endTime).toLocaleDateString()}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
            {d.siblings.length > 0 && (
              <Card title={`Other ${p.name} locations`}>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {d.siblings.map((x) => (
                    <PlaceCard key={x.id} p={x}>
                      <PlaceLinks p={x} />
                    </PlaceCard>
                  ))}
                </div>
              </Card>
            )}
          </>
        )}
      </Loading>
    </div>
  );
}
