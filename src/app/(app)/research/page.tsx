import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/auth";
import { db } from "@/db";
import { opportunities, researchReports } from "@/db/schema";
import { daysAgo } from "@/lib/format";
import { EmptyState, PageHeader, Panel, RecommendationBadge } from "@/components/ui";

export const metadata = { title: "AI research reports" };

export default async function ResearchPage() {
  await requireUser();
  const rows = await db
    .select({ r: researchReports, title: opportunities.title, opportunityId: opportunities.id })
    .from(researchReports)
    .innerJoin(opportunities, eq(opportunities.id, researchReports.opportunityId))
    .orderBy(desc(researchReports.createdAt))
    .limit(200);
  return (
    <>
      <PageHeader title="AI research reports" description="Every report is checked before it's saved: sources not found in the research are removed, and recommendations are capped until financials are verified." />
      <Panel flush>
        {rows.length ? (
          <ul className="divide-y divide-line">
            {rows.map(({ r, title, opportunityId }) => (
              <li key={r.id} className="flex flex-wrap items-start gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <Link href={`/opportunities/${opportunityId}`} className="font-medium hover:text-accent hover:underline">{title}</Link>
                  <p className="mt-0.5 line-clamp-2 max-w-[80ch] text-muted">{r.summary}</p>
                </div>
                <RecommendationBadge value={r.recommendation} />
                <span className="w-40 text-right text-xs text-faint">v{r.version} · {daysAgo(r.createdAt)}<br />{r.auditFlags.length} audit flag{r.auditFlags.length === 1 ? "" : "s"} · {r.webSearches} searches</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No research reports yet">Reports are created by the daily research run for the most promising new opportunities, or when you request research on an opportunity.</EmptyState>
        )}
      </Panel>
    </>
  );
}
