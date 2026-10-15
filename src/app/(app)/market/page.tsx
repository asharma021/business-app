import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/auth";
import { db } from "@/db";
import { marketStats, sources } from "@/db/schema";
import { daysAgo, money } from "@/lib/format";
import { EmptyState, PageHeader, Panel } from "@/components/ui";

export const metadata = { title: "Market trends" };

export default async function MarketPage() {
  await requireUser();
  const rows = await db.select().from(marketStats).orderBy(desc(marketStats.establishments));
  const [src] = await db.select().from(sources).where(eq(sources.key, "census_cbp"));
  const max = Math.max(1, ...rows.map((r) => r.establishments ?? 0));
  const year = rows[0]?.year;
  return (
    <>
      <PageHeader
        title="Market trends"
        description={<>Official establishment, employment and payroll counts for tracked service industries in the Dallas-Fort Worth-Arlington metro, from the U.S. Census Bureau County Business Patterns API{year ? ` (${year} data)` : ""}. Year-over-year trends, BLS and FRED data arrive in Phase 2.</>}
      />
      <Panel title={rows[0]?.geoLabel ?? "Dallas-Fort Worth-Arlington, TX"} action={src && <span className="text-xs text-muted">Last refreshed {daysAgo(src.lastSuccessAt)}</span>} flush>
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-line text-xs text-muted">
                <tr>
                  <th scope="col" className="px-4 py-2 text-left font-medium">Industry (NAICS)</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Establishments</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Employees</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Employees per firm</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Avg. annual pay</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <th scope="row" className="px-4 py-2 text-left font-normal">{r.naicsLabel} <span className="text-faint">{r.naics}</span></th>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="num w-14 text-right">{r.establishments?.toLocaleString() ?? "—"}</span>
                        <span className="h-2 rounded-sm bg-accent/60" style={{ width: `${((r.establishments ?? 0) / max) * 160}px` }} aria-hidden />
                      </div>
                    </td>
                    <td className="num px-3 py-2 text-right">{r.employees?.toLocaleString() ?? "—"}</td>
                    <td className="num px-3 py-2 text-right">{r.employees && r.establishments ? (r.employees / r.establishments).toFixed(1) : "—"}</td>
                    <td className="num px-4 py-2 text-right">{r.annualPayrollThousands && r.employees ? money((r.annualPayrollThousands * 1000) / r.employees) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-4 py-3 text-xs text-muted">Source: U.S. Census Bureau, County Business Patterns. Small employers dominate most of these industries — a high establishment count with few employees per firm usually means a fragmented market where acquisitions can consolidate.</p>
          </div>
        ) : (
          <EmptyState title="No market data yet">{src?.lastError ? `Last attempt failed: ${src.lastError}` : "Census data loads on the next research run."}</EmptyState>
        )}
      </Panel>
    </>
  );
}
