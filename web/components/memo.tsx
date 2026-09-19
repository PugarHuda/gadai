"use client";
import type { Memo, Persona } from "@feedesk/shared";
import { Pill, usdcRaw } from "./ui";

/** One card per underwriter persona. The first (lead) persona's decision is binding. */
export function Memos({ memos, personas, leadId }: { memos: Memo[]; personas?: Persona[]; leadId?: string }) {
  if (!memos.length) return <p className="text-sm text-mute">No credit memos written yet.</p>;
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {memos.map((m) => {
        const p = personas?.find((x) => x.id === m.personaId);
        const lead = m.personaId === (leadId ?? personas?.[0]?.id);
        return (
          <article key={m.personaId} className={`box relative rounded-[3px] p-4 ${lead ? "border-violet ring-1 ring-violet" : ""}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-display text-lg leading-tight">{p?.name ?? m.personaId}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-mute">
                  {m.model.startsWith("engine-only") ? <span className="tag text-amber-ink">engine only, no LLM review</span> : m.model}
                  {lead && <span className="tag text-violet">lead, binding</span>}
                </div>
              </div>
              <Pill s={m.decision} />
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 border-y border-rule py-2">
              <div><dt className="label">principal</dt><dd className="num">{usdcRaw(m.principalRaw)}</dd></div>
              <div><dt className="label">max note px</dt><dd className="num">{m.maxNotePrice.toFixed(2)}</dd></div>
              <div><dt className="label">confidence</dt><dd className="num">{Math.round(m.confidence * 100)}</dd></div>
            </dl>
            <p className="mt-3 text-sm leading-relaxed">{m.rationale}</p>
            {m.risks.length > 0 && (
              <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-mute marker:text-amber-ink">
                {m.risks.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            )}
          </article>
        );
      })}
    </div>
  );
}
