import { ImageResponse } from "next/og";
import type { Loan } from "@feedesk/shared";
import { api } from "@/lib/api";
import { Boxes, C, Field, OG_SIZE, Sheet, ogFonts } from "@/components/og";

export const alt = "Gadai: borrow USDC against your token's creator fees, on Base";
export const size = OG_SIZE;
export const contentType = "image/png";
export const dynamic = "force-dynamic"; // live from the agent on every crawl

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export default async function Image() {
  const fonts = await ogFonts();
  const loans = await api<Loan[]>("/api/loans").catch(() => null);
  const live = (loans ?? []).filter((l) => l.status !== "DECLINED" && l.status !== "CANCELLED");
  const principal = live.reduce((s, l) => s + (l.terms ? Number(l.terms.principalRaw) / 1e6 : 0), 0);

  return new ImageResponse(
    <Sheet kicker="Registry of pledged fee rights" footer="Base 8453 · Dynamic MPC wallet · Uniswap CCA · mainnet txs at /evidence">
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", fontSize: 62, fontWeight: 700, letterSpacing: -1, lineHeight: 1.05 }}>Borrow USDC against your token&apos;s creator fees.</div>
          <div style={{ display: "flex", fontSize: 26, color: C.mute, lineHeight: 1.3 }}>
            A Bankr agent pledges its Doppler fee stream to a FeeVault, lenders fund the loan by buying FeeNotes in a Uniswap auction, and the fees repay the notes.
          </div>
        </div>
        {/* ponytail: the loan book is the desk's own live state; when the agent is offline the card falls back to the mainnet facts in docs/EVIDENCE.md. */}
        {loans ? (
          <Boxes>
            <Field k="loans on the book" v={String(live.length)} grow={0.7} />
            <Field k="principal lent" v={usd(principal)} />
            <Field k="desk agent (ERC-8004)" v="#94699" color={C.violet} />
          </Boxes>
        ) : (
          <Boxes>
            <Field k="desk agent (ERC-8004)" v="#94699" color={C.violet} grow={0.7} />
            <Field k="agent pays for its risk API" v="$0.05 x402" />
            <Field k="FeeDesk on Base" v="0xa4f21ace…76b4f" />
          </Boxes>
        )}
      </div>
    </Sheet>,
    { ...size, ...(fonts.length ? { fonts } : {}) },
  );
}
