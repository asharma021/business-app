import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/auth";
import { db } from "@/db";
import { dailyReports, emailDeliveries } from "@/db/schema";
import type { DailyReportContent, ReportItem } from "@/lib/report/daily";
import { Money, Notice, PageHeader, Panel, RecommendationBadge } from "@/components/ui";
import { money } from "@/lib/format";

function Items({ items, empty }: { items: ReportItem[]; empty: string }) {
  if (!items.length) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-line">
      {items.map((i) => (
        <li key={i.id + (i.note ?? "")} className="py-3 text-sm first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <Link href={`/opportunities/${i.id}`} className="font-medium hover:text-accent hover:underline">{i.title}</Link>
            <span className="text-muted">{i.location}{i.score !== null && <> · score <span className="num text-ink">{i.score}</span></>}</span>
          </div>
          {i.note && <p className="mt-1 text-warn">{i.note}</p>}
          <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-4">
            <div><dt className="text-xs text-muted">Asking</dt><dd><Money value={i.askingPrice} /></dd></div>
            <div><dt className="text-xs text-muted">Revenue</dt><dd><Money value={i.revenue} /></dd></div>
            <div><dt className="text-xs text-muted">Reported SDE</dt><dd><Money value={i.cashFlow} /></dd></div>
            <div><dt className="text-xs text-muted">Est. to you after financing</dt><dd className="num">{i.ownerIncomeAfterFinancing === null ? "Not computable" : money(i.ownerIncomeAfterFinancing)}</dd></div>
          </dl>
          <div className="mt-1 flex flex-wrap items-center gap-2"><RecommendationBadge value={i.recommendation} />{i.mainRisk && <span className="text-muted">Main risk: {i.mainRisk}</span>}</div>
          {i.whyInteresting && <p className="mt-1 text-muted">{i.whyInteresting}</p>}
          {i.sourceUrl && <a href={i.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="mt-1 inline-block text-accent hover:underline">Original listing</a>}
        </li>
      ))}
    </ul>
  );
}

export default async function ReportPage({ params }: { params: Promise<{ date: string }> }) {
  const user = await requireUser();
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();
  const [row] = await db.select().from(dailyReports).where(and(eq(dailyReports.userId, user.id), eq(dailyReports.reportDate, date)));
  if (!row) notFound();
  const [delivery] = await db.select().from(emailDeliveries).where(and(eq(emailDeliveries.userId, user.id), eq(emailDeliveries.reportDate, date), eq(emailDeliveries.kind, "daily")));
  const r = row.content as DailyReportContent;
  return (
    <>
      <PageHeader title={`Daily intelligence — ${date}`} description={delivery ? (delivery.status === "SENT" ? `Emailed to ${delivery.to} at ${delivery.sentAt?.toISOString().slice(11, 16)} UTC.` : `Email ${delivery.status.toLowerCase()}${delivery.error ? `: ${delivery.error}` : ""}.`) : "Not emailed."} />
      <div className="max-w-4xl space-y-6">
        <Panel title="Executive summary"><ul className="space-y-1 text-sm">{r.executiveSummary.map((s) => <li key={s}>{s}</li>)}</ul></Panel>
        {!r.hasCompellingOpportunities && <Notice>No compelling opportunities were found for this day. Nothing was added to fill the report.</Notice>}
        <Panel title="Top new opportunities"><Items items={r.newOpportunities} empty="None." /></Panel>
        <Panel title="Most likely to meet your income target"><Items items={r.topIncome} empty="None currently meet your minimum after financing." /></Panel>
        <Panel title="Franchise discoveries"><Items items={r.franchises} empty="None." /></Panel>
        <Panel title="Emerging business models"><p className="text-sm text-muted">Emerging-model research isn't enabled yet (planned phase).</p></Panel>
        <Panel title="Price reductions"><Items items={r.priceReductions} empty="None detected." /></Panel>
        <Panel title="Market changes">{r.marketChanges.length ? <ul className="text-sm">{r.marketChanges.map((m) => <li key={m}>{m}</li>)}</ul> : <p className="text-sm text-muted">None.</p>}</Panel>
        <Panel title="Watchlist alerts"><Items items={r.watchlistAlerts} empty="No changes to saved opportunities." /></Panel>
        <Panel title="Recommended next actions">{r.nextActions.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{r.nextActions.map((m) => <li key={m}>{m}</li>)}</ul> : <p className="text-sm text-muted">None.</p>}</Panel>
      </div>
    </>
  );
}
