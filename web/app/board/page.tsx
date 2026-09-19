"use client";
import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Addr, Card, Empty, Loading, Stat, ago, pct, usd, useLoad } from "@/components/ui";

// Mirrors agent/src/board BoardRow / Board (GET /api/board).
type Row = {
  slug: string; name: string; token: string; symbol: string; beneficiary: string | null; sharePct: number | null;
  lifetimeWeth: number | null; claimableWeth: number | null; weeklyWeth: number;
  llmTokens30d: number | null; llmRequests30d: number | null;
  maxLoanUsdc: number; feeRatePct: number | null; floorPrice: number | null;
  eligible: boolean; reason: string | null; error: string | null;
};
type QuotePx = { symbol: string; address: string; stock: boolean; wethPerUnit: number; usd: number; source: string };
type RhRow = Row & {
  chain: "robinhood"; quote: QuotePx | null;
  lifetimeQuote: number | null; claimableQuote: number | null; ratePerDayQuote: number | null; usdPerDay: number | null; indicativeUsdc: number;
};
type Board = {
  generatedAt: string; ethUsd: number;
  totals: {
    agents: number; eligible: number; totalCreditUsdc: number; lifetimeFeesWeth: number; claimableWeth: number; llmTokens30d: number; failed: number; nonBase: number;
    robinhoodAgents: number; indicativeCreditUsdc: number; equityAgents: number; equityFeesUsd: number; indicativeEquityCreditUsdc: number;
  };
  rows: Row[];
  robinhood: RhRow[];
};

const weth = (n: number | null, d = 4) => (n == null ? "—" : n.toFixed(d));
const compact = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 }));

/** Compute burn (Bankr LLM Gateway tokens, 30d) against fee income (weekly WETH). Words, not a made-up cost estimate. */
function signal(r: Row): { label: string; cls: string; hint: string } {
  const burn = (r.llmTokens30d ?? 0) > 0, earn = r.weeklyWeth > 0;
  if (r.llmTokens30d == null) return { label: "no usage data", cls: "text-mute", hint: "llm-usage request failed" };
  if (burn && earn) return { label: "fee-funded compute", cls: "text-desk bg-desk/5", hint: "spends on inference and earns fees" };
  if (burn) return { label: "burning, no fees", cls: "text-amber-ink bg-amber/15", hint: "inference spend with no fee income this week" };
  if (earn) return { label: "fees, no compute", cls: "text-mute", hint: "earns fees, no LLM Gateway usage in 30d" };
  return { label: "idle", cls: "text-mute", hint: "no fees this week, no LLM usage in 30d" };
}

const COLS = [
  ["name", "Agent"],
  ["maxLoanUsdc", "Credit line"],
  ["feeRatePct", "Fee"],
  ["lifetimeWeth", "Lifetime WETH"],
  ["claimableWeth", "Claimable"],
  ["weeklyWeth", "Weekly WETH"],
  ["llmTokens30d", "LLM tokens 30d"],
] as const;
type Key = (typeof COLS)[number][0];

const applyHref = (r: Row) => `/apply?token=${r.token}${r.beneficiary ? `&borrower=${r.beneficiary}` : ""}`;

function Status({ r }: { r: Row }) {
  if (r.eligible) return <span className="pill text-desk bg-desk/5">pre-approved</span>;
  return (
    <div className="max-w-64">
      <span className={`pill ${r.error ? "text-stamp bg-stamp/5" : "text-mute"}`}>{r.error ? "fetch failed" : "not eligible"}</span>
      <p className="mt-1 text-xs leading-snug text-mute" title={r.error ?? undefined}>{(r.reason ?? "").replace(/^not eligible: /, "")}</p>
    </div>
  );
}

