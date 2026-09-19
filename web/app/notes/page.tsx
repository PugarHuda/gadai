"use client";
import Link from "next/link";
import type { Address } from "viem";
import type { AuctionState, Loan } from "@feedesk/shared";
import { api } from "@/lib/api";
import { noteAbi, publicClient } from "@/lib/chain";
import { useSigner } from "@/lib/wallet";
import { Addr, Card, Empty, Loading, pct, usdcRaw, useLoad } from "@/components/ui";

type Open = { loan: Loan; a: AuctionState | null; err: string | null };

async function openAuctions(): Promise<Open[]> {
  const loans = await api<Loan[]>("/api/loans?status=AUCTION");
  return Promise.all(
    loans.map((loan) =>
      api<AuctionState>(`/api/loans/${loan.id}/auction`).then(
        (a) => ({ loan, a, err: null }),
        (e: Error) => ({ loan, a: null, err: e.message }),
      ),
    ),
  );
}

/** Notes the connected wallet holds across funded loans (FeeNote ERC-20 balanceOf, on-chain). */
async function myNotes(me: Address) {
  const loans = (await api<Loan[]>("/api/loans")).filter((l) => l.note && (l.status === "ACTIVE" || l.status === "RELEASED"));
  if (!loans.length) return [];
  const bals = await publicClient.multicall({
    contracts: loans.map((l) => ({ address: l.note!, abi: noteAbi, functionName: "balanceOf", args: [me] }) as const),
  });
  return loans
    .map((l, i) => {
      const b = bals[i];
      if (b.status !== "success") throw new Error(`balanceOf on note ${l.note} (loan #${l.id}) failed: ${b.error.message}`);
      return { loan: l, bal: b.result as bigint };
    })
    .filter((x) => x.bal > 0n);
}

/** The connected wallet's CCA bids across every loan that had an auction, hiding bids that are exited with nothing left to claim. */
async function myBids(me: Address) {
  const loans = (await api<Loan[]>("/api/loans")).filter((l) => l.auction);
  const states = await Promise.all(loans.map((l) => api<AuctionState>(`/api/loans/${l.id}/auction`)));
  return states.flatMap((a, i) =>
    a.bids.filter((b) => b.owner.toLowerCase() === me.toLowerCase() && (!b.exited || BigInt(b.tokensFilledRaw) > 0n)).map((b) => ({ loan: loans[i], a, b })),
  );
}

