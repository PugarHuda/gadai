"use client";
import type { Memo, Persona } from "@feedesk/shared";
import { Pill, usdcRaw } from "./ui";

/** One card per underwriter persona. The first (lead) persona's decision is binding. */
export function Memos({ memos, personas, leadId }: { memos: Memo[]; personas?: Persona[]; leadId?: string }) {
  if (!memos.length) return <p className="text-sm text-mute">No memos.</p>;
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {memos.map((m) => {
        const p = personas?.find((x) => x.id === m.personaId);
        const lead = m.personaId === (leadId ?? personas?.[0]?.id);
        return (
          <article key={m.personaId} className={`card relative p-4 ${lead ? "outline-2 outline-offset-4 outline-desk" : ""}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-serif text-2xl leading-none">{p?.name ?? m.personaId}</div>
                <div className="label mt-1">{m.model}{lead && " · lead, binding"}</div>
              </div>
              <Pill s={m.decision} />
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div><dt className="label">principal</dt><dd className="num">{usdcRaw(m.principalRaw)}</dd></div>
              <div><dt className="label">max note px</dt><dd className="num">{m.maxNotePrice.toFixed(2)}</dd></div>
              <div><dt className="label">confidence</dt><dd className="num">{Math.round(m.confidence * 100)}</dd></div>
            </dl>
            <p className="mt-3 text-sm leading-relaxed">{m.rationale}</p>
            {m.risks.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs text-mute">
                {m.risks.map((r, i) => <li key={i}>▲ {r}</li>)}
              </ul>
            )}
          </article>
        );
      })}
    </div>
  );
}
