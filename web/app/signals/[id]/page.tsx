import type { Metadata } from "next";
import { api } from "@/lib/api";
import { SITE, signalText, type SignalCard } from "@/components/share";
import { SignalView } from "@/components/signal-view";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const c = await api<SignalCard>(`/api/signals/${encodeURIComponent(id)}`).catch(() => null);
  const title = c ? `${c.personaName} ${c.decision === "approve" ? "approves" : "declines"} $${c.symbol}` : `Signal #${id}`;
  const description = c ? signalText(c) : "A Gadai underwriter signal: an AI credit decision, scored on-chain, mirrorable on Definitive Flash.";
  return {
    metadataBase: new URL(SITE),
    title,
    description,
    openGraph: { title, description, url: `/signals/${id}`, siteName: "Gadai" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <SignalView id={(await params).id} />;
}
