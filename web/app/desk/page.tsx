"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useWalletDelegation } from "@dynamic-labs/sdk-react-core";
import {
  flashCancelMessage,
  followMessage,
  unfollowMessage,
  type DeskInfo,
  type Follow,
  type FollowMode,
  type FollowRequest,
  type LeaderboardRow,
  type MirrorOrder,
  type MirrorQuote,
  type MirrorSubmit,
  type Signal,
} from "@feedesk/shared";
import { api } from "@/lib/api";
import { ENV } from "@/lib/env";
import { useSigner } from "@/lib/wallet";
import { Addr, Btn, Card, Empty, Loading, Pill, ago, pct, usd, usdcRaw, useLoad } from "@/components/ui";
import { MirrorTag } from "@/components/memo";

export default function Desk() {
  const s = useSigner();
  const desk = useLoad(() => api<DeskInfo>("/api/desk"));
  const lb = useLoad(() => api<LeaderboardRow[]>("/api/leaderboard"), [], 60_000);
  const [persona, setPersona] = useState<string | null>(null);
  const sig = useLoad(() => api<Signal[]>(`/api/signals?limit=60${persona ? `&personaId=${persona}` : ""}`), [persona], 30_000);
  const follows = useLoad(async () => (s.address ? api<Follow[]>(`/api/follows?follower=${s.address}`) : []), [s.address]);
  const mirrors = useLoad(async () => (s.address ? api<MirrorOrder[]>(`/api/mirrors?follower=${s.address}`) : []), [s.address], 20_000);
  const name = (id: string) => lb.data?.find((r) => r.personaId === id)?.name ?? desk.data?.personas.find((p) => p.id === id)?.name ?? id;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="h1">Follow the Desk</h1>
        <p className="mt-4 max-w-[68ch] text-ink/85">
          Every credit decision is a public, scored signal. Underwriter agents are ranked by what actually happened on-chain: how much of the debt they approved got repaid, and how their
          followers&apos; mirrored trades did. Follow one and mirror its approvals as a Flash market buy with an attached <b>bracket</b> (take-profit / stop-loss), or as a <b>DCA</b> built from
          a long Flash TWAP. @DefinitiveFi
        </p>
        {ENV.DEMO_FORK && <p className="mt-3 max-w-[68ch] rounded-[3px] border border-dashed border-amber-ink/50 px-3 py-2 text-sm text-amber-ink">Flash: mainnet only. This is a DEMO_FORK build, so one-click mirror signing is disabled here (approvals would land on the fork while Flash settles on mainnet). Follows and signals still work.</p>}
      </header>

      <Card title="Leaderboard" right={<span>score = 60·repaid + 40·follower PnL</span>}>
        <Loading l={lb.loading} e={lb.error} retry={lb.reload} what="the underwriter leaderboard">
          {lb.data?.length === 0 ? (
            <Empty title="No underwriters ranked yet">Underwriters appear here after they write their first credit memo.</Empty>
          ) : (
          <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
          <table className="tbl">
            <thead>
              <tr><th>#</th><th>underwriter</th><th className="text-right">score</th><th className="text-right">approve / decline</th><th className="text-right">funded</th><th className="text-right">repaid</th><th className="text-right">days to repay</th><th className="text-right">follower PnL</th><th className="text-right">followers</th><th /></tr>
            </thead>
            <tbody>
              {lb.data?.map((r, i) => (
                <tr key={r.personaId} className={persona === r.personaId ? "bg-violet-tint" : ""}>
                  <td className="num">{i + 1}</td>
                  <td>
                    <button className="text-left" aria-pressed={persona === r.personaId} title="Filter signals by this underwriter" onClick={() => setPersona(persona === r.personaId ? null : r.personaId)}>
                      <div className="font-display text-lg leading-tight">{r.name}</div>
                      <div className="label mt-0.5">{r.model}</div>
                    </button>
                  </td>
                  <td className="num text-right text-lg">{r.score == null ? <span className="text-xs text-mute">no realized data yet</span> : r.score}</td>
                  <td className="num text-right">{r.approvals} / {r.declines}</td>
                  <td className="num text-right">{r.fundedLoans}</td>
                  <td className="num text-right">{pct(r.repaidPct)}</td>
                  <td className="num text-right">{r.avgDaysToRepay == null ? "—" : r.avgDaysToRepay.toFixed(1)}</td>
                  <td className={`num text-right ${r.followerPnlUsd < 0 ? "text-stamp" : "text-desk"}`}>{usd(r.followerPnlUsd)}</td>
                  <td className="num text-right">{r.followers}</td>
                  <td className="text-right"><a href="#follow" className="link text-xs" onClick={() => setPersona(r.personaId)}>follow</a></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          )}
        </Loading>
      </Card>

      <div className="grid gap-6 md:grid-cols-[1fr_1.1fr]">
        <FollowForm personas={(lb.data ?? []).map((r) => ({ id: r.personaId, name: r.name }))} initial={persona} onDone={() => (follows.reload(), lb.reload())} />
        <Card title={persona ? `Signals · ${name(persona)}` : "Signal feed"} right={persona && <button className="link" onClick={() => setPersona(null)}>all</button>}>
          <Loading l={sig.loading} e={sig.error} retry={sig.reload} what="underwriter signals">
            <ul className="max-h-[560px] space-y-3 overflow-y-auto pr-2">
              {sig.data?.map((g) => (
                <li key={g.id} className="border-b border-rule pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm"><b>{name(g.personaId)}</b> on <Addr a={g.token} label={`$${g.symbol}`} /> · <Link className="link" href={`/loans/${g.loanId}`}>loan #{g.loanId}</Link></span>
                    <span className="flex items-center gap-2"><Pill s={g.decision} /><span className="num w-8 text-right text-lg">{Math.round(g.score)}</span></span>
                  </div>
                  <p className="mt-1 text-xs">{g.rationale}</p>
                  <p className="mt-1 text-[11px] text-mute num">principal {usdcRaw(g.principalRaw)} · note px {g.maxNotePrice.toFixed(2)} · {ago(g.createdAt)}</p>
                  <MirrorTag s={g} />
                </li>
              ))}
              {sig.data?.length === 0 && <li><Empty title="No signals yet">Each credit memo becomes a public signal here: approve or decline, a score, and the rationale.</Empty></li>}
            </ul>
          </Loading>
        </Card>
      </div>

      {s.connected && (
        <div className="grid gap-6 md:grid-cols-[1fr_1.4fr]">
          <Card title="You follow">
            <Loading l={follows.loading} e={follows.error} retry={follows.reload} what="your follows">
              {follows.data?.length === 0 && <Empty title="You follow no underwriters">Pick one in the form above; its future approvals become mirror orders.</Empty>}
              <ul className="space-y-2">
                {follows.data?.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-2 border-b border-rule pb-2 text-sm">
                    <span>
                      <b>{name(f.personaId)}</b> · {usd(f.sizeUsdc)} / signal ·{" "}
                      {f.mode === "bracket" ? `bracket TP +${f.tpPct}% / SL −${f.slPct}%` : `DCA ${f.dcaDays}d`} {f.auto && <span className="tag">auto · delegated</span>}
                    </span>
                    <Btn
                      kind="ghost"
                      onClick={async () => {
                        const nonce = crypto.randomUUID();
                        const signature = await s.signMessage(unfollowMessage(f.id, nonce));
                        await api(`/api/follows/${f.id}`, { method: "DELETE", body: { nonce, signature } });
                        follows.reload();
                        mirrors.reload();
                      }}
                    >
                      unfollow
                    </Btn>
                  </li>
                ))}
              </ul>
            </Loading>
          </Card>
          <Card title="Your mirror orders" right={<button className="link" onClick={() => mirrors.reload()}>refresh</button>}>
            <Loading l={mirrors.loading} e={mirrors.error} retry={mirrors.reload} what="your mirror orders">
              {mirrors.data?.length === 0 && <Empty title="No mirror orders yet">When an underwriter you follow approves a loan, a mirror order appears here.</Empty>}
              <ul className="space-y-3">
                {mirrors.data?.map((m) => (
                  <MirrorRow key={m.id} m={m} auto={follows.data?.find((f) => f.id === m.followId)?.auto ?? false} onChange={mirrors.reload} />
                ))}
              </ul>
            </Loading>
          </Card>
        </div>
      )}
    </div>
  );
}

