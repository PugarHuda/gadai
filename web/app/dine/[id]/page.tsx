"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { flynetLinkMessage, type DinePassport, type DinePlan, type DineState, type FlynetStatus } from "@feedesk/shared";
import { api } from "@/lib/api";
import { ENV } from "@/lib/env";
import { useSigner } from "@/lib/wallet";
import { Btn, Card, Empty, Err, Loading, Pill, ago, usd, usdcRaw, useLoad } from "@/components/ui";
import { FlynetNotes, PayWithFly, PickCard, PlaceCard, PlaceLinks, SaveToList, SourceLine, Trending } from "@/components/dine";

const EXAMPLES = ["somewhere in NYC for four, open late, burgers", "cheap drinks in SF", "Italian in Denver, takes reservations", "coffee in the Financial District"];
const skey = (id: number) => `gadai:flynet-session:${id}`;
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* private mode */ } },
};

export default function DinePlanner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  if (!/^[1-9]\d{0,14}$/.test(id)) notFound(); // /dine/abc is a 404, never "loan #NaN"
  const loanId = Number(id);
  const s = useSigner();
  const st = useLoad(() => api<DineState>(`/api/loans/${loanId}/dine`), [loanId]);
  const fs = useLoad(() => api<FlynetStatus>("/api/flynet/status"), []);

  // member session: the OAuth callback lands on #member=<token> (or #member-error=...)
  const [session, setSession] = useState<string | null>(null);
  const [memberErr, setMemberErr] = useState<string | null>(null);
  useEffect(() => {
    const h = new URLSearchParams(window.location.hash.slice(1));
    if (h.get("member")) store.set(skey(loanId), h.get("member"));
    if (h.get("member-error")) setMemberErr(`Blackbird login did not finish: ${h.get("member-error")}`);
    if (h.size) history.replaceState(null, "", window.location.pathname);
    setSession(store.get(skey(loanId)));
  }, [loanId]);
  const sq = session ? `?session=${encodeURIComponent(session)}` : ""; // query, not a header: the agent CORS allowlist has no custom headers
  const pass = useLoad(async () => {
    if (!session) return null;
    try {
      return await api<DinePassport>(`/api/loans/${loanId}/dine/passport${sq}`);
    } catch (e) {
      if (/session required/.test((e as Error).message)) (store.set(skey(loanId), null), setSession(null));
      throw e;
    }
  }, [loanId, session]);

  const connect = async () => {
    const nonce = crypto.randomUUID();
    const sig = await s.signMessage(flynetLinkMessage(loanId, nonce));
    window.location.href = `${ENV.AGENT_URL}/api/flynet/connect?loanId=${loanId}&nonce=${nonce}&sig=${sig}`;
  };
  const logout = async () => {
    await api(`/api/loans/${loanId}/dine/member${sq}`, { method: "DELETE" });
    store.set(skey(loanId), null);
    setSession(null);
  };

  const [req, setReq] = useState(EXAMPLES[0]!);
  const [party, setParty] = useState("4");
  const [time, setTime] = useState("");
  const [useLoc, setUseLoc] = useState(false);
  const [plan, setPlan] = useState<DinePlan | null>(null);
  const ask = async () => {
    let near: { lat: number; lng: number } | undefined;
    if (useLoc)
      near = await new Promise((ok, no) =>
        navigator.geolocation.getCurrentPosition((p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude }), () => no(new Error("Location permission denied; untick “near me” or allow it")), { timeout: 10_000 }),
      );
    setPlan(await api<DinePlan>(`/api/loans/${loanId}/dine/plan${sq}`, { body: { request: req, partySize: Number(party), time: time || undefined, near } }));
  };

  const d = st.data;
  const budget = d ? Number(BigInt(d.budgetRaw)) / 1e6 : 0;
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="h1">Dine on {d ? `$${d.symbol}` : "your"} fees</h1>
          <p className="mt-2 text-sm text-mute">Blackbird Flynet dining concierge for loan #{loanId}</p>
        </div>
        <Link href={`/loans/${loanId}`} className="link text-sm">
          Back to loan #{loanId}
        </Link>
      </header>

      <Loading l={st.loading} e={st.error} retry={st.reload} what="this loan's dining budget">
        {d && (
          <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
            <div className="space-y-6">
              <Card title="Dining budget" right={<Pill s={d.loanStatus} />}>
                <p className="num font-display text-3xl">{usdcRaw(d.budgetRaw)}</p>
                <p className="mt-1 text-xs text-mute">
                  The loan&apos;s <span className="num">drawLimit</span> from underwriting, backed by the pledged creator-fee rights. The concierge plans inside it
                  {d.loanStatus !== "ACTIVE" && `; the loan is ${d.loanStatus}, so this is a plan only`}.
                </p>
                {/* live state from GET /api/flynet/status (the app's own allowed_scopes), not a hard-coded line */}
                {(() => {
                  const p = fs.data?.payments ?? d.payments;
                  const live = p.state === "enabled";
                  return (
                    <div className={`mt-3 rounded-[3px] border px-3 py-2 text-xs ${live ? "border-desk/30 bg-desk/5" : "border-stamp/30 bg-stamp/5"}`}>
                      <b className={live ? "text-desk" : "text-stamp"}>
                        FLY payments: {live ? "enabled" : p.state === "pending-review" ? "pending Blackbird review" : "unknown"}.
                      </b>{" "}
                      {p.reason} Paying charges the member&apos;s own Blackbird FLY balance; the loan&apos;s{" "}
                      <span className="num">drawLimit</span> stays a planning budget.
                    </div>
                  );
                })()}
              </Card>

              <Card title="Blackbird passport" right="Flynet OAuth + PKCE">
                <Err e={memberErr} />
                {!d.memberLogin.available ? (
                  <Empty title="Blackbird login is not available yet">
                    {d.memberLogin.reason} Until then the concierge still works on public Flynet data, just without your check-in history.
                  </Empty>
                ) : !session ? (
                  <div className="space-y-2 text-sm">
                    <p>
                      Log in with Blackbird to read your profile, FLY balance, check-ins, membership cards and tags. The concierge then knows where you have eaten, boosts
                      restaurants where you hold a card, and can suggest somewhere new. Nothing is paid.
                    </p>
                    <Btn onClick={s.connected ? connect : s.login}>{s.connected ? "Log in with Blackbird" : "Log in with Dynamic first"}</Btn>
                    <p className="text-[11px] text-mute">You sign one message with the loan&apos;s borrower wallet so the login binds to this loan.</p>
                  </div>
                ) : (
                  <Loading l={pass.loading} e={pass.error} retry={pass.reload} what="your Blackbird passport">
                    {pass.data && (
                      <div className="space-y-3 text-sm">
                        <div className="flex items-baseline justify-between">
                          <span className="font-display text-2xl">{pass.data.firstName || "Blackbird member"}</span>
                          {pass.data.tier && <span className="tag text-violet">{pass.data.tier}</span>}
                        </div>
                        <dl className="grid grid-cols-2 gap-2">
                          <div>
                            <dt className="label">FLY balance</dt>
                            <dd className="num">{(Number(BigInt(pass.data.flyBalanceWei) / 10n ** 14n) / 1e4).toFixed(2)}</dd>
                          </div>
                          <div>
                            <dt className="label">≈ USD</dt>
                            <dd className="num">{usd(pass.data.flyBalanceUsdCents / 100)}</dd>
                          </div>
                          <div>
                            <dt className="label">places visited</dt>
                            <dd className="num">{pass.data.placesVisited}</dd>
                          </div>
                          <div>
                            <dt className="label">check-ins</dt>
                            <dd className="num">{pass.data.checkIns.length}</dd>
                          </div>
                        </dl>
                        {pass.data.checkIns.length > 0 && (
                          <ul className="max-h-48 space-y-1 overflow-auto text-xs">
                            {pass.data.checkIns.map((c, i) => (
                              <li key={i} className="flex justify-between gap-2">
                                <Link className="link" href={`/dine/r/${c.placeId}`}>
                                  {c.name}
                                </Link>
                                <span className="text-mute">
                                  {c.neighborhood ?? ""} · {ago(c.at)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                        {pass.data.checkIns.length === 0 && <p className="text-xs text-mute">No check-ins yet on this Blackbird account.</p>}
                        {pass.data.memberships && (
                          <div>
                            <p className="label">membership cards ({pass.data.memberships.length})</p>
                            {pass.data.memberships.length === 0 ? (
                              <p className="text-xs text-mute">No membership cards yet.</p>
                            ) : (
                              <ul className="max-h-40 space-y-1 overflow-auto text-xs">
                                {pass.data.memberships.map((m) => (
                                  <li key={m.restaurantId} className="flex justify-between gap-2">
                                    <span>{m.name}</span>
                                    <span className="text-mute">
                                      {m.tier} · <span className="num">{m.checkIns}</span> check-ins
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                        {pass.data.tags && pass.data.tags.length > 0 && (
                          <p className="text-xs">
                            <span className="label mr-2">tags</span>
                            {pass.data.tags.map((t) => `${t.type}${t.metadata.length ? ` (${t.metadata.map((m) => `${m.key}: ${m.value.join(", ")}`).join("; ")})` : ""}`).join(" · ")}
                          </p>
                        )}
                        {pass.data.notes.map((n) => (
                          <p key={n} className="text-xs text-amber-ink">
                            {n}
                          </p>
                        ))}
                        <Btn kind="ghost" onClick={logout}>
                          Log out of Blackbird
                        </Btn>
                      </div>
                    )}
                  </Loading>
                )}
              </Card>
              <FlynetNotes st={fs.data} />
            </div>

            <div className="space-y-6">
              <Card title="Ask the concierge" right={`budget ${usd(budget)} · ~${usd(budget / Math.max(1, Number(party) || 1), 0)} a head`}>
                <label className="block">
                  <span className="label">what are you after?</span>
                  <textarea className="input mt-1 min-h-20 w-full py-2" maxLength={500} value={req} onChange={(e) => setReq(e.target.value)} />
                </label>
                <div className="mt-1 flex flex-wrap gap-2 text-xs">
                  {EXAMPLES.map((x) => (
                    <button key={x} className="link" onClick={() => setReq(x)}>
                      {x}
                    </button>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap items-end gap-3">
                  <label>
                    <span className="label">party</span>
                    <input className="input mt-1 w-20" type="number" min={1} max={20} value={party} onChange={(e) => setParty(e.target.value)} />
                  </label>
                  <label>
                    <span className="label">time (venue-local)</span>
                    <input className="input mt-1" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                  </label>
                  <label className="flex items-center gap-2 pb-2 text-sm">
                    <input type="checkbox" checked={useLoc} onChange={(e) => setUseLoc(e.target.checked)} /> near me
                  </label>
                  <Btn onClick={ask}>Find a table</Btn>
                </div>
                <p className="mt-2 text-[11px] text-mute">Leave time empty for “now”. Location is sent once for distance and is not stored.</p>
              </Card>

              {plan && (
                <Card title={`Shortlist for “${plan.request}”`} right={<SourceLine s={plan.source} />}>
                  <p className="text-xs">
                    <span className={`tag mr-2 ${plan.ranker === "bankr-llm" ? "text-violet" : "text-mute"}`}>{plan.ranker === "bankr-llm" ? "Bankr LLM" : "deterministic ranker"}</span>
                    <span className="text-mute">{plan.rankerNote}</span>
                  </p>
                  <p className="mt-2 text-xs text-mute">
                    Read as: {plan.understood.join(" · ")} · {plan.considered} Blackbird venues matched
                    {plan.personalized ? " · personalized with your check-ins and membership cards" : ""} · 7-day check-ins are network-wide and anonymized
                  </p>
                  {session && !d.saveToList.available && <p className="mt-2 text-xs text-mute">Save to list: {d.saveToList.reason}</p>}
                  {plan.notes.map((n) => (
                    <p key={n} className="mt-2 rounded-[3px] border border-amber/50 bg-amber/10 px-3 py-1.5 text-xs text-amber-ink">
                      {n}
                    </p>
                  ))}
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    {plan.picks.map((x, i) => (
                      <PickCard
                        key={x.place.id}
                        x={x}
                        rank={i + 1}
                        action={
                          session && pass.data ? (
                            <>
                              <SaveToList loanId={loanId} session={session} restaurantId={x.place.restaurantId} state={d.saveToList} />
                              <PayWithFly loanId={loanId} session={session} restaurantId={x.place.restaurantId} name={x.place.name} payments={fs.data?.payments ?? d.payments} />
                            </>
                          ) : undefined
                        }
                      />
                    ))}
                  </div>
                </Card>
              )}

              {!plan && <Trending />}

              {pass.data && pass.data.gapsNearby.length > 0 && (
                <Card title="Gaps in your passport" right="Blackbird venues in your neighborhoods you have not checked in at">
                  <div className="grid gap-4 sm:grid-cols-3">
                    {pass.data.gapsNearby.map((p) => (
                      <PlaceCard key={p.id} p={p}>
                        <PlaceLinks p={p} />
                      </PlaceCard>
                    ))}
                  </div>
                </Card>
              )}
            </div>
          </div>
        )}
      </Loading>
    </div>
  );
}
