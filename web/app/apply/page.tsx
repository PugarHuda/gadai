"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { isAddress, type Address } from "viem";
import { TEST_POOL, applyMessage, type ApplyRequest, type DeskInfo, type LoanDetail, type Quote } from "@feedesk/shared";
import { api, creatorTokens, type CreatorToken } from "@/lib/api";
import { ENV } from "@/lib/env";
import { useSigner } from "@/lib/wallet";
import { Btn, Card, Err, FeeChart, Pill, usd, usdcRaw, useLoad } from "@/components/ui";
import { Memos } from "@/components/memo";
import { PledgePanel } from "@/components/pledge";

export default function Apply() {
  const s = useSigner();
  const desk = useLoad(() => api<DeskInfo>("/api/desk"));
  const [borrower, setBorrower] = useState("");
  const [token, setToken] = useState("");
  const [tokens, setTokens] = useState<CreatorToken[] | null>(null);
  const [tokErr, setTokErr] = useState<unknown>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loan, setLoan] = useState<LoanDetail | null>(null);

  // Default borrower = connected wallet. Any beneficiary can be quoted; applying needs the beneficiary's own signature.
  useEffect(() => {
    if (s.address && !borrower) setBorrower(s.address);
  }, [s.address, borrower]);

  useEffect(() => {
    setTokens(null);
    setTokErr(null);
    if (isAddress(borrower)) creatorTokens(borrower).then(setTokens, setTokErr);
  }, [borrower]);

  const getQuote = async () => {
    if (!isAddress(token)) throw new Error("Enter the token address (0x…)");
    if (!isAddress(borrower)) throw new Error("Enter the beneficiary wallet (0x…)");
    setLoan(null);
    setQuote(await api<Quote>(`/api/quote?token=${token}&borrower=${borrower}`));
  };
  // Only the fee beneficiary can apply: it signs applyMessage (EIP-191). Bankr-wallet beneficiaries apply via the Bankr skill.
  const apply = async () => {
    if (!s.address) return s.login();
    if (s.address.toLowerCase() !== borrower.toLowerCase())
      throw new Error(`Connected ${s.address} is not the beneficiary ${borrower}. Only the beneficiary can sign the application. If it's a Bankr wallet, ask your Bankr agent to apply with the Gadai skill.`);
    const b = borrower as Address, nonce = crypto.randomUUID();
    const body: ApplyRequest = { token: token as Address, borrower: b, controller: b, via: "web", nonce, signature: await s.signMessage(applyMessage(token as Address, b, b, nonce)) };
    setLoan(await api<LoanDetail>("/api/loans", { body }));
  };

  const inp = quote?.inputs;
  const t = quote?.terms;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="h1">Apply for credit</h1>
        <p className="mt-4 max-w-[68ch] text-ink/85">
          Terms come from your token&apos;s real Doppler fee history (Bankr fee API), priced with a Uniswap Trading API quote. Then three underwriter agents on the Bankr LLM Gateway
          write memos. They can only lower the amount, never raise it.
        </p>
      </header>

      <Card title="1. Borrower and token">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="label">Fee beneficiary wallet</span>
            <input className="input mt-1" placeholder="0x… (your EOA or Bankr wallet)" value={borrower} onChange={(e) => setBorrower(e.target.value.trim())} />
            {!s.connected && (
              <button className="link mt-1 text-xs" onClick={s.login}>
                log in with Dynamic to prefill
              </button>
            )}
          </label>
          <label className="block">
            <span className="label">Token (Base, Doppler)</span>
            <input className="input mt-1" placeholder="0x…" value={token} onChange={(e) => setToken(e.target.value.trim())} />
            {ENV.DEMO_FORK && (
              <button className="link mt-1 text-xs" onClick={() => (setBorrower(TEST_POOL.beneficiary), setToken(TEST_POOL.token))}>
                fork demo: quote the GITLAWB test pool
              </button>
            )}
          </label>
        </div>
        {tokens && tokens.length > 0 && (
          <div className="mt-4">
            <div className="label">Your Base tokens (Bankr creator fees, via the agent)</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {tokens.map((x) => (
                <button
                  key={x.token}
                  onClick={() => setToken(x.token)}
                  className={`rounded-[3px] border px-3 py-1.5 text-left text-xs transition-colors ${token.toLowerCase() === x.token.toLowerCase() ? "border-violet bg-violet-tint ring-1 ring-violet" : "border-rule bg-paper hover:border-mute"}`}
                >
                  <b>${x.symbol}</b> · share {x.sharePct}% · claimable {x.claimableWeth.toFixed(4)} WETH
                </button>
              ))}
            </div>
          </div>
        )}
        {tokens && tokens.length === 0 && <p className="mt-3 text-xs text-mute">No Base Doppler tokens with this wallet as beneficiary.</p>}
        <Err e={tokErr} />
        <div className="mt-4">
          <Btn onClick={getQuote}>Get quote</Btn>
        </div>
      </Card>

      {quote && (
        <Card title="2. Quote" right={quote.eligible ? <Pill s="approve" /> : <Pill s="decline" />}>
          {!quote.eligible && (
            <ul className="mb-4 list-disc rounded-[3px] border border-stamp/40 bg-stamp/5 py-2 pr-3 pl-8 text-sm text-stamp">
              {quote.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
          {inp && (
            <div className="grid gap-6 md:grid-cols-[1.3fr_1fr]">
              <div>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-display text-2xl">${inp.symbol}</h3>
                  <span className="label">
                    share {inp.sharePct}% · {inp.lifetimeDays}d live · ETH {usd(inp.ethUsd, 0)}
                  </span>
                </div>
                <div className="mt-3">
                  <FeeChart days={inp.dailyWeth} claimable={Number(inp.claimableWethRaw) / 1e18} />
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="label">30d fees</dt>
                    <dd className="num">{inp.weth30d.toFixed(4)} WETH</dd>
                  </div>
                  <div>
                    <dt className="label">lifetime</dt>
                    <dd className="num">{inp.wethLifetime.toFixed(4)} WETH</dd>
                  </div>
                  <div>
                    <dt className="label">claim-first → vault</dt>
                    <dd className="num">{(Number(inp.claimableWethRaw) / 1e18).toFixed(4)} WETH</dd>
                  </div>
                </dl>
              </div>
              {t && (
                <dl className="grid grid-cols-2 content-start gap-3">
                  <div className="col-span-2 rounded-[3px] border border-violet bg-violet-tint p-3">
                    <dt className="label !text-violet">max principal</dt>
                    <dd className="num text-3xl text-violet-deep sm:text-4xl">{usdcRaw(t.maxPrincipalRaw)}</dd>
                  </div>
                  <div>
                    <dt className="label">note face</dt>
                    <dd className="num">{usdcRaw(t.faceValueRaw)}</dd>
                  </div>
                  <div>
                    <dt className="label">fee</dt>
                    <dd className="num">{t.feeRatePct.toFixed(2)}%</dd>
                  </div>
                  <div>
                    <dt className="label">floor note price</dt>
                    <dd className="num">{t.floorPrice.toFixed(2)} USDC</dd>
                  </div>
                  <div>
                    <dt className="label">term @ run-rate</dt>
                    <dd className="num">{t.termDays.toFixed(1)} d</dd>
                  </div>
                  <div>
                    <dt className="label">advance rate</dt>
                    <dd className="num">{t.advanceRatePct}%</dd>
                  </div>
                  <div>
                    <dt className="label">dining line (Flynet)</dt>
                    <dd className="num">{usdcRaw(t.drawLimitRaw)}</dd>
                  </div>
                </dl>
              )}
            </div>
          )}
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-semibold text-violet">How this quote was priced</summary>
            <pre className="mt-2 whitespace-pre-wrap bg-ground/60 p-3 font-mono text-xs">{quote.formula}</pre>
          </details>
          {quote.eligible && !loan && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Btn onClick={apply}>{s.connected ? "Sign & apply · ask the underwriters" : "Log in to apply"}</Btn>
              <span className="text-xs text-mute">
                Calls the Bankr LLM Gateway ({desk.data?.personas.map((p) => p.model).join(", ") ?? "3 models"}). If approved, the Dynamic agent wallet opens your FeeVault on-chain.
              </span>
            </div>
          )}
        </Card>
      )}

      {loan && (
        <>
          <Card title={`3. Loan #${loan.id}: credit memos`} right={<Pill s={loan.status} />}>
            <Memos memos={loan.memos} personas={desk.data?.personas} />
          </Card>
          {loan.status === "APPROVED" && loan.vault && <PledgePanel loan={loan} onDone={setLoan} />}
          {loan.status !== "APPROVED" && loan.status !== "DECLINED" && (
            <p className="text-sm">
              Pledge confirmed.{" "}
              <Link className="link" href={`/loans/${loan.id}`}>
                Follow the FeeNote auction on the loan page
              </Link>
            </p>
          )}
          {loan.status === "DECLINED" && (
            <p className="rounded-[3px] border border-stamp/40 bg-stamp/5 px-3 py-2 text-sm text-stamp">
              The lead underwriter declined. The memo and signal are public on{" "}
              <Link className="link" href="/desk">
                Follow the Desk
              </Link>
              .
            </p>
          )}
        </>
      )}
    </div>
  );
}
