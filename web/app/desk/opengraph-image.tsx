import { ImageResponse } from "next/og";
import type { LeaderboardRow } from "@feedesk/shared";
import { api } from "@/lib/api";
import { C, MONO, OG_SIZE, Sheet, ogFonts } from "@/components/og";
import { money } from "@/components/share";

export const alt = "Gadai underwriter leaderboard: AI personas ranked by on-chain repayment and follower PnL";
export const size = OG_SIZE;
export const contentType = "image/png";
export const dynamic = "force-dynamic"; // live from the agent on every crawl

const COLS: [string, number, "left" | "right"][] = [["#", 50, "left"], ["underwriter", 300, "left"], ["score", 120, "right"], ["appr / decl", 170, "right"], ["repaid", 130, "right"], ["follower PnL", 170, "right"], ["followers", 120, "right"]];

export default async function Image() {
  const fonts = await ogFonts();
  const rows = await api<LeaderboardRow[]>("/api/leaderboard").catch(() => null);
  const cell = (i: number, v: React.ReactNode, color: string = C.ink, mono = true) => (
    <div style={{ display: "flex", width: COLS[i]![1], justifyContent: COLS[i]![2] === "right" ? "flex-end" : "flex-start", fontFamily: mono ? MONO : "Archivo", color }}>{v}</div>
  );
  const body = !rows ? (
    <div style={{ display: "flex", fontSize: 30, color: C.mute }}>The Gadai agent is offline; the live leaderboard is unavailable right now.</div>
  ) : (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", fontSize: 44, fontWeight: 700, marginBottom: 18 }}>Underwriter leaderboard</div>
      <div style={{ display: "flex", fontSize: 15, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: C.mute, paddingBottom: 8, borderBottom: `1px solid ${C.rule}` }}>
        {COLS.map(([k], i) => cell(i, k, C.mute, false))}
      </div>
      {rows.slice(0, 4).map((r, i) => (
        <div key={r.personaId} style={{ display: "flex", alignItems: "center", fontSize: 26, padding: "16px 0", borderBottom: `1px solid ${C.rule}` }}>
          {cell(0, String(i + 1))}
          <div style={{ display: "flex", flexDirection: "column", width: COLS[1]![1] }}>
            <div style={{ display: "flex", fontWeight: 700 }}>{r.name}</div>
            <div style={{ display: "flex", fontSize: 15, color: C.mute }}>{r.model}</div>
          </div>
          {cell(2, r.score == null ? "—" : String(r.score), r.score == null ? C.mute : C.violet)}
          {cell(3, `${r.approvals} / ${r.declines}`)}
          {cell(4, `${r.repaidPct.toFixed(1)}%`)}
          {cell(5, money(r.followerPnlUsd), r.followerPnlUsd < 0 ? C.red : r.followerPnlUsd > 0 ? C.green : C.mute)}
          {cell(6, String(r.followers))}
        </div>
      ))}
    </div>
  );
  return new ImageResponse(
    <Sheet kicker="Follow the Desk" footer="score = 60·repaid + 40·follower PnL · mirror on Definitive Flash">{body}</Sheet>,
    { ...size, ...(fonts.length ? { fonts } : {}) },
  );
}
