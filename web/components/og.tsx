// Share-card chrome for next/og (Satori): lien-registry sheet on the grey desk. Server-only (opengraph-image routes).
import type { ReactNode } from "react";

export const OG_SIZE = { width: 1200, height: 630 };
export const C = {
  ground: "#e5e8e3", sheet: "#fcfcfa", ink: "#16181d", mute: "#545a64", rule: "#c4c9cf",
  violet: "#5a2bb3", tint: "#efe9fa", green: "#16683b", red: "#b42318", amberInk: "#7a4b00",
};

// Google Fonts serves TTF (which Satori reads) when no browser UA is sent. On failure the card falls back to next/og's default font.
async function gfont(family: string, weight: number) {
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${family}:wght@${weight}`)).text();
  const url = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/)?.[1];
  if (!url) throw new Error(`no TTF for ${family}`);
  return (await fetch(url)).arrayBuffer();
}
let fontsP: Promise<{ name: string; data: ArrayBuffer; weight: 400 | 700; style: "normal" }[]> | undefined;
export const ogFonts = () =>
  (fontsP ??= Promise.all([gfont("Archivo", 400), gfont("Archivo", 700), gfont("Chivo+Mono", 400)])
    .then(([a4, a7, m]) => [
      { name: "Archivo", data: a4, weight: 400 as const, style: "normal" as const },
      { name: "Archivo", data: a7, weight: 700 as const, style: "normal" as const },
      { name: "Chivo Mono", data: m, weight: 400 as const, style: "normal" as const },
    ])
    .catch(() => ((fontsP = undefined), []))); // retry on the next render

export const MONO = "Chivo Mono";

/** Caption over a typed entry, inside a hairline box. */
export function Field({ k, v, color = C.ink, grow = 1 }: { k: string; v: ReactNode; color?: string; grow?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: grow, flexBasis: 0, padding: "14px 18px", background: C.sheet, gap: 6 }}>
      <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: C.mute }}>{k}</div>
      <div style={{ display: "flex", fontFamily: MONO, fontSize: 34, color }}>{v}</div>
    </div>
  );
}

/** The filing stamp: double-ruled box, rotated -2°. */
export function Stamp({ text, color }: { text: string; color: string }) {
  return (
    <div style={{ display: "flex", transform: "rotate(-2deg)", border: `3px solid ${color}`, padding: 3, borderRadius: 4 }}>
      <div style={{ display: "flex", border: `1.5px solid ${color}`, padding: "6px 18px", color, fontSize: 34, fontWeight: 700, letterSpacing: 4, textTransform: "uppercase" }}>{text}</div>
    </div>
  );
}

export function Sheet({ kicker, children, footer }: { kicker: string; children: ReactNode; footer: string }) {
  return (
    <div style={{ display: "flex", width: "100%", height: "100%", background: C.ground, padding: 36, fontFamily: "Archivo", color: C.ink }}>
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, background: C.sheet, border: `1px solid ${C.rule}`, boxShadow: "0 10px 28px -16px rgba(22,24,29,.28)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 28px", borderBottom: `1px solid ${C.rule}` }}>
          <div style={{ display: "flex", fontSize: 26, fontWeight: 700 }}>Gadai</div>
          <div style={{ display: "flex", fontSize: 16, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: C.mute }}>{kicker}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, padding: "24px 28px" }}>{children}</div>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 28px", borderTop: `1px solid ${C.rule}`, fontSize: 18, color: C.mute }}>
          <div style={{ display: "flex" }}>{footer}</div>
          <div style={{ display: "flex", fontFamily: MONO }}>gadai-six.vercel.app</div>
        </div>
      </div>
    </div>
  );
}

/** Row of fields sharing hairline edges (gap over a rule-colored ground, like the site's registry boxes). */
export const Boxes = ({ children }: { children: ReactNode }) => (
  <div style={{ display: "flex", gap: 1, background: C.rule, border: `1px solid ${C.rule}` }}>{children}</div>
);
