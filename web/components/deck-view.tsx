"use client";

/**
 * The /deck presentation. Same content and same visual world as the Remotion deck in
 * video/src/deck/Deck.tsx — both read web/components/deck-content.ts, so no number is written twice.
 * One slide per viewport, arrow keys / swipe / click to move.
 *
 * It renders as a fixed overlay so it can be full-bleed without touching the shared app layout.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { SLIDES, type Slide, type Tone } from "./deck-content";

const TONE_FILL: Record<Tone, string> = {
  plain: "bg-paper",
  violet: "bg-violet-tint",
  green: "bg-desk/10",
  amber: "bg-amber/15",
  red: "bg-stamp/10",
};
const TONE_EDGE: Record<Tone, string> = {
  plain: "border-t-rule",
  violet: "border-t-violet",
  green: "border-t-desk",
  amber: "border-t-amber",
  red: "border-t-stamp",
};
const TONE_TEXT: Record<Tone, string> = { plain: "text-ink", violet: "text-violet", green: "text-desk", amber: "text-amber-ink", red: "text-stamp" };

/** Entrance: nth child lands a beat after the one before it. Reduced motion kills it in globals.css. */
const step = (i: number) => ({ animationDelay: `${60 + i * 70}ms` });

function Head({ s }: { s: Slide }) {
  return (
    <header className="dk-in">
      <p className="label flex items-center gap-3 text-violet">
        <span aria-hidden className="inline-block h-[3px] w-8 shrink-0 bg-violet" />
        {s.title}
      </p>
      <h2 className="font-display mt-3 text-[clamp(1.6rem,4.4vw,3.1rem)] leading-[1.06]">{s.headline}</h2>
      {s.sub && <p className="mt-3 max-w-[72ch] text-[clamp(0.95rem,1.6vw,1.3rem)] leading-snug text-mute">{s.sub}</p>}
    </header>
  );
}

