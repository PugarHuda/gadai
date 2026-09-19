"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DynamicWidget } from "@dynamic-labs/sdk-react-core";

const LINKS = [
  ["/", "Loan book"],
  ["/apply", "Borrow"],
  ["/board", "Credit lines"],
  ["/notes", "Lend"],
  ["/desk", "Follow the Desk"],
  ["/dine", "Dine"],
  ["/demo", "Demo"],
  ["/evidence", "Evidence"],
] as const;

export function Nav() {
  const p = usePathname();
  return (
    <header className="border-b border-rule bg-paper">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-2 px-4 pt-3 md:flex-nowrap md:py-0">
        <Link href="/" className="flex items-baseline gap-2 md:py-3" aria-label="Gadai, loan book">
          <span className="font-display text-2xl leading-none">Gadai</span>
          <span className="hidden text-xs text-mute lg:inline">registry of pledged fee rights</span>
        </Link>
        <div className="order-last -mx-4 w-[calc(100%+2rem)] overflow-x-auto md:order-none md:mx-0 md:w-auto md:flex-1">
          <nav aria-label="Main" className="flex gap-1 px-4 md:px-0">
            {LINKS.map(([h, l]) => {
              const on = h === "/" ? p === "/" || p.startsWith("/loans/") : p.startsWith(h); // a loan page belongs to the loan book
              return (
                <Link
                  key={h}
                  href={h}
                  aria-current={on ? "page" : undefined}
                  className={`whitespace-nowrap border-b-2 px-2.5 py-3 text-sm font-semibold transition-colors md:py-4 ${on ? "border-violet text-ink" : "border-transparent text-mute hover:text-ink"}`}
                >
                  {l}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="ml-auto md:ml-0">
          <DynamicWidget />
        </div>
      </div>
    </header>
  );
}
