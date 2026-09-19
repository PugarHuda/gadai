import type { Metadata } from "next";
import { Archivo, Chivo_Mono } from "next/font/google";
import "./globals.css";
import { missingEnv, ENV } from "@/lib/env";
import { Providers } from "@/lib/wallet";
import { Nav } from "@/components/nav";

const sans = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo" });
const mono = Chivo_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-chivo-mono" });

export const metadata: Metadata = {
  title: { default: "Gadai · credit against Bankr creator fees", template: "%s · Gadai" },
  description: "USDC loans for Bankr agents, collateralized by Doppler fee rights on Base. Funded by FeeNote auctions.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const missing = missingEnv();
  return (
    <html lang="en" className={`${mono.variable} ${sans.variable}`}>
      <body className="min-h-screen antialiased">
        {missing.length ? (
          <main className="mx-auto max-w-2xl px-4 py-16">
            <div className="card p-6 sm:p-8">
              <h1 className="h1">Gadai is not configured</h1>
              <p className="mt-4">These environment variables are missing. Set them at build time (see .env.example):</p>
              <ul className="mt-3 list-disc pl-6 font-mono text-sm text-stamp">
                {missing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          </main>
        ) : (
          <Providers>
            <a href="#main" className="sr-only z-[60] bg-ink px-3 py-2 text-paper focus:not-sr-only focus:fixed focus:left-2 focus:top-2">
              Skip to content
            </a>
            {ENV.DEMO_FORK && (
              <div role="note" className="sticky top-0 z-50 border-b border-ink bg-ink px-4 py-1.5 text-center text-xs text-paper">
                <span className="pill mr-2 border-amber text-amber">Demo fork</span>
                Anvil fork of Base (<span className="font-mono">{ENV.FORK_RPC_URL}</span>). On-chain state is local; Flash orders are mainnet only.
              </div>
            )}
            <Nav />
            <main id="main" tabIndex={-1} className="mx-auto max-w-6xl px-4 pb-24 pt-8 sm:pt-10">{children}</main>
            <footer className="border-t border-rule">
              <div className="mx-auto flex max-w-6xl flex-wrap gap-x-6 gap-y-1 px-4 py-6 text-xs text-mute">
                <span className="font-semibold text-ink">Gadai · Base 8453</span>
                <span>Bankr fee APIs and LLM Gateway</span>
                <span>Dynamic wallets</span>
                <span>Uniswap CCA and Trading API</span>
                <span>Definitive Flash</span>
                <span>Blackbird Flynet</span>
              </div>
            </footer>
          </Providers>
        )}
      </body>
    </html>
  );
}
