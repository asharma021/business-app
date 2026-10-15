import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/auth";
import { db } from "@/db";
import { dailyReports, emailDeliveries } from "@/db/schema";
import { getOrCreatePreference } from "@/lib/preferences";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui";
import { SendReportNowButton } from "@/components/ops-buttons";

export const metadata = { title: "Daily intelligence" };

export default async function ReportsPage() {
  const user = await requireUser();
  const pref = await getOrCreatePreference(user.id, user.email);
  const [reports, deliveries] = await Promise.all([
    db.select().from(dailyReports).where(eq(dailyReports.userId, user.id)).orderBy(desc(dailyReports.reportDate)).limit(120),
    db.select().from(emailDeliveries).where(eq(emailDeliveries.userId, user.id)),
  ]);
  const time = `${String(pref.dailyReportHour).padStart(2, "0")}:${String(pref.dailyReportMinute).padStart(2, "0")}`;
  return (
    <>
      <PageHeader title="Daily intelligence" description={`Generated every day at ${time} (${pref.timezone}) and ${pref.dailyEmailEnabled ? `emailed to ${pref.reportEmail ?? user.email}` : "not emailed (turned off in Settings)"}. Weekly and monthly summaries are planned for Phase 6.`} actions={<SendReportNowButton />} />
      <Panel flush>
        {reports.length ? (
          <ul className="divide-y divide-line">
            {reports.map((r) => {
              const d = deliveries.find((x) => x.reportDate === r.reportDate && x.kind === "daily");
              const c = r.content as { executiveSummary?: string[] };
              return (
                <li key={r.id} className="flex flex-wrap items-start gap-3 px-4 py-3 text-sm">
                  <Link href={`/reports/${r.reportDate}`} className="num w-28 font-medium hover:text-accent hover:underline">{r.reportDate}</Link>
                  <p className="min-w-0 flex-1 text-muted">{c.executiveSummary?.slice(0, 2).join(" ")}</p>
                  {d ? <Badge tone={d.status === "SENT" ? "gain" : d.status === "FAILED" ? "loss" : "neutral"}>{d.status === "SENT" ? "Emailed" : d.status === "SKIPPED" ? "Not emailed" : d.status.toLowerCase()}</Badge> : <Badge>Not sent</Badge>}
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState title="No reports yet">The first report is generated at {time} after the morning research run. The background worker must be running.</EmptyState>
        )}
      </Panel>
    </>
  );
}
