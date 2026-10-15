"use client";
import { useActionState, useTransition } from "react";
import { saveRssFeeds, toggleSource, type ActionState } from "@/app/actions";
import { Button, Notice, Textarea } from "@/components/ui";

export function SourceToggle({ k, enabled }: { k: string; enabled: boolean }) {
  const [pending, start] = useTransition();
  return (
    <label className="flex items-center gap-2 text-xs text-muted">
      <input type="checkbox" checked={enabled} disabled={pending} onChange={(e) => start(() => toggleSource(k, e.target.checked))} />
      {enabled ? "On" : "Off"}
    </label>
  );
}

export function RssForm({ feeds }: { feeds: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveRssFeeds, undefined);
  return (
    <form action={action} className="space-y-3">
      <p className="text-sm text-muted">One feed URL per line — for example a broker's published listings feed. robots.txt is checked before every fetch.</p>
      <label htmlFor="feeds" className="sr-only">Feed URLs</label>
      <Textarea id="feeds" name="feeds" rows={4} defaultValue={feeds} placeholder="https://broker.example.com/listings.rss" />
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirm" className="mt-1" /> I'm permitted to use these feeds under the publisher's terms.</label>
      {state?.error && <Notice tone="error">{state.error}</Notice>}
      {state?.message && <Notice tone="ok">{state.message}</Notice>}
      <Button disabled={pending}>Save feeds</Button>
    </form>
  );
}
