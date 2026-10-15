import Link from "next/link";
import { PageHeader, Panel } from "@/components/ui";
import { features } from "@/lib/env";
import { cn } from "@/lib/utils";
import { CsvForm, ImportForm, ManualForm } from "./import-form";

export const metadata = { title: "Import listings" };

const MODES = [
  { key: "url", label: "Link or pasted text", hint: "AI reads the listing" },
  { key: "form", label: "Enter details", hint: "No AI needed" },
  { key: "csv", label: "Upload CSV", hint: "Many at once, no AI" },
] as const;

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const { mode: raw } = await searchParams;
  const mode = MODES.some((m) => m.key === raw) ? raw! : "url";
  return (
    <>
      <PageHeader
        title="Import listings"
        description="Add businesses you found on broker sites, marketplaces or in emails. Figures are stored exactly as stated and labeled seller-reported unless you mark them verified."
      />
      <nav aria-label="Import method" className="mb-4 flex flex-wrap gap-2">
        {MODES.map((m) => (
          <Link
            key={m.key}
            href={`/import?mode=${m.key}`}
            aria-current={mode === m.key ? "page" : undefined}
            className={cn("rounded border px-3 py-2 text-sm", mode === m.key ? "border-accent bg-accent/10 text-ink" : "border-line bg-surface text-muted hover:text-ink")}
          >
            <span className="font-medium">{m.label}</span> <span className="text-xs text-faint">· {m.hint}</span>
          </Link>
        ))}
      </nav>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Panel>{mode === "url" ? <ImportForm aiEnabled={features.ai()} /> : mode === "form" ? <ManualForm /> : <CsvForm />}</Panel>
        <div className="space-y-3 text-sm text-muted">
          {mode === "url" && (
            <>
              <p><span className="font-medium text-ink">Link only:</span> the page is fetched once, only if the site's robots.txt allows it. Logins, CAPTCHAs and paywalls are never bypassed.</p>
              <p><span className="font-medium text-ink">Blocked site?</span> Paste the listing text and include the link. The link is kept as the source.</p>
            </>
          )}
          {mode === "form" && <p>Tick <span className="font-medium text-ink">verified</span> only when you've checked the figures against tax returns or financial statements — verified figures raise the confidence score and let a listing be rated a strong candidate.</p>}
          {mode === "csv" && (
            <>
              <p>Only <span className="font-medium text-ink">title</span> is required. Blank cells stay "Not disclosed" — they're never treated as zero.</p>
              <p><a href="/listing-import-template.csv" download className="text-accent hover:underline">Download the CSV template</a></p>
            </>
          )}
          <p><span className="font-medium text-ink">Duplicates</span> are merged when the same business appears more than once, and price changes are tracked.</p>
        </div>
      </div>
    </>
  );
}
