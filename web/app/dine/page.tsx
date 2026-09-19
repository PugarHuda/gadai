"use client";
import Link from "next/link";
import type { Loan } from "@feedesk/shared";
import { api } from "@/lib/api";
import { useSigner } from "@/lib/wallet";
import { Card, Empty, Loading, Pill, usdcRaw, useLoad } from "@/components/ui";

export default function DinePicker() {
  const s = useSigner();
  const me = s.address?.toLowerCase();
  const q = useLoad(
    async () => (me ? (await api<Loan[]>("/api/loans")).filter((l) => l.borrower.toLowerCase() === me || l.controller.toLowerCase() === me) : []),
    [me],
  );
  return (
    <div className="space-y-8">
      <header>
        <h1 className="h1">Dine on your fees</h1>
        <p className="mt-4 max-w-[68ch] text-ink/85">
          Every active loan carries a small dining line. Link your Blackbird account, let the desk agent pick restaurants from Flynet data, and draw FLY to pay at the table. The draw is
          recorded on your FeeVault and repaid automatically from your fee stream.
        </p>
      </header>
      <Card title="Your loans">
        {!s.connected ? (
          <Empty title="Log in to open your dining line">
            <button className="link" onClick={s.login}>Log in with Dynamic</button> as the borrower or controller of a loan. Active loans list here with their dining limit.
          </Empty>
        ) : (
          <Loading l={q.loading} e={q.error} retry={q.reload} what="your loans">
            {q.data?.length === 0 && (
              <Empty title="No loans for this wallet">
                The dining line comes with an active loan. <Link className="link" href="/apply">Apply for a loan</Link> first.
              </Empty>
            )}
            <ul className="divide-y divide-rule">
              {q.data?.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm first:pt-0 last:pb-0">
                  <span>
                    <b>${l.symbol}</b> <span className="num text-mute">#{l.id}</span> · line <span className="num">{usdcRaw(l.terms?.drawLimitRaw)}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <Pill s={l.status} />
                    {l.status === "ACTIVE" ? (
                      <Link className="btn btn-primary" href={`/dine/${l.id}`}>
                        Dine
                      </Link>
                    ) : (
                      <span className="text-xs text-mute">Line opens once the loan is active</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </Loading>
        )}
      </Card>
    </div>
  );
}
