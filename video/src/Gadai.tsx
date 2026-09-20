import React from "react";
import { AbsoluteFill, Audio, Easing, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { loadFont as loadArchivo } from "@remotion/google-fonts/Archivo";
import { loadFont as loadMono } from "@remotion/google-fonts/ChivoMono";
import { DeckSlide } from "./deck/Deck";
import voice from "../public/voice/words.json";
import data from "../public/data.json";
import rawMarks from "../public/marks.json";

const { fontFamily: SANS } = loadArchivo("normal", { weights: ["400", "600", "700", "800"], subsets: ["latin"] });
const { fontFamily: MONO } = loadMono("normal", { weights: ["400", "500"], subsets: ["latin"] });

// web/DESIGN.md tokens
const C = { desk: "#e5e8e3", sheet: "#fcfcfa", ink: "#16181d", mute: "#545a64", rule: "#c4c9cf", violet: "#5a2bb3", violetTint: "#efe9fa", green: "#16683b", amber: "#e3a32b" };
const FPS = 30, LEAD = 12, TAIL = 20, XF = 18;
const ease = Easing.bezier(0.22, 1, 0.36, 1);

type Word = { w: string; s: number; e: number };
const V: Record<string, { dur: number; words: Word[] }> = Object.fromEntries((voice as any[]).map((v) => [v.id, v]));
const sceneLen = (id: string) => LEAD + Math.ceil(V[id].dur * FPS) + TAIL;
/** frame (scene-local) at which the n-th word starting with `k` is spoken */
const at = (id: string, k: string, n = 0) => {
  const hits = V[id].words.filter((w) => w.w.toLowerCase().startsWith(k.toLowerCase()));
  const w = hits[Math.min(n, hits.length - 1)];
  if (!w) throw new Error(`narration "${id}" has no word starting "${k}"`);
  return LEAD + Math.round((w.s / 1000) * FPS);
};

type Mark = { label: string; tIn: number; tOut: number; x: number; y: number; w: number; h: number };
const M: Record<string, Record<string, Mark>> = Object.fromEntries(
  Object.entries(rawMarks as Record<string, Mark[]>).map(([k, v]) => [k, Object.fromEntries(v.map((m) => [m.label, m]))]),
);

const short = (h?: string | null, a = 10, b = 6) => (h ? `${h.slice(0, a)}…${h.slice(-b)}` : "");
const ev = (kind: string) => (data as any).loan.events.find((e: any) => e.kind === kind);
const T = (data as any).board.totals;
const loan = (data as any).loan;
const usdc = (raw: string) => Number(raw) / 1e6;

// ---------- captions ----------
const Captions: React.FC<{ id: string; dark?: boolean }> = ({ id, dark }) => {
  const f = useCurrentFrame();
  const t = ((f - LEAD) / FPS) * 1000;
  const words = V[id].words;
  const chunks: Word[][] = [];
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (!chunks.length || (prev && w.s - prev.e > 180) || chunks.at(-1)!.length >= 8) chunks.push([]);
    chunks.at(-1)!.push(w);
  });
  const ci = chunks.findIndex((c, i) => t < (chunks[i + 1]?.[0].s ?? c.at(-1)!.e + 600));
  const chunk = chunks[ci];
  if (!chunk || t < chunk[0].s - 150) return null;
  const inO = interpolate(t, [chunk[0].s - 150, chunk[0].s + 50], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 44, display: "flex", justifyContent: "center", opacity: inO }}>
      <div style={{ maxWidth: 1400, padding: "12px 24px", borderRadius: 4, background: dark ? "rgba(252,252,250,0.06)" : "rgba(22,24,29,0.84)", fontFamily: SANS, fontSize: 37, fontWeight: 600, lineHeight: 1.22, textAlign: "center", color: "#fcfcfa", boxShadow: dark ? "none" : "0 10px 30px -12px rgba(22,24,29,.5)" }}>
        {chunk.map((w, i) => {
          const on = t >= w.s - 40;
          const cur = on && t < w.e + 80;
          return (
            <span key={i} style={{ color: cur ? "#c9b4f5" : on ? "#fcfcfa" : "rgba(252,252,250,0.45)" }}>
              {w.w}{i < chunk.length - 1 ? " " : ""}
            </span>
          );
        })}
      </div>
    </div>
  );
};

