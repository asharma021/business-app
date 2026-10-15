import type { DailyReportContent, ReportItem } from "./daily";
import { money } from "@/lib/format";

export const DAILY_SUBJECT = "Opportunity Radar AI — Daily Business Investment Intelligence";

const esc = (s: string | null | undefined) =>
  (s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const safeUrl = (u: string | null) => (u && /^https?:\/\//i.test(u) ? esc(u) : null);

const REC_LABEL: Record<string, string> = {
  STRONG_CANDIDATE: "Strong candidate for due diligence",
  PROMISING_NEEDS_VERIFICATION: "Promising — needs verification",
  HIGH_RISK: "High risk",
  FINANCIALLY_UNATTRACTIVE: "Financially unattractive",
  INSUFFICIENT_DATA: "Insufficient data",
};

function item(i: ReportItem, appUrl: string) {
  const src = safeUrl(i.sourceUrl);
  const row = (k: string, v: string) => `<tr><td style="color:#6b7280;padding:2px 12px 2px 0;font-size:13px">${k}</td><td style="font-size:13px;color:#111827">${v}</td></tr>`;
  return `<div style="border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;margin:10px 0">
  <div style="font-weight:600;font-size:15px;color:#111827"><a href="${esc(appUrl)}/opportunities/${esc(i.id)}" style="color:#111827;text-decoration:none">${esc(i.title)}</a></div>
  <div style="color:#6b7280;font-size:13px;margin:2px 0 8px">${esc(i.location)}${i.score !== null ? ` · Score <b style="color:#111827">${i.score}</b>/100` : ""}${i.confidence !== null ? ` · Confidence ${i.confidence}` : ""}</div>
  ${i.note ? `<div style="background:#fef3c7;border-radius:6px;padding:6px 8px;font-size:13px;margin-bottom:8px">${esc(i.note)}</div>` : ""}
  <table cellpadding="0" cellspacing="0">
  ${row("Asking price", money(i.askingPrice))}
  ${row("Reported revenue", money(i.revenue))}
  ${row("Reported earnings (SDE)", money(i.cashFlow))}
  ${row("Est. owner income after financing", i.ownerIncomeAfterFinancing === null ? "Not computable" : `${money(i.ownerIncomeAfterFinancing)}/yr <span style="color:#6b7280">(base case, est. after tax)</span>`)}
  ${i.recommendation ? row("Assessment", esc(REC_LABEL[i.recommendation] ?? i.recommendation)) : ""}
  ${i.mainRisk ? row("Main risk", esc(i.mainRisk)) : ""}
  ${i.whyInteresting ? row("Why it's interesting", esc(i.whyInteresting)) : ""}
  </table>
  ${src ? `<div style="margin-top:8px;font-size:13px"><a href="${src}" style="color:#2563eb">Original listing ↗</a></div>` : ""}
</div>`;
}

function section(title: string, items: ReportItem[], empty: string, appUrl: string) {
  return `<h2 style="font-size:16px;margin:28px 0 6px;color:#111827">${esc(title)}</h2>${items.length ? items.map((i) => item(i, appUrl)).join("") : `<p style="color:#6b7280;font-size:14px;margin:4px 0">${esc(empty)}</p>`}`;
}

export function renderDailyEmail(r: DailyReportContent, appUrl: string): { subject: string; html: string; text: string } {
  const list = (xs: string[], empty: string) =>
    xs.length ? `<ul style="padding-left:18px;margin:6px 0">${xs.map((x) => `<li style="font-size:14px;margin:3px 0">${esc(x)}</li>`).join("")}</ul>` : `<p style="color:#6b7280;font-size:14px">${esc(empty)}</p>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f9fafb;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<div style="max-width:680px;margin:0 auto;padding:24px 16px">
<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280">Opportunity Radar AI · ${esc(r.reportDate)}</div>
<h1 style="font-size:22px;margin:6px 0 16px;color:#111827">Daily Business Investment Intelligence</h1>
<div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px 20px">
<h2 style="font-size:16px;margin:0 0 6px">Executive summary</h2>${list(r.executiveSummary, "")}
${section("Top new opportunities", r.newOpportunities, "No new acquisition opportunities today.", appUrl)}
${section("Most likely to meet your income target", r.topIncome, "No tracked opportunity currently meets your minimum after financing.", appUrl)}
${section("Franchise discoveries", r.franchises, "No new franchise opportunities today.", appUrl)}
${section("Emerging business models", r.emerging, "Emerging-model research is not enabled yet (planned phase).", appUrl)}
${section("Price reductions", r.priceReductions, "No price reductions detected.", appUrl)}
<h2 style="font-size:16px;margin:28px 0 6px">Market changes</h2>${list(r.marketChanges, "No market data changes.")}
${section("Watchlist alerts", r.watchlistAlerts, "No changes to your watchlist.", appUrl)}
<h2 style="font-size:16px;margin:28px 0 6px">Recommended next actions</h2>${list(r.nextActions, "No actions needed today.")}
</div>
<p style="font-size:12px;color:#6b7280;line-height:1.5;margin-top:16px">Figures are seller-reported unless marked verified. Owner income estimates use your saved financing and tax assumptions and are not financial advice. <a href="${esc(appUrl)}/reports/${esc(r.reportDate)}" style="color:#2563eb">View online</a> · <a href="${esc(appUrl)}/settings" style="color:#2563eb">Email settings</a></p>
</div></body></html>`;

  const txtItem = (i: ReportItem) =>
    `- ${i.title} (${i.location}) — price ${money(i.askingPrice)}, revenue ${money(i.revenue)}, SDE ${money(i.cashFlow)}, est. owner income ${i.ownerIncomeAfterFinancing === null ? "n/a" : money(i.ownerIncomeAfterFinancing)}, score ${i.score ?? "n/a"}${i.note ? ` — ${i.note}` : ""}${i.sourceUrl ? `\n  ${i.sourceUrl}` : ""}`;
  const txtSec = (t: string, xs: ReportItem[], e: string) => `\n${t}\n${xs.length ? xs.map(txtItem).join("\n") : e}`;
  const text = [
    `Opportunity Radar AI — ${r.reportDate}`,
    "",
    ...r.executiveSummary,
    txtSec("TOP NEW OPPORTUNITIES", r.newOpportunities, "None today."),
    txtSec("MOST LIKELY TO MEET YOUR INCOME TARGET", r.topIncome, "None."),
    txtSec("FRANCHISES", r.franchises, "None today."),
    txtSec("PRICE REDUCTIONS", r.priceReductions, "None."),
    txtSec("WATCHLIST ALERTS", r.watchlistAlerts, "None."),
    "\nNEXT ACTIONS",
    ...(r.nextActions.length ? r.nextActions.map((a) => `- ${a}`) : ["None."]),
    `\nView online: ${appUrl}/reports/${r.reportDate}`,
  ].join("\n");

  return { subject: DAILY_SUBJECT, html, text };
}
