import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { requireUser } from "@/auth";
import { getOpportunityDetail } from "@/lib/data";
import { daysAgo, location, money } from "@/lib/format";
import { getOrCreatePreference } from "@/lib/preferences";
import { ResearchReportSchema, type Finding } from "@/lib/ai/schemas";
import { SCENARIO_ADJUSTMENTS, type CalculatorResult } from "@/lib/finance/calculator";
import type { CategoryScore } from "@/lib/scoring";
import { Badge, Money, Notice, PageHeader, Panel, RecommendationBadge, RESEARCH_STATUS_LABEL, ScoreBadge } from "@/components/ui";
import { IncomeBar } from "@/components/income-bar";
import { FeedbackChips, NoteForm, OpportunityActions, CompleteNoteButton } from "./client";

export const metadata = { title: "Opportunity" };

const PROV: Record<string, { label: string; tone: "gain" | "neutral" | "accent" | "warn" }> = {
  VERIFIED: { label: "Verified", tone: "gain" },
  SELLER_REPORTED: { label: "Seller-reported", tone: "neutral" },
  THIRD_PARTY: { label: "Third-party", tone: "accent" },
  AI_ESTIMATE: { label: "AI estimate", tone: "warn" },
};
const ProvBadge = ({ p }: { p: string }) => <Badge tone={PROV[p]?.tone ?? "neutral"}>{PROV[p]?.label ?? p}</Badge>;

