"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Hex } from "viem";
import { addrUrl, txUrl } from "@/lib/chain";
import { ENV } from "@/lib/env";
import { AgentOffline } from "@/lib/api";

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
  const u = addrUrl(a);
  return u ? (
    <a className="link font-mono" href={u} target="_blank" rel="noreferrer" title={a}>
      {label ?? short(a)}
    </a>
  ) : (
    <span className="font-mono" title={`${a} (Anvil fork: not linked to Basescan)`}>
      {label ?? short(a)} <span className="tag text-mute">fork</span>
    </span>
  );
}

const ExtIcon = () => (
  <svg aria-hidden viewBox="0 0 12 12" className="ml-0.5 inline size-2.5 align-baseline" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M4.5 2.5h5v5M9.5 2.5 3 9" />
  </svg>
);

export function Tx({ h }: { h?: Hex | null }) {
  if (!h) return <span className="text-mute">—</span>;
  const u = txUrl(h);
  return u ? (
    <a className="link font-mono" href={u} target="_blank" rel="noreferrer" title={h}>
      {short(h)}
      <ExtIcon />
    </a>
  ) : (
    <span className="font-mono" title={`${h} (fork-only tx, not on Basescan)`}>
      {short(h)} <span className="tag text-mute">fork</span>
    </span>
  );
}

const PILL: Record<string, string> = {
  DECLINED: "text-stamp bg-stamp/5",
  APPROVED: "text-violet bg-violet-tint",
  PLEDGED: "text-amber-ink bg-amber/15",
  AUCTION: "text-amber-ink bg-amber/15",
  ACTIVE: "text-desk bg-desk/5",
  RELEASED: "text-mute",
  CANCELLED: "text-stamp",
  approve: "text-desk bg-desk/5",
  decline: "text-stamp bg-stamp/5",
};
export const Pill = ({ s }: { s: string }) => <span className={`pill ${PILL[s] ?? "text-mute"}`}>{s}</span>;

export function Card({ title, right, children, className = "", id }: { title?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={`card ${className}`}>
      {(title || right) && (
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-rule px-4 py-2.5 sm:px-5">
          <h2 className="text-sm font-bold [font-stretch:105%]">{title}</h2>
          <div className="text-xs text-mute">{right}</div>
        </header>
      )}
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

const msg = (e: unknown) =>
  e instanceof AgentOffline ? "The Gadai agent is offline, so this can't run right now. Try again in a moment." : e instanceof Error ? e.message : String(e);

export const Err = ({ e }: { e: unknown }) =>
  e ? (
    <p role="alert" className="mt-2 rounded-[3px] border border-stamp/40 bg-stamp/5 px-3 py-2 text-sm break-words text-stamp">
      {msg(e)}
    </p>
  ) : null;

/** The agent API is not answering. Shown instead of the data, never as a raw fetch error. */
export function Offline({ retry, what = "this data" }: { retry?: () => unknown; what?: string }) {
  return (
    <div role="status" className="flex flex-wrap items-start justify-between gap-4 rounded-[3px] border border-dashed border-mute/60 bg-ground/50 px-4 py-4">
      <div className="max-w-xl">
        <p className="font-semibold">The Gadai agent is offline</p>
        <p className="mt-1 text-sm text-mute">
          {`It serves ${what}, so there is nothing to show until it is back. Contracts on Base are unaffected: pledged fee rights stay in their vaults and release() still works on-chain.`}
        </p>
      </div>
      {retry && (
        <button className="btn btn-ghost" onClick={() => retry()}>
          Try again
        </button>
      )}
    </div>
  );
}

/** Empty state that says what will appear and how to make it appear. */
export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-[3px] border border-dashed border-rule px-4 py-5">
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-1 max-w-xl text-sm text-mute">{children}</div>}
    </div>
  );
}

