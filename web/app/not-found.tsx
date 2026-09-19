import Link from "next/link";

export default function NotFound() {
  return (
    <div className="space-y-4">
      <h1 className="h1">Not found</h1>
      <p role="alert" className="max-w-[60ch] text-sm">
        This page was not found. Loan and dining links use a positive integer loan id, e.g. <span className="font-mono">/loans/1</span>.
      </p>
      <Link href="/" className="link text-sm">Back to the loan book</Link>
    </div>
  );
}
