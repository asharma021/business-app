import Link from "next/link";
import { Bookmark } from "lucide-react";
import type { OpportunityRow } from "@/lib/data";
import { daysAgo, location } from "@/lib/format";
import { Badge, Money, RecommendationBadge, RESEARCH_STATUS_LABEL, ScoreBadge } from "@/components/ui";
import { IncomeBar } from "@/components/income-bar";

export interface Targets {
  target: number;
  minimum: number;
}

/**
 * Dense, scannable list of opportunities. Rows become stacked cards on narrow screens.
 * Every financial cell distinguishes "Not disclosed" from a real figure.
 */
export function OpportunityTable({ rows, targets, compact = false }: { rows: OpportunityRow[]; targets: Targets; compact?: boolean }) {
  return (
    <div className="overflow-hidden">
      <table className="w-full text-sm">
        <thead className="hidden border-b border-line text-left text-xs text-muted md:table-header-group">
          <tr>
            <th scope="col" className="px-4 py-2 font-medium">Opportunity</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Asking</th>
            {!compact && <th scope="col" className="px-3 py-2 text-right font-medium">Revenue</th>}
            <th scope="col" className="px-3 py-2 text-right font-medium">Reported SDE</th>
            <th scope="col" className="px-3 py-2 font-medium">Est. owner cash after debt &amp; tax</th>
            {!compact && <th scope="col" className="px-3 py-2 text-right font-medium">Cash needed</th>}
            <th scope="col" className="px-4 py-2 text-right font-medium">Score</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.id} className="block px-4 py-3 hover:bg-raised/40 md:table-row md:p-0">
              <td className="block md:table-cell md:px-4 md:py-3 md:align-top">
                <Link href={`/opportunities/${r.id}`} className="font-medium text-ink hover:text-accent hover:underline">
                  {r.title}
                </Link>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                  <span>{location(r)}</span>
                  {r.industry && <span>{r.industry}</span>}
                  {r.type === "FRANCHISE" && <Badge tone="accent">Franchise</Badge>}
                  {r.sellerFinancing && <Badge tone="gain">Seller financing</Badge>}
                  {r.saved && <Bookmark className="h-3.5 w-3.5 fill-current text-accent" aria-label="Saved" />}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-faint">
                  <span>Found {daysAgo(r.firstDiscoveredAt)}</span>
                  <span>{RESEARCH_STATUS_LABEL[r.researchStatus] ?? r.researchStatus}</span>
                  <RecommendationBadge value={r.recommendation} />
                  {r.pipelineStatus === "CONTACTED" && <Badge tone="accent">Contacted</Badge>}
                  {r.pipelineStatus === "REJECTED" && <Badge tone="loss">Rejected</Badge>}
                </div>
              </td>
              <td className="inline-block w-1/2 pt-2 md:table-cell md:w-auto md:px-3 md:py-3 md:text-right md:align-top">
                <span className="block text-xs text-muted md:hidden">Asking</span>
                <Money value={r.askingPrice} />
              </td>
              {!compact && (
                <td className="hidden md:table-cell md:px-3 md:py-3 md:text-right md:align-top">
                  <Money value={r.revenue} />
                </td>
              )}
              <td className="inline-block w-1/2 pt-2 md:table-cell md:w-auto md:px-3 md:py-3 md:text-right md:align-top">
                <span className="block text-xs text-muted md:hidden">Reported SDE</span>
                <Money value={r.cashFlow} />
              </td>
              <td className="block pt-2 md:table-cell md:px-3 md:py-3 md:align-top">
                <span className="block text-xs text-muted md:hidden">Est. owner cash after debt &amp; tax</span>
                <IncomeBar data={r.base} target={targets.target} minimum={targets.minimum} compact />
              </td>
              {!compact && (
                <td className="hidden md:table-cell md:px-3 md:py-3 md:text-right md:align-top">
                  {r.base ? <Money value={r.base.upfrontInvestment} /> : <span className="text-faint">—</span>}
                </td>
              )}
              <td className="block pt-2 md:table-cell md:px-4 md:py-3 md:text-right md:align-top">
                <ScoreBadge score={r.score} confidence={r.confidence} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