/** Button that runs an async action, shows pending state and the error (no silent failures). */
export function Btn({ onClick, children, kind = "primary", disabled, className = "" }: { onClick: () => Promise<unknown> | unknown; children: React.ReactNode; kind?: "primary" | "ghost" | "danger"; disabled?: boolean; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  return (
    <span className={`inline-flex flex-col ${className}`}>
      <button
        className={`btn btn-${kind}`}
        disabled={disabled || busy}
        aria-busy={busy}
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

export function Loading({ l, e, children, retry, what }: { l: boolean; e: unknown; children?: React.ReactNode; retry?: () => unknown; what?: string }) {
  if (e instanceof AgentOffline) return <Offline retry={retry} what={what} />;
  if (e) return <Err e={e} />;
  if (l)
    return (
      <div aria-busy className="space-y-2.5 py-1">
        <span className="sr-only">Loading</span>
        <div className="skeleton h-4 w-2/3" />
        <div className="skeleton h-4 w-full" />
        <div className="skeleton h-4 w-5/6" />
      </div>
    );
  return <>{children}</>;
}

/** One box of the registry summary strip (parent draws the shared rules). */
export function Stat({ k, v, sub }: { k: string; v: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="bg-card px-4 py-3 sm:px-5">
      <div className="label">{k}</div>
      <div className="num mt-1 text-2xl">{v}</div>
      {sub && <div className="mt-0.5 text-xs text-mute">{sub}</div>}
    </div>
  );
}

/** The loan lifecycle, one axis shared by the home page and every loan view. */
export const STAGES = [
  ["Pledge", "The creator moves the token's fee rights to a per-loan FeeVault"],
  ["Auction", "FeeNotes sell in a Uniswap CCA to fund the loan"],
  ["Disburse", "The desk's Dynamic agent wallet sends the USDC"],
  ["Repay", "WETH fees land in the vault and repay the notes"],
  ["Release", "At zero debt anyone calls release(); the rights go back"],
] as const;
const STAGE_AT: Record<string, number> = { APPROVED: 0, PLEDGED: 1, AUCTION: 1, ACTIVE: 3, RELEASED: 5 };

export function Lifecycle({ status, detail = false }: { status?: string; detail?: boolean }) {
  const at = status == null ? -1 : (STAGE_AT[status] ?? -1);
  return (
    <ol className="grid grid-cols-1 border border-rule bg-paper sm:grid-cols-5">
      {STAGES.map(([name, what], i) => {
        const done = at > i, now = at === i;
        return (
          <li
            key={name}
            aria-current={now ? "step" : undefined}
            className={`relative border-rule px-4 py-3 not-last:border-b sm:not-last:border-r sm:not-last:border-b-0 ${now ? "bg-violet-tint" : ""}`}
          >
            <div className="flex items-center gap-2">
              <span className={`num grid size-5 shrink-0 place-items-center rounded-full border text-[11px] ${done ? "border-desk bg-desk text-paper" : now ? "border-violet bg-violet text-paper" : "border-rule text-mute"}`}>{i + 1}</span>
              <span className={`font-bold [font-stretch:108%] ${at >= 0 && !done && !now ? "text-mute" : ""}`}>{name}</span>
              {done && <span className="sr-only">(done)</span>}
            </div>
            {detail && <p className="mt-1.5 text-xs leading-snug text-mute">{what}</p>}
            {now && <span aria-hidden className="absolute inset-x-0 -bottom-px h-0.5 bg-violet" />}
          </li>
        );
      })}
    </ol>
  );
}

/** Bars of daily WETH fees (Bankr token-fees dailyEarnings, from the agent quote). */
export function FeeChart({ days, claimable }: { days: { date: string; weth: number }[]; claimable?: number }) {
  const max = Math.max(1e-9, ...days.map((d) => d.weth), claimable ?? 0);
  const total = days.reduce((s, d) => s + d.weth, 0);
  return (
    <figure>
      <div className="flex h-36 items-end gap-[3px] border-b border-ink">
        {days.map((d) => (
          <div key={d.date} className="group relative flex-1 bg-ink/80 hover:bg-violet" style={{ height: `${Math.max(1, (d.weth / max) * 100)}%`, opacity: d.weth ? 1 : 0.15 }}>
            <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap bg-ink px-1.5 py-0.5 text-[11px] text-paper group-hover:block">
              {d.date}: {d.weth.toFixed(4)} WETH
            </span>
          </div>
        ))}
        {claimable != null && (
          <div className="relative flex-1 bg-amber" style={{ height: `${Math.max(1, (claimable / max) * 100)}%` }} title={`unclaimed: ${claimable} WETH`} />
        )}
      </div>
      <figcaption className="num mt-1.5 flex flex-wrap justify-between gap-x-3 text-[11px] text-mute">
        <span>{days[0]?.date}</span>
        <span>
          Σ30d {total.toFixed(4)} WETH {claimable != null && <>· <i className="inline-block size-2 bg-ink/80" /> claimed · <i className="inline-block size-2 bg-amber" /> unclaimed (claim-first → vault)</>}
        </span>
        <span>{days.at(-1)?.date}</span>
      </figcaption>
    </figure>
  );
}

export const ForkOnly = ({ children }: { children: React.ReactNode }) => (ENV.DEMO_FORK ? <>{children}</> : null);
