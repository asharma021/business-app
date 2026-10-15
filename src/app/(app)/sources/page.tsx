import { desc } from "drizzle-orm";
import { requireUser } from "@/auth";
import { db } from "@/db";
import { researchJobLogs, researchJobs, sources } from "@/db/schema";
import { daysAgo } from "@/lib/format";
import { features } from "@/lib/env";
import { Badge, Notice, PageHeader, Panel } from "@/components/ui";
import { RunResearchButton } from "@/components/run-research-button";
import { RssForm, SourceToggle } from "./client";
import { ConnectionChecks } from "@/components/ops-buttons";
import { inArray } from "drizzle-orm";

export const metadata = { title: "Research sources" };

const ACCESS: Record<string, { label: string; tone: "gain" | "accent" | "neutral" | "warn" }> = {
  CONFIRMED: { label: "Automated", tone: "gain" },
  MANUAL_ONLY: { label: "Manual import", tone: "accent" },
  PROPOSED: { label: "Proposed — not integrated", tone: "neutral" },
  DISABLED: { label: "Disabled", tone: "warn" },
};

export default async function SourcesPage() {
  await requireUser();
  const [all, jobs] = await Promise.all([db.select().from(sources).orderBy(sources.access, sources.name), db.select().from(researchJobs).orderBy(desc(researchJobs.createdAt)).limit(15)]);
  const logs = jobs.length ? await db.select().from(researchJobLogs).where(inArray(researchJobLogs.jobId, jobs.map((j) => j.id))).orderBy(researchJobLogs.at) : [];
  const rss = all.find((s) => s.key === "rss_feeds");
  return (
    <>
      <PageHeader title="Research sources" description="Where opportunities and market data come from, and how each run went. Proposed sources are never fetched until an authorized integration exists." actions={<RunResearchButton />} />
      {!features.ai() && <div className="mb-4"><Notice tone="warn">ANTHROPIC_API_KEY isn't set, so web discovery, listing extraction and AI research are off. Census market data still runs.</Notice></div>}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <Panel title="Sources" flush>
            <ul className="divide-y divide-line">
              {all.map((s) => (
                <li key={s.id} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{s.name}</span>
                    <Badge tone={ACCESS[s.access].tone}>{ACCESS[s.access].label}</Badge>
                    {(s.access === "CONFIRMED" || s.access === "MANUAL_ONLY") && <span className="ml-auto"><SourceToggle k={s.key} enabled={s.enabled} /></span>}
                  </div>
                  <p className="mt-1 max-w-[80ch] text-muted">{s.termsNote}</p>
                  <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-faint">
                    {s.homepage && <a href={s.homepage} target="_blank" rel="noopener noreferrer" className="hover:text-accent hover:underline">{new URL(s.homepage).hostname}</a>}
                    <span>reliability {s.reliability}/100</span>
                    {s.lastRunAt && <span>last run {daysAgo(s.lastRunAt)}</span>}
                    {s.lastSuccessAt && <span>last success {daysAgo(s.lastSuccessAt)}</span>}
                  </div>
                  {s.lastError && <p className="mt-1 text-xs text-loss">Last error: {s.lastError}</p>}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
        <div className="space-y-6">
          <Panel title="Connection checks">
            <ConnectionChecks />
          </Panel>
          <Panel title="RSS feeds">
            <RssForm feeds={((rss?.config as { feeds?: string[] })?.feeds ?? []).join("\n")} />
          </Panel>
          <Panel title="Research runs" flush>
            {jobs.length ? (
              <ul className="divide-y divide-line">
                {jobs.map((j) => (
                  <li key={j.id} className="px-4 py-3 text-sm">
                    <details>
                      <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                        <Badge tone={j.status === "SUCCEEDED" ? "gain" : j.status === "FAILED" ? "loss" : j.status === "PARTIAL" ? "warn" : "accent"}>{j.status.toLowerCase()}</Badge>
                        <span>{j.kind === "DAILY_RESEARCH" ? "Daily" : j.kind === "MANUAL_RESEARCH" ? "Manual" : j.kind.toLowerCase()}</span>
                        <span className="text-faint">{daysAgo(j.createdAt)}</span>
                      </summary>
                      <dl className="num mt-2 grid grid-cols-2 gap-x-3 text-xs text-muted">
                        <dt>Started</dt><dd>{j.startedAt?.toISOString().replace("T", " ").slice(0, 16) ?? "—"} UTC</dd>
                        <dt>Duration</dt><dd>{j.startedAt && j.finishedAt ? `${Math.round((j.finishedAt.getTime() - j.startedAt.getTime()) / 1000)}s` : "—"}</dd>
                        <dt>Sources</dt><dd>{j.sourcesSucceeded}/{j.sourcesAttempted} succeeded</dd>
                        <dt>Discovered</dt><dd>{j.discovered} new, {j.updated} updated</dd>
                        <dt>Researched</dt><dd>{j.researched}</dd>
                        <dt>Errors</dt><dd>{j.errors}</dd>
                        <dt>AI usage</dt><dd>{(j.inputTokens + j.outputTokens).toLocaleString()} tokens, {j.webSearches} searches</dd>
                        <dt>Cost</dt><dd>{j.costUsd ? `$${Number(j.costUsd).toFixed(2)}` : "Set AI prices to track"}</dd>
                      </dl>
                      <ol className="mt-2 space-y-0.5 text-xs">
                        {logs.filter((l) => l.jobId === j.id).map((l) => (
                          <li key={l.id} className={l.level === "error" ? "text-loss" : l.level === "warn" ? "text-warn" : "text-muted"}>{l.message}</li>
                        ))}
                      </ol>
                    </details>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-4 text-sm text-muted">No runs yet. The worker runs research every morning; use Run research now to start one.</p>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
