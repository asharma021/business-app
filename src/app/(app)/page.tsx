import Link from "next/link";
import { and, desc, eq, isNull } from "drizzle-orm";
import { requireUser } from "@/auth";
import { db } from "@/db";
import { dailyReports, notifications, researchJobs } from "@/db/schema";
import { overviewData } from "@/lib/data";
import { daysAgo, money } from "@/lib/format";
import { getOrCreatePreference } from "@/lib/preferences";
import { EmptyState, LinkButton, Notice, PageHeader, Panel, RecommendationBadge } from "@/components/ui";
import { OpportunityTable } from "@/components/opportunity-table";
import { RunResearchButton } from "@/components/run-research-button";
import { markNotificationsRead } from "@/app/actions";
import type { DailyReportContent } from "@/lib/report/daily";

export const metadata = { title: "Overview" };

export default async function OverviewPage() {
  const user = await requireUser();
  const pref = await getOrCreatePreference(user.id, user.email);
  const targets = { target: pref.targetOwnerIncome, minimum: pref.minOwnerIncome };
  const [data, [lastJob], [latestReport], alerts] = await Promise.all([
    overviewData(user.id),
    db.select().from(researchJobs).orderBy(desc(researchJobs.createdAt)).limit(1),
    db.select().from(dailyReports).where(eq(dailyReports.userId, user.id)).orderBy(desc(dailyReports.reportDate)).limit(1),
    db.select().from(notifications).where(and(eq(notifications.userId, user.id), isNull(notifications.readAt))).orderBy(desc(notifications.createdAt)).limit(5),
  ]);
  const summary = (latestReport?.content as DailyReportContent | undefined)?.executiveSummary;
  const nothingYet = data.top.length === 0;

  return (
    <>
      <PageHeader
        title="Overview"
        description={
          <>
            Looking for {money(pref.targetOwnerIncome)}/yr to you after financing and tax (minimum {money(pref.minOwnerIncome)}).{" "}
            {lastJob ? `Last research run ${daysAgo(lastJob.createdAt)}: ${lastJob.status.toLowerCase()}.` : "No research has run yet."}
          </>
        }
        actions={
          <>
            <LinkButton href="/import">Import a listing</LinkButton>
            <RunResearchButton />
          </>
        }
      />

      {alerts.length > 0 && (
        <div className="mb-6 space-y-2">
          {alerts.map((a) => (
            <Notice key={a.id} tone="error">
              <span className="font-medium">{a.title}.</span> {a.body}
            </Notice>
          ))}
          <form action={markNotificationsRead}>
            <button className="text-sm text-muted underline hover:text-ink">Dismiss alerts</button>
          </form>
        </div>
      )}

      {nothingYet ? (
        <Panel>
          <EmptyState
            title="No opportunities yet"
            action={
              <div className="flex justify-center gap-2">
                <LinkButton href="/import" variant="primary">Import a listing</LinkButton>
                <LinkButton href="/sources">Check research sources</LinkButton>
              </div>
            }
          >
            Paste a listing URL or text you found on a broker site, or run research to search public listings. Each opportunity is checked against your income target after debt service and estimated tax.
          </EmptyState>
        </Panel>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-6">
            <Panel title="Could reach your income target" action={<Link href="/opportunities?meetsTarget=1" className="text-sm text-accent hover:underline">See all</Link>} flush>
              {data.meeting.length ? (
                <OpportunityTable rows={data.meeting} targets={targets} compact />
              ) : (
                <EmptyState title="Nothing clears your target yet">
                  Based on reported figures and your saved financing assumptions, no tracked business leaves {money(pref.targetOwnerIncome)}/yr after debt and tax. Adjust assumptions in Settings or keep researching.
                </EmptyState>
              )}
            </Panel>
            <Panel title="New in the last 24 hours" flush>
              {data.newToday.length ? <OpportunityTable rows={data.newToday.slice(0, 8)} targets={targets} compact /> : <EmptyState title="No new opportunities today" />}
            </Panel>
            <Panel title="Highest scored" action={<Link href="/opportunities" className="text-sm text-accent hover:underline">All opportunities</Link>} flush>
              <OpportunityTable rows={data.top} targets={targets} compact />
            </Panel>
          </div>

          <div className="space-y-6">
            <Panel title="Daily summary" action={latestReport && <Link href={`/reports/${latestReport.reportDate}`} className="text-sm text-accent hover:underline">{latestReport.reportDate}</Link>}>
              {summary ? (
                <ul className="space-y-1.5 text-sm">{summary.map((s, i) => <li key={i}>{s}</li>)}</ul>
              ) : (
                <p className="text-sm text-muted">The first daily report is generated at {String(pref.dailyReportHour).padStart(2, "0")}:{String(pref.dailyReportMinute).padStart(2, "0")} ({pref.timezone}).</p>
              )}
            </Panel>
            <Panel title="Price reductions (30 days)">
              {data.priceCuts.length ? (
                <ul className="space-y-2 text-sm">
                  {data.priceCuts.slice(0, 6).map(({ r, title }) => (
                    <li key={r.id}>
                      <Link href={`/opportunities/${r.opportunityId}`} className="font-medium hover:text-accent hover:underline">{title}</Link>
                      <div className="num text-muted">
                        {money(Number(r.oldValue))} → <span className="text-gain">{money(Number(r.newValue))}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">No price changes detected.</p>
              )}
            </Panel>
            <Panel title="Needs more information">
              {data.needsInfo.length ? (
                <ul className="space-y-1.5 text-sm">
                  {data.needsInfo.map((o) => (
                    <li key={o.id}>
                      <Link href={`/opportunities/${o.id}`} className="hover:text-accent hover:underline">{o.title}</Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">Every researched opportunity has a price and cash flow.</p>
              )}
            </Panel>
            <Panel title="Recently researched">
              {data.recentResearch.length ? (
                <ul className="space-y-2 text-sm">
                  {data.recentResearch.map((r) => (
                    <li key={r.id} className="flex items-start justify-between gap-2">
                      <Link href={`/opportunities/${r.opportunityId}`} className="hover:text-accent hover:underline">{r.title}</Link>
                      <RecommendationBadge value={r.rec} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">No AI research reports yet.</p>
              )}
            </Panel>
            <Panel title="Saved" action={<Link href="/watchlist" className="text-sm text-accent hover:underline">Watchlist</Link>}>
              {data.saved.length ? (
                <ul className="space-y-1.5 text-sm">
                  {data.saved.map((o) => (
                    <li key={o.id}><Link href={`/opportunities/${o.id}`} className="hover:text-accent hover:underline">{o.title}</Link></li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">Save opportunities to track changes and get watchlist alerts.</p>
              )}
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}