function Findings({ items }: { items: Finding[] }) {
  if (!items.length) return null;
  return (
    <ul className="mt-3 space-y-2">
      {items.map((f, i) => (
        <li key={i} className="flex flex-wrap items-start gap-2 text-sm">
          <ProvBadge p={f.provenance} />
          <span className="min-w-0 flex-1">{f.claim}</span>
          {f.sourceUrl && (
            <a href={f.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
              {new URL(f.sourceUrl).hostname} <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

function Rating({ value, label }: { value: number | null; label: string }) {
  return (
    <span className="text-sm text-muted">
      {label}: {value ? <span className="num font-medium text-ink">{value}/5</span> : <span className="text-faint">insufficient evidence</span>}
    </span>
  );
}

const ROWS: [keyof CalculatorResult, string][] = [
  ["sde", "Starting earnings"],
  ["managerCost", "Manager replacement"],
  ["maintenanceCapex", "Maintenance capex + other costs"],
  ["annualDebtService", "Annual debt service"],
  ["estimatedTaxes", "Estimated taxes"],
  ["afterTaxCashToOwner", "Cash to you (after tax)"],
  ["monthlyAfterTaxCash", "Per month"],
  ["dscr", "Debt service coverage"],
  ["upfrontInvestment", "Cash needed at close"],
  ["paybackYears", "Payback (years)"],
];

export default async function OpportunityPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ imported?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const d = await getOpportunityDetail(id, user.id);
  if (!d) notFound();
  const pref = await getOrCreatePreference(user.id, user.email);
  const { o } = d;
  const parsed = d.latest ? ResearchReportSchema.safeParse(d.latest.sections) : null;
  const r = parsed?.success ? parsed.data : null;
  const base = (d.scenarios.BASE?.outputs as unknown as CalculatorResult) ?? null;
  const breakdown = (d.score?.breakdown as { categories: CategoryScore[]; fitReasons: string[] } | undefined) ?? null;
  const originalUrl = d.listings.find((l) => /^https?:/.test(l.l.url))?.l.url ?? null;

  return (
    <>
      {sp.imported && (
        <div className="mb-4">
          <Notice tone="ok">
            Listing saved.{" "}
            {d.statements.some((s) => s.provenance === "VERIFIED") ? "Figures are marked verified." : "Figures are labeled seller-reported until you verify them with documents."}
          </Notice>
        </div>
      )}
      <PageHeader
        title={o.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>{location(o)}</span>
            {o.industry && <span>· {o.industry}</span>}
            <Badge tone={o.type === "FRANCHISE" ? "accent" : "neutral"}>{o.type === "FRANCHISE" ? "Franchise" : o.type === "EMERGING" ? "Emerging" : "Acquisition"}</Badge>
            <Badge>{RESEARCH_STATUS_LABEL[o.researchStatus]}</Badge>
            {o.listingStatus !== "ACTIVE" && <Badge tone="warn">{o.listingStatus.replace("_", " ").toLowerCase()}</Badge>}
          </span>
        }
        actions={<OpportunityActions id={o.id} saved={d.saved} pipeline={o.pipelineStatus} originalUrl={originalUrl} />}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          {/* Recommendation */}
          <Panel title="AI recommendation" action={d.latest && <span className="text-xs text-muted">Report v{d.latest.version} · {daysAgo(d.latest.createdAt)}</span>}>
            {r ? (
              <div className="space-y-3">
                <RecommendationBadge value={d.latest!.recommendation} />
                <p className="max-w-[70ch] text-sm leading-relaxed">{r.summary}</p>
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <div><dt className="text-muted">Why it's interesting</dt><dd>{r.whyInteresting}</dd></div>
                  <div><dt className="text-muted">Main risk</dt><dd>{r.mainRisk}</dd></div>
                </dl>
                {d.latest!.auditFlags.length > 0 && (
                  <div className="rounded border border-warn/40 bg-warn/10 p-3 text-sm">
                    <p className="font-medium">Research audit</p>
                    <ul className="mt-1 list-disc pl-5 text-muted">{d.latest!.auditFlags.map((f) => <li key={f}>{f}</li>)}</ul>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted">
                {o.researchStatus === "FAILED" ? "The last research attempt failed. Request updated research to retry." : o.researchStatus === "RESEARCHING" || o.researchStatus === "QUEUED" ? "Research is queued — this page updates when the worker finishes." : "No AI research report yet. Request research to analyze the market, competition and risks."}
              </p>
            )}
          </Panel>

          {/* Financials */}
          <Panel title="Financial analysis">
            <div className="grid gap-4 sm:grid-cols-4">
              {[["Asking price", o.askingPrice], ["Revenue", o.revenue], ["Reported SDE", o.cashFlow], ["EBITDA", o.ebitda]].map(([k, v]) => (
                <div key={k as string}>
                  <div className="text-xs text-muted">{k}</div>
                  <Money value={v as number | null} className="text-lg font-semibold" />
                </div>
              ))}
            </div>
            <div className="mt-5">
              <div className="mb-1 text-sm font-medium">What reaches you (base case)</div>
              <IncomeBar data={base} target={pref.targetOwnerIncome} minimum={pref.minOwnerIncome} />
            </div>
            {base && (
              <div className="mt-5 overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <caption className="mb-2 text-left text-xs text-muted">
                    Scenarios use your saved financing ({d.scenarios.BASE ? String((d.scenarios.BASE.inputs as { financing: { structure: string } }).financing.structure).replaceAll("_", " ").toLowerCase() : ""}) and tax assumptions. Conservative: earnings −{Math.round((1 - SCENARIO_ADJUSTMENTS.CONSERVATIVE.sdeMultiplier) * 100)}%, rates +{SCENARIO_ADJUSTMENTS.CONSERVATIVE.rateDeltaPts} pts, extra costs {SCENARIO_ADJUSTMENTS.CONSERVATIVE.extraCostPctOfSde * 100}% of earnings. Optimistic: earnings +{Math.round((SCENARIO_ADJUSTMENTS.OPTIMISTIC.sdeMultiplier - 1) * 100)}%.
                  </caption>
                  <thead className="border-b border-line text-xs text-muted">
                    <tr><th scope="col" className="py-1.5 text-left font-medium"> </th><th scope="col" className="py-1.5 text-right font-medium">Conservative</th><th scope="col" className="py-1.5 text-right font-medium">Base</th><th scope="col" className="py-1.5 text-right font-medium">Optimistic</th></tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {ROWS.map(([key, label]) => (
                      <tr key={key} className={key === "afterTaxCashToOwner" ? "font-semibold" : ""}>
                        <th scope="row" className="py-1.5 text-left font-normal text-muted">{label}</th>
                        {(["CONSERVATIVE", "BASE", "OPTIMISTIC"] as const).map((k) => {
                          const out = d.scenarios[k]?.outputs as unknown as CalculatorResult | undefined;
                          let v: number | null = out ? (out[key] as number | null) : null;
                          if (key === "maintenanceCapex" && out) v = out.maintenanceCapex + out.additionalOperatingCosts;
                          return (
                            <td key={k} className="num py-1.5 text-right">
                              {v === null || v === undefined ? "—" : key === "dscr" ? `${v.toFixed(2)}×` : key === "paybackYears" ? v.toFixed(1) : money(v)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <ul className="mt-3 space-y-1 text-xs text-muted">
                  <li>Starting earnings: {base.earningsBasis === "EBITDA" ? "reported EBITDA (SDE not disclosed)" : "reported SDE / cash flow"}. Revenue is never treated as earnings.</li>
                  {base.warnings.map((w) => <li key={w}>{w}</li>)}
                </ul>
                <Link href={`/calculator?opp=${o.id}`} className="mt-3 inline-block text-sm text-accent hover:underline">Adjust assumptions in the calculator</Link>
              </div>
            )}
            <div className="mt-6">
              <div className="mb-2 text-sm font-medium">Reported figures by source</div>
              {d.statements.length ? (
                <ul className="divide-y divide-line text-sm">
                  {d.statements.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
                      <ProvBadge p={s.provenance} />
                      <span className="text-muted">{s.periodLabel}</span>
                      <span>Revenue <Money value={s.revenue} /></span>
                      <span>SDE <Money value={s.sde} /></span>
                      {s.ebitda !== null && <span>EBITDA <Money value={s.ebitda} /></span>}
                      <span className="text-xs text-faint">{daysAgo(s.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">No financial figures have been disclosed.</p>
              )}
              {r && r.financialObservations.length > 0 && <Findings items={r.financialObservations} />}
            </div>
          </Panel>

          {/* Business & market */}
          {r && (
            <Panel title="Business and market">
              <div className="space-y-5 text-sm leading-relaxed">
                <div><h3 className="mb-1 font-medium">Business model</h3><p className="max-w-[70ch]">{r.businessModel}</p></div>
                <div>
                  <h3 className="mb-1 font-medium">Market demand</h3>
                  <Rating value={r.marketDemand.rating} label="Rating" />
                  <p className="mt-1 max-w-[70ch]">{r.marketDemand.assessment}</p>
                  <Findings items={r.marketDemand.findings} />
                </div>
                <div>
                  <h3 className="mb-1 font-medium">Competition</h3>
                  <Rating value={r.competition.rating} label="Competitive position" />
                  <p className="mt-1 max-w-[70ch]">{r.competition.assessment}</p>
                  <Findings items={r.competition.findings} />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div><h3 className="mb-1 font-medium">Operations</h3><Rating value={r.operations.simplicityRating} label="Simplicity" /><p className="mt-1">Owner involvement: {r.operations.ownerInvolvement.toLowerCase()}</p><p className="mt-1">{r.operations.laborRequirements}</p></div>
                  <div><h3 className="mb-1 font-medium">Scalability</h3><Rating value={r.scalability.rating} label="Rating" /><p className="mt-1">{r.scalability.assessment}</p></div>
                  <div><h3 className="mb-1 font-medium">Regulatory</h3><p>{r.operations.regulatory}</p></div>
                  <div><h3 className="mb-1 font-medium">Seasonality</h3><p>{r.operations.seasonality}</p></div>
                </div>
              </div>
            </Panel>
          )}

          {r && (
            <Panel title="Risks">
              {r.risks.length ? (
                <ul className="divide-y divide-line text-sm">
                  {r.risks.map((k, i) => (
                    <li key={i} className="flex flex-wrap items-start gap-3 py-2">
                      <Badge tone={k.severity === "HIGH" ? "loss" : k.severity === "MEDIUM" ? "warn" : "neutral"}>{k.severity.toLowerCase()}</Badge>
                      <span className="w-48 shrink-0 text-muted">{k.category.replaceAll("_", " ").toLowerCase()}</span>
                      <span className="min-w-0 flex-1">{k.description}</span>
                      {k.sourceUrl && <a href={k.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-xs text-accent hover:underline">source</a>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">No specific risks identified — that usually means too little evidence, not low risk.</p>
              )}
            </Panel>
          )}

          {r && (
            <Panel title="Due diligence">
              <div className="grid gap-6 text-sm md:grid-cols-3">
                <div><h3 className="mb-2 font-medium">Questions for the seller</h3><ul className="list-disc space-y-1 pl-5">{r.dueDiligence.sellerQuestions.map((q) => <li key={q}>{q}</li>)}</ul></div>
                <div><h3 className="mb-2 font-medium">Documents to request</h3><ul className="list-disc space-y-1 pl-5">{r.dueDiligence.documentsToRequest.map((q) => <li key={q}>{q}</li>)}</ul></div>
                <div><h3 className="mb-2 font-medium">Unresolved concerns</h3><ul className="list-disc space-y-1 pl-5">{[...r.dueDiligence.unresolvedConcerns, ...r.dataGaps].map((q) => <li key={q}>{q}</li>)}</ul></div>
              </div>
            </Panel>
          )}

          <Panel title="Sources">
            <ul className="divide-y divide-line text-sm">
              {d.listings.map(({ l, sourceName, reliability }) => (
                <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span className="font-medium">{sourceName}</span>
                  <span className="text-xs text-faint">reliability {reliability}/100</span>
                  {/^https?:/.test(l.url) ? (
                    <a href={l.url} target="_blank" rel="noopener noreferrer nofollow" className="min-w-0 flex-1 truncate text-accent hover:underline">{l.url}</a>
                  ) : (
                    <span className="flex-1 text-muted">{l.url.startsWith("csv:") ? "CSV row (no link)" : l.url.startsWith("manual:") ? "Entered manually (no link)" : "Pasted text (no link)"}</span>
                  )}
                  <span className="text-xs text-muted">first seen {daysAgo(l.firstSeenAt)}, last {daysAgo(l.lastSeenAt)}</span>
                </li>
              ))}
              {d.citations.filter((c) => c.section !== "listing").map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <ProvBadge p={c.provenance} />
                  <a href={c.url} target="_blank" rel="noopener noreferrer nofollow" className="min-w-0 flex-1 truncate text-accent hover:underline">{c.title ?? c.url}</a>
                </li>
              ))}
            </ul>
          </Panel>

          {d.history.length > 0 && (
            <Panel title="What changed">
              <ul className="space-y-1 text-sm">
                {d.history.map((h) => (
                  <li key={h.id} className="num"><span className="text-muted">{h.observedAt.toISOString().slice(0, 10)}</span> {h.field}: {h.field === "askingPrice" ? `${money(Number(h.oldValue))} → ${money(Number(h.newValue))}` : `${h.oldValue ?? "—"} → ${h.newValue ?? "—"}`}</li>
                ))}
              </ul>
            </Panel>
          )}
        </div>

        <div className="space-y-6">
          <Panel title="Opportunity score">
            {d.score ? (
              <>
                <div className="flex items-baseline justify-between">
                  <ScoreBadge score={d.score.total} />
                  <span className="text-xs text-muted">of 100</span>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  {[["Attractiveness", d.score.attractiveness], ["Financial feasibility", d.score.feasibility], ["Data confidence", d.score.confidence], ["Fit with your goals", d.score.fit]].map(([k, v]) => (
                    <div key={k as string} className="rounded bg-raised px-2 py-1.5"><dt className="text-xs text-muted">{k}</dt><dd className="num font-semibold">{v}</dd></div>
                  ))}
                </dl>
                {breakdown && (
                  <details className="mt-4 text-sm" open>
                    <summary className="cursor-pointer font-medium">How this was calculated</summary>
                    <ul className="mt-2 space-y-3">
                      {breakdown.categories.map((c) => (
                        <li key={c.category}>
                          <div className="flex justify-between gap-2">
                            <span>{c.label}</span>
                            <span className="num text-muted">{c.score} × {c.weight}% = <span className="text-ink">{c.weighted.toFixed(1)}</span></span>
                          </div>
                          <ul className="mt-0.5 text-xs text-muted">
                            {c.evidence.map((e) => <li key={e}>{e}</li>)}
                            {c.capped && <li className="text-warn">Capped at {c.score} by evidence confidence (raw {c.rawScore})</li>}
                            {!c.computed && <li className="text-faint">Not computed from data</li>}
                          </ul>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-3">
                      <div className="font-medium">Fit</div>
                      <ul className="mt-1 list-disc pl-5 text-xs text-muted">{breakdown.fitReasons.map((f) => <li key={f}>{f}</li>)}</ul>
                    </div>
                  </details>
                )}
              </>
            ) : (
              <p className="text-sm text-muted">Not scored yet.</p>
            )}
          </Panel>

          <Panel title="Details">
            <dl className="space-y-1.5 text-sm">
              {[
                ["Established", o.yearEstablished ?? "Not disclosed"],
                ["Employees", o.employees ?? "Not disclosed"],
                ["Seller financing", o.sellerFinancing === null ? "Not disclosed" : o.sellerFinancing ? `Yes${o.sellerFinancingNote ? ` — ${o.sellerFinancingNote}` : ""}` : "No"],
                ["Owner involvement", o.ownerInvolvement ?? "Not disclosed"],
                ["First discovered", o.firstDiscoveredAt.toISOString().slice(0, 10)],
                ["Last verified", o.lastVerifiedAt ? daysAgo(o.lastVerifiedAt) : "Never"],
                ["Missing", o.missingFields.length ? o.missingFields.join(", ") : "Nothing key"],
              ].map(([k, v]) => (
                <div key={k as string} className="flex justify-between gap-3"><dt className="text-muted">{k}</dt><dd className="text-right">{String(v)}</dd></div>
              ))}
            </dl>
            {o.description && <p className="mt-3 border-t border-line pt-3 text-sm text-muted">{o.description}</p>}
          </Panel>

          <Panel title="Your feedback">
            <FeedbackChips id={o.id} active={d.feedback} />
          </Panel>

          <Panel title="Notes and follow-ups">
            <NoteForm id={o.id} />
            <ul className="mt-4 space-y-3 text-sm">
              {d.notes.map((n) => (
                <li key={n.id} className={n.doneAt ? "text-faint line-through" : ""}>
                  <p className="whitespace-pre-wrap">{n.body}</p>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                    <span>{daysAgo(n.createdAt)}</span>
                    {n.dueAt && <span>· follow up {n.dueAt.toISOString().slice(0, 10)}</span>}
                    {n.dueAt && !n.doneAt && <CompleteNoteButton noteId={n.id} oppId={o.id} />}
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}
