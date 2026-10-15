import Link from "next/link";
import { requireUser } from "@/auth";
import { listOpportunities, opportunitiesByIds, OpportunityFilters, type OpportunityRow } from "@/lib/data";
import { location, money } from "@/lib/format";
import { getOrCreatePreference } from "@/lib/preferences";
import { Button, EmptyState, Money, PageHeader, Panel, RecommendationBadge } from "@/components/ui";
import { IncomeBar } from "@/components/income-bar";

export const metadata = { title: "Compare" };

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ ids?: string | string[] }> }) {
  const user = await requireUser();
  const pref = await getOrCreatePreference(user.id, user.email);
  const sp = await searchParams;
  const ids = [...new Set((Array.isArray(sp.ids) ? sp.ids : (sp.ids ?? "").split(",")).flatMap((s) => s.split(",")).filter(Boolean))].slice(0, 5);
  const [rows, choices] = await Promise.all([opportunitiesByIds(user.id, ids), listOpportunities(user.id, OpportunityFilters.parse({ sort: "score" }), 40)]);
  const R: [string, (o: OpportunityRow) => React.ReactNode][] = [
    ["Location", (o) => location(o)],
    ["Asking price", (o) => <Money value={o.askingPrice} />],
    ["Revenue", (o) => <Money value={o.revenue} />],
    ["Reported SDE", (o) => <Money value={o.cashFlow} />],
    ["Cash needed at close", (o) => (o.base ? money(o.base.upfrontInvestment) : "—")],
    ["Monthly debt service", (o) => (o.base ? money(o.base.monthlyDebtService) : "—")],
    ["Est. cash to you / yr", (o) => <IncomeBar data={o.base} target={pref.targetOwnerIncome} minimum={pref.minOwnerIncome} compact />],
    ["Debt coverage", (o) => (o.base?.dscr != null ? `${o.base.dscr.toFixed(2)}×` : "—")],
    ["Payback (yrs)", (o) => (o.base?.paybackYears != null ? o.base.paybackYears.toFixed(1) : "—")],
    ["Seller financing", (o) => (o.sellerFinancing === null ? "Not disclosed" : o.sellerFinancing ? "Yes" : "No")],
    ["Score", (o) => (o.score ?? "—")],
    ["Data confidence", (o) => (o.confidence ?? "—")],
    ["Recommendation", (o) => (o.recommendation ? <RecommendationBadge value={o.recommendation} /> : "—")],
  ];
  return (
    <>
      <PageHeader title="Compare businesses" description="Side by side, up to five. Market growth, risk and scalability detail lives on each research page; deeper comparison and scenario charts arrive in Phase 2." />
      <form method="get" className="mb-6 rounded-lg border border-line bg-surface p-4">
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Choose up to 5</legend>
          <div className="grid max-h-56 gap-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
            {choices.map((c) => (
              <label key={c.id} className="flex items-center gap-2 truncate text-sm">
                <input type="checkbox" name="ids" value={c.id} defaultChecked={ids.includes(c.id)} /> <span className="truncate">{c.title}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <Button variant="primary" className="mt-3">Compare selected</Button>
      </form>
      {rows.length ? (
        <Panel flush>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-line">
                <tr>
                  <th scope="col" className="w-44 px-4 py-3 text-left text-xs font-medium text-muted"> </th>
                  {rows.map((o) => <th key={o.id} scope="col" className="px-4 py-3 text-left align-top font-semibold"><Link href={`/opportunities/${o.id}`} className="hover:text-accent hover:underline">{o.title}</Link></th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {R.map(([label, fn]) => (
                  <tr key={label}>
                    <th scope="row" className="px-4 py-2 text-left font-normal text-muted">{label}</th>
                    {rows.map((o) => <td key={o.id} className="num px-4 py-2 align-top">{fn(o)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : (
        <Panel><EmptyState title="Pick opportunities to compare">Select up to five above, or use Compare on any opportunity page.</EmptyState></Panel>
      )}
    </>
  );
}
