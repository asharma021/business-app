import { requireUser } from "@/auth";
import { listOpportunities, OpportunityFilters } from "@/lib/data";
import { getOrCreatePreference } from "@/lib/preferences";
import { EmptyState, LinkButton, PageHeader, Panel } from "@/components/ui";
import { OpportunityTable } from "@/components/opportunity-table";

export const metadata = { title: "Watchlist" };

export default async function WatchlistPage() {
  const user = await requireUser();
  const pref = await getOrCreatePreference(user.id, user.email);
  const rows = await listOpportunities(user.id, OpportunityFilters.parse({ saved: "1", archived: "1", sort: "score" }));
  return (
    <>
      <PageHeader title="Watchlist" description="Saved opportunities. Price, status and financing changes appear as watchlist alerts in your daily email." />
      <Panel flush>
        {rows.length ? (
          <OpportunityTable rows={rows} targets={{ target: pref.targetOwnerIncome, minimum: pref.minOwnerIncome }} />
        ) : (
          <EmptyState title="Nothing saved yet" action={<LinkButton href="/opportunities">Browse opportunities</LinkButton>}>Save an opportunity from its page to track it here.</EmptyState>
        )}
      </Panel>
    </>
  );
}
