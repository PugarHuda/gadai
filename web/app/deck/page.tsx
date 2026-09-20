import type { Metadata } from "next";
import { DeckView } from "@/components/deck-view";

export const metadata: Metadata = {
  title: "Deck",
  description: "The Gadai pitch deck: the problem, the lien, how a loan moves, the underwriting engine, and the Base mainnet evidence.",
};

export default function DeckPage() {
  return <DeckView />;
}