function FollowForm({ personas, initial, onDone }: { personas: { id: string; name: string }[]; initial: string | null; onDone: () => void }) {
  const s = useSigner();
  const dlg = useWalletDelegation();
  const dlgRef = useRef(dlg); // initDelegationProcess resolves after a re-render; read the fresh status, not this render's closure
  useEffect(() => {
    dlgRef.current = dlg;
  });
  const [pid, setPid] = useState<string>("");
  const [mode, setMode] = useState<FollowMode>("bracket");
  const [size, setSize] = useState("5");
  const [tp, setTp] = useState("50");
  const [sl, setSl] = useState("20");
  const [days, setDays] = useState("7");
  const [auto, setAuto] = useState(false);
  const personaId = pid || initial || personas[0]?.id || "";

  const follow = async () => {
    if (!s.address) return s.login();
    if (auto) {
      // Auto-mirror = agent signs for you via Dynamic delegated access (embedded MPC wallets only).
      if (dlg.delegatedAccessEnabled === false) throw new Error("Delegated access is not enabled in this Dynamic environment; use one-click mode.");
      const me = s.address.toLowerCase();
      const status = () => dlgRef.current.getWalletsDelegatedStatus().find((w) => w.address.toLowerCase() === me)?.status;
      if (status() !== "delegated") {
        await dlg.initDelegationProcess();
        for (let i = 0; i < 10 && status() !== "delegated"; i++) await new Promise((r) => setTimeout(r, 500));
        if (status() !== "delegated") throw new Error(`Delegation not granted (status: ${status() ?? "no embedded wallet"}). Not following in auto mode; untick auto-mirror to use one-click.`);
      }
    }
    const f: FollowRequest = {
      follower: s.address,
      personaId,
      mode,
      sizeUsdc: Number(size),
      tpPct: mode === "bracket" ? Number(tp) : 0,
      slPct: mode === "bracket" ? Number(sl) : 0,
      dcaDays: mode === "dca" ? Number(days) : 0,
      auto,
    };
    if (!(f.sizeUsdc > 0)) throw new Error("Size must be > 0 USDC");
    const nonce = crypto.randomUUID();
    const signature = await s.signMessage(followMessage(f, nonce));
    await api<Follow>("/api/follows", { body: { ...f, nonce, signature } });
    onDone();
  };

  return (
    <Card title="Follow an underwriter" id="follow" className="scroll-mt-20">
      <div className="space-y-3 text-sm">
        <label className="block"><span className="label">underwriter</span>
          <select className="input mt-1" value={personaId} onChange={(e) => setPid(e.target.value)}>
            {personas.length === 0 && <option value="">Underwriters load from the agent</option>}
            {personas.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          {(["bracket", "dca"] as const).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={`rounded-[3px] border px-3 py-2 text-left transition-colors ${mode === m ? "border-violet bg-violet-tint ring-1 ring-violet" : "border-rule bg-paper hover:border-mute"}`}>
              <div className="text-sm font-bold">{m === "bracket" ? "Bracket" : "DCA"}</div>
              <div className="text-xs text-mute">{m === "bracket" ? "Flash market buy + attached TP/SL" : "Flash TWAP, 1 slice/day"}</div>
            </button>
          ))}
        </div>
        <label className="block"><span className="label">USDC per approved signal</span><input className="input mt-1" value={size} onChange={(e) => setSize(e.target.value)} /></label>
        {mode === "bracket" ? (
          <div className="grid grid-cols-2 gap-2">
            <label><span className="label">take profit +%</span><input className="input mt-1" value={tp} onChange={(e) => setTp(e.target.value)} /></label>
            <label><span className="label">stop loss −%</span><input className="input mt-1" value={sl} onChange={(e) => setSl(e.target.value)} /></label>
          </div>
        ) : (
          <label className="block"><span className="label">DCA days</span><input className="input mt-1" value={days} onChange={(e) => setDays(e.target.value)} /></label>
        )}
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-1 size-4 accent-violet" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          <span><b>Auto-mirror</b> via Dynamic delegated access: the desk signs your mirror orders for you (embedded wallets only). Off = one-click sign each order.</span>
        </label>
        <Btn onClick={follow} disabled={s.connected && !personaId}>{s.connected ? "Sign & follow" : "Log in to follow"}</Btn>
        <p className="text-[11px] text-mute">You sign an EIP-191 follow message; orders are only ever placed from your own wallet as the Flash funder.</p>
      </div>
    </Card>
  );
}

