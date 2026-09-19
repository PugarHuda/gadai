import type { Metadata } from "next";
import Link from "next/link";
import { BASESCAN } from "@feedesk/shared";
import { Card } from "@/components/ui";

export const metadata: Metadata = { title: "Evidence", description: "What Gadai ran on Base mainnet, what ran on a fork, and what is code only." };

// Source of truth: docs/EVIDENCE.md (Base mainnet, 2026-09-19). Always Basescan links: these txs are on mainnet even when the UI runs on DEMO_FORK.
const AGENT_WALLET = "0x81b73786BF2dE819e66BB57d08effADe0085305D";
const FEE_DESK = "0xa4f21ace41923bccfdebf1c6ab49659d80476b4f";

const Scan = ({ h, kind = "tx", full }: { h: string; kind?: "tx" | "address"; full?: boolean }) => (
  <a className="link font-mono" href={`${BASESCAN}/${kind}/${h}`} target="_blank" rel="noreferrer" title={h}>
    {full ? h : `${h.slice(0, 10)}…${h.slice(-6)}`}
  </a>
);

const ROWS: { what: React.ReactNode; why: string; tx: React.ReactNode }[] = [
  {
    what: <>Uniswap Trading API swap, 0.00015 ETH → 0.395941 USDC (routing CLASSIC, impact 0.01%)</>,
    why: "The desk funds its own API budget through the same Uniswap API the keeper uses",
    tx: <Scan h="0x6dd51e0c3fa3a8ace9633a32200857b8795c1e6cadd06e0eb5d9f701026cc072" />,
  },
  {
    what: <>Deploy <span className="font-mono">FeeDesk</span> (keeper = Dynamic agent wallet, treasury = desk Bankr wallet, oracle max age 1 h)</>,
    why: "The lending desk is live on Base mainnet",
    tx: (
      <>
        <Scan h="0x21cce9322a7ceb0a1af4225973d9ad3969c298a5594d7f71a7f7689c233ee858" /> → contract <Scan kind="address" h={FEE_DESK} />
      </>
    ),
  },
  {
    what: <>ERC-8004 <span className="font-mono">register(agentURI)</span> → desk agent <b>#94699</b>, calldata carries Base builder code <span className="font-mono">bc_32d4pc8g</span> (ERC-8021)</>,
    why: "The underwriter has an on-chain identity that repayment reputation attaches to",
    tx: <Scan h="0xde4b3490940e7bc064c3511c7843eab20f16f1419e456185e35a7690966229cb" />,
  },
  {
    what: <>x402 paid risk check: the Dynamic agent wallet buys a honeypot/rug verdict for GITLAWB ($0.05 USDC, EIP-3009 signed by the MPC wallet, settled by the Bankr facilitator). SAFE → no limit cut</>,
    why: "An agent that pays for an API, retries the request and uses the response",
    tx: <Scan h="0x9c22339bffe1f0e424dad6d5ab64d77603176716d95694eb40430d203f98ad00" />,
  },
  {
    what: (
      <>
        Definitive Flash TWAP order <span className="font-mono break-all">fb3b2572-48c6-4ce5-b79a-6199cefac82f</span>: the desk mirrors its own approved signal (buy GITLAWB, 0.25 USDC in 2 slices over 10 min), EIP-712 signed by the MPC wallet. Approval{" "}
        <Scan h="0x6cef30c59a7e6d071fb543f19443ef1cf6db0470b689e382296852121f0ce007" />
      </>
    ),
    why: "An advanced order placed by an agent that others follow",
    tx: (
      <>
        first fill 0.125 USDC → 2,158 GITLAWB: <Scan h="0x261a1355c4d5c7a1e97aaf398a1eb42f8c8563b5489f68709c2bd7660f3bcab4" />
      </>
    ),
  },
];

const SPLIT: [string, string, string, string[]][] = [
  [
    "Base mainnet",
    "text-desk bg-desk/5",
    "Real transactions and live services, linked above.",
    [
      "FeeDesk deployment",
      "ERC-8004 registration (desk #94699)",
      "x402 risk payment by the Dynamic agent wallet",
      "Flash TWAP order",
      "Uniswap Trading API swap",
      "x402 credit report service (Bankr x402 Cloud)",
      "Flynet production data (dining catalog, read-only)",
    ],
  ],
  [
    "Fork",
    "text-amber-ink bg-amber/15",
    "Anvil fork of Base with a real Bankr pool. Shown in the demo video.",
    ["Full loan lifecycle: createLoan, pledge, CCA, disburse, keeper swap, repay, release", "ERC-8004 feedback"],
  ],
  [
    "Code only",
    "text-mute",
    "Written and tested, not exercised end to end.",
    [
      "Dynamic delegated auto-mirror",
      "Flynet payments (needs Blackbird partner review)",
      "LLM memos (Bankr LLM credits are $0, so memos come from rule personas)",
    ],
  ],
];

export default function Evidence() {
  return (
    <div className="space-y-12">
      <header>
        <h1 className="h1">Evidence</h1>
        <p className="mt-3 max-w-[68ch] text-mute">
          What ran on Base mainnet, what ran on a fork, and what is code only. Every mainnet transaction was signed by the desk&apos;s Dynamic agent wallet{" "}
          <Scan kind="address" h={AGENT_WALLET} />. The full loan lifecycle runs on the fork; see the <Link className="link" href="/demo">demo video</Link>.
        </p>
      </header>

      <Card title="Base mainnet transactions" right="Basescan · 2026-09-19">
        <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
          <table className="tbl">
            <thead>
              <tr><th>#</th><th>what</th><th>why it matters</th><th>tx</th></tr>
            </thead>
            <tbody>
              {ROWS.map((r, i) => (
                <tr key={i}>
                  <td className="num">{i + 1}</td>
                  <td className="min-w-72">{r.what}</td>
                  <td className="min-w-48 text-mute">{r.why}</td>
                  <td className="min-w-48">{r.tx}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-sm text-mute">
          Also live: the paid credit report on Bankr x402 Cloud (<span className="font-mono break-all">x402.bankr.bot/0x0455408228f460722ecbe80789bcf1628b479e98/gadai-credit</span>, $0.02, answers HTTP 402 with payment requirements).
        </p>
      </Card>

      <Card title="Live vs simulated">
        <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
          <table className="tbl">
            <thead>
              <tr><th>where</th><th>what ran there</th></tr>
            </thead>
            <tbody>
              {SPLIT.map(([where, cls, note, items]) => (
                <tr key={where}>
                  <td className="w-48">
                    <span className={`pill ${cls}`}>{where}</span>
                    <p className="mt-1.5 text-xs text-mute">{note}</p>
                  </td>
                  <td>
                    <ul className="list-disc space-y-0.5 pl-5">
                      {items.map((x) => <li key={x}>{x}</li>)}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Dynamic wallet pattern" right="@dynamic-labs-wallet/node-evm">
        <dl className="grid grid-cols-1 gap-px border border-rule bg-rule sm:grid-cols-2">
          {[
            ["pattern", "Agent wallet"],
            ["owner", "The Gadai desk's Dynamic environment user"],
            ["auth", "Agent signing token → SIWE → user JWT → 2-of-2 MPC"],
            ["address", <span key="a" className="break-all"><Scan kind="address" full h={AGENT_WALLET} /></span>],
          ].map(([k, v]) => (
            <div key={k as string} className="bg-card px-4 py-3">
              <dt className="label">{k}</dt>
              <dd className="mt-1 text-sm">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
