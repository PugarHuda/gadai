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
type Board = {
  generatedAt: string; ethUsd: number;
  totals: { agents: number; eligible: number; totalCreditUsdc: number; lifetimeFeesWeth: number; claimableWeth: number; llmTokens30d: number; failed: number; nonBase: number };
  rows: Row[];
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
                Built {ago(d.generatedAt)} · ETH {usd(d.ethUsd, 2)} (Uniswap Trading API quote) · {d.totals.nonBase} non-Base profiles skipped
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
    </div>
  );
}