export default function BoardPage() {
  const b = useLoad(() => api<Board>("/api/board"));
  const [sort, setSort] = useState<{ k: Key; desc: boolean }>({ k: "maxLoanUsdc", desc: true });
  const [onlyEligible, setOnlyEligible] = useState(false);
  const d = b.data;

  const rows = (d?.rows ?? [])
    .filter((r) => !onlyEligible || r.eligible)
    .sort((x, y) => {
      const a = x[sort.k], c = y[sort.k];
      const v = typeof a === "string" ? a.localeCompare(c as string) : (a ?? -1) - ((c as number | null) ?? -1);
      return sort.desc ? -v : v;
    });
  const by = (k: Key) => setSort((s) => ({ k, desc: s.k === k ? !s.desc : k !== "name" }));

  return (
    <div className="space-y-12">
      <header>
        <h1 className="h1 max-w-[22ch]">
          {d ? <>Gadai could extend {usd(d.totals.totalCreditUsdc, 0)} of credit today across {d.totals.eligible} Bankr agent{d.totals.eligible === 1 ? "" : "s"}.</> : "Credit lines for every Bankr agent on Base."}
        </h1>
        <p className="mt-5 max-w-[66ch] text-base leading-relaxed text-ink/85">
          Every agent profile on Bankr with a Base token, run through the same deterministic engine that prices a real application: fee history from the Bankr fee API, the lead
          underwriter&apos;s advance rate, a live Uniswap ETH quote and the desk cap. A pre-approval is not a loan: applying re-checks the pool on-chain and adds the LLM memos.
          Agents on Robinhood Chain, several of them paid in tokenized stocks, get <a className="link" href="#equities">indicative lines below</a>.
        </p>
      </header>

      <section aria-labelledby="totals" className="space-y-4">
        <h2 id="totals" className="sr-only">Totals</h2>
        <Loading l={b.loading} e={b.error} retry={b.reload} what="the credit line board (live Bankr agent data)">
          {d && (
            <>
              <div className="card grid grid-cols-2 gap-px overflow-hidden bg-rule md:grid-cols-4">
                <Stat k="Credit available" v={usd(d.totals.totalCreditUsdc, 0)} sub={`${d.totals.eligible} of ${d.totals.agents} agents pre-approved`} />
                <Stat k="Lifetime fees" v={`${d.totals.lifetimeFeesWeth.toFixed(2)}`} sub="WETH, beneficiary share (Bankr fee API)" />
                <Stat k="Claimable now" v={`${d.totals.claimableWeth.toFixed(3)}`} sub="WETH waiting to be claimed" />
                <Stat k="LLM tokens, 30d" v={compact(d.totals.llmTokens30d)} sub="Bankr LLM Gateway usage" />
              </div>
              <p className="text-xs text-mute">
                Built {ago(d.generatedAt)} · ETH {usd(d.ethUsd, 2)} (Uniswap Trading API quote) · {d.totals.nonBase} non-Base profiles:{" "}
                <a className="link" href="#equities">{d.totals.robinhoodAgents} on Robinhood Chain, priced below</a>
                {d.totals.failed > 0 && <> · <span className="text-stamp">{d.totals.failed} rows failed to fetch (shown below, not dropped)</span></>}
                {" "}· cached 10 min
              </p>
            </>
          )}
        </Loading>
      </section>

      {d && (
        <section aria-labelledby="lines" className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 id="lines" className="text-lg font-bold [font-stretch:108%]">Credit lines</h2>
            <div className="flex items-center gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" className="accent-violet" checked={onlyEligible} onChange={(e) => setOnlyEligible(e.target.checked)} />
                Pre-approved only
              </label>
              <button className="link" onClick={() => b.reload()}>Refresh</button>
            </div>
          </div>
          <Card title={`${rows.length} agents`} right="Bankr agent-profiles · token fees · llm-usage">
            {rows.length === 0 ? (
              <Empty title={onlyEligible ? "No agent is pre-approved right now" : "No Bankr agents with a Base token"}>
                Credit lines appear when an agent&apos;s Doppler fee stream supports at least $1 under the engine. Untick the filter to see why each agent is not eligible.
              </Empty>
            ) : (
              <>
                <label className="mb-3 flex items-center gap-2 text-sm md:hidden">
                  <span className="label">Sort</span>
                  <select className="input !h-9 !w-auto" value={sort.k} onChange={(e) => setSort({ k: e.target.value as Key, desc: e.target.value !== "name" })}>
                    {COLS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </label>
                <ul className="divide-y divide-rule md:hidden">
                  {rows.map((r) => {
                    const s = signal(r);
                    return (
                      <li key={r.slug} className="space-y-1.5 py-3 first:pt-0 last:pb-0">
                        <div className="flex items-start justify-between gap-3">
                          <span className="font-semibold">{r.name} <span className="num text-sm font-normal text-mute">${r.symbol}</span></span>
                          <span className="num text-lg">{r.eligible ? usd(r.maxLoanUsdc) : "—"}</span>
                        </div>
                        <Status r={r} />
                        <div className="num flex flex-wrap gap-x-4 text-xs text-mute">
                          <span>life {weth(r.lifetimeWeth)} WETH</span>
                          <span>wk {weth(r.weeklyWeth)}</span>
                          <span>LLM {compact(r.llmTokens30d)}</span>
                          {r.feeRatePct != null && <span>fee {pct(r.feeRatePct, 2)}</span>}
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className={`pill ${s.cls}`} title={s.hint}>{s.label}</span>
                          {r.eligible && <Link className="link text-sm font-semibold" href={applyHref(r)}>Apply</Link>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <div className="hidden overflow-x-auto md:block">
                  <table className="tbl">
                    <thead>
                      <tr>
                        {COLS.map(([k, l]) => (
                          <th key={k} className={k === "name" ? "" : "text-right"} aria-sort={sort.k === k ? (sort.desc ? "descending" : "ascending") : undefined}>
                            <button className={`uppercase ${sort.k === k ? "text-ink" : "hover:text-ink"}`} onClick={() => by(k)}>
                              {l}{sort.k === k ? (sort.desc ? " ↓" : " ↑") : ""}
                            </button>
                          </th>
                        ))}
                        <th>Status</th>
                        <th>Compute vs fees</th>
                        <th><span className="sr-only">Action</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const s = signal(r);
                        return (
                          <tr key={r.slug} className="transition-colors hover:bg-violet-tint/50">
                            <td className="min-w-44">
                              <div className="font-semibold">{r.name}</div>
                              <div className="text-xs"><Addr a={r.token} label={`$${r.symbol}`} />{r.sharePct != null && <span className="text-mute"> · share {r.sharePct}%</span>}</div>
                            </td>
                            <td className="num text-right whitespace-nowrap">{r.eligible ? usd(r.maxLoanUsdc) : <span className="text-mute">—</span>}</td>
                            <td className="num text-right">{r.feeRatePct == null ? <span className="text-mute">—</span> : pct(r.feeRatePct, 2)}</td>
                            <td className="num text-right">{weth(r.lifetimeWeth)}</td>
                            <td className="num text-right">{weth(r.claimableWeth)}</td>
                            <td className="num text-right">{weth(r.weeklyWeth)}</td>
                            <td className="num text-right whitespace-nowrap" title={r.llmRequests30d == null ? undefined : `${r.llmRequests30d.toLocaleString()} requests`}>{compact(r.llmTokens30d)}</td>
                            <td><Status r={r} /></td>
                            <td><span className={`pill whitespace-nowrap ${s.cls}`} title={s.hint}>{s.label}</span></td>
                            <td>{r.eligible && <Link className="link font-semibold" href={applyHref(r)}>Apply</Link>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Card>
        </section>
      )}

      {d && <Equities d={d} />}
    </div>
  );
}

const RH_EXPLORER = "https://robinhoodchain.blockscout.com";
const units = (n: number | null, sym: string, d = 4) => (n == null ? "—" : `${n.toLocaleString("en-US", { maximumFractionDigits: d })} ${sym}`);

function RhStatus({ r }: { r: RhRow }) {
  if (r.error)
    return (
      <div className="max-w-64">
        <span className="pill text-stamp bg-stamp/5">fetch failed</span>
        <p className="mt-1 text-xs leading-snug text-mute" title={r.error}>{r.reason}</p>
      </div>
    );
  if (r.indicativeUsdc > 0) return <span className="pill whitespace-nowrap text-amber-ink bg-amber/15" title={r.reason ?? undefined}>indicative, not lendable yet</span>;
  return (
    <div className="max-w-64">
      <span className="pill text-mute">no line</span>
      <p className="mt-1 text-xs leading-snug text-mute">{(r.reason ?? "").replace(/^not eligible: /, "")}</p>
    </div>
  );
}

const Ticker = ({ q }: { q: QuotePx | null }) =>
  q == null ? <span className="text-mute">—</span> : (
    <a className="link font-mono font-semibold" href={`${RH_EXPLORER}/token/${q.address}`} target="_blank" rel="noreferrer" title={q.source}>{q.symbol}</a>
  );

/** Robinhood Chain agents, most with creator fees paid in tokenized stocks. Same engine; priced, not lendable. */
function Equities({ d }: { d: Board }) {
  const [onlyStocks, setOnlyStocks] = useState(true);
  const rows = (d.robinhood ?? []).filter((r) => !onlyStocks || r.quote?.stock);
  const tickers = [...new Map((d.robinhood ?? []).filter((r) => r.quote?.stock).map((r) => [r.quote!.symbol, r.quote!])).values()];
  const t = d.totals;
  return (
    <section id="equities" aria-labelledby="eq-h" className="scroll-mt-24 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="eq-h" className="text-lg font-bold [font-stretch:108%]">Onchain equities · Robinhood Chain</h2>
          <p className="mt-2 max-w-[70ch] text-sm leading-relaxed text-ink/85">
            These agents launched on Robinhood Chain. Several earn their creator fees in tokenized stocks: the pool is quoted in SPY, TSLA or MSTR, so every fee claim
            pays out in shares. Gadai runs the same engine on that stream, counted in shares and priced in USD: each stock is quoted into WETH with the Uniswap Trading API
            on Robinhood Chain (4663), then valued at ETH/USD.{" "}
            <strong className="font-semibold text-ink">These lines are indicative.</strong> The pools use the same Doppler FeesManager interface as on Base (
            <span className="font-mono">getShares</span>, <span className="font-mono">updateBeneficiary</span>, <span className="font-mono">collectFees</span>, checked on-chain),
            but Gadai&apos;s desk contracts are deployed only on Base and its vault only liquidates WETH. The desk prices these lines but cannot lend against them yet.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-violet" checked={onlyStocks} onChange={(e) => setOnlyStocks(e.target.checked)} />
          Stock-quoted fees only
        </label>
      </div>
      <div className="card grid grid-cols-2 gap-px overflow-hidden bg-rule md:grid-cols-4">
        <Stat k="Equity-fee agents" v={t.equityAgents} sub={tickers.length ? `fees in ${tickers.map((q) => q.symbol).join(", ")}` : "none right now"} />
        <Stat k="Equity fees, lifetime" v={usd(t.equityFeesUsd, 0)} sub="beneficiary share, shares × live price" />
        <Stat k="Indicative equity credit" v={usd(t.indicativeEquityCreditUsdc, 0)} sub="engine max principal, not lendable" />
        <Stat k="All Robinhood lines" v={usd(t.indicativeCreditUsdc, 0)} sub={`${t.robinhoodAgents} agents, incl. WETH-quoted`} />
      </div>
      {tickers.length > 0 && (
        <p className="num text-xs text-mute">
          {tickers.map((q) => `${q.symbol} ${usd(q.usd, 2)} (${q.wethPerUnit.toFixed(5)} WETH)`).join(" · ")} · Uniswap Trading API, 0.1 share → WETH on chain 4663, × ETH/USD
        </p>
      )}
      <Card title={`${rows.length} agents`} right="Bankr fee API (in shares) · Uniswap on Robinhood Chain">
        {rows.length === 0 ? (
          <Empty title="No Robinhood Chain agent earns fees in a stock right now">Untick the filter to see the WETH-quoted Robinhood Chain agents.</Empty>
        ) : (
          <>
            <ul className="divide-y divide-rule md:hidden">
              {rows.map((r) => {
                const sym = r.quote?.symbol ?? "";
                return (
                  <li key={r.slug} className="space-y-1.5 py-3 first:pt-0 last:pb-0">
                    <div className="flex items-start justify-between gap-3">
                      <span className="font-semibold">{r.name} <span className="num text-sm font-normal text-mute">${r.symbol}</span></span>
                      <span className="num text-lg">{r.indicativeUsdc > 0 ? usd(r.indicativeUsdc) : "—"}</span>
                    </div>
                    <div className="text-xs text-mute">Robinhood Chain · fees in <Ticker q={r.quote} /></div>
                    <RhStatus r={r} />
                    <div className="num flex flex-wrap gap-x-4 text-xs text-mute">
                      <span>life {units(r.lifetimeQuote, sym)}</span>
                      <span>{units(r.ratePerDayQuote, sym, 6)}/day{r.usdPerDay != null && ` (${usd(r.usdPerDay)})`}</span>
                      <span>claimable {units(r.claimableQuote, sym)}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="hidden overflow-x-auto md:block">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Fees in</th>
                    <th className="text-right">Lifetime fees</th>
                    <th className="text-right">Engine rate</th>
                    <th className="text-right">Claimable</th>
                    <th className="text-right">Indicative line</th>
                    <th className="text-right">Fee</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const sym = r.quote?.symbol ?? "";
                    const px = r.quote?.usd;
                    return (
                      <tr key={r.slug} className="transition-colors hover:bg-violet-tint/50">
                        <td className="min-w-44">
                          <div className="font-semibold">{r.name}</div>
                          <div className="text-xs">
                            <a className="link font-mono" href={`${RH_EXPLORER}/token/${r.token}`} target="_blank" rel="noreferrer" title={r.token}>${r.symbol}</a>
                            <span className="text-mute"> · Robinhood Chain{r.sharePct != null && ` · share ${r.sharePct}%`}</span>
                          </div>
                        </td>
                        <td className="whitespace-nowrap">
                          <Ticker q={r.quote} />
                          {px != null && <div className="num text-xs text-mute">{usd(px, 2)}</div>}
                        </td>
                        <td className="num text-right whitespace-nowrap">
                          {units(r.lifetimeQuote, sym)}
                          {r.lifetimeQuote != null && px != null && <div className="text-xs text-mute">{usd(r.lifetimeQuote * px, 0)}</div>}
                        </td>
                        <td className="num text-right whitespace-nowrap">
                          {units(r.ratePerDayQuote, sym, 6)}/d
                          {r.usdPerDay != null && <div className="text-xs text-mute">{usd(r.usdPerDay)}/day</div>}
                        </td>
                        <td className="num text-right whitespace-nowrap">{units(r.claimableQuote, sym)}</td>
                        <td className="num text-right whitespace-nowrap">{r.indicativeUsdc > 0 ? usd(r.indicativeUsdc) : <span className="text-mute">—</span>}</td>
                        <td className="num text-right">{r.feeRatePct == null ? <span className="text-mute">—</span> : pct(r.feeRatePct, 2)}</td>
                        <td><RhStatus r={r} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </section>
  );
}