function Body({ s }: { s: Slide }) {
  switch (s.kind) {
    case "title":
      return (
        <div className="flex flex-1 flex-col justify-center">
          <div className="dk-in flex flex-wrap items-end gap-x-6 gap-y-1">
            <h2 className="font-display text-[clamp(3.4rem,13vw,9rem)] leading-[0.9] tracking-[-0.035em]">{s.headline}</h2>
            <p className="pb-2 text-[clamp(0.95rem,2vw,1.6rem)] text-mute">{s.sub}</p>
          </div>
          <div className="dk-grow mt-5 h-[4px] origin-left bg-violet" />
          <p className="dk-in mt-7 max-w-[26ch] text-[clamp(1.15rem,3.2vw,2.5rem)] leading-[1.25] sm:max-w-[34ch]" style={step(1)}>
            {s.lead}
          </p>
          <dl className="mt-8 flex flex-wrap gap-3">
            {s.chips.map(([k, v], i) => (
              <div key={k} className="dk-in box px-4 py-3" style={step(2 + i)}>
                <dt className="label">{k}</dt>
                <dd className="num mt-1 text-[clamp(0.9rem,1.7vw,1.35rem)]">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      );

    case "stats":
      return (
        <div className="flex flex-1 flex-col justify-center gap-7 py-6">
          <dl className="grid gap-px border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-4">
            {s.stats.map((st, i) => (
              <div key={st.label} className="dk-in bg-paper p-4 sm:p-5" style={step(i)}>
                <dt className="label">{st.label}</dt>
                <dd className="num mt-2 text-[clamp(1.5rem,3.4vw,2.9rem)] leading-none whitespace-nowrap">{st.value}</dd>
                <p className="mt-3 text-sm leading-snug text-mute">{st.source}</p>
              </div>
            ))}
          </dl>
          <p className="dk-in border-l-[5px] border-violet bg-violet-tint px-5 py-4 text-[clamp(1rem,2vw,1.6rem)] leading-snug font-semibold" style={step(s.stats.length)}>
            {s.punch}
          </p>
        </div>
      );

    case "diagram":
      return (
        <div className="flex flex-1 flex-col justify-center gap-6 py-6">
          <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {s.nodes.map((n, i) => (
              <li
                key={n.t}
                className={`dk-in card flex flex-col p-4 ${n.hot ? "border-violet border-2 bg-violet-tint" : ""}`}
                style={step(i)}
              >
                <span className="num text-xs text-violet">{String(i + 1).padStart(2, "0")}</span>
                <span className={`mt-2 text-[clamp(1rem,1.9vw,1.5rem)] leading-tight font-bold ${n.mono ? "num font-medium" : ""}`}>{n.t}</span>
                <span className="mt-1 text-sm leading-snug text-mute">{n.s}</span>
              </li>
            ))}
          </ol>
          <p className="dk-in num self-start border-2 border-violet px-4 py-2 text-[clamp(0.8rem,1.5vw,1.15rem)] text-violet" style={step(s.nodes.length)}>
            ↩ {s.loop}
          </p>
        </div>
      );

    case "steps":
      return (
        <ol className="my-auto grid gap-px border border-rule bg-rule">
          {s.steps.map((st, i) => (
            <li key={st.t} className="dk-in relative flex flex-wrap items-baseline gap-x-5 gap-y-1 overflow-hidden bg-paper px-4 py-3 md:px-5" style={step(i)}>
              <span aria-hidden className="dk-sweep" />
              <span className="num relative flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-violet text-sm text-violet">{i + 1}</span>
              <span className="relative w-[7.5rem] shrink-0 text-[clamp(1rem,1.9vw,1.55rem)] font-extrabold">{st.t}</span>
              <span className="relative min-w-[16rem] flex-1 text-[clamp(0.85rem,1.4vw,1.15rem)] leading-snug">{st.s}</span>
              <span className="num relative shrink-0 border border-violet px-2 py-0.5 text-xs text-violet">{st.tag}</span>
            </li>
          ))}
        </ol>
      );

    case "cards":
      return (
        <div className="my-auto grid gap-4 lg:grid-cols-3">
          {s.cards.map((c, i) => {
            const t = c.tone ?? "plain";
            return (
              <section key={c.title} className={`dk-in card flex flex-col border-t-4 p-4 sm:p-5 ${TONE_EDGE[t]}`} style={step(i)}>
                <h3 className={`text-[clamp(1.05rem,2vw,1.6rem)] leading-tight font-extrabold ${TONE_TEXT[t]}`}>{c.title}</h3>
                <p className="mt-2 text-[clamp(0.85rem,1.3vw,1.05rem)] leading-snug text-mute">{c.lead}</p>
                <dl className="mt-auto grid gap-px border border-rule bg-rule">
                  {c.rows.map(([k, v], j) => (
                    <div key={k} className={`flex flex-wrap items-baseline justify-between gap-x-3 px-3 py-2 ${j === 0 ? TONE_FILL[t] : "bg-paper"}`}>
                      <dt className="text-sm font-semibold text-mute">{k}</dt>
                      <dd className={`num text-right text-sm leading-snug ${j === 0 ? TONE_TEXT[t] : "text-ink"}`}>{v}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            );
          })}
        </div>
      );

    case "rows": {
      const cols = s.widths.map((w) => `${w}fr`).join(" ");
      const mono = s.mono ?? [];
      return (
        <div className="my-auto flex flex-col gap-5" style={{ ["--dk-cols" as string]: cols }}>
          <div>
            <div className="hidden gap-5 border-b-2 border-ink pb-2 md:grid md:[grid-template-columns:var(--dk-cols)]">
              {s.cols.map((c) => (
                <span key={c} className="label">
                  {c}
                </span>
              ))}
            </div>
            {s.rows.map((r, i) => {
              const t = r.tone ?? "plain";
              return (
                <div key={i} className={`dk-in relative overflow-hidden border-b border-rule ${r.tone ? TONE_FILL[t] : ""}`} style={step(i)}>
                  <span aria-hidden className="dk-sweep" />
                  <div className="relative grid grid-cols-1 gap-x-5 gap-y-0.5 px-2 py-2.5 md:gap-5 md:[grid-template-columns:var(--dk-cols)]">
                    {r.cells.map((cell, j) => (
                      <span key={j} className="min-w-0">
                        <span className="label mr-2 md:hidden">{s.cols[j]}</span>
                        <span
                          className={`${mono.includes(j) ? "num" : ""} text-[clamp(0.82rem,1.25vw,1.05rem)] leading-snug ${
                            j === 0 ? `font-bold ${r.tone ? TONE_TEXT[t] : "text-ink"}` : j === s.cols.length - 1 && r.tone ? TONE_TEXT[t] : "text-mute"
                          }`}
                        >
                          {cell}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          {s.strip && (
            <dl className="grid gap-px border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-5">
              {s.strip.map(([k, v], i) => (
                <div key={k} className="dk-in bg-paper px-3 py-2.5" style={step(s.rows.length + i)}>
                  <dt className="label">{k}</dt>
                  <dd className="num mt-1 text-[clamp(0.8rem,1.3vw,1.1rem)] break-all">{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      );
    }
  }
}

export function DeckView() {
  const [i, setI] = useState(0);
  const touch = useRef<number | null>(null);
  const slide = SLIDES[i];
  const go = useCallback((d: number) => setI((n) => Math.min(SLIDES.length - 1, Math.max(0, n + d))), []);

  // #<slide id> deep-links a slide, so a judge can be sent straight to /deck#evidence.
  useEffect(() => {
    const fromHash = () => {
      const n = SLIDES.findIndex((s) => s.id === decodeURIComponent(location.hash.slice(1)));
      if (n >= 0) setI(n);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  useEffect(() => {
    if (location.hash.slice(1) !== slide.id) history.replaceState(null, "", `#${slide.id}`);
  }, [slide.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      if (k === "ArrowRight" || k === "ArrowDown" || k === "PageDown" || k === " " || k === "Enter") {
        e.preventDefault();
        go(1);
      } else if (k === "ArrowLeft" || k === "ArrowUp" || k === "PageUp" || k === "Backspace") {
        e.preventDefault();
        go(-1);
      } else if (k === "Home") setI(0);
      else if (k === "End") setI(SLIDES.length - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col overflow-hidden bg-ground"
      onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        const from = touch.current;
        touch.current = null;
        if (from === null) return;
        const dx = e.changedTouches[0].clientX - from;
        if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1);
      }}
    >
      <style>{`
        @keyframes dk-rise { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
        @keyframes dk-grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
        @keyframes dk-sweep { from { transform: translateX(-130%); } to { transform: translateX(130%); } }
        .dk-in { animation: dk-rise .5s cubic-bezier(.22,1,.36,1) both; }
        .dk-grow { animation: dk-grow .6s cubic-bezier(.22,1,.36,1) both; animation-delay: 120ms; }
        .dk-sweep { position: absolute; inset: 0 auto 0 0; width: 45%; background: linear-gradient(90deg, transparent, var(--color-violet-tint), transparent); animation: dk-sweep .75s cubic-bezier(.22,1,.36,1) both; }
      `}</style>

      <div key={slide.id} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pt-6 pb-4 sm:px-8 sm:pt-10 lg:px-14">
        {slide.kind !== "title" && <Head s={slide} />}
        <Body s={slide} />
        {slide.footnote && <p className="num shrink-0 border-t border-rule pt-3 text-xs break-words text-mute">{slide.footnote}</p>}
      </div>

      <nav aria-label="Slides" className="shrink-0 border-t border-rule bg-paper">
        <div className="h-[3px] w-full bg-rule">
          <div className="h-full bg-violet transition-[width] duration-300" style={{ width: `${((i + 1) / SLIDES.length) * 100}%` }} />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 sm:px-8 lg:px-14">
          <span className="num text-xs text-mute">
            {String(i + 1).padStart(2, "0")} / {SLIDES.length}
          </span>
          <span className="hidden text-sm font-semibold sm:inline">{slide.title}</span>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" className="btn btn-ghost px-3" onClick={() => go(-1)} disabled={i === 0} aria-label="Previous slide">
              ←
            </button>
            <button type="button" className="btn btn-primary px-3" onClick={() => go(1)} disabled={i === SLIDES.length - 1} aria-label="Next slide">
              →
            </button>
            <Link className="link ml-2 text-sm font-semibold" href="/demo">
              Download the video
            </Link>
            <Link className="link hidden text-sm font-semibold sm:inline" href="/">
              Exit deck
            </Link>
          </div>
        </div>
      </nav>
    </div>
  );
}
