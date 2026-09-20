/**
 * Gadai slide deck for Remotion — 1920x1080, 30fps.
 *
 * Content (every number, every claim) lives in web/components/deck-content.ts, which the /deck
 * web page imports too, so the deck and the site can never drift. This file is only the drawing.
 *
 * Use from the main video:
 *   import { SLIDES, DeckSlide } from "./deck/Deck";
 *   <TransitionSeries.Sequence durationInFrames={SLIDES[0].durationInFrames}><DeckSlide id="title" /></TransitionSeries.Sequence>
 * or pull one component out: `SLIDES.find((s) => s.id === "board")!.Component`.
 *
 * Stills / preview without touching video/src/Root.tsx:
 *   npx remotion still src/deck/index.ts Slide-board out/board.png
 */
import React from "react";
import { AbsoluteFill, Easing, Series, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont as loadArchivo } from "@remotion/google-fonts/Archivo";
import { loadFont as loadMono } from "@remotion/google-fonts/ChivoMono";
import { SLIDES as CONTENT, TOTAL_FRAMES, type Slide, type Tone } from "../../../web/components/deck-content";

const { fontFamily: SANS } = loadArchivo("normal", { weights: ["400", "600", "700", "800"], subsets: ["latin"] });
const { fontFamily: MONO } = loadMono("normal", { weights: ["400", "500"], subsets: ["latin"] });

// web/DESIGN.md tokens, same set the main video uses.
const C = {
  desk: "#e5e8e3",
  sheet: "#fcfcfa",
  ink: "#16181d",
  mute: "#545a64",
  rule: "#c4c9cf",
  violet: "#5a2bb3",
  violetTint: "#efe9fa",
  green: "#16683b",
  greenTint: "#e3f1e8",
  amber: "#e3a32b",
  amberInk: "#7a4b00",
  amberTint: "#fbf1dc",
  red: "#b42318",
};
const TONE: Record<Tone, { line: string; fill: string; ink: string }> = {
  plain: { line: C.rule, fill: C.sheet, ink: C.ink },
  violet: { line: C.violet, fill: C.violetTint, ink: C.violet },
  green: { line: C.green, fill: C.greenTint, ink: C.green },
  amber: { line: C.amber, fill: C.amberTint, ink: C.amberInk },
  red: { line: C.red, fill: "#fbeae8", ink: C.red },
};

const PAD = 110;
const ease = Easing.bezier(0.22, 1, 0.36, 1);

const useRise = (delay = 0, damping = 17) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping, stiffness: 120, mass: 0.9 } });
};
/** opacity + lift, the deck's one entrance move */
const rise = (s: number, px = 26) => ({ opacity: s, transform: `translateY(${(1 - s) * px}px)` });

/** A violet band that crosses a row once as it lands, then leaves. */
const Sweep: React.FC<{ from: number }> = ({ from }) => {
  const x = interpolate(useCurrentFrame(), [from, from + 30], [-50, 110], { easing: ease, extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  if (x >= 110) return null;
  return <div style={{ position: "absolute", top: 0, bottom: 0, left: `${x}%`, width: "42%", background: `linear-gradient(90deg, rgba(90,43,179,0), ${C.violetTint}, rgba(90,43,179,0))`, pointerEvents: "none" }} />;
};

const Caption: React.FC<{ children: React.ReactNode; color?: string; size?: number }> = ({ children, color = C.mute, size = 17 }) => (
  <div style={{ fontFamily: SANS, fontSize: size, fontWeight: 600, letterSpacing: "0.09em", textTransform: "uppercase", color }}>{children}</div>
);

/** Counts a leading number up, keeping whatever prefix/suffix the content wrote ("593.16 WETH", "$755.31", "18.6B"). */
const Num: React.FC<{ text: string; from: number }> = ({ text, from }) => {
  const frame = useCurrentFrame();
  const m = /^([^\d-]*)(-?[\d,]*\.?\d+)(.*)$/s.exec(text);
  if (!m) return <>{text}</>;
  const [, pre, raw, post] = m;
  const target = Number(raw.replace(/,/g, ""));
  const dec = raw.includes(".") ? raw.split(".")[1].length : 0;
  const k = interpolate(frame, [from, from + 40], [0, 1], { easing: Easing.out(Easing.cubic), extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <>
      {pre}
      {(target * k).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec })}
      {post}
    </>
  );
};

const Header: React.FC<{ slide: Slide }> = ({ slide }) => {
  const a = useRise(2);
  const b = useRise(8);
  return (
    <div style={{ position: "absolute", left: PAD, right: PAD, top: 82 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, ...rise(a, 14) }}>
        <div style={{ width: 54, height: 5, background: C.violet, borderRadius: 2 }} />
        <Caption color={C.violet}>{slide.title}</Caption>
      </div>
      <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: 64, lineHeight: 1.05, letterSpacing: "-0.02em", color: C.ink, marginTop: 16, maxWidth: 1580, ...rise(a) }}>{slide.headline}</div>
      {slide.sub && <div style={{ fontFamily: SANS, fontSize: 29, lineHeight: 1.35, color: C.mute, marginTop: 14, maxWidth: 1500, ...rise(b, 18) }}>{slide.sub}</div>}
    </div>
  );
};

