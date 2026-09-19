import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { missingEnv, ENV } from "@/lib/env";
import { Providers } from "@/lib/wallet";
import { Nav } from "@/components/nav";

const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-mono" });
const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-sans" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", variable: "--font-serif-display" });

export const metadata: Metadata = {
  title: "Gadai — credit against Bankr creator fees",
  description: "USDC loans for Bankr agents, collateralized by Doppler fee rights on Base. Funded by FeeNote auctions.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const missing = missingEnv();
  return (
    <html lang="en" className={`${mono.variable} ${sans.variable} ${serif.variable}`}>
      <body className="min-h-screen antialiased">
        {missing.length ? (
          <main className="mx-auto max-w-2xl p-10">
            <h1 className="h1">Gadai is not configured</h1>
            <p className="mt-4">Missing env (see .env.example), set at build time:</p>
            <ul className="mt-2 list-disc pl-6 font-mono text-stamp">
              {missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </main>
        ) : (
          <Providers>
            {ENV.DEMO_FORK && (
              <div className="sticky top-0 z-50 bg-stamp px-4 py-1.5 text-center font-mono text-xs uppercase tracking-widest text-paper">
                DEMO_FORK · Anvil fork of Base ({ENV.FORK_RPC_URL}) · on-chain state is local · Flash: mainnet only
              </div>
            )}
            <Nav />
            <main className="mx-auto max-w-6xl px-4 pb-24 pt-6">{children}</main>
            <footer className="mx-auto max-w-6xl border-t-[1.5px] border-ink px-4 py-6 font-mono text-[11px] text-mute">
              Gadai · Base 8453 · Bankr fee APIs + LLM Gateway · Dynamic wallets · Uniswap CCA + Trading API · Definitive Flash · Blackbird Flynet
            </footer>
          </Providers>
        )}
      </body>
    </html>
  );
}
