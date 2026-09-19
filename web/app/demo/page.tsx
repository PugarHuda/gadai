import type { Metadata } from "next";

export const metadata: Metadata = { title: "Demo video" };

export default function Demo() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Gadai demo</h1>
      <p className="mt-2 max-w-2xl">
        A live run on an Anvil fork of Base against a real Bankr pool: Credit Line Board, underwriting, pledge, Uniswap CCA,
        disbursement by the Dynamic agent wallet, Uniswap swap, repayment, release, ERC-8004 reputation and the x402 credit report.
      </p>
      <video className="mt-6 w-full border" src="/gadai-demo.mp4" controls playsInline preload="metadata" />
      <p className="mt-3 text-sm">
        <a className="underline" href="/gadai-demo.mp4" download>Download the MP4</a> · 2:28 · narrated, subtitled
      </p>
    </div>
  );
}
