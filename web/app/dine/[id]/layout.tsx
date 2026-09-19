import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return { title: `Dine · loan #${(await params).id}` };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
