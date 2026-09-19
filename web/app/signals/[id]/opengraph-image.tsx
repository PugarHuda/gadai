import { ImageResponse } from "next/og";
import { api } from "@/lib/api";
import { Boxes, C, Field, OG_SIZE, Sheet, Stamp, ogFonts } from "@/components/og";
import { money, usdcLimit, writtenBy, type SignalCard } from "@/components/share";

export const alt = "Gadai underwriter signal: decision, credit limit, and realized outcome";
export const size = OG_SIZE;
export const contentType = "image/png";
export const dynamic = "force-dynamic"; // live from the agent on every crawl

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const fonts = await ogFonts();
  let c: SignalCard | null = null, err = "";
  try {
    c = await api<SignalCard>(`/api/signals/${encodeURIComponent(id)}`);
  } catch (e) {
    err = (e as Error).message;
  }
  const body = !c ? (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", fontSize: 56, fontWeight: 700 }}>Signal #{id}</div>
      <div style={{ display: "flex", fontSize: 28, color: C.mute }}>{/not found/i.test(err) ? "No such signal on the desk." : "The Gadai agent is offline; the live card is unavailable right now."}</div>
    </div>
  ) : (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "space-between" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", fontSize: 64, fontWeight: 700, letterSpacing: -1 }}>{c.personaName} on ${c.symbol}</div>
          <div style={{ display: "flex", gap: 12, fontSize: 22, color: c.llm ? C.mute : C.amberInk }}>
            <div style={{ display: "flex" }}>{writtenBy(c)}</div>
            {c.lead && <div style={{ display: "flex", color: C.violet }}>· lead underwriter, binding</div>}
          </div>
        </div>
        <Stamp text={c.decision === "approve" ? "Approved" : "Declined"} color={c.decision === "approve" ? C.green : C.red} />
      </div>
      <Boxes>
        <Field k="credit limit" v={usdcLimit(c.principalRaw)} />
        <Field k="score" v={String(Math.round(c.score))} grow={0.6} />
        <Field k="note px" v={c.maxNotePrice.toFixed(2)} grow={0.6} />
        <Field k="loan" v={c.loan ? c.loan.status : "—"} />
      </Boxes>
      <Boxes>
        <Field k="repaid on-chain" v={c.loan?.repaidPct == null ? "not funded yet" : `${c.loan.repaidPct.toFixed(1)}%`} color={c.loan?.repaidPct == null ? C.mute : C.green} />
        <Field
          k="follower PnL (Flash fills)"
          v={c.mirrors.pnlUsd == null ? (c.decision === "approve" ? "no fills yet" : "nothing to mirror") : money(c.mirrors.pnlUsd)}
          color={c.mirrors.pnlUsd == null ? C.mute : c.mirrors.pnlUsd < 0 ? C.red : C.green}
        />
        <Field k="mirrors placed" v={`${c.mirrors.placed} / ${c.mirrors.total}`} grow={0.7} />
      </Boxes>
    </div>
  );
  return new ImageResponse(
    <Sheet kicker={`Follow the Desk · signal #${id}`} footer="Mirror on Definitive Flash: market buy + TP/SL bracket, or DCA">{body}</Sheet>,
    { ...size, ...(fonts.length ? { fonts } : {}) },
  );
}
