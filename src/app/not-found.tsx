import Link from "next/link";
export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-2 text-center">
      <h1 className="text-lg font-semibold">Page not found</h1>
      <p className="text-sm text-muted">That opportunity or report doesn't exist, or it was removed.</p>
      <Link href="/" className="mt-2 text-sm text-accent hover:underline">Go to overview</Link>
    </div>
  );
}