const Footnote: React.FC<{ slide: Slide }> = ({ slide }) => {
  const s = useRise(34);
  if (!slide.footnote) return null;
  return (
    <div style={{ position: "absolute", left: PAD, right: PAD, bottom: 56, borderTop: `1px solid ${C.rule}`, paddingTop: 14, fontFamily: MONO, fontSize: 19, color: C.mute, opacity: s }}>{slide.footnote}</div>
  );
};

const Frame: React.FC<{ slide: Slide; children: React.ReactNode; bare?: boolean }> = ({ slide, children, bare }) => (
  <AbsoluteFill style={{ background: C.desk }}>
    {!bare && <Header slide={slide} />}
    {children}
    <Footnote slide={slide} />
  </AbsoluteFill>
);

// ---------- layouts ----------

const TitleSlide: React.FC<{ slide: Slide }> = ({ slide }) => {
  const a = useRise(3, 15);
  const b = useRise(14);
  const c = useRise(26);
  const sweep = interpolate(useCurrentFrame(), [10, 42], [0, 1], { easing: ease, extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  if (slide.kind !== "title") return null;
  return (
    <Frame slide={slide} bare>
      <div style={{ position: "absolute", left: PAD, top: 292 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 34, ...rise(a, 34) }}>
          <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: 178, lineHeight: 0.92, letterSpacing: "-0.035em", color: C.ink }}>{slide.headline}</div>
          <div style={{ fontFamily: SANS, fontSize: 32, color: C.mute, paddingBottom: 22 }}>{slide.sub}</div>
        </div>
        <div style={{ width: 1700 * sweep, height: 5, background: C.violet, marginTop: 34, borderRadius: 2 }} />
        <div style={{ fontFamily: SANS, fontSize: 44, lineHeight: 1.28, color: C.ink, marginTop: 40, maxWidth: 1420, ...rise(b, 22) }}>{slide.lead}</div>
        <div style={{ display: "flex", gap: 16, marginTop: 54, ...rise(c, 18) }}>
          {slide.chips.map(([k, v]) => (
            <div key={k} style={{ background: C.sheet, border: `1px solid ${C.rule}`, borderRadius: 3, padding: "14px 22px 16px" }}>
              <Caption size={15}>{k}</Caption>
              <div style={{ fontFamily: MONO, fontSize: 26, color: C.ink, marginTop: 6 }}>{v}</div>
            </div>
          ))}
        </div>
      </div>
      <Footnote slide={slide} />
    </Frame>
  );
};

