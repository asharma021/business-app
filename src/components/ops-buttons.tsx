"use client";
import Link from "next/link";
import { useActionState } from "react";
import { runConnectionChecks, sendReportNowAction, sendTestEmailAction, type ActionState, type ChecksState } from "@/app/actions";
import { Badge, Button } from "@/components/ui";

export function SendTestEmailButton() {
  const [state, action, pending] = useActionState<ActionState>(async () => sendTestEmailAction(), undefined);
  return (
    <form action={action} className="space-y-2">
      <Button type="submit" disabled={pending}>{pending ? "Sending…" : "Send test email"}</Button>
      {state?.message && <p role="status" className="text-sm text-gain">{state.message}</p>}
      {state?.error && <p role="alert" className="text-sm text-loss">{state.error}</p>}
    </form>
  );
}

export function SendReportNowButton() {
  const [state, action, pending] = useActionState<ActionState>(async () => sendReportNowAction(), undefined);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      {state?.message && (
        <span role="status" className="text-sm text-gain">
          {state.message} {state.id && <Link href={`/reports/${state.id}`} className="text-accent hover:underline">Open it</Link>}
        </span>
      )}
      {state?.error && <span role="alert" className="text-sm text-loss">{state.error}</span>}
      <Button variant="primary" disabled={pending}>{pending ? "Building…" : "Build and email today's report now"}</Button>
    </form>
  );
}

const TONE = { ok: "gain", warn: "warn", fail: "loss", skipped: "neutral" } as const;
const LABEL = { ok: "Pass", warn: "Warning", fail: "Fail", skipped: "Not configured" } as const;

export function ConnectionChecks() {
  const [state, action, pending] = useActionState<ChecksState, FormData>(runConnectionChecks, undefined);
  return (
    <form action={action} className="space-y-3">
      <p className="text-sm text-muted">Makes one small real request to each service to confirm keys, permissions and the worker are working.</p>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="webSearch" /> Also test Claude web search (one search, about $0.01)</label>
      <Button disabled={pending}>{pending ? "Checking…" : "Check connections"}</Button>
      {state?.error && <p role="alert" className="text-sm text-loss">{state.error}</p>}
      {state?.results && (
        <ul className="divide-y divide-line text-sm" role="status">
          {state.results.map((r) => (
            <li key={r.name} className="py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{r.name}</span>
                <Badge tone={TONE[r.status]}>{LABEL[r.status]}</Badge>
              </div>
              <p className="mt-0.5 text-muted">{r.detail}</p>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
