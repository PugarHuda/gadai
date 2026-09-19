// Share cards + X intents for Follow the Desk. No "use client": used by server pages, OG images and client pages alike.
import type { Address, LeaderboardRow, Signal } from "@feedesk/shared";

export const SITE = "https://gadai-six.vercel.app";

/** GET /api/signals/:id (agent/src/social/index.ts SignalCard). */
export type SignalCard = Signal & {
  personaName: string;
  model: string | null;
  llm: boolean;
  lead: boolean;
  loan: { status: string; repaidPct: number | null } | null;
  mirrors: { total: number; placed: number; filled: number; spentUsdc: number; pnlUsd: number | null };
};
/** GET /api/signals/:id/flash-quote: live Flash /quote for the market + Bracket a mirror would place. */
export type SignalFlashQuote = {
  signalId: number; token: Address; symbol: string; funder: Address;
  sizeUsdc: number; tpPct: number; slPct: number;
  spotUsd: number; riskFlagged: boolean; tpPriceUsd: number; slPriceUsd: number;
  estTokenOut: string; estOutUsd: number; estFeeUsd: number; priceImpactPct: number; withinImpactGate: boolean;
  integratorFeeBps: number; quoteId: string; quotedAt: string;
};
/** GET /api/flash/info. */
export type FlashInfo = {
  integratorFeeBps: number; integratorFeeSet: boolean; mainnetOnly: boolean; demoFork: boolean; maxPriceImpactPct: number;
  mirrors: { total: number; placed: number; filled: number };
};

export const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const usdcLimit = (raw: string) => money(Number(BigInt(raw)) / 1e6);
/** "rule-based, no LLM review" is never passed off as an LLM call. */
export const writtenBy = (c: Pick<SignalCard, "llm" | "model">) => (c.llm ? `LLM memo · ${c.model}` : "rule-based, no LLM review");

export const signalUrl = (id: number) => `${SITE}/signals/${id}`;
export const xIntent = (text: string, url: string) => `https://x.com/intent/post?${new URLSearchParams({ text, url })}`;

/** X post text for a signal; outcome fields are optional so the /desk feed (plain Signal rows) can share too. */
export function signalText(c: Signal & { personaName: string } & Partial<Pick<SignalCard, "loan" | "mirrors">>) {
  const outcome = c.mirrors?.pnlUsd != null ? ` Follower PnL so far: ${money(c.mirrors.pnlUsd)}.` : c.loan?.repaidPct != null ? ` ${c.loan.repaidPct.toFixed(0)}% repaid on-chain.` : "";
  return c.decision === "approve"
    ? `${c.personaName} (Gadai underwriter) approved $${c.symbol}: ${usdcLimit(c.principalRaw)} credit limit, score ${Math.round(c.score)}.${outcome} Followers mirror it with a @DefinitiveFi Flash market buy + TP/SL bracket.`
    : `${c.personaName} (Gadai underwriter) declined $${c.symbol}, score ${Math.round(c.score)}. No mirror order. Follow its calls on @DefinitiveFi Flash:`;
}

export function leaderboardText(rows: LeaderboardRow[]) {
  const top = rows[0];
  if (!top) return "Gadai's AI underwriters are ranked by on-chain repayment and follower PnL. Follow one and mirror its approvals on @DefinitiveFi Flash.";
  return `Gadai underwriter leaderboard: ${top.name} leads${top.score == null ? " (no realized data yet)" : ` with score ${top.score}`}, ${top.approvals} approvals, ${top.repaidPct.toFixed(0)}% repaid. Follow an agent and mirror its approvals on @DefinitiveFi Flash.`;
}

export function ShareOnX({ text, url, label = "Share on X" }: { text: string; url: string; label?: string }) {
  return (
    <a
      href={xIntent(text, url)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-8 items-center gap-1.5 rounded-[3px] border border-rule bg-paper px-2.5 py-1 text-xs font-semibold text-ink hover:border-violet hover:bg-violet-tint"
    >
      <svg aria-hidden viewBox="0 0 24 24" className="size-3.5 fill-current">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
      {label}
    </a>
  );
}
