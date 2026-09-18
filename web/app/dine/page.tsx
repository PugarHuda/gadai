"use client";
import Link from "next/link";
import type { Loan } from "@feedesk/shared";
import { api } from "@/lib/api";
import { useSigner } from "@/lib/wallet";
import { Card, Loading, Pill, usdcRaw, useLoad } from "@/components/ui";

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
        <p className="label">Blackbird Flynet</p>
        <h1 className="h1 mt-1">Dine on your fees</h1>
        <p className="mt-3 max-w-2xl text-sm">
          Every active loan carries a small dining line. Link your Blackbird account, let the desk agent pick restaurants from Flynet data, and draw FLY to pay at the table. The draw is
          recorded on your FeeVault and repaid automatically from your fee stream.
        </p>
      </header>
      <Card title="Your loans">
        {!s.connected ? (
          <button className="link text-sm" onClick={s.login}>
            Log in with Dynamic as the borrower or controller
          </button>
        ) : (
          <Loading l={q.loading} e={q.error}>
            {q.data?.length === 0 && (
              <p className="text-sm text-mute">
                No loans for this wallet. <Link className="link" href="/apply">Apply →</Link>
              </p>
            )}
            <ul className="divide-y divide-ink/15">
              {q.data?.map((l) => (
                <li key={l.id} className="flex items-center justify-between py-2 text-sm">
                  <span>
                    <b>${l.symbol}</b> #{l.id} · line {usdcRaw(l.terms?.drawLimitRaw)}
                  </span>
                  <span className="flex items-center gap-3">
                    <Pill s={l.status} />
                    {l.status === "ACTIVE" ? (
                      <Link className="btn btn-primary" href={`/dine/${l.id}`}>
                        Dine →
                      </Link>
                    ) : (
                      <span className="text-xs text-mute">line opens when ACTIVE</span>
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
