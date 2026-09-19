import type { Metadata } from "next";
import Link from "next/link";
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

/** Which 404 did the agent give? Its catch-all answers "no route GET …" (a bare Hono 404 is "404 404 Not Found"); the signal route answers "signal N not found". */
const why404 = (e: unknown) => {
  const m = e instanceof Error ? e.message : "";
  if (/^no route |^404 /.test(m)) return "route";
  if (/not found/i.test(m)) return "signal";
  return null; // offline or other errors: SignalView shows its own designed state
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const miss = await api(`/api/signals/${encodeURIComponent(id)}`).then(() => null, why404);
  if (!miss) return <SignalView id={id} />;
  return (
    <div className="space-y-4">
      <h1 className="h1">{miss === "route" ? "Signals are not served by this agent" : `No signal #${id}`}</h1>
      <p role="alert" className="max-w-[60ch] text-sm">
        {miss === "route"
          ? "The Gadai agent answered, but it has no /api/signals route. It is running an older build; restart it from the current code and reload this page."
          : "The agent has no signal with this id. Signals are numbered from 1 and appear when an underwriter writes a credit memo."}
      </p>
      <Link href="/desk" className="link text-sm">See the underwriters and their signals</Link>
    </div>
  );
}
