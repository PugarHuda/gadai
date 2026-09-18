"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DynamicWidget } from "@dynamic-labs/sdk-react-core";

const LINKS = [
  ["/", "Loan book"],
  ["/apply", "Borrow"],
  ["/notes", "Lend · FeeNotes"],
  ["/desk", "Follow the Desk"],
  ["/dine", "Dine"],
] as const;

export function Nav() {
  const p = usePathname();
  return (
    <nav className="border-b-[1.5px] border-ink bg-paper/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="font-serif text-3xl leading-none">
          Fee<span className="text-desk">/</span>Desk
        </Link>
        <div className="flex flex-1 flex-wrap gap-x-4 gap-y-1">
          {LINKS.map(([h, l]) => {
            const on = h === "/" ? p === "/" : p.startsWith(h);
            return (
              <Link key={h} href={h} className={`font-mono text-xs uppercase tracking-widest ${on ? "text-ink underline decoration-2 underline-offset-4" : "text-mute hover:text-ink"}`}>
                {l}
              </Link>
            );
          })}
        </div>
        <DynamicWidget />
      </div>
    </nav>
  );
}
