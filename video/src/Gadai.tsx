import React from "react";
import { AbsoluteFill, Audio, Easing, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { loadFont as loadArchivo } from "@remotion/google-fonts/Archivo";
import { loadFont as loadMono } from "@remotion/google-fonts/ChivoMono";
import voice from "../public/voice/words.json";
import data from "../public/data.json";

const { fontFamily: SANS } = loadArchivo("normal", { weights: ["400", "600", "700", "800"], subsets: ["latin"] });
const { fontFamily: MONO } = loadMono("normal", { weights: ["400", "500"], subsets: ["latin"] });

// web/DESIGN.md tokens
const C = { desk: "#e5e8e3", sheet: "#fcfcfa", ink: "#16181d", mute: "#545a64", rule: "#c4c9cf", violet: "#5a2bb3", violetTint: "#efe9fa", green: "#16683b", amber: "#e3a32b" };
const FPS = 30, LEAD = 12, TAIL = 20, XF = 18;
type Word = { w: string; s: number; e: number };
const V: Record<string, { dur: number; words: Word[] }> = Object.fromEntries((voice as any[]).map((v) => [v.id, v]));
const sceneLen = (id: string, extra = 0) => LEAD + Math.ceil(V[id].dur * FPS) + TAIL + extra;
// frame (scene-local) at which the n-th occurrence of a word starting with `k` is spoken
const at = (id: string, k: string, n = 0) => {
  const hits = V[id].words.filter((w) => w.w.toLowerCase().startsWith(k.toLowerCase()));
  const w = hits[Math.min(n, hits.length - 1)];
  return w ? LEAD + Math.round((w.s / 1000) * FPS) : LEAD;
};
const short = (h?: string | null, a = 10, b = 6) => (h ? `${h.slice(0, a)}…${h.slice(-b)}` : "");
const ev = (kind: string) => (data as any).loan.events.find((e: any) => e.kind === kind);
const T = (data as any).board.totals;
const loan = (data as any).loan;
const usdc = (raw: string) => Number(raw) / 1e6;

const ease = Easing.bezier(0.22, 1, 0.36, 1);
const useSpring = (delay = 0, damping = 18) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: f - delay, fps, config: { damping, stiffness: 110, mass: 0.9 } });
};

// ---------- shared pieces ----------
const Label: React.FC<{ children: React.ReactNode; color?: string; style?: React.CSSProperties }> = ({ children, color = C.mute, style }) => (
  <div style={{ fontFamily: SANS, fontSize: 18, fontWeight: 600, letterSpacing: "0.09em", textTransform: "uppercase", color, ...style }}>{children}</div>
);

const Captions: React.FC<{ id: string; dark?: boolean }> = ({ id, dark }) => {
  const f = useCurrentFrame();
  const t = ((f - LEAD) / FPS) * 1000;
  const words = V[id].words;
  // chunk on pauses and at most 8 words
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
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 58, display: "flex", justifyContent: "center", opacity: inO }}>
      <div style={{ maxWidth: 1400, padding: "14px 26px", borderRadius: 4, background: dark ? "rgba(252,252,250,0.06)" : "rgba(22,24,29,0.82)", fontFamily: SANS, fontSize: 40, fontWeight: 600, lineHeight: 1.25, textAlign: "center", color: "#fcfcfa", boxShadow: dark ? "none" : "0 10px 30px -12px rgba(22,24,29,.5)" }}>
        {chunk.map((w, i) => {
          const on = t >= w.s - 40;
          const cur = t >= w.s - 40 && t < w.e + 80;
          return (
            <span key={i} style={{ color: cur ? "#c9b4f5" : on ? "#fcfcfa" : "rgba(252,252,250,0.45)", transition: "none" }}>
              {w.w}{i < chunk.length - 1 ? " " : ""}
            </span>
          );
        })}
      </div>
    </div>
  );
};

const LowerThird: React.FC<{ from: number; to: number; label: string; value: React.ReactNode; accent?: string; y?: number; x?: number }> = ({ from, to, label, value, accent = C.violet, y = 170, x = 64 }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (f < from || f > to + 15) return null;
  const s = spring({ frame: f - from, fps, config: { damping: 16, stiffness: 120 } });
  const out = interpolate(f, [to, to + 15], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", left: x, bottom: y, opacity: s * out, transform: `translateX(${(1 - s) * -40}px)`, background: C.sheet, borderLeft: `5px solid ${accent}`, padding: "14px 22px 16px", boxShadow: "0 1px 2px rgb(22 24 29 / .08), 0 16px 36px -16px rgb(22 24 29 / .45)", borderRadius: 3, minWidth: 360 }}>
      <Label style={{ fontSize: 15 }}>{label}</Label>
      <div style={{ fontFamily: MONO, fontSize: 28, color: C.ink, marginTop: 6 }}>{value}</div>
    </div>
  );
};

