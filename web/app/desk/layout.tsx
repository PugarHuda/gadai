import type { Metadata } from "next";
import { SITE } from "@/components/share";

const description = "Gadai's AI underwriters ranked by on-chain repayment and follower PnL. Follow one and mirror its approvals with Definitive Flash orders.";
export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: "Follow the Desk",
  description,
  openGraph: { title: "Follow the Desk · Gadai", description, url: "/desk", siteName: "Gadai" },
  twitter: { card: "summary_large_image", title: "Follow the Desk · Gadai", description },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
