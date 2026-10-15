"use client";
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="rounded-lg border border-loss/40 bg-loss/10 p-6">
      <h1 className="font-semibold">This page failed to load</h1>
      <p className="mt-1 text-sm text-muted">{error.digest ? `Error reference ${error.digest}. ` : ""}Check that the database is reachable and the server log for details.</p>
      <button onClick={reset} className="mt-3 text-sm text-accent hover:underline">Try again</button>
    </div>
  );
}