const Sponsor: React.FC<{ from: number; to: number; name: string; role: string; right?: number; top?: number }> = ({ from, to, name, role, right = 64, top = 64 }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (f < from || f > to + 15) return null;
  const s = spring({ frame: f - from, fps, config: { damping: 16, stiffness: 120 } });
  const out = interpolate(f, [to, to + 15], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", right, top, opacity: s * out, transform: `translateY(${(1 - s) * -20}px)`, background: C.ink, color: C.sheet, padding: "12px 20px", borderRadius: 3, display: "flex", gap: 14, alignItems: "baseline" }}>
      <span style={{ fontFamily: SANS, fontWeight: 800, fontSize: 28 }}>{name}</span>
      <span style={{ fontFamily: SANS, fontSize: 20, color: "#b9bec6" }}>{role}</span>
    </div>
  );
};

// Screen capture with a camera: keys are [frame, focusX, focusY, scale] in 1920x1080 clip coords.
type Key = [number, number, number, number];
const Cam: React.FC<{ src: string; start?: number; rate?: number; keys: Key[] }> = ({ src, start = 0, rate = 1, keys: raw }) => {
  const f = useCurrentFrame();
  const keys = [...raw].sort((a, b) => a[0] - b[0]).filter((k, i, a) => i === 0 || k[0] > a[i - 1][0]);
  const fr = keys.map((k) => k[0]);
  const pick = (i: number) => (keys.length === 1 ? keys[0][i] : interpolate(f, fr, keys.map((k) => k[i]), { easing: ease, extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const s = pick(3), cx = pick(1), cy = pick(2);
  const tx = Math.min(0, Math.max(1920 - 1920 * s, 960 - cx * s));
  const ty = Math.min(0, Math.max(1080 - 1080 * s, 540 - cy * s));
  return (
    <AbsoluteFill style={{ background: C.desk, overflow: "hidden" }}>
      <div style={{ position: "absolute", width: 1920, height: 1080, transformOrigin: "0 0", transform: `translate(${tx}px, ${ty}px) scale(${s})` }}>
        <OffthreadVideo src={staticFile(`clips/${src}.mp4`)} startFrom={Math.round(start * FPS)} playbackRate={rate} muted style={{ width: 1920, height: 1080 }} />
      </div>
    </AbsoluteFill>
  );
};

const Voice: React.FC<{ id: string }> = ({ id }) => (
  <Sequence from={LEAD}>
    <Audio src={staticFile(`voice/${id}.mp3`)} />
  </Sequence>
);

const Chapter: React.FC<{ n: string; title: string }> = ({ n, title }) => {
  const f = useCurrentFrame();
  const s = useSpring(4);
  const out = interpolate(f, [80, 100], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", left: 64, top: 56, opacity: s * out, display: "flex", alignItems: "center", gap: 14, background: C.sheet, padding: "10px 18px", borderRadius: 3, boxShadow: "0 10px 28px -16px rgb(22 24 29 / .5)" }}>
      <span style={{ fontFamily: MONO, fontSize: 20, color: C.violet }}>{n}</span>
      <span style={{ fontFamily: SANS, fontSize: 22, fontWeight: 700, color: C.ink }}>{title}</span>
    </div>
  );
};

// ---------- scenes ----------
const Counter: React.FC<{ to: number; from: number; dec?: number; suffix?: string; prefix?: string }> = ({ to, from, dec = 0, suffix = "", prefix = "" }) => {
  const f = useCurrentFrame();
  const k = interpolate(f, [from, from + 45], [0, 1], { easing: Easing.out(Easing.cubic), extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <>{prefix}{(to * k).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec })}{suffix}</>;
};

const Open: React.FC = () => {
  const f = useCurrentFrame();
  const l1 = useSpring(6), l2 = useSpring(at("open", "They"));
  const statsIn = at("open", "Right");
  const stats: [string, React.ReactNode, string, number][] = [
    ["Bankr agents on Base", <Counter to={T.agents} from={at("open", String(T.agents))} />, "agent profiles priced by Gadai", at("open", String(T.agents))],
    ["Lifetime creator fees", <Counter to={T.lifetimeFeesWeth} from={at("open", String(Math.round(T.lifetimeFeesWeth)))} dec={1} suffix=" WETH" />, "beneficiary share · Bankr fee API", at("open", String(Math.round(T.lifetimeFeesWeth)))],
    ["LLM tokens, 30 days", <Counter to={T.llmTokens30d / 1e9} from={at("open", "18")} dec={1} suffix="B" />, "Bankr LLM Gateway usage", at("open", "18")],
  ];
  const up = interpolate(f, [statsIn - 10, statsIn + 20], [0, -150], { easing: ease, extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: C.ink }}>
      <AbsoluteFill style={{ background: "radial-gradient(1200px 700px at 30% 20%, rgba(90,43,179,0.20), transparent 70%)" }} />
      <div style={{ position: "absolute", left: 150, top: 250 + up, fontFamily: SANS, color: C.sheet, fontWeight: 800, fontSize: 104, lineHeight: 1.04, letterSpacing: "-0.02em" }}>
        <div style={{ opacity: l1, transform: `translateY(${(1 - l1) * 40}px)` }}>Bankr agents earn fees.</div>
        <div style={{ opacity: l2, transform: `translateY(${(1 - l2) * 40}px)`, color: "#c9b4f5" }}>They still run out of compute.</div>
      </div>
      <div style={{ position: "absolute", left: 150, right: 150, top: 610, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", borderTop: "1px solid rgba(252,252,250,0.18)" }}>
        {stats.map(([lab, val, src, d], i) => {
          const s = spring({ frame: f - d + 6, fps: FPS, config: { damping: 18 } });
          return (
            <div key={i} style={{ borderLeft: i ? "1px solid rgba(252,252,250,0.18)" : "none", padding: "26px 30px", opacity: s, transform: `translateY(${(1 - s) * 24}px)` }}>
              <Label color="#9aa0aa">{lab}</Label>
              <div style={{ fontFamily: MONO, fontSize: 68, color: C.sheet, marginTop: 10 }}>{val}</div>
              <div style={{ fontFamily: SANS, fontSize: 18, color: "#9aa0aa", marginTop: 8 }}>{src}</div>
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", left: 150, top: 820, fontFamily: MONO, fontSize: 16, color: "#7d838d", opacity: interpolate(f, [statsIn, statsIn + 30], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
        source: live Gadai agent /api/board · built {new Date((data as any).board.generatedAt).toISOString().slice(0, 16).replace("T", " ")} UTC
      </div>
      <Captions id="open" dark />
      <Voice id="open" />
    </AbsoluteFill>
  );
};

// Step-by-step mechanism diagram
const Idea: React.FC = () => {
  const f = useCurrentFrame();
  const W = 300, H = 118;
  type N = { x: number; y: number; t: string; s: string; k: number; hot?: boolean };
  const nodes: N[] = [
    { x: 120, y: 250, t: "Token trades", s: "Bankr / Doppler pool", k: at("idea", "fees") - 20 },
    { x: 470, y: 250, t: "Creator fees", s: "WETH, beneficiary share", k: at("idea", "fees") },
    { x: 820, y: 250, t: "updateBeneficiary", s: "FeesManager → vault", k: at("idea", "updateBeneficiary") },
    { x: 1170, y: 250, t: "FeeVault", s: "the lien", k: at("idea", "lien"), hot: true },
    { x: 1520, y: 250, t: "FeeNotes", s: "Uniswap CCA", k: at("idea", "auction") },
    { x: 1520, y: 560, t: "USDC → borrower", s: "Dynamic agent wallet", k: at("idea", "USDC", 1) },
    { x: 1170, y: 560, t: "Swap fees → USDC", s: "Uniswap Trading API", k: at("idea", "swapped") },
    { x: 820, y: 560, t: "Repay", s: "FeeNote holders", k: at("idea", "repay") },
    { x: 470, y: 560, t: "release()", s: "fee rights return", k: at("idea", "release"), hot: true },
  ];
  const cx = (n: N) => n.x + W / 2, cy = (n: N) => n.y + H / 2;
  const edges = nodes.slice(1).map((n, i) => {
    const a = nodes[i];
    let d: string;
    if (a.y === n.y) d = a.x < n.x ? `M${a.x + W} ${cy(a)} L${n.x - 8} ${cy(n)}` : `M${a.x} ${cy(a)} L${n.x + W + 8} ${cy(n)}`;
    else d = `M${cx(a)} ${a.y + H} L${cx(n)} ${n.y - 8}`;
    return { d, k: n.k - 10 };
  });
  const back = { d: `M${cx(nodes[8])} ${nodes[8].y} C ${cx(nodes[8])} 470, ${cx(nodes[1])} 470, ${cx(nodes[1])} ${nodes[1].y + H + 8}`, k: nodes[8].k + 10 };
  const draw = (k: number) => interpolate(f, [k, k + 22], [1, 0], { easing: ease, extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const title = useSpring(2);
  return (
    <AbsoluteFill style={{ background: C.desk }}>
      <div style={{ position: "absolute", left: 120, top: 84, opacity: title, transform: `translateY(${(1 - title) * 20}px)` }}>
        <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: 64, color: C.ink, letterSpacing: "-0.015em" }}>
          Gadai <span style={{ fontWeight: 400, color: C.mute, fontSize: 40 }}>(Indonesian: “pledge”)</span>
        </div>
        <div style={{ fontFamily: SANS, fontSize: 28, color: C.mute, marginTop: 6 }}>USDC credit against the creator fees an agent already earns.</div>
      </div>
      <svg width={1920} height={1080} style={{ position: "absolute" }}>
        <defs>
          <marker id="ar" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill={C.ink} /></marker>
          <marker id="arv" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill={C.violet} /></marker>
        </defs>
        {[...edges, back].map((e, i) => (
          <path key={i} d={e.d} fill="none" stroke={e === back ? C.violet : C.ink} strokeWidth={2.5} strokeDasharray={e === back ? "8 8" : undefined} pathLength={1} markerEnd={draw(e.k) < 0.05 ? `url(#${e === back ? "arv" : "ar"})` : undefined}
            style={e === back ? { strokeDasharray: "0.02 0.015", strokeDashoffset: 0, opacity: 1 - draw(e.k) } : { strokeDasharray: 1, strokeDashoffset: draw(e.k) }} />
        ))}
      </svg>
      {nodes.map((n, i) => {
        const s = spring({ frame: f - n.k, fps: FPS, config: { damping: 15, stiffness: 130 } });
        const live = f >= n.k && (nodes[i + 1] ? f < nodes[i + 1].k : true);
        return (
          <div key={i} style={{ position: "absolute", left: n.x, top: n.y, width: W, height: H, opacity: s, transform: `scale(${0.9 + 0.1 * s})`, background: n.hot ? C.violetTint : C.sheet, border: `${live ? 2.5 : 1.5}px solid ${n.hot || live ? C.violet : C.rule}`, borderRadius: 3, boxShadow: "0 1px 2px rgb(22 24 29 / .06), 0 10px 28px -16px rgb(22 24 29 / .28)", padding: "18px 20px", boxSizing: "border-box" }}>
            <div style={{ fontFamily: MONO, fontSize: 15, color: C.violet }}>{String(i + 1).padStart(2, "0")}</div>
            <div style={{ fontFamily: n.t.includes("(") || n.t.startsWith("update") ? MONO : SANS, fontWeight: 700, fontSize: n.t.length > 16 ? 25 : 30, color: C.ink, marginTop: 4 }}>{n.t}</div>
            <div style={{ fontFamily: SANS, fontSize: 19, color: C.mute, marginTop: 2 }}>{n.s}</div>
          </div>
        );
      })}
      <Captions id="idea" />
      <Voice id="idea" />
    </AbsoluteFill>
  );
};

const Board: React.FC = () => {
  const k = at("board", "Today"), ne = at("board", "Every", 1);
  return (
    <AbsoluteFill>
      <Cam src="board" start={1.2} rate={1.25} keys={[[0, 720, 210, 1.5], [70, 720, 220, 1.42], [k - 20, 820, 350, 1.25], [k + 10, 960, 500, 1.3], [ne - 10, 960, 600, 1.22], [ne + 30, 960, 600, 1.25], [sceneLen("board"), 1000, 520, 1.3]]} />
      <Chapter n="01" title="Credit Line Board" />
      <LowerThird from={k} to={k + 110} label="Live · Gadai agent /api/board" value="Bankr fee API + LLM Gateway, one engine" />
      <Sponsor from={at("board", "Fee")} to={at("board", "Today") - 10} name="Bankr" role="fee API · LLM Gateway" />
      <Captions id="board" />
      <Voice id="board" />
    </AbsoluteFill>
  );
};

const Apply: React.FC = () => {
  const sw = at("apply", "Three");
  const m = loan.memos ?? [];
  return (
    <AbsoluteFill>
      <Sequence durationInFrames={sw}>
        <Cam src="apply" start={4.5} rate={1} keys={[[0, 960, 300, 1.3], [90, 960, 330, 1.3], [sw - 60, 960, 700, 1.3], [sw, 960, 720, 1.32]]} />
      </Sequence>
      <Sequence from={sw}>
        <Cam src="memos" start={2.2} rate={1.15} keys={[[0, 1200, 250, 1.35], [60, 960, 400, 1.2], [200, 960, 520, 1.25], [sceneLen("apply") - sw, 960, 560, 1.3]]} />
      </Sequence>
      <Chapter n="02" title="Apply & underwrite" />
      <LowerThird from={at("apply", "skeptic") - 5} to={at("apply", "borrower", 1) - 10} label="Memos · rules, no LLM review" value={m.map((x: any) => `${x.personaId} $${usdc(x.principalRaw).toFixed(0)}`).join(" · ")} />
      <LowerThird from={at("apply", "ERC-8004") - 5} to={sceneLen("apply")} label="Borrower identity · ERC-8004" value={`agent registered on Base`} />
      <Captions id="apply" />
      <Voice id="apply" />
    </AbsoluteFill>
  );
};

const Pledge: React.FC = () => (
  <AbsoluteFill>
    <Cam src="pledge" start={1.8} rate={1.1} keys={[[0, 1250, 230, 1.45], [70, 1250, 230, 1.45], [140, 960, 560, 1.22], [sceneLen("pledge"), 960, 600, 1.28]]} />
    <Chapter n="03" title="Pledge · the lien" />
    <LowerThird from={at("pledge", "updateBeneficiary")} to={sceneLen("pledge")} label="pledge · updateBeneficiary → FeeVault" value={short(ev("pledged")?.txHash, 14, 8)} />
    <Captions id="pledge" />
    <Voice id="pledge" />
  </AbsoluteFill>
);

const Cca: React.FC = () => (
  <AbsoluteFill>
    <Cam src="notes" start={1.8} rate={1.35} keys={[[0, 800, 220, 1.35], [80, 960, 420, 1.25], [sceneLen("cca"), 960, 520, 1.3]]} />
    <Chapter n="04" title="Uniswap CCA · FeeNotes" />
    <Sponsor from={at("cca", "Uniswap")} to={sceneLen("cca")} name="Uniswap" role="Continuous Clearing Auction" />
    <Sponsor from={at("cca", "Dynamic")} to={sceneLen("cca")} name="Dynamic" role="agent wallet · MPC" top={140} />
    <LowerThird from={at("cca", "anchor")} to={sceneLen("cca")} label="desk anchor bid · Dynamic agent wallet" value={short(ev("bid")?.txHash, 14, 8)} />
    <Captions id="cca" />
    <Voice id="cca" />
  </AbsoluteFill>
);

// calldata tail of a desk tx with its ERC-8021 builder-code suffix highlighted
const Suffix: React.FC<{ from: number }> = ({ from }) => {
  const f = useCurrentFrame();
  const s = spring({ frame: f - from, fps: FPS, config: { damping: 16 } });
  const bc = (data as any).builder;
  if (!bc || f < from) return null;
  const typed = Math.floor(interpolate(f, [from + 10, from + 50], [0, Number(bc.suffix.length)], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  return (
    <div style={{ position: "absolute", right: 64, top: 150, width: 1000, opacity: s, transform: `translateY(${(1 - s) * 30}px)`, background: C.ink, borderRadius: 4, padding: "22px 26px", boxShadow: "0 20px 50px -20px rgba(0,0,0,.6)" }}>
      <Label color="#9aa0aa" style={{ fontSize: 15 }}>calldata · {bc.kind} tx {short(bc.tx, 8, 4)}</Label>
      <div style={{ fontFamily: MONO, fontSize: 22, lineHeight: 1.5, marginTop: 10, wordBreak: "break-all", color: "#7d838d" }}>
        0x{bc.body}
        <span style={{ color: "#fcfcfa", background: "rgba(90,43,179,.55)", padding: "0 2px" }}>{bc.suffix.slice(0, typed)}</span>
      </div>
      <div style={{ fontFamily: SANS, fontSize: 20, color: "#c9b4f5", marginTop: 10 }}>ERC-8021 suffix · builder code “{bc.code}” · marker 0x8021…8021</div>
    </div>
  );
};

const Repay: React.FC = () => {
  const sw = at("repay", "keeper");
  const rel = at("repay", "release");
  const rep = at("repay", "reputation") - 10;
  const L = sceneLen("repay");
  const fr = useCurrentFrame();
  const stamp = fr >= rel ? spring({ frame: fr - rel, fps: FPS, config: { damping: 11, stiffness: 160 } }) : 0;
  return (
    <AbsoluteFill>
      <Sequence durationInFrames={sw}>
        <Cam src="active" start={1.8} rate={1.1} keys={[[0, 1425, 200, 1.6], [70, 1425, 200, 1.55], [110, 960, 500, 1.2], [sw, 960, 600, 1.25]]} />
      </Sequence>
      <Sequence from={sw} durationInFrames={rel - 5 - sw}>
        <Cam src="released" start={10.5} rate={1.0} keys={[[0, 960, 400, 1.2], [rel - sw, 960, 520, 1.3]]} />
      </Sequence>
      <Sequence from={rel - 5} durationInFrames={rep - rel + 5}>
        <Cam src="released" start={1.6} rate={0.8} keys={[[0, 1300, 260, 1.35], [22, 1425, 170, 2.1], [rep - rel - 20, 1425, 175, 1.95], [rep - rel + 5, 1200, 300, 1.4]]} />
      </Sequence>
      <Sequence from={rep}>
        <Cam src="released" start={17} rate={1.0} keys={[[0, 960, 500, 1.2], [L - rep, 960, 600, 1.3]]} />
      </Sequence>
      <Chapter n="05" title="Disburse · repay · release" />
      <LowerThird from={LEAD + 10} to={sw - 5} label={`disbursed · ${usdc(loan.terms?.principalRaw ?? "0").toFixed(2)} USDC`} value={short(ev("disbursed")?.txHash, 14, 8)} />
      <LowerThird from={at("repay", "swaps")} to={rel - 10} label="swap WETH → USDC · Uniswap Trading API" value={short(ev("swapped")?.txHash, 14, 8)} />
      <Sponsor from={at("repay", "swaps")} to={rel - 10} name="Uniswap" role="Trading API" />
      <LowerThird from={rel + 5} to={at("repay", "desk", 0) - 5} label="release() · fee rights returned" value={short(ev("released")?.txHash, 14, 8)} accent={C.violet} />
      <LowerThird from={at("repay", "reputation")} to={L} label="ERC-8004 · repayment reputation" value={short((ev("erc8004_feedback") ?? ev("erc8004_metadata"))?.txHash, 14, 8) || "written by desk"} />
      <Suffix from={at("repay", "builder") - 15} />
      {stamp > 0 && <div style={{ position: "absolute", inset: 0, boxShadow: `inset 0 0 0 ${(1 - stamp) * 30}px rgba(90,43,179,0.25)`, pointerEvents: "none" }} />}
      <Captions id="repay" />
      <Voice id="repay" />
    </AbsoluteFill>
  );
};

// Real Flynet production records (agent/src/flynet/fixtures, captured 2026-09-19). The live fork agent predates the
// concierge build, so the dine page is drawn here instead of screen-captured.
const VENUES: [string, string, string, string, string][] = [
  ["Casa 13urger", "Bowery · New York, NY", "Burgers", "$", "Fri 12:00–02:30"],
  ["Proper Food", "116 Montgomery St · San Francisco, CA", "American · Sandwiches", "$$", "special: Earn 10X back in Fly"],
  ["Frankies 457 Spuntino", "Carroll Gardens · New York, NY", "Italian", "$$", ""],
  ["Damian", "Arts District · Los Angeles, CA", "Mexican", "$$$$", ""],
];
const Dine: React.FC<{ member: number }> = ({ member }) => {
  const f = useCurrentFrame();
  const h = useSpring(2);
  const m = spring({ frame: f - member, fps: FPS, config: { damping: 16 } });
  return (
    <AbsoluteFill style={{ background: C.desk }}>
      <div style={{ position: "absolute", left: 120, top: 150, opacity: h, transform: `translateY(${(1 - h) * 20}px)` }}>
        <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: 72, color: C.ink, letterSpacing: "-0.02em" }}>Dine on your fees</div>
        <div style={{ fontFamily: SANS, fontSize: 28, color: C.mute, marginTop: 6, maxWidth: 1100 }}>Every loan carries a dining budget. The desk's concierge ranks live Blackbird venues against it.</div>
      </div>
      <div style={{ position: "absolute", left: 120, top: 360, width: 1060, background: C.sheet, border: `1px solid ${C.rule}`, borderRadius: 3, boxShadow: "0 10px 28px -16px rgb(22 24 29 / .35)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "16px 24px", borderBottom: `1px solid ${C.rule}` }}>
          <span style={{ fontFamily: SANS, fontWeight: 700, fontSize: 24, color: C.ink }}>Blackbird venues</span>
          <span style={{ fontFamily: MONO, fontSize: 18, color: C.mute }}>Flynet production · 1,675 venues</span>
        </div>
        {VENUES.map(([n, where, cui, price, note], i) => {
          const s = spring({ frame: f - 14 - i * 6, fps: FPS, config: { damping: 16 } });
          return (
            <div key={n} style={{ display: "flex", alignItems: "baseline", gap: 18, padding: "16px 24px", borderTop: i ? `1px solid ${C.rule}` : "none", opacity: s, transform: `translateX(${(1 - s) * -20}px)` }}>
              <span style={{ fontFamily: MONO, fontSize: 18, color: C.violet, width: 30 }}>{String(i + 1).padStart(2, "0")}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: 28, color: C.ink }}>{n} <span style={{ fontWeight: 400, fontSize: 20, color: C.mute }}>{where}</span></div>
                <div style={{ fontFamily: SANS, fontSize: 19, color: C.mute, marginTop: 2 }}>{cui}{note && <span style={{ color: C.green }}> · {note}</span>}</div>
              </div>
              <span style={{ fontFamily: MONO, fontSize: 22, color: C.ink }}>{price}</span>
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", left: 1230, top: 360, width: 570, display: "grid", gap: 16 }}>
        {[["Concierge", "hours · specials · challenges, ranked against the loan's dining budget"], ["Member", "Blackbird login · passport · save to list"]].map(([k, v], i) => (
          <div key={k} style={{ background: i ? C.violetTint : C.sheet, border: `1px solid ${i ? C.violet : C.rule}`, borderRadius: 3, padding: "20px 24px", opacity: i ? m : h }}>
            <Label style={{ fontSize: 15 }}>{k}</Label>
            <div style={{ fontFamily: SANS, fontSize: 24, color: C.ink, marginTop: 6, lineHeight: 1.3 }}>{v}</div>
          </div>
        ))}
      </div>
      <div style={{ position: "absolute", left: 120, top: 890, fontFamily: MONO, fontSize: 16, color: C.mute }}>venue records: Flynet production API (read scopes approved), captured 2026-09-19</div>
    </AbsoluteFill>
  );
};

const Desk: React.FC = () => {
  const sw = at("desk", "Every", 1);
  const L = sceneLen("desk");
  return (
    <AbsoluteFill>
      <Sequence durationInFrames={sw}>
        <Cam src="desk" start={8} rate={1.1} keys={[[0, 800, 220, 1.35], [80, 960, 480, 1.22], [sw, 960, 560, 1.28]]} />
      </Sequence>
      <Sequence from={sw}>
        <Dine member={at("desk", "Members") - sw} />
      </Sequence>
      <Chapter n="06" title="Follow the Desk · Dine on fees" />
      <Sponsor from={at("desk", "Definitive")} to={sw - 5} name="Definitive" role="Flash bracket / DCA / TWAP" />
      <LowerThird from={at("desk", "placed")} to={sw - 5} label="Flash TWAP · Base mainnet · filled" value={<>order fb3b2572…ac82f<br />fill {short("0x261a1355c4d5c7a1e97aaf398a1eb42f8c8563b5489f68709c2bd7660f3bcab4", 10, 6)} · 0.125 USDC → 2,158 GITLAWB</>} accent={C.green} />
      <Sponsor from={at("desk", "Blackbird")} to={L} name="Blackbird" role="Flynet · approved on production" />
      <LowerThird from={at("desk", "Paying")} to={L} label="status · Blackbird"  value="FLY payments: pending review" accent={C.amber} x={1230} y={170} />
      <Captions id="desk" />
      <Voice id="desk" />
    </AbsoluteFill>
  );
};

const X402: React.FC = () => {
  const f = useCurrentFrame();
  const b = (data as any).x402.body;
  const a = b.accepts?.[0] ?? {};
  const lines: [string, string, boolean?][] = [
    ["HTTP/1.1", "402 Payment Required", true],
    ["x402Version", String(b.x402Version)],
    ["scheme", a.scheme],
    ["network", `${a.network}  (Base)`],
    ["amount", `${a.amount}  = $${(Number(a.amount) / 1e6).toFixed(2)} USDC`, true],
    ["asset", short(a.asset, 10, 6) + "  (USDC)"],
    ["payTo", short(a.payTo, 10, 6)],
    ["resource", (a.resource ?? "").replace("https://", "")],
    ["facilitator", (b.facilitator ?? "").replace("https://", "")],
  ];
  const s = useSpring(4);
  return (
    <AbsoluteFill style={{ background: C.desk }}>
      <div style={{ position: "absolute", left: 120, top: 90, opacity: s }}>
        <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: 60, color: C.ink, letterSpacing: "-0.015em" }}>Paid credit report</div>
        <div style={{ fontFamily: SANS, fontSize: 28, color: C.mute, marginTop: 4 }}>x402 both ways · sells credit reports, buys risk checks</div>
      </div>
      <div style={{ position: "absolute", left: 120, top: 250, width: 1680, background: C.ink, borderRadius: 4, padding: "30px 40px", opacity: s, transform: `translateY(${(1 - s) * 30}px)`, boxShadow: "0 30px 60px -30px rgba(0,0,0,.6)" }}>
        <div style={{ fontFamily: MONO, fontSize: 20, color: "#7d838d", marginBottom: 14 }}>GET x402.bankr.bot/0x0455…9e98/gadai-credit?token=0x5F98…DBa3</div>
        {lines.map(([k, v, hot], i) => {
          const o = interpolate(f, [16 + i * 7, 26 + i * 7], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          return (
            <div key={i} style={{ fontFamily: MONO, fontSize: 30, lineHeight: 1.6, opacity: o, transform: `translateX(${(1 - o) * -12}px)`, display: "flex", gap: 24 }}>
              <span style={{ color: "#9aa0aa", width: 250 }}>{k}</span>
              <span style={{ color: hot ? "#c9b4f5" : "#fcfcfa" }}>{v}</span>
            </div>
          );
        })}
      </div>
      <Sponsor from={at("x402", "x402")} to={sceneLen("x402")} name="Bankr" role="x402 Cloud" top={96} />
      <Sponsor from={at("x402", "Dynamic")} to={sceneLen("x402")} name="Dynamic" role="agent wallet pays" top={170} />
      <LowerThird from={at("x402", "desk") - 5} to={sceneLen("x402")} label="desk paid · third-party risk check · Base mainnet" value={`0.05 USDC · ${short("0x9c22339bffe1f0e424dad6d5ab64d77603176716d95694eb40430d203f98ad00", 10, 6)}`} accent={C.green} x={120} />
      <LowerThird from={at("x402", "honeypot") - 5} to={sceneLen("x402")} label="verdict → underwriter" value="HONEYPOT declines · SUSPICIOUS halves" x={1000} />
      <Captions id="x402" />
      <Voice id="x402" />
    </AbsoluteFill>
  );
};

// Base mainnet receipts (read from mainnet.base.org, 2026-09-19; see docs/EVIDENCE.md)
const DESK_WALLET = "0x81b73786BF2dE819e66BB57d08effADe0085305D";
const TXS: { k: string; title: string; hash: string; block: number; time: string; rows: [string, string][] }[] = [
  { k: "FeeDesk", title: "FeeDesk deployed", hash: "0x21cce9322a7ceb0a1af4225973d9ad3969c298a5594d7f71a7f7689c233ee858", block: 51521161, time: "15:27:49", rows: [["From", `${short(DESK_WALLET, 8, 6)} · Dynamic agent wallet`], ["Contract created", short("0xa4f21ace41923bccfdebf1c6ab49659d80476b4f", 10, 8)]] },
  { k: "ERC-8004", title: "ERC-8004 register → agent #94699", hash: "0xde4b3490940e7bc064c3511c7843eab20f16f1419e456185e35a7690966229cb", block: 51521164, time: "15:27:55", rows: [["To", `${short("0x8004a169fb4a3325136eb29fa0ceb6d2e539a432", 8, 6)} · Identity Registry`], ["Minted", `agentId 94699 → ${short(DESK_WALLET, 8, 6)}`]] },
  { k: "x402", title: "x402 risk check paid", hash: "0x9c22339bffe1f0e424dad6d5ab64d77603176716d95694eb40430d203f98ad00", block: 51521178, time: "15:28:23", rows: [["Transfer", `0.05 USDC from ${short(DESK_WALLET, 8, 6)}`], ["Auth", "EIP-3009 · Dynamic MPC · Bankr facilitator"]] },
  { k: "Flash", title: "Definitive Flash TWAP fill", hash: "0x261a1355c4d5c7a1e97aaf398a1eb42f8c8563b5489f68709c2bd7660f3bcab4", block: 51521408, time: "15:36:03", rows: [["Order", "fb3b2572-48c6-4ce5-b79a-6199cefac82f"], ["Swap", "0.125 USDC → 2,158.27 GITLAWB"]] },
];
const Mainnet: React.FC = () => {
  const f = useCurrentFrame();
  const h = useSpring(2);
  return (
    <AbsoluteFill style={{ background: C.desk }}>
      <div style={{ position: "absolute", left: 120, top: 70, opacity: h, transform: `translateY(${(1 - h) * 20}px)` }}>
        <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: 60, color: C.ink, letterSpacing: "-0.015em" }}>Mainnet evidence</div>
        <div style={{ fontFamily: SANS, fontSize: 26, color: C.mute, marginTop: 4 }}>Base mainnet (8453) · signed by the desk's Dynamic agent wallet · 2026-09-19 UTC</div>
      </div>
      <div style={{ position: "absolute", left: 120, top: 220, width: 1680, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        {TXS.map((x) => {
          const s = spring({ frame: f - (at("mainnet", x.k) - 8), fps: FPS, config: { damping: 16 } });
          return (
            <div key={x.k} style={{ background: C.sheet, border: `1px solid ${C.rule}`, borderRadius: 6, opacity: s, transform: `translateY(${(1 - s) * 24}px)`, boxShadow: "0 10px 28px -16px rgb(22 24 29 / .35)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 22px", borderBottom: `1px solid ${C.rule}` }}>
                <span style={{ fontFamily: SANS, fontWeight: 700, fontSize: 25, color: C.ink }}>{x.title}</span>
                <span style={{ fontFamily: SANS, fontWeight: 600, fontSize: 16, color: C.green, background: "#e3f1e8", border: `1px solid ${C.green}`, borderRadius: 4, padding: "3px 10px" }}>✓ Success</span>
              </div>
              <div style={{ padding: "12px 22px 16px", display: "grid", gridTemplateColumns: "180px 1fr", rowGap: 8, fontSize: 19 }}>
                {([["Transaction hash", short(x.hash, 18, 10)], ["Block", `${x.block.toLocaleString("en-US")} · ${x.time} UTC`], ...x.rows] as [string, string][]).map(([k, v]) => (
                  <React.Fragment key={k}>
                    <span style={{ fontFamily: SANS, color: C.mute }}>{k}</span>
                    <span style={{ fontFamily: MONO, color: k === "Transaction hash" ? C.violet : C.ink }}>{v}</span>
                  </React.Fragment>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", left: 120, top: 800, fontFamily: MONO, fontSize: 18, color: C.mute, opacity: interpolate(f, [at("mainnet", "Every"), at("mainnet", "Every") + 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
        basescan.org/tx/&lt;hash&gt; · FeeDesk {short("0xa4f21ace41923bccfdebf1c6ab49659d80476b4f", 10, 8)} · full list in docs/EVIDENCE.md
      </div>
      <Captions id="mainnet" />
      <Voice id="mainnet" />
    </AbsoluteFill>
  );
};

const Close: React.FC = () => {
  const f = useCurrentFrame();
  const tiles: [string, string][] = [
    ["Bankr", "fee API · LLM Gateway · x402 Cloud · skill"],
    ["Dynamic", "agent wallet signs every desk tx"],
    ["Uniswap", "CCA for FeeNotes · Trading API swaps"],
    ["Definitive", "Flash TWAP filled on mainnet · bracket / DCA mirrors"],
    ["Blackbird", "Flynet dining concierge · live venues"],
    ["Base", "chain · ERC-8021 builder code"],
    ["ERC-8004", "desk agent #94699 · repayment reputation"],
    ["x402", "$0.02 credit report · $0.05 risk check paid"],
  ];
  const h = useSpring(4);
  return (
    <AbsoluteFill style={{ background: C.desk }}>
      <div style={{ position: "absolute", left: 120, top: 90, opacity: h }}>
        <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: 96, color: C.ink, letterSpacing: "-0.02em" }}>Gadai</div>
        <div style={{ fontFamily: SANS, fontSize: 34, color: C.mute }}>Credit for agents, secured by the fees they already earn.</div>
      </div>
      <div style={{ position: "absolute", left: 120, top: 330, width: 1680, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1, background: C.rule, border: `1px solid ${C.rule}` }}>
        {tiles.map(([n, d], i) => {
          const s = spring({ frame: f - 14 - i * 5, fps: FPS, config: { damping: 16 } });
          return (
            <div key={n} style={{ background: C.sheet, padding: "26px 26px 28px", opacity: s, transform: `translateY(${(1 - s) * 20}px)` }}>
              <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: 34, color: C.ink }}>{n}</div>
              <div style={{ fontFamily: SANS, fontSize: 21, color: C.mute, marginTop: 6, lineHeight: 1.35 }}>{d}</div>
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", left: 120, top: 700, display: "flex", gap: 48, opacity: interpolate(f, [60, 80], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
        <span style={{ fontFamily: MONO, fontSize: 34, color: C.violet }}>gadai-six.vercel.app</span>
        <span style={{ fontFamily: MONO, fontSize: 34, color: C.ink }}>github.com/PugarHuda/gadai</span>
      </div>
      <div style={{ position: "absolute", left: 120, top: 780, fontFamily: SANS, fontSize: 20, color: C.mute, opacity: interpolate(f, [80, 100], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
        The loan lifecycle runs on an Anvil fork of Base against real Bankr pools; mainnet transactions are listed in docs/EVIDENCE.md. Numbers on screen were read live from the Gadai agent on {String((data as any).capturedAt).slice(0, 10)}.
      </div>
      <Captions id="close" />
      <Voice id="close" />
    </AbsoluteFill>
  );
};

const SCENES: [string, React.FC][] = [["open", Open], ["idea", Idea], ["board", Board], ["apply", Apply], ["pledge", Pledge], ["cca", Cca], ["repay", Repay], ["desk", Desk], ["x402", X402], ["mainnet", Mainnet], ["close", Close]];
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
    <Audio src={staticFile("pad.m4a")} volume={0.1} />
  </AbsoluteFill>
);
