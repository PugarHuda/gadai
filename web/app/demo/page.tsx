import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Demo video" };

// ponytail: duration is ffprobe of public/gadai-demo.mp4 (228.8 s = 3:49); re-probe if the MP4 is replaced.
const CHECK = [
  ["/evidence", "Evidence", "the Base mainnet transactions (FeeDesk, ERC-8004 #94699, x402 payment, Flash TWAP) and what is fork-only"],
  ["/board", "Credit lines", "the Credit Line Board, per-persona limits from the agent"],
  ["/desk", "Follow the Desk", "the underwriter leaderboard and mirrorable signals"],
  ["/dine", "Dine", "the dining concierge on live Flynet data"],
] as const;

export default function Demo() {
  return (
    <div className="space-y-10">
      <header>
        <h1 className="h1">Demo</h1>
        <p className="mt-3 max-w-[68ch]">
          A live run on an Anvil fork of Base against a real Bankr pool: Credit Line Board, underwriting, pledge, Uniswap CCA,
          disbursement by the Dynamic agent wallet, Uniswap swap, repayment, release, ERC-8004 reputation and the x402 credit report.
        </p>
      </header>
      <figure>
        <video className="w-full border border-rule bg-ink" src="/gadai-demo.mp4" poster="/gadai-demo-poster.jpg" controls playsInline preload="metadata" />
        <figcaption className="mt-2 text-sm text-mute">
          <a className="link" href="https://youtu.be/F7joLyWWB0E">Watch on YouTube</a> · <a className="link" href="/gadai-demo.mp4" download>Download the MP4</a> · <span className="num">3:49</span> · narrated, subtitled
        </figcaption>
      </figure>
      <section>
        <h2 className="text-lg font-bold [font-stretch:108%]">What else to check</h2>
        <ul className="mt-3 max-w-[68ch] space-y-2">
          {CHECK.map(([h, l, what]) => (
            <li key={h}>
              <Link className="link font-semibold" href={h}>{l}</Link> <span className="text-mute">· {what}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