const StatsSlide: React.FC<{ slide: Slide }> = ({ slide }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (slide.kind !== "stats") return null;
  const punch = spring({ frame: frame - 70, fps, config: { damping: 18 } });
  return (
    <Frame slide={slide}>
      <div style={{ position: "absolute", left: PAD, right: PAD, top: 330, display: "grid", gridTemplateColumns: `repeat(${slide.stats.length}, 1fr)`, gap: 1, background: C.rule, border: `1px solid ${C.rule}`, borderRadius: 3 }}>
        {slide.stats.map((st, i) => {
          const d = 12 + i * 8;
          const s = spring({ frame: frame - d, fps, config: { damping: 17, stiffness: 120 } });
          return (
            <div key={st.label} style={{ background: C.sheet, padding: "28px 30px 32px", ...rise(s, 22) }}>
              <Caption size={16}>{st.label}</Caption>
              {/* one line, whatever the unit: long values step down instead of wrapping */}
              <div style={{ fontFamily: MONO, fontSize: st.value.length > 10 ? 46 : st.value.length > 7 ? 54 : 62, lineHeight: 1, height: 68, display: "flex", alignItems: "center", color: C.ink, marginTop: 16, whiteSpace: "nowrap" }}>
                <Num text={st.value} from={d + 4} />
              </div>
              <div style={{ fontFamily: SANS, fontSize: 20, color: C.mute, marginTop: 14, lineHeight: 1.3 }}>{st.source}</div>
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", left: PAD, right: PAD, top: 648, background: C.violetTint, borderLeft: `6px solid ${C.violet}`, borderRadius: 3, padding: "30px 38px", ...rise(punch, 20) }}>
        <div style={{ fontFamily: SANS, fontSize: 34, lineHeight: 1.32, color: C.ink, fontWeight: 600 }}>{slide.punch}</div>
      </div>
    </Frame>
  );
};

const DiagramSlide: React.FC<{ slide: Slide }> = ({ slide }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (slide.kind !== "diagram") return null;
  const n = slide.nodes.length;
  const gap = 44;
  const W = Math.floor((1920 - PAD * 2 - gap * (n - 1)) / n);
  const H = 196;
  const TOP = 380;
  const at = (i: number) => 26 + i * 16;
  const loopIn = 26 + n * 16 + 10;
  const loopS = spring({ frame: frame - loopIn, fps, config: { damping: 18 } });
  const loopDraw = interpolate(frame, [loopIn, loopIn + 30], [1, 0], { easing: ease, extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const lastX = PAD + (n - 1) * (W + gap) + W / 2;
  const firstX = PAD + W / 2;
  return (
    <Frame slide={slide}>
      <svg width={1920} height={1080} style={{ position: "absolute", left: 0, top: 0 }}>
        <defs>
          <marker id="dk-ar" markerWidth="11" markerHeight="11" refX="9" refY="5.5" orient="auto">
            <path d="M0 0 L11 5.5 L0 11 z" fill={C.ink} />
          </marker>
          <marker id="dk-arv" markerWidth="11" markerHeight="11" refX="9" refY="5.5" orient="auto">
            <path d="M0 0 L11 5.5 L0 11 z" fill={C.violet} />
          </marker>
        </defs>
        {slide.nodes.slice(1).map((_, i) => {
          const x0 = PAD + i * (W + gap) + W;
          const d = interpolate(frame, [at(i + 1) - 8, at(i + 1) + 14], [1, 0], { easing: ease, extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          return <path key={i} d={`M${x0 + 4} ${TOP + H / 2} L${x0 + gap - 6} ${TOP + H / 2}`} stroke={C.ink} strokeWidth={3} fill="none" pathLength={1} strokeDasharray={1} strokeDashoffset={d} markerEnd={d < 0.05 ? "url(#dk-ar)" : undefined} />;
        })}
        <path
          d={`M${lastX} ${TOP + H + 8} C ${lastX} ${TOP + H + 150}, ${firstX} ${TOP + H + 150}, ${firstX} ${TOP + H + 10}`}
          stroke={C.violet}
          strokeWidth={3.5}
          fill="none"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={loopDraw}
          markerEnd={loopDraw < 0.05 ? "url(#dk-arv)" : undefined}
        />
      </svg>
      {slide.nodes.map((node, i) => {
        const s = spring({ frame: frame - at(i), fps, config: { damping: 15, stiffness: 135 } });
        return (
          <div
            key={node.t}
            style={{
              position: "absolute",
              left: PAD + i * (W + gap),
              top: TOP,
              width: W,
              height: H,
              boxSizing: "border-box",
              background: node.hot ? C.violetTint : C.sheet,
              border: `${node.hot ? 3 : 1}px solid ${node.hot ? C.violet : C.rule}`,
              borderRadius: 3,
              padding: "24px 26px",
              boxShadow: "0 1px 2px rgb(22 24 29 / .06), 0 10px 28px -16px rgb(22 24 29 / .28)",
              opacity: s,
              transform: `scale(${0.92 + 0.08 * s})`,
            }}
          >
            <div style={{ fontFamily: MONO, fontSize: 18, color: C.violet }}>{String(i + 1).padStart(2, "0")}</div>
            <div style={{ fontFamily: node.mono ? MONO : SANS, fontWeight: node.mono ? 500 : 700, fontSize: node.mono ? 27 : 32, lineHeight: 1.12, color: C.ink, marginTop: 10 }}>{node.t}</div>
            <div style={{ fontFamily: SANS, fontSize: 21, color: C.mute, marginTop: 8, lineHeight: 1.25 }}>{node.s}</div>
          </div>
        );
      })}
      <div style={{ position: "absolute", left: 0, right: 0, top: TOP + H + 158, display: "flex", justifyContent: "center", ...rise(loopS, 14) }}>
        <div style={{ background: C.sheet, border: `2px solid ${C.violet}`, borderRadius: 3, padding: "14px 26px", fontFamily: MONO, fontSize: 25, color: C.violet }}>{slide.loop}</div>
      </div>
    </Frame>
  );
};

const StepsSlide: React.FC<{ slide: Slide }> = ({ slide }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (slide.kind !== "steps") return null;
  return (
    <Frame slide={slide}>
      <div style={{ position: "absolute", left: PAD, right: PAD, top: 350, display: "grid", gap: 1, background: C.rule, border: `1px solid ${C.rule}`, borderRadius: 3 }}>
        {slide.steps.map((st, i) => {
          const d = 14 + i * 9;
          const s = spring({ frame: frame - d, fps, config: { damping: 17, stiffness: 125 } });
          return (
            <div key={st.t} style={{ position: "relative", background: C.sheet, display: "flex", alignItems: "flex-start", gap: 30, padding: "24px 32px", opacity: s, transform: `translateX(${(1 - s) * -26}px)`, overflow: "hidden" }}>
              <Sweep from={d} />
              <div style={{ position: "relative", width: 52, height: 52, borderRadius: 26, border: `2px solid ${C.violet}`, color: C.violet, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: MONO, fontSize: 25, flexShrink: 0, background: C.sheet }}>{i + 1}</div>
              <div style={{ position: "relative", width: 300, flexShrink: 0, fontFamily: SANS, fontWeight: 800, fontSize: 36, color: C.ink, lineHeight: 1.15 }}>{st.t}</div>
              <div style={{ position: "relative", flex: 1, fontFamily: SANS, fontSize: 25, color: C.ink, lineHeight: 1.36 }}>{st.s}</div>
              <div style={{ position: "relative", flexShrink: 0, alignSelf: "center", fontFamily: MONO, fontSize: 19, color: C.violet, border: `1.5px solid ${C.violet}`, borderRadius: 2, padding: "5px 12px", background: C.sheet }}>{st.tag}</div>
            </div>
          );
        })}
      </div>
    </Frame>
  );
};

const CardsSlide: React.FC<{ slide: Slide }> = ({ slide }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (slide.kind !== "cards") return null;
  return (
    <Frame slide={slide}>
      <div style={{ position: "absolute", left: PAD, right: PAD, top: 372, bottom: 132, display: "grid", gridTemplateColumns: `repeat(${slide.cards.length}, 1fr)`, gap: 26 }}>
        {slide.cards.map((card, i) => {
          const d = 16 + i * 10;
          const s = spring({ frame: frame - d, fps, config: { damping: 17, stiffness: 120 } });
          const t = TONE[card.tone ?? "plain"];
          return (
            <div key={card.title} style={{ background: C.sheet, border: `1px solid ${C.rule}`, borderTop: `5px solid ${t.line}`, borderRadius: 3, padding: "26px 28px 24px", display: "flex", flexDirection: "column", boxShadow: "0 1px 2px rgb(22 24 29 / .06), 0 10px 28px -16px rgb(22 24 29 / .28)", ...rise(s, 26) }}>
              <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: 34, color: t.ink, lineHeight: 1.1 }}>{card.title}</div>
              <div style={{ fontFamily: SANS, fontSize: 23, color: C.mute, lineHeight: 1.4, marginTop: 12 }}>{card.lead}</div>
              <div style={{ marginTop: "auto", paddingTop: 22 }}>
                <div style={{ display: "grid", gap: 1, background: C.rule, border: `1px solid ${C.rule}`, borderRadius: 3 }}>
                  {card.rows.map(([k, v], j) => {
                    const rs = spring({ frame: frame - (d + 12 + j * 5), fps, config: { damping: 18 } });
                    return (
                      <div key={k} style={{ background: j === 0 ? t.fill : C.sheet, display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 14, padding: "11px 16px", opacity: rs }}>
                        <span style={{ fontFamily: SANS, fontSize: 19, fontWeight: 600, color: C.mute, flexShrink: 0 }}>{k}</span>
                        <span style={{ fontFamily: MONO, fontSize: 20, color: j === 0 ? t.ink : C.ink, textAlign: "right", lineHeight: 1.25 }}>{v}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Frame>
  );
};

const RowsSlide: React.FC<{ slide: Slide }> = ({ slide }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const head = useRise(12);
  if (slide.kind !== "rows") return null;
  const mono = slide.mono ?? [];
  const cols = `${slide.widths.map((w) => `${w}fr`).join(" ")}`;
  // the table shares 1080 with a header, an optional strip and a footnote: tighten as rows are added
  const pad = slide.rows.length >= 8 ? 11 : slide.rows.length >= 6 ? 14 : 18;
  const size = slide.rows.length >= 8 ? 23 : 24;
  const stripIn = 22 + slide.rows.length * 7 + 8;
  const strip = spring({ frame: frame - stripIn, fps, config: { damping: 18 } });
  return (
    <Frame slide={slide}>
      <div style={{ position: "absolute", left: PAD, right: PAD, top: 336 }}>
        <div style={{ display: "grid", gridTemplateColumns: cols, gap: 24, borderBottom: `2px solid ${C.ink}`, padding: "0 12px 10px", ...rise(head, 12) }}>
          {slide.cols.map((c) => (
            <Caption key={c} size={17}>
              {c}
            </Caption>
          ))}
        </div>
        {slide.rows.map((r, i) => {
          const d = 22 + i * 7;
          const s = spring({ frame: frame - d, fps, config: { damping: 18, stiffness: 130 } });
          const t = TONE[r.tone ?? "plain"];
          return (
            <div key={i} style={{ position: "relative", background: r.tone ? t.fill : "transparent", borderBottom: `1px solid ${C.rule}`, overflow: "hidden", opacity: s, transform: `translateX(${(1 - s) * -18}px)` }}>
              <Sweep from={d} />
              <div style={{ position: "relative", display: "grid", gridTemplateColumns: cols, gap: 24, alignItems: "baseline", padding: `${pad}px 12px ${pad}px 12px` }}>
                {r.cells.map((cell, j) => (
                  <span
                    key={j}
                    style={{
                      fontFamily: mono.includes(j) ? MONO : SANS,
                      fontSize: mono.includes(j) ? size - 1 : size,
                      fontWeight: j === 0 && !mono.includes(0) ? 700 : 400,
                      color: j === 0 ? (r.tone ? t.ink : C.ink) : j === slide.cols.length - 1 && r.tone ? t.ink : C.mute,
                      lineHeight: 1.3,
                    }}
                  >
                    {cell}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {slide.strip && (
        <div style={{ position: "absolute", left: PAD, right: PAD, bottom: 122, display: "grid", gridTemplateColumns: `repeat(${slide.strip.length}, 1fr)`, gap: 1, background: C.rule, border: `1px solid ${C.rule}`, borderRadius: 3, ...rise(strip, 18) }}>
          {slide.strip.map(([k, v]) => (
            <div key={k} style={{ background: C.sheet, padding: "16px 20px 18px" }}>
              <Caption size={15}>{k}</Caption>
              <div style={{ fontFamily: MONO, fontSize: v.length > 18 ? 21 : v.length > 13 ? 24 : 28, color: C.ink, marginTop: 8, whiteSpace: "nowrap" }}>{v}</div>
            </div>
          ))}
        </div>
      )}
    </Frame>
  );
};

const LAYOUTS: Record<Slide["kind"], React.FC<{ slide: Slide }>> = {
  title: TitleSlide,
  stats: StatsSlide,
  diagram: DiagramSlide,
  steps: StepsSlide,
  cards: CardsSlide,
  rows: RowsSlide,
};

/** One slide by id. The video can drop this straight into a TransitionSeries.Sequence. */
export const DeckSlide: React.FC<{ id: string }> = ({ id }) => {
  const slide = CONTENT.find((s) => s.id === id);
  if (!slide) throw new Error(`No deck slide "${id}" (have: ${CONTENT.map((s) => s.id).join(", ")})`);
  const Layout = LAYOUTS[slide.kind];
  return <Layout slide={slide} />;
};

export type DeckSlideEntry = { id: string; title: string; durationInFrames: number; notes: string; Component: React.FC };

/** id, title, durationInFrames, notes + a ready component, in presentation order. */
export const SLIDES: DeckSlideEntry[] = CONTENT.map((s) => ({
  id: s.id,
  title: s.title,
  durationInFrames: s.durationInFrames,
  notes: s.notes,
  Component: () => <DeckSlide id={s.id} />,
}));

export const deckTotalFrames = TOTAL_FRAMES;

/** The whole deck back to back, for review and for a standalone render. */
export const Deck: React.FC = () => (
  <AbsoluteFill style={{ background: C.desk }}>
    <Series>
      {SLIDES.map((s) => (
        <Series.Sequence key={s.id} durationInFrames={s.durationInFrames}>
          <s.Component />
        </Series.Sequence>
      ))}
    </Series>
  </AbsoluteFill>
);
