"use client";
import Link from "next/link";
import { api } from "@/lib/api";
import { ENV } from "@/lib/env";
import { Addr, Card, Loading, Pill, Stat, ago, useLoad } from "./ui";
import { MirrorTag } from "./memo";
import { ShareOnX, money, signalText, signalUrl, usdcLimit, writtenBy, type SignalCard, type SignalFlashQuote } from "./share";

export function SignalView({ id }: { id: string }) {
  const card = useLoad(() => api<SignalCard>(`/api/signals/${encodeURIComponent(id)}`), [id], 60_000);
  const c = card.data;
  return (
    <div className="space-y-8">
      <Loading l={card.loading} e={card.error} retry={card.reload} what="this signal">
        {c && (
          <>
            <header className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="h1">{c.personaName} on ${c.symbol}</h1>
                <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-mute">
                  <span className={c.llm ? "" : "tag text-amber-ink"}>{writtenBy(c)}</span>
                  {c.lead && <span className="tag text-violet">lead, binding</span>}
                  <span>signal #{c.id} · {ago(c.createdAt)}</span>
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Pill s={c.decision} />
                <ShareOnX text={signalText(c)} url={signalUrl(c.id)} />
              </div>
            </header>

            <Card title="Signal" right={<span>agent · on-chain</span>}>
              <div className="grid grid-cols-2 gap-px border border-rule bg-rule sm:grid-cols-4">
                <Stat k="credit limit" v={usdcLimit(c.principalRaw)} sub="this persona's max principal" />
                <Stat k="score" v={Math.round(c.score)} sub="memo confidence × 100" />
                <Stat k="max note px" v={c.maxNotePrice.toFixed(2)} sub="USDC per FeeNote it would bid" />
                <Stat k="token" v={<Addr a={c.token} label={`$${c.symbol}`} />} sub={<Link className="link" href={`/loans/${c.loanId}`}>loan #{c.loanId}</Link>} />
              </div>
              <p className="mt-4 max-w-[68ch] text-sm leading-relaxed">{c.rationale}</p>
              <MirrorTag s={c} />
            </Card>

            <Card title="Realized outcome">
              <div className="grid grid-cols-2 gap-px border border-rule bg-rule sm:grid-cols-4">
                <Stat k="loan status" v={c.loan?.status ?? "—"} sub="agent" />
                <Stat k="repaid" v={c.loan?.repaidPct == null ? "—" : `${c.loan.repaidPct.toFixed(1)}%`} sub={c.loan?.repaidPct == null ? "not funded yet" : "on-chain, FeeVault senior debt"} />
                <Stat k="follower PnL" v={c.mirrors.pnlUsd == null ? "—" : <span className={c.mirrors.pnlUsd < 0 ? "text-stamp" : "text-desk"}>{money(c.mirrors.pnlUsd)}</span>} sub={c.mirrors.pnlUsd == null ? "no Flash fills yet" : `on ${money(c.mirrors.spentUsdc)} spent, marked at Flash price`} />
                <Stat k="mirrors" v={`${c.mirrors.placed} / ${c.mirrors.total}`} sub={`placed on Flash / queued · ${c.mirrors.filled} filled`} />
              </div>
            </Card>

            {c.decision === "approve" && <FlashQuote id={c.id} symbol={c.symbol} />}

            <p className="text-sm">
              <Link className="link" href="/desk#follow">Follow {c.personaName}</Link> to mirror its next approval. <Link className="link" href="/desk">Leaderboard and signal feed</Link>.
            </p>
          </>
        )}
      </Loading>
    </div>
  );
}


/** The real Flash quote for the order a default follower ($5, TP +50%, SL −20%) would place. Quote only, nothing is signed. */
export function FlashQuote({ id, symbol }: { id: number; symbol: string }) {
  const q = useLoad(() => api<SignalFlashQuote>(`/api/signals/${id}/flash-quote`), [id]);
  const d = q.data;
  return (
    <Card title="Live Flash quote for the mirror" right={<button className="link" onClick={() => q.reload()}>re-quote</button>}>
      <Loading l={q.loading} e={q.error} retry={q.reload} what="the Flash quote">
        {d && (
          <>
            <p className="mb-3 max-w-[68ch] text-sm text-mute">
              What a follower&apos;s mirror would place right now: a Flash <b>market</b> buy of {money(d.sizeUsdc)} of ${symbol} with an attached <b>Bracket</b> (take-profit +{d.tpPct}%, stop-loss −{d.slPct}%). Quoted live by Flash <span className="font-mono">/quote</span>; no order is placed.
            </p>
            <div className="grid grid-cols-2 gap-px border border-rule bg-rule sm:grid-cols-4">
              <Stat k="spot" v={`$${d.spotUsd.toPrecision(4)}`} sub="Flash /search" />
              <Stat k="est. received" v={Number(d.estTokenOut).toLocaleString("en-US", { maximumFractionDigits: 0 })} sub={`≈ ${money(d.estOutUsd)} of $${symbol}`} />
              <Stat k="price impact" v={<span className={d.withinImpactGate ? "" : "text-stamp"}>{d.priceImpactPct.toFixed(2)}%</span>} sub={d.withinImpactGate ? "within the 3% gate" : d.riskFlagged ? "risk-flagged: mirror blocked" : "over 3%: mirror waits"} />
              <Stat k="Flash fee" v={money(d.estFeeUsd)} sub={`integrator fee ${d.integratorFeeBps} bps`} />
              <Stat k="take profit" v={`$${d.tpPriceUsd.toPrecision(4)}`} sub={`+${d.tpPct}% notional trigger`} />
              <Stat k="stop loss" v={`$${d.slPriceUsd.toPrecision(4)}`} sub={`−${d.slPct}% notional trigger`} />
              <Stat k="funder" v={<Addr a={d.funder} />} sub="quote only (Flash needs a funder)" />
              <Stat k="quote" v={<span className="text-sm">{d.quoteId.slice(0, 8)}…</span>} sub={ago(d.quotedAt)} />
            </div>
            <p className="mt-3 text-xs text-mute">Flash settles on Base mainnet only{ENV.DEMO_FORK ? "; this DEMO_FORK build shows the quote but cannot sign the order" : ""}.</p>
          </>
        )}
      </Loading>
    </Card>
  );
}