const Voice: React.FC<{ id: string }> = ({ id }) => (
  <Sequence from={LEAD}>
    <Audio src={staticFile(`voice/${id}.mp3`)} />
  </Sequence>
);

// ---------- the callout ----------
/**
 * A rounded outline around exactly one thing on screen, with a label that never covers it.
 * `k` is 1/cameraScale, so inside a zoomed capture the stroke and the label stay the same size on screen.
 */
const Spot: React.FC<{ x: number; y: number; w: number; h: number; from: number; to: number; label: string; k?: number; dim?: boolean; below?: boolean }> = ({ x, y, w, h, from, to, label, k = 1, dim, below }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (f < from - 1 || f > to + 12) return null;
  const s = spring({ frame: f - from, fps, config: { damping: 15, stiffness: 150, mass: 0.7 } });
  const out = interpolate(f, [to, to + 12], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const o = Math.max(0, s * out);
  const pad = 11 * k, grow = (1 - s) * 15 * k;
  const X = x - pad - grow, Y = y - pad - grow, W = w + pad * 2 + grow * 2, H = h + pad * 2 + grow * 2;
  const lh = 44 * k, lw = label.length * 13.4 * k + 30 * k;
  const above = !below && Y > lh + 18 * k;
  return (
    <>
      {dim &&
        ([[0, 0, 1920, Y], [0, Y + H, 1920, 1080 - Y - H], [0, Y, X, H], [X + W, Y, 1920 - X - W, H]] as [number, number, number, number][]).map(([a, b, c, d], i) => (
          <div key={i} style={{ position: "absolute", left: a, top: b, width: Math.max(0, c), height: Math.max(0, d), background: "rgba(18,20,25,0.46)", opacity: o }} />
        ))}
      <div style={{ position: "absolute", left: X, top: Y, width: W, height: H, border: `${3.4 * k}px solid ${C.violet}`, borderRadius: 7 * k, boxShadow: `0 0 0 ${2.5 * k}px rgba(90,43,179,.18)`, opacity: o }} />
      <div
        style={{
          position: "absolute",
          left: Math.max(14 * k, Math.min(X, 1920 - lw - 14 * k)),
          top: above ? Y - 12 * k - lh : Y + H + 12 * k,
          transform: `translateY(${(1 - s) * (above ? 10 : -10) * k}px)`,
          opacity: o,
          background: C.violet,
          color: "#fcfcfa",
          borderRadius: 4 * k,
          padding: `${8 * k}px ${15 * k}px ${9 * k}px`,
          fontFamily: SANS,
          fontWeight: 700,
          fontSize: 24 * k,
          lineHeight: 1.05,
          whiteSpace: "nowrap",
          boxShadow: `0 ${9 * k}px ${22 * k}px -${9 * k}px rgba(22,24,29,.55)`,
        }}
      >
        {label}
      </div>
    </>
  );
};

// ---------- screen capture, driven by the marks ----------
type B = { m: string; w: string; n?: number; label: string; dim?: boolean; zoom?: number; pad?: number; below?: boolean };
type Beat = B & { at: number; hold: number };
/** turn narration word anchors into beats; each callout holds until just before the next one */
const beats = (id: string, bs: B[]): Beat[] => {
  const ats = bs.map((b) => at(id, b.w, b.n ?? 0));
  return bs.map((b, i) => ({ ...b, at: ats[i], hold: Math.max(24, Math.min(130, (ats[i + 1] ?? sceneLen(id) + 6) - ats[i] - 14)) }));
};

const Shot: React.FC<{ clip: string; id: string; bs: B[] }> = ({ clip, id, bs }) => {
  const f = useCurrentFrame();
  const end = sceneLen(id);
  const B = beats(id, bs);
  const ms = B.map((b) => {
    const m = M[clip]?.[b.m];
    if (!m) throw new Error(`clip "${clip}" has no mark "${b.m}"`);
    return m;
  });
  const PRE = 10;
  // frame -> clip time: crawl while a callout is up, glide between callouts
  const fr: number[] = [], ct: number[] = [], cam: [number, number, number][] = [];
  const push = (a: number, t: number, c: [number, number, number]) => {
    const x = fr.length ? Math.max(a, fr.at(-1)! + 1) : a;
    fr.push(x); ct.push(t); cam.push(c);
  };
  const view = (m: Mark, b: B): [number, number, number] => {
    const pad = b.pad ?? 130;
    // 170px of headroom so the label and the captions never sit on top of the thing being pointed at
    const s = Math.max(1, Math.min(b.zoom ?? 1.95, 1920 / (m.w + pad * 2), (1080 - 170) / (m.h + pad * 2)));
    return [m.x + m.w / 2, m.y + m.h / 2, s];
  };
  const v0 = view(ms[0], B[0]);
  push(0, Math.max(0, ms[0].tIn - 1.3), [v0[0], v0[1], v0[2] * 0.93]);
  B.forEach((b, i) => {
    const v = view(ms[i], b);
    push(b.at - PRE, ms[i].tIn, v);
    push(b.at + b.hold, Math.min(ms[i].tOut, ms[i].tIn + (b.hold + PRE) / FPS), v);
  });
  push(end + 6, ct.at(-1)!, cam.at(-1)!);

  const pick = (i: 0 | 1 | 2) => interpolate(f, fr, cam.map((c) => c[i]), { easing: ease, extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const t = interpolate(f, fr, ct, { easing: ease, extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const s = pick(2), cx = pick(0), cy = pick(1);
  const tx = Math.min(0, Math.max(1920 - 1920 * s, 960 - cx * s));
  const ty = Math.min(0, Math.max(1080 - 1080 * s, 470 - cy * s)); // bias up: keeps callouts clear of the captions
  return (
    <AbsoluteFill style={{ background: C.desk, overflow: "hidden" }}>
      <div style={{ position: "absolute", width: 1920, height: 1080, transformOrigin: "0 0", transform: `translate(${tx}px, ${ty}px) scale(${s})` }}>
        {/* time remap: the sequence starts on the current frame, so the video always shows frame `startFrom` */}
        <Sequence from={f} layout="none">
          <OffthreadVideo src={staticFile(`clips/${clip}.mp4`)} startFrom={Math.max(0, Math.round(t * FPS))} muted style={{ width: 1920, height: 1080, display: "block" }} />
        </Sequence>
        {B.map((b, i) => (
          <Spot key={i} {...ms[i]} from={b.at - 6} to={b.at + b.hold} label={b.label} k={1 / s} dim={b.dim} below={b.below} />
        ))}
      </div>
    </AbsoluteFill>
  );
};

/** Callouts over a deck slide, in slide coordinates. */
type SB = B & { box: [number, number, number, number] };
const Slide: React.FC<{ slide: string; id: string; bs: SB[] }> = ({ slide, id, bs }) => {
  const B = beats(id, bs) as (SB & Beat)[];
  return (
    <AbsoluteFill style={{ background: C.desk }}>
      <DeckSlide id={slide} />
      {B.map((b, i) => (
        <Spot key={i} x={b.box[0]} y={b.box[1]} w={b.box[2]} h={b.box[3]} from={b.at - 6} to={b.at + b.hold} label={b.label} dim={b.dim} below={b.below} />
      ))}
    </AbsoluteFill>
  );
};

/** A receipt for something that happened off-screen, on mainnet. It is its own callout. */
const Receipt: React.FC<{ from: number; to: number; title: string; rows: [string, string][]; x?: number; y?: number; w?: number }> = ({ from, to, title, rows, x = 1140, y = 150, w = 700 }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (f < from || f > to + 14) return null;
  const s = spring({ frame: f - from, fps, config: { damping: 16, stiffness: 130 } });
  const out = interpolate(f, [to, to + 14], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, opacity: s * out, transform: `translateY(${(1 - s) * 26}px)`, background: C.sheet, border: `3px solid ${C.violet}`, borderRadius: 6, boxShadow: "0 22px 50px -22px rgba(22,24,29,.55)" }}>
      <div style={{ background: C.violet, color: "#fcfcfa", fontFamily: SANS, fontWeight: 700, fontSize: 24, padding: "10px 18px 11px" }}>{title}</div>
      <div style={{ padding: "14px 18px 16px", display: "grid", gridTemplateColumns: "172px 1fr", rowGap: 9 }}>
        {rows.map(([k, v]) => (
          <React.Fragment key={k}>
            <span style={{ fontFamily: SANS, fontSize: 20, color: C.mute }}>{k}</span>
            <span style={{ fontFamily: MONO, fontSize: 20, color: C.ink, wordBreak: "break-all" }}>{v}</span>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

// ---------- scene 01: the problem, on live numbers ----------
const Counter: React.FC<{ to: number; from: number; dec?: number; suffix?: string }> = ({ to, from, dec = 0, suffix = "" }) => {
  const f = useCurrentFrame();
  const k = interpolate(f, [from, from + 42], [0, 1], { easing: Easing.out(Easing.cubic), extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <>{(to * k).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec })}{suffix}</>;
};

const STAT_X = 150, STAT_W = 540, STAT_Y = 604, STAT_H = 196;
const Open: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rise = (d: number) => spring({ frame: f - d, fps, config: { damping: 18, stiffness: 110 } });
  const l1 = rise(6), l2 = rise(at("open", "They") - 8);
  const ks = [at("open", "hundred"), at("open", "earned"), at("open", "burned")];
  const stats: [string, React.ReactNode, string][] = [
    ["Bankr agents on Base", <Counter to={T.agents} from={ks[0]} />, "agent profiles · Bankr public API"],
    ["Lifetime creator fees", <Counter to={T.lifetimeFeesWeth} from={ks[1]} dec={2} suffix=" WETH" />, "beneficiary share · Bankr fee API"],
    ["LLM tokens, 30 days", <Counter to={T.llmTokens30d / 1e9} from={ks[2]} dec={1} suffix="B" />, "Bankr LLM Gateway usage"],
  ];
  const up = interpolate(f, [ks[0] - 22, ks[0] + 10], [0, -170], { easing: ease, extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const punch = rise(at("open", "borrow") - 10);
  return (
    <AbsoluteFill style={{ background: C.ink }}>
      <AbsoluteFill style={{ background: "radial-gradient(1200px 700px at 30% 20%, rgba(90,43,179,0.22), transparent 70%)" }} />
      <div style={{ position: "absolute", left: STAT_X, top: 246 + up, fontFamily: SANS, color: C.sheet, fontWeight: 800, fontSize: 100, lineHeight: 1.04, letterSpacing: "-0.02em" }}>
        <div style={{ opacity: l1, transform: `translateY(${(1 - l1) * 40}px)` }}>Bankr agents earn fees.</div>
        <div style={{ opacity: l2, transform: `translateY(${(1 - l2) * 40}px)`, color: "#c9b4f5" }}>They still run out of compute.</div>
      </div>
      <div style={{ position: "absolute", left: STAT_X, top: STAT_Y, width: STAT_W * 3, height: STAT_H, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", borderTop: "1px solid rgba(252,252,250,0.18)" }}>
        {stats.map(([lab, val, src], i) => {
          const s = spring({ frame: f - ks[i] + 8, fps, config: { damping: 18 } });
          return (
            <div key={i} style={{ borderLeft: i ? "1px solid rgba(252,252,250,0.18)" : "none", padding: "24px 30px", opacity: s, transform: `translateY(${(1 - s) * 22}px)`, boxSizing: "border-box" }}>
              <div style={{ fontFamily: SANS, fontSize: 18, fontWeight: 600, letterSpacing: "0.09em", textTransform: "uppercase", color: "#9aa0aa" }}>{lab}</div>
              <div style={{ fontFamily: MONO, fontSize: 64, color: C.sheet, marginTop: 10 }}>{val}</div>
              <div style={{ fontFamily: SANS, fontSize: 18, color: "#9aa0aa", marginTop: 8 }}>{src}</div>
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", left: STAT_X, top: 856, width: 1240, fontFamily: SANS, fontSize: 36, fontWeight: 600, color: "#fcfcfa", opacity: punch, transform: `translateY(${(1 - punch) * 18}px)` }}>
        Nothing lets an agent borrow against fees it has already earned.
      </div>
      <div style={{ position: "absolute", left: STAT_X, top: 930, fontFamily: MONO, fontSize: 16, color: "#7d838d", opacity: punch }}>
        live Gadai agent /api/board · {String((data as any).board.generatedAt).slice(0, 16).replace("T", " ")} UTC
      </div>
      <Spot x={STAT_X} y={STAT_Y} w={STAT_W} h={STAT_H} from={ks[0] + 4} to={ks[1] - 14} label="105 Bankr agents" />
      <Spot x={STAT_X + STAT_W} y={STAT_Y} w={STAT_W} h={STAT_H} from={ks[1] + 4} to={ks[2] - 14} label="593 WETH of creator fees" />
      <Spot x={STAT_X + STAT_W * 2} y={STAT_Y} w={STAT_W} h={STAT_H} from={ks[2] + 4} to={at("open", "borrow") - 16} label="19.5B LLM tokens burned" />
      <Captions id="open" dark />
      <Voice id="open" />
    </AbsoluteFill>
  );
};

// ---------- scenes ----------
const TSLA = "0xbfbe9702dd40ed28e734d1ebc319a7ace9d27b30f77eb5185179de01366dd708";
const FLASH_FILL = "0x261a1355c4d5c7a1e97aaf398a1eb42f8c8563b5489f68709c2bd7660f3bcab4";

const Equities: React.FC = () => (
  <AbsoluteFill>
    <Shot
      clip="equities"
      id="equities"
      bs={[
        { m: "heading", w: "Robinhood", label: "Robinhood Chain agents", pad: 220 },
        { m: "agents", w: "three", label: "3 paid in tokenized stocks" },
        { m: "fees", w: "stocks", label: "lifetime equity fees" },
        { m: "px", w: "quoted", label: "each stock quoted via Uniswap on chain 4663", pad: 80 },
        { m: "indicative", w: "indicative", label: "priced, not lendable: desk is Base-only" },
      ]}
    />
    <Receipt
      from={at("equities", "Tesla") - 12}
      to={sceneLen("equities")}
      title="Real buy · Robinhood Chain 4663"
      x={1080}
      y={132}
      w={760}
      rows={[
        ["Bridged", "0.0002 ETH, Base → 4663 (Relay)"],
        ["Bought", "0.00078962 TSLA for 0.000109976 ETH"],
        ["Router", "Uniswap Trading API, chain 4663"],
        ["Swap tx", short(TSLA, 12, 8)],
      ]}
    />
    <Captions id="equities" />
    <Voice id="equities" />
  </AbsoluteFill>
);

const Lien: React.FC = () => (
  <AbsoluteFill>
    <Shot
      clip="loan"
      id="lien"
      bs={[
        { m: "stamp", w: "real", label: "loan #1 · GITLAWB · released", pad: 300 },
        { m: "terms", w: "against", label: `principal ${usdc(loan.terms.principalRaw).toFixed(2)} USDC`, pad: 90 },
        { m: "identity", w: "identity", label: "borrower's own ERC-8004 agent" },
        { m: "pledged", w: "update", label: "updateBeneficiary → FeeVault", dim: true },
      ]}
    />
    <Captions id="lien" />
    <Voice id="lien" />
  </AbsoluteFill>
);

/** the ERC-8021 builder-code suffix, read out of the real disburse calldata */
const Suffix: React.FC<{ from: number; to: number }> = ({ from, to }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const bc = (data as any).builder;
  if (!bc || f < from || f > to + 14) return null;
  const s = spring({ frame: f - from, fps, config: { damping: 16 } });
  const out = interpolate(f, [to, to + 14], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const typed = Math.floor(interpolate(f, [from + 8, from + 44], [0, Number(bc.suffix.length)], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  return (
    <div style={{ position: "absolute", left: 130, top: 120, width: 980, opacity: s * out, transform: `translateY(${(1 - s) * 26}px)`, background: C.ink, borderRadius: 6, border: `3px solid ${C.violet}`, padding: "20px 24px 22px", boxShadow: "0 22px 50px -22px rgba(0,0,0,.7)" }}>
        <div style={{ fontFamily: SANS, fontSize: 15, fontWeight: 600, letterSpacing: "0.09em", textTransform: "uppercase", color: "#9aa0aa" }}>calldata tail · disburse {short(bc.tx, 8, 4)}</div>
      <div style={{ fontFamily: MONO, fontSize: 21, lineHeight: 1.5, marginTop: 9, wordBreak: "break-all", color: "#7d838d" }}>
        …{bc.body}
        <span style={{ color: "#fcfcfa", background: "rgba(90,43,179,.6)" }}>{bc.suffix.slice(0, typed)}</span>
      </div>
      <div style={{ fontFamily: SANS, fontSize: 20, color: "#c9b4f5", marginTop: 9 }}>ERC-8021 suffix · Base builder code “{bc.code}”</div>
    </div>
  );
};

const Repay: React.FC = () => (
  <AbsoluteFill>
    <Shot
      clip="timeline"
      id="repay"
      bs={[
        { m: "disbursed", w: "disburses", label: `${usdc(ev("disbursed").data.amountRaw).toFixed(2)} USDC · Dynamic agent wallet` },
        { m: "collected", w: "collects", label: "keeper collects the pool's fees" },
        { m: "swapped", w: "swaps", label: "Uniswap Trading API · WETH → USDC", dim: true },
        { m: "debt", w: "zero", label: "debt read on-chain: zero", pad: 90 },
        { m: "released", w: "release", label: "release() · fee rights returned" },
        { m: "feedback", w: "reputation", label: "ERC-8004 repayment reputation" },
      ]}
    />
    <Suffix from={at("repay", "builder") - 14} to={sceneLen("repay")} />
    <Captions id="repay" />
    <Voice id="repay" />
  </AbsoluteFill>
);

const Desk: React.FC = () => (
  <AbsoluteFill>
    <Shot
      clip="desk"
      id="desk"
      bs={[
        { m: "call", w: "signal", label: "signal #1 · Prudent approves $GITLAWB", pad: 230 },
        { m: "share", w: "share", label: "share card for X" },
        { m: "fee", w: "quote", label: `live Definitive Flash quote · ${(data as any).quote?.integratorFeeBps ?? 10} bps to Gadai` },
        { m: "auto", w: "Auto", label: "Dynamic delegated access · no approval yet", dim: true },
        { m: "bracket", w: "bracket", label: "market buy + take-profit bracket" },
        { m: "dca", w: "DCA", label: "DCA = one Flash TWAP" },
        { m: "bps", w: "basis", label: "integrator fee, 10 bps" },
      ]}
    />
    <Receipt
      from={at("desk", "mainnet") - 14}
      to={sceneLen("desk")}
      title="The desk mirrored its own call · Base mainnet"
      x={1010}
      y={128}
      w={830}
      rows={[
        ["Order", "fb3b2572-48c6-4ce5-b79a-6199cefac82f"],
        ["Size", "0.25 USDC → GITLAWB, 2 slices / 10 min"],
        ["First fill", "0.125 USDC → 2,158 GITLAWB"],
        ["Tx", short(FLASH_FILL, 12, 8)],
      ]}
    />
    <Captions id="desk" />
    <Voice id="desk" />
  </AbsoluteFill>
);

const Dine: React.FC = () => (
  <AbsoluteFill>
    <Shot
      clip="dine"
      id="dine"
      bs={[
        { m: "budget", w: "budget", label: `dining budget · ${usdc(loan.terms.drawLimitRaw).toFixed(2)} USDC`, pad: 190 },
        { m: "trending", w: "checked", label: "trending from network check-ins, 7d", pad: 40, zoom: 1.2 },
        { m: "venues", w: "venues", label: "1,675 live Blackbird venues", pad: 120 },
        { m: "pay", w: "Paying", label: "FLY payments: pending Blackbird review", dim: true },
        { m: "passport", w: "passport", label: "Blackbird login · passport, memberships, tags" },
        { m: "pick", w: "hours", label: "hours, cost estimate, check-ins — live", pad: 60 },
      ]}
    />
    <Captions id="dine" />
    <Voice id="dine" />
  </AbsoluteFill>
);

const Evidence: React.FC = () => (
  <AbsoluteFill>
    <Shot
      clip="evidence"
      id="evidence"
      bs={[
        { m: "desk", w: "deployed", label: "FeeDesk deployed on Base mainnet", pad: 80 },
        { m: "id", w: "agent", label: "ERC-8004 agent #94699", pad: 80 },
        { m: "x402", w: "payment", label: "$0.05 x402 risk check, paid", pad: 80 },
        { m: "flash", w: "Flash", label: "Definitive Flash TWAP, filled", pad: 80 },
        { m: "split", w: "page", label: "mainnet vs fork vs code only", pad: 40, zoom: 1.25 },
        { m: "wallet", w: "signed", label: "Dynamic agent wallet · 2-of-2 MPC", pad: 60 },
      ]}
    />
    <Captions id="evidence" />
    <Voice id="evidence" />
  </AbsoluteFill>
);

const Board: React.FC = () => (
  <AbsoluteFill>
    <Shot
      clip="board"
      id="board"
      bs={[
        { m: "headline", w: "prices", label: "every Bankr agent, priced live", pad: 160 },
        { m: "credit", w: "hundred", label: "credit available today" },
        { m: "llm", w: "Gateway", label: "compute burn · Bankr LLM Gateway" },
        { m: "line", w: "line", label: "that agent's credit line" },
        { m: "signal", w: "cover", label: "do its fees cover its compute?" },
        { m: "why", w: "why", label: "why this one is not eligible", dim: true },
      ]}
    />
    <Captions id="board" />
    <Voice id="board" />
  </AbsoluteFill>
);

// deck-slide scenes. Boxes are in slide coordinates (see video/src/deck/Deck.tsx layouts).
// DiagramSlide: PAD 110, gap 44, TOP 380, H 196 -> W = floor((1920-220-176)/5)
const NODE = (i: number): [number, number, number, number] => [110 + i * 348, 380, 304, 196];
// CardsSlide: left/right PAD 110, top 372, bottom 132, gap 26, 3 columns
const CARD = (i: number): [number, number, number, number] => [110 + Math.round(i * 575.33), 372, 549, 576];
// RowsSlide: container top 336, header 32, row pitch 53 at 8 rows (padding 11 + 23px/1.3 + 1px rule)
const ROW = (i: number, n = 1): [number, number, number, number] => [110, 368 + i * 53, 1700, n * 53];

const What: React.FC = () => (
  <AbsoluteFill>
    <Slide
      slide="what"
      id="what"
      bs={[
        { m: "", w: "trade", box: NODE(0), label: "a trade on a Bankr / Doppler pool" },
        { m: "", w: "beneficiary", box: NODE(1), label: "creator fees, to a beneficiary" },
        { m: "", w: "update", box: NODE(2), label: "the Doppler call that moves them" },
        { m: "", w: "lien", box: NODE(3), label: "the lien: a per-loan FeeVault", dim: true },
        { m: "", w: "FeeNotes", box: NODE(4), label: "sold for USDC in a Uniswap CCA" },
        { m: "", w: "release", box: [437, 739, 1044, 53], label: "permissionless release()", below: true },
      ]}
    />
    <Captions id="what" />
    <Voice id="what" />
  </AbsoluteFill>
);

const Engine: React.FC = () => (
  <AbsoluteFill>
    <Slide
      slide="underwriting"
      id="engine"
      bs={[
        { m: "", w: "lowest", box: CARD(0), label: "deterministic rate math" },
        { m: "", w: "persona", box: CARD(1), label: "three persona memos · Bankr LLM Gateway" },
        { m: "", w: "skeptic", box: [713, 827, 493, 48], label: "the skeptic lends a third", below: true },
        { m: "", w: "cents", box: CARD(2), label: "paid x402 risk check · Dynamic MPC wallet", dim: true },
      ]}
    />
    <Captions id="engine" />
    <Voice id="engine" />
  </AbsoluteFill>
);

const Notes: React.FC = () => (
  <AbsoluteFill>
    <Slide
      slide="feenote"
      id="notes"
      bs={[
        { m: "", w: "asset", box: CARD(0), label: "the FeeNote, an ERC-20 claim" },
        { m: "", w: "Uniswap", box: CARD(1), label: "Uniswap Continuous Clearing Auction" },
        { m: "", w: "anchor", box: CARD(2), label: "desk anchor bid · Dynamic agent wallet" },
      ]}
    />
    <Captions id="notes" />
    <Voice id="notes" />
  </AbsoluteFill>
);

const A2A: React.FC = () => (
  <AbsoluteFill>
    <Slide
      slide="a2a"
      id="a2a"
      bs={[
        { m: "", w: "sells", box: CARD(0), label: "sells credit reports · Bankr x402 Cloud" },
        { m: "", w: "buys", box: CARD(1), label: "buys risk data · $0.05, EIP-3009" },
        { m: "", w: "installs", box: CARD(2), label: "Bankr Skill + two Grok Bot skills" },
      ]}
    />
    <Captions id="a2a" />
    <Voice id="a2a" />
  </AbsoluteFill>
);

const Close: React.FC = () => (
  <AbsoluteFill>
    <Slide
      slide="scope"
      id="close"
      bs={[
        { m: "", w: "live", box: ROW(0, 4), label: "live on Base mainnet" },
        { m: "", w: "fork", box: ROW(4), label: "the loan lifecycle: an Anvil fork of Base" },
        { m: "", w: "Gadai", box: [110, 866, 1698, 90], label: "see it yourself", below: true },
      ]}
    />
    <Captions id="close" />
    <Voice id="close" />
  </AbsoluteFill>
);

const SCENES: [string, React.FC][] = [
  ["open", Open],
  ["what", What],
  ["board", Board],
  ["equities", Equities],
  ["engine", Engine],
  ["lien", Lien],
  ["notes", Notes],
  ["repay", Repay],
  ["a2a", A2A],
  ["desk", Desk],
  ["dine", Dine],
  ["evidence", Evidence],
  ["close", Close],
];
export const totalFrames = SCENES.reduce((a, [id]) => a + sceneLen(id), 0) - XF * (SCENES.length - 1) + 30;

export const Gadai: React.FC = () => (
  <AbsoluteFill style={{ background: C.ink }}>
    <TransitionSeries>
      {SCENES.flatMap(([id, S], i) => [
        <TransitionSeries.Sequence key={id} durationInFrames={sceneLen(id) + (i === SCENES.length - 1 ? 30 : 0)}>
          <S />
        </TransitionSeries.Sequence>,
        i < SCENES.length - 1 ? <TransitionSeries.Transition key={id + "t"} presentation={fade()} timing={linearTiming({ durationInFrames: XF })} /> : null,
      ]).filter(Boolean)}
    </TransitionSeries>
    <Audio src={staticFile("pad.m4a")} volume={0.09} />
  </AbsoluteFill>
);