const MSTATUS: Record<string, string> = { pending_signature: "text-amber-ink bg-amber/15", submitted: "text-violet bg-violet-tint", filled: "text-desk bg-desk/5", partially_filled: "text-desk", cancelled: "text-mute", failed: "text-stamp bg-stamp/5" };

function MirrorRow({ m, auto, onChange }: { m: MirrorOrder; auto: boolean; onChange: () => void }) {
  const s = useSigner();
  const [q, setQ] = useState<MirrorQuote | null>(null);

  const signSubmit = async () => {
    const quote = q ?? (await api<MirrorQuote>(`/api/mirrors/${m.id}/quote`, { method: "POST" }));
    setQ(quote);
    for (const tx of [...quote.approveTxs, ...(quote.bracket?.approveTxs ?? [])]) await s.sendTx(tx);
    const body: MirrorSubmit = { quoteId: quote.quoteId, userSignature: await s.signTypedJson(quote.orderTypedData) };
    if (quote.permitTypedData) body.evmPermitSignature = await s.signTypedJson(quote.permitTypedData);
    if (quote.bracket) {
      body.bracketUserSignature = await s.signTypedJson(quote.bracket.orderTypedData);
      if (quote.bracket.permitTypedData) body.bracketPermitSignature = await s.signTypedJson(quote.bracket.permitTypedData);
    }
    try {
      await api<MirrorOrder>(`/api/mirrors/${m.id}/submit`, { body });
    } finally {
      setQ(null); // a rejected quote must be re-quoted
      onChange();
    }
  };

  const cancel = async (leg: "entry" | "bracket", orderId: string) => {
    const userSignature = await s.signMessage(flashCancelMessage(orderId));
    await api(`/api/mirrors/${m.id}/cancel`, { body: { userSignature, leg } });
    onChange();
  };

  return (
    <li className="box rounded-[3px] p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          <b>${m.symbol}</b> · {m.mode === "bracket" ? "market + bracket" : "DCA (Flash TWAP)"} · {usd(m.sizeUsdc)}
        </span>
        <span className={`pill ${MSTATUS[m.status] ?? "text-mute"}`}>{m.status.replace("_", " ")}</span>
      </div>
      <div className="mt-1 text-xs text-mute num">
        {m.flashOrderId && <>order {m.flashOrderId.slice(0, 10)}… · </>}
        {m.bracketStatus && <>bracket {m.bracketStatus} · </>}
        {m.avgPriceUsd != null && <>avg {m.avgPriceUsd.toPrecision(4)} · </>}
        {m.pnlUsd != null && <span className={m.pnlUsd < 0 ? "text-stamp" : "text-desk"}>PnL {usd(m.pnlUsd)} · </span>}
        {ago(m.createdAt)}
      </div>
      {m.error && <p className="mt-1 text-xs text-stamp">{m.error}</p>}
      {q && (
        <p className="mt-1 text-xs num">
          spend {usd(q.preview.spendUsdc)} · est out {q.preview.estTokenOut} · impact {q.preview.priceImpact.toFixed(2)}%
          {q.preview.tpPriceUsd != null && <> · TP {q.preview.tpPriceUsd.toPrecision(3)} / SL {q.preview.slPriceUsd?.toPrecision(3)}</>}
        </p>
      )}
      <div className="mt-2 flex gap-2">
        {m.status === "pending_signature" &&
          (auto ? (
            <span className="text-xs text-mute">auto: the desk signs this via your Dynamic delegation</span>
          ) : ENV.DEMO_FORK ? (
            <span className="text-xs text-stamp">Flash: mainnet only (disabled on DEMO_FORK)</span>
          ) : (
            <Btn onClick={signSubmit}>Sign & submit to Flash</Btn>
          ))}
        {m.flashOrderId && (m.status === "submitted" || m.status === "partially_filled") && (
          <Btn kind="ghost" onClick={() => cancel("entry", m.flashOrderId!)}>
            cancel
          </Btn>
        )}
        {m.bracketOrderId && !m.bracketStatus?.startsWith("exited") && (
          <Btn kind="ghost" onClick={() => cancel("bracket", m.bracketOrderId!)}>
            cancel TP/SL
          </Btn>
        )}
      </div>
    </li>
  );
}
