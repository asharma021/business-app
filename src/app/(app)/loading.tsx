export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-4">
      <span className="sr-only">Loading…</span>
      <div className="h-7 w-56 animate-pulse rounded bg-raised" />
      <div className="h-4 w-96 max-w-full animate-pulse rounded bg-raised" />
      <div className="h-64 animate-pulse rounded-lg bg-raised" />
    </div>
  );
}
