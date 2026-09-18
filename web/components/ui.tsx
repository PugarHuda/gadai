"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Hex } from "viem";
import { addrUrl, txUrl } from "@/lib/chain";
import { ENV } from "@/lib/env";

export const short = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");
export const usd = (n: number, d = 2) => `$${n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
export const usdcRaw = (raw?: string | null) => (raw == null ? "—" : usd(Number(BigInt(raw)) / 1e6));
export const pct = (n: number, d = 1) => `${n.toFixed(d)}%`;
export const ago = (iso: string) => {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  return s < 60 ? `${s | 0}s ago` : s < 3600 ? `${(s / 60) | 0}m ago` : s < 86400 ? `${(s / 3600) | 0}h ago` : `${(s / 86400) | 0}d ago`;
};

export function Addr({ a, label }: { a?: string | null; label?: string }) {
  if (!a) return <span className="text-mute">—</span>;
  return (
    <a className="link font-mono" href={addrUrl(a)} target="_blank" rel="noreferrer" title={a}>
      {label ?? short(a)}
    </a>
  );
}

export function Tx({ h }: { h?: Hex | null }) {
  if (!h) return <span className="text-mute">—</span>;
  const u = txUrl(h);
  return u ? (
    <a className="link font-mono" href={u} target="_blank" rel="noreferrer" title={h}>
      {short(h)} ↗
    </a>
  ) : (
    <span className="font-mono" title={`${h} (fork-only tx, not on Basescan)`}>
      {short(h)} <span className="tag">fork</span>
    </span>
  );
}

const PILL: Record<string, string> = {
  DECLINED: "bg-stamp text-paper",
  APPROVED: "bg-ink text-paper",
  PLEDGED: "bg-amber text-ink",
  AUCTION: "bg-amber text-ink",
  ACTIVE: "bg-desk text-paper",
  RELEASED: "border border-ink",
  CANCELLED: "border border-stamp text-stamp",
  approve: "bg-desk text-paper",
  decline: "bg-stamp text-paper",
};
export const Pill = ({ s }: { s: string }) => <span className={`pill ${PILL[s] ?? "border border-ink"}`}>{s}</span>;

export function Card({ title, right, children, className = "" }: { title?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || right) && (
        <header className="flex items-baseline justify-between gap-3 border-b-[1.5px] border-ink px-4 py-2">
          <h2 className="label">{title}</h2>
          <div className="text-xs">{right}</div>
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export const Err = ({ e }: { e: unknown }) =>
  e ? <p className="mt-2 border-l-4 border-stamp bg-stamp/10 px-3 py-2 text-sm text-stamp break-words">{e instanceof Error ? e.message : String(e)}</p> : null;

/** Button that runs an async action, shows pending state and the error (no silent failures). */
export function Btn({ onClick, children, kind = "primary", disabled, className = "" }: { onClick: () => Promise<unknown> | unknown; children: React.ReactNode; kind?: "primary" | "ghost" | "danger"; disabled?: boolean; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  return (
    <span className={`inline-flex flex-col ${className}`}>
      <button
        className={`btn btn-${kind}`}
        disabled={disabled || busy}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            await onClick();
          } catch (e) {
            setErr(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Working…" : children}
      </button>
      <Err e={err} />
    </span>
  );
}

/** Fetch-on-mount with reload; `deps` re-trigger. `every` polls (ms). */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = [], every?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0); // drop responses that a newer run (e.g. persona switch) superseded
  const run = useCallback(() => {
    const n = ++seq.current;
    return fn()
      .then((d) => n === seq.current && (setData(d), setError(null)), (e) => n === seq.current && setError(e))
      .finally(() => n === seq.current && setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    run();
    if (!every) return;
    const t = setInterval(run, every);
    return () => clearInterval(t);
  }, [run, every]);
  return { data, error, loading, reload: run };
}

export function Loading({ l, e, children }: { l: boolean; e: unknown; children?: React.ReactNode }) {
  if (e) return <Err e={e} />;
  if (l) return <p className="text-mute text-sm animate-pulse">Loading…</p>;
  return <>{children}</>;
}

export function Stat({ k, v, sub }: { k: string; v: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="border-[1.5px] border-ink bg-paper px-4 py-3">
      <div className="label">{k}</div>
      <div className="num text-2xl mt-1">{v}</div>
      {sub && <div className="text-xs text-mute mt-1">{sub}</div>}
    </div>
  );
}

/** Bars of daily WETH fees (Bankr token-fees dailyEarnings, from the agent quote). */
export function FeeChart({ days, claimable }: { days: { date: string; weth: number }[]; claimable?: number }) {
  const max = Math.max(1e-9, ...days.map((d) => d.weth), claimable ?? 0);
  const total = days.reduce((s, d) => s + d.weth, 0);
  return (
    <figure>
      <div className="flex h-36 items-end gap-[3px] border-b-[1.5px] border-ink">
        {days.map((d) => (
          <div key={d.date} className="group relative flex-1 bg-ink/85 hover:bg-desk" style={{ height: `${Math.max(1, (d.weth / max) * 100)}%`, opacity: d.weth ? 1 : 0.15 }}>
            <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap bg-ink px-1.5 py-0.5 text-[10px] text-paper group-hover:block">
              {d.date}: {d.weth.toFixed(4)} WETH
            </span>
          </div>
        ))}
        {claimable != null && (
          <div className="relative flex-1 bg-amber" style={{ height: `${Math.max(1, (claimable / max) * 100)}%` }} title={`unclaimed: ${claimable} WETH`} />
        )}
      </div>
      <figcaption className="mt-1 flex justify-between text-[11px] text-mute">
        <span>{days[0]?.date}</span>
        <span>
          Σ30d {total.toFixed(4)} WETH {claimable != null && <>· <span className="text-ink">■</span> claimed · <span className="text-amber">■</span> unclaimed (claim-first → vault)</>}
        </span>
        <span>{days.at(-1)?.date}</span>
      </figcaption>
    </figure>
  );
}

export const ForkOnly = ({ children }: { children: React.ReactNode }) => (ENV.DEMO_FORK ? <>{children}</> : null);
