import Link from "next/link";
import { requireUser } from "@/auth";
import { listOpportunities, parseFilters } from "@/lib/data";
import { getOrCreatePreference } from "@/lib/preferences";
import { Button, EmptyState, Input, Label, LinkButton, PageHeader, Panel, Select } from "@/components/ui";
import { OpportunityTable } from "@/components/opportunity-table";

export const metadata = { title: "Opportunities" };

const TITLES: Record<string, { title: string; description: string }> = {
  ACQUISITION: { title: "Business acquisitions", description: "Established businesses listed for sale." },
  FRANCHISE: { title: "Franchises", description: "Franchise resales and franchise offerings. FDD performance figures are never assumed to apply to every location." },
};

export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const pref = await getOrCreatePreference(user.id, user.email);
  const f = parseFilters(await searchParams);
  const rows = await listOpportunities(user.id, f, 200);
  const head = (f.type && TITLES[f.type]) || { title: "Discover opportunities", description: "Every opportunity found by research or imported by you, ranked against your goals." };
  const hasFilters = Object.keys(f).some((k) => k !== "sort" && k !== "type" && (f as Record<string, unknown>)[k] !== undefined);

  return (
    <>
      <PageHeader title={head.title} description={head.description} actions={<LinkButton href="/import" variant="primary">Import a listing</LinkButton>} />
      <form method="get" className="mb-4 rounded-lg border border-line bg-surface p-4" role="search">
        {f.type && <input type="hidden" name="type" value={f.type} />}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
          <div className="col-span-2">
            <Label htmlFor="q">Search</Label>
            <Input id="q" name="q" defaultValue={f.q} placeholder="Industry, city, keyword" />
          </div>
          <div>
            <Label htmlFor="state">State</Label>
            <Input id="state" name="state" defaultValue={f.state} maxLength={2} placeholder="TX" />
          </div>
          <div>
            <Label htmlFor="maxPrice">Max asking ($)</Label>
            <Input id="maxPrice" name="maxPrice" inputMode="numeric" defaultValue={f.maxPrice} placeholder="Any" />
          </div>
          <div>
            <Label htmlFor="minCashFlow">Min SDE ($)</Label>
            <Input id="minCashFlow" name="minCashFlow" inputMode="numeric" defaultValue={f.minCashFlow} placeholder="Any" />
          </div>
          <div>
            <Label htmlFor="minScore">Min score</Label>
            <Input id="minScore" name="minScore" inputMode="numeric" defaultValue={f.minScore} placeholder="0" />
          </div>
          <div>
            <Label htmlFor="research">Research</Label>
            <Select id="research" name="research" defaultValue={f.research ?? ""}>
              <option value="">Any</option>
              <option value="RESEARCHED">Researched</option>
              <option value="QUEUED">Queued</option>
              <option value="NEEDS_INFO">Needs financials</option>
              <option value="FAILED">Failed</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="sort">Sort by</Label>
            <Select id="sort" name="sort" defaultValue={f.sort}>
              <option value="score">Score</option>
              <option value="income">Owner cash</option>
              <option value="newest">Newest</option>
              <option value="cashflow">Reported SDE</option>
              <option value="price">Lowest price</option>
            </Select>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" name="meetsTarget" value="1" defaultChecked={!!f.meetsTarget} className="accent-[rgb(var(--accent))]" /> Meets income target</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="sellerFinancing" value="1" defaultChecked={!!f.sellerFinancing} /> Seller financing</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="saved" value="1" defaultChecked={!!f.saved} /> Saved only</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="archived" value="1" defaultChecked={!!f.archived} /> Include archived</label>
          <div className="ml-auto flex gap-2">
            {hasFilters && <Link href={f.type ? `/opportunities?type=${f.type}` : "/opportunities"} className="inline-flex h-9 items-center px-2 text-sm text-muted hover:text-ink">Clear</Link>}
            <Button variant="primary">Apply filters</Button>
          </div>
        </div>
      </form>
      <Panel title={`${rows.length} result${rows.length === 1 ? "" : "s"}`} flush>
        {rows.length ? (
          <OpportunityTable rows={rows} targets={{ target: pref.targetOwnerIncome, minimum: pref.minOwnerIncome }} />
        ) : (
          <EmptyState title={hasFilters ? "No opportunities match these filters" : "No opportunities yet"} action={<LinkButton href="/import">Import a listing</LinkButton>}>
            {hasFilters ? "Loosen a filter or clear them to see everything." : "Import a listing or run research from the Overview page."}
          </EmptyState>
        )}
      </Panel>
    </>
  );
}