export default function Notes() {
  const s = useSigner();
  const open = useLoad(openAuctions, [], 15_000);
  const mine = useLoad(async () => (s.address ? myNotes(s.address) : []), [s.address]);
  const bids = useLoad(async () => (s.address ? myBids(s.address) : []), [s.address], 15_000);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="h1">Lend through FeeNotes</h1>
        <p className="mt-4 max-w-[68ch] text-ink/85">
          Each loan mints a FeeNote ERC-20: one note is a senior claim on 1 USDC of that loan&apos;s fee stream. Notes are sold in a Uniswap Continuous Clearing Auction that funds the loan.
          The desk&apos;s agent anchors each auction at its lead underwriter&apos;s price. Bid with your Dynamic wallet, then redeem 1:1 as fees come in.
        </p>
      </header>

      <Card title="Open auctions" right={<button className="link" onClick={() => open.reload()}>refresh</button>}>
        <Loading l={open.loading} e={open.error} retry={open.reload} what="the open FeeNote auctions">
          {open.data?.length === 0 && <Empty title="No auctions live right now">A FeeNote auction opens as soon as a borrower pledges fee rights on an approved loan. Past and funded loans are on the <Link className="link" href="/">loan book</Link>.</Empty>}
          <div className="grid gap-4 md:grid-cols-2">
            {open.data?.map(({ loan, a, err }) => {
              const prog = a ? (Number(a.currencyRaisedRaw) / Math.max(1, Number(a.requiredRaw))) * 100 : 0;
              return (
                <article key={loan.id} className="box rounded-[3px] p-4">
                  <div className="flex items-baseline justify-between">
                    <h3 className="font-display text-2xl">fn${loan.symbol} <span className="num text-sm font-normal text-mute">#{loan.id}</span></h3>
                    <Link href={`/loans/${loan.id}`} className="btn btn-primary">Bid</Link>
                  </div>
                  {err && <p className="mt-2 text-xs text-stamp">{err}</p>}
                  {a && (
                    <>
                      <div className="mt-3 h-2 bg-rule/60"><div className="h-full bg-amber" style={{ width: `${Math.min(100, prog)}%` }} /></div>
                      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                        <div><dt className="label">raised</dt><dd className="num">{usdcRaw(a.currencyRaisedRaw)}</dd></div>
                        <div><dt className="label">needs</dt><dd className="num">{usdcRaw(a.requiredRaw)}</dd></div>
                        <div><dt className="label">clearing</dt><dd className="num">{a.clearingPrice.toFixed(3)}</dd></div>
                        <div><dt className="label">yield @ floor</dt><dd className="num">{pct((1 / a.floorPrice - 1) * 100)}</dd></div>
                      </dl>
                      <p className="mt-2 text-xs text-mute num">blocks {a.currentBlock} → end {a.endBlock} · {a.bids.length} bids · lead px {loan.leadMemo?.maxNotePrice.toFixed(2) ?? "—"}</p>
                    </>
                  )}
                </article>
              );
            })}
          </div>
        </Loading>
      </Card>

      {s.connected && (
        <Card title="Your bids" right={<button className="link" onClick={() => bids.reload()}>refresh</button>}>
          <Loading l={bids.loading} e={bids.error} retry={bids.reload} what="your auction bids">
            {bids.data?.length === 0 ? (
              <p className="text-sm text-mute">No open or unclaimed bids.</p>
            ) : (
              <table className="tbl">
                <thead><tr><th>loan</th><th>bid</th><th className="text-right">amount</th><th className="text-right">max px</th><th>state</th><th /></tr></thead>
                <tbody>
                  {bids.data?.map(({ loan, a, b }) => (
                    <tr key={`${loan.id}-${b.bidId}`}>
                      <td>fn${loan.symbol} <span className="num text-mute">#{loan.id}</span></td>
                      <td className="num">#{b.bidId}</td>
                      <td className="num text-right">{usdcRaw(b.amountRaw)}</td>
                      <td className="num text-right">{b.maxPrice.toFixed(3)}</td>
                      <td className="text-xs">{a.currentBlock < a.endBlock ? "auction live" : b.exited ? "exited · notes to claim" : "ended · exit needed"}</td>
                      <td className="text-right"><Link className="link text-xs" href={`/loans/${loan.id}`}>{a.currentBlock < a.endBlock ? "View" : "Exit or claim"}</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Loading>
        </Card>
      )}

      <Card title="Your FeeNotes">
        {!s.connected ? (
          <Empty title="Log in to see your notes"><button className="link" onClick={s.login}>Log in with Dynamic</button> to list the FeeNotes your wallet holds and redeem them as fees come in.</Empty>
        ) : (
          <Loading l={mine.loading} e={mine.error} retry={mine.reload} what="your FeeNote holdings">
            {mine.data?.length === 0 ? (
              <p className="text-sm text-mute">You hold no FeeNotes yet. Exit and claim a graduated bid (see "Your bids") to receive them.</p>
            ) : (
              <table className="tbl">
                <thead><tr><th>note</th><th>loan</th><th>status</th><th className="text-right">face held</th><th /></tr></thead>
                <tbody>
                  {mine.data?.map(({ loan, bal }) => (
                    <tr key={loan.id}>
                      <td><Addr a={loan.note} label={`fn$${loan.symbol}`} /></td>
                      <td className="num">#{loan.id}</td>
                      <td>{loan.status}</td>
                      <td className="num text-right">{usdcRaw(String(bal))}</td>
                      <td className="text-right"><Link className="link text-xs" href={`/loans/${loan.id}`}>Redeem</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Loading>
        )}
      </Card>
    </div>
  );
}
