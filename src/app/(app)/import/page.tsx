import { PageHeader, Panel } from "@/components/ui";
import { ImportForm } from "./import-form";
import { features } from "@/lib/env";

export const metadata = { title: "Import a listing" };

export default function ImportPage() {
  return (
    <>
      <PageHeader
        title="Import a listing"
        description="Add a business you found on a broker site, marketplace or in an email. Figures are stored exactly as stated and labeled seller-reported until you verify them."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Panel>
          <ImportForm aiEnabled={features.ai()} />
        </Panel>
        <div className="space-y-3 text-sm text-muted">
          <p><span className="font-medium text-ink">URL only:</span> the page is fetched once, only if the site's robots.txt allows it. Logins, CAPTCHAs and paywalls are never bypassed.</p>
          <p><span className="font-medium text-ink">Blocked site?</span> Paste the listing text and include the URL. The URL is kept as the source link.</p>
          <p><span className="font-medium text-ink">Duplicates</span> are merged automatically when the same business appears on more than one site; price changes are tracked.</p>
        </div>
      </div>
    </>
  );
}
