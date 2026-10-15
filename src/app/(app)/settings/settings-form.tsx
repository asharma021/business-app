"use client";
import { useActionState, useState } from "react";
import { savePreferences, type ActionState } from "@/app/actions";
import type { Preference } from "@/db/schema";
import type { FinancingDefaults } from "@/lib/preferences";
import { CATEGORIES, CATEGORY_LABELS, type Weights } from "@/lib/scoring";
import { FINANCING_PRESETS } from "@/lib/finance/calculator";
import { Button, Field, Input, Notice, Panel, Select } from "@/components/ui";

type P = Omit<Preference, "updatedAt"> & { updatedAt?: undefined };

export function SettingsForm({ pref, financing, weights, userEmail, emailConfigured }: { pref: P; financing: FinancingDefaults; weights: Weights; userEmail: string | null; emailConfigured: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(savePreferences, undefined);
  const [fin, setFin] = useState({
    structure: financing.structure,
    down: financing.downPaymentPct * 100,
    seniorPct: (financing.seniorLoan?.pct ?? 0) * 100,
    seniorRate: financing.seniorLoan?.ratePct ?? 10.5,
    seniorTerm: financing.seniorLoan?.termYears ?? 10,
    sellerPct: (financing.sellerNote?.pct ?? 0) * 100,
    sellerRate: financing.sellerNote?.ratePct ?? 6,
    sellerTerm: financing.sellerNote?.termYears ?? 5,
    closing: financing.closingCostsPct * 100,
  });
  const [w, setW] = useState<Record<string, number>>(Object.fromEntries(CATEGORIES.map((c) => [c, Math.round(weights[c])])));
  const wSum = Object.values(w).reduce((a, b) => a + b, 0);
  const finSum = fin.down + fin.seniorPct + fin.sellerPct;

  const preset = (k: keyof typeof FINANCING_PRESETS) => {
    const p = FINANCING_PRESETS[k];
    setFin((f) => ({
      ...f,
      structure: k,
      down: p.downPaymentPct * 100,
      seniorPct: (p.seniorLoan?.pct ?? 0) * 100,
      seniorRate: p.seniorLoan?.ratePct ?? f.seniorRate,
      seniorTerm: p.seniorLoan?.termYears ?? f.seniorTerm,
      sellerPct: (p.sellerNote?.pct ?? 0) * 100,
      sellerRate: p.sellerNote?.ratePct ?? f.sellerRate,
      sellerTerm: p.sellerNote?.termYears ?? f.sellerTerm,
      closing: p.closingCostsPct * 100,
    }));
  };
  const finInput = (k: keyof typeof fin, label: string, step = 1) => (
    <Field label={label} htmlFor={k}>
      <Input id={k} name={k === "down" ? "downPaymentPct" : k === "closing" ? "closingCostsPct" : k} type="number" step={step} value={fin[k] as number} onChange={(e) => setFin((f) => ({ ...f, [k]: Number(e.target.value), structure: "CUSTOM" }))} />
    </Field>
  );

  return (
    <form action={action} className="max-w-4xl space-y-6">
      <input type="hidden" name="structure" value={fin.structure} />
      <Panel title="Income goals">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Minimum owner income ($/yr)" htmlFor="minOwnerIncome"><Input id="minOwnerIncome" name="minOwnerIncome" type="number" step={5000} defaultValue={pref.minOwnerIncome} required /></Field>
          <Field label="Target owner income ($/yr)" htmlFor="targetOwnerIncome"><Input id="targetOwnerIncome" name="targetOwnerIncome" type="number" step={5000} defaultValue={pref.targetOwnerIncome} required /></Field>
          <Field label="Stretch target ($/yr)" htmlFor="stretchOwnerIncome"><Input id="stretchOwnerIncome" name="stretchOwnerIncome" type="number" step={5000} defaultValue={pref.stretchOwnerIncome} required /></Field>
          <Field label="Capital budget ($)" htmlFor="capitalBudget" hint="Cash you can put in at close. Leave blank if undecided — it's never assumed."><Input id="capitalBudget" name="capitalBudget" type="number" step={5000} defaultValue={pref.capitalBudget ?? ""} placeholder="Not set" /></Field>
          <Field label="Max asking price ($)" htmlFor="maxAskingPrice" hint="Guides discovery searches"><Input id="maxAskingPrice" name="maxAskingPrice" type="number" step={10000} defaultValue={pref.maxAskingPrice ?? ""} placeholder="No limit" /></Field>
          <Field label="Risk tolerance" htmlFor="riskTolerance">
            <Select id="riskTolerance" name="riskTolerance" defaultValue={pref.riskTolerance}><option value="LOW">Low</option><option value="MODERATE">Moderate</option><option value="HIGH">High</option></Select>
          </Field>
          <Field label="Ownership preference" htmlFor="ownershipPreference">
            <Select id="ownershipPreference" name="ownershipPreference" defaultValue={pref.ownershipPreference}><option value="OWNER_OPERATED">Owner-operated first</option><option value="SEMI_ABSENTEE">Semi-absentee</option><option value="EITHER">Either</option></Select>
          </Field>
        </div>
      </Panel>

      <Panel title="Geography and industries">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Priority states" htmlFor="primaryStates" hint="Two-letter codes, comma-separated"><Input id="primaryStates" name="primaryStates" defaultValue={pref.primaryStates.join(", ")} /></Field>
          <Field label="Priority metros" htmlFor="primaryMetros"><Input id="primaryMetros" name="primaryMetros" defaultValue={pref.primaryMetros.join(", ")} /></Field>
          <Field label="Excluded industries" htmlFor="excludedIndustries" hint="Comma-separated keywords"><Input id="excludedIndustries" name="excludedIndustries" defaultValue={pref.excludedIndustries.join(", ")} placeholder="e.g. restaurant, bar" /></Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="includeNationwide" defaultChecked={pref.includeNationwide} /> Include opportunities nationwide (ranked lower)</label>
        </div>
      </Panel>

      <Panel title="Default financing and operating assumptions">
        <div className="space-y-4">
          <Field label="Structure preset" htmlFor="preset" hint="SBA eligibility and approval are never assumed. Rates are placeholders — replace with a current lender quote.">
            <Select id="preset" value={fin.structure} onChange={(e) => e.target.value !== "CUSTOM" && preset(e.target.value as keyof typeof FINANCING_PRESETS)}>
              <option value="SBA_STYLE">SBA 7(a)-style</option><option value="SBA_PLUS_SELLER">SBA-style + seller note</option><option value="CONVENTIONAL">Conventional</option><option value="SELLER">Seller financing</option><option value="CASH">All cash</option><option value="CUSTOM">Custom</option>
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            {finInput("down", "Down payment (%)")}
            {finInput("seniorPct", "Bank loan (% of price)")}
            {finInput("sellerPct", "Seller note (% of price)")}
            {finInput("seniorRate", "Bank rate (%)", 0.25)}
            {finInput("seniorTerm", "Bank term (years)")}
            {finInput("closing", "Closing costs (%)", 0.5)}
            {finInput("sellerRate", "Seller note rate (%)", 0.25)}
            {finInput("sellerTerm", "Seller note term (years)")}
            <Field label="Working capital (% of price)" htmlFor="workingCapitalPct"><Input id="workingCapitalPct" name="workingCapitalPct" type="number" step={1} defaultValue={financing.workingCapitalPctOfPrice * 100} /></Field>
          </div>
          {Math.abs(finSum - 100) > 0.01 && <Notice tone="warn">Down payment and loans add up to {finSum}% — they must total 100%.</Notice>}
          <div className="grid gap-4 border-t border-line pt-4 sm:grid-cols-3">
            <Field label="Your role" htmlFor="ownerRole"><Select id="ownerRole" name="ownerRole" defaultValue={financing.operating.ownerRole}><option value="OWNER_OPERATED">Owner-operated</option><option value="SEMI_ABSENTEE">Semi-absentee (hire manager)</option></Select></Field>
            <Field label="Manager cost ($/yr)" htmlFor="managerSalary" hint="Applied when semi-absentee"><Input id="managerSalary" name="managerSalary" type="number" step={5000} defaultValue={financing.operating.managerSalary} /></Field>
            <Field label="Maintenance capex ($/yr)" htmlFor="maintenanceCapex"><Input id="maintenanceCapex" name="maintenanceCapex" type="number" step={1000} defaultValue={financing.operating.maintenanceCapex} /></Field>
            <Field label="Other added costs ($/yr)" htmlFor="additionalOperatingCosts"><Input id="additionalOperatingCosts" name="additionalOperatingCosts" type="number" step={1000} defaultValue={financing.operating.additionalOperatingCosts} /></Field>
            <Field label="Effective tax rate (%)" htmlFor="effectiveTaxRatePct" hint="Federal + self-employment"><Input id="effectiveTaxRatePct" name="effectiveTaxRatePct" type="number" step={1} defaultValue={financing.operating.effectiveTaxRatePct} /></Field>
            <Field label="Contribution margin (%)" htmlFor="contributionMarginPct"><Input id="contributionMarginPct" name="contributionMarginPct" type="number" step={5} defaultValue={financing.operating.contributionMarginPct * 100} /></Field>
            <Field label="Flag DSCR below" htmlFor="dscrThreshold" hint="Common lender guideline; requirements vary"><Input id="dscrThreshold" name="dscrThreshold" type="number" step={0.05} defaultValue={financing.operating.dscrThreshold} /></Field>
          </div>
        </div>
      </Panel>

      <Panel title="Scoring weights" action={<span className={Math.abs(wSum - 100) > 0.5 ? "text-sm text-warn" : "text-sm text-muted"}>Total {wSum} — normalized to 100 on save</span>}>
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {CATEGORIES.map((c) => (
            <div key={c} className="flex items-center gap-3">
              <label htmlFor={`w_${c}`} className="flex-1 text-sm">{CATEGORY_LABELS[c]}</label>
              <input id={`w_${c}`} name={`w_${c}`} type="range" min={0} max={50} value={w[c]} onChange={(e) => setW((x) => ({ ...x, [c]: Number(e.target.value) }))} className="w-32 accent-[rgb(var(--accent))]" />
              <span className="num w-8 text-right text-sm">{w[c]}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">Income-driven categories are always capped by evidence confidence, whatever the weights.</p>
      </Panel>

      <Panel title="Daily report">
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Hour (0–23)" htmlFor="dailyReportHour"><Input id="dailyReportHour" name="dailyReportHour" type="number" min={0} max={23} defaultValue={pref.dailyReportHour} /></Field>
          <Field label="Minute" htmlFor="dailyReportMinute"><Input id="dailyReportMinute" name="dailyReportMinute" type="number" min={0} max={59} defaultValue={pref.dailyReportMinute} /></Field>
          <div className="sm:col-span-2"><Field label="Timezone" htmlFor="timezone"><Input id="timezone" name="timezone" defaultValue={pref.timezone} /></Field></div>
          <div className="sm:col-span-2"><Field label="Send to" htmlFor="reportEmail" hint={`Defaults to ${userEmail ?? "your sign-in email"}`}><Input id="reportEmail" name="reportEmail" type="email" defaultValue={pref.reportEmail ?? ""} /></Field></div>
          <label className="flex items-center gap-2 self-end pb-2 text-sm sm:col-span-2"><input type="checkbox" name="dailyEmailEnabled" defaultChecked={pref.dailyEmailEnabled} /> Email me the daily report</label>
        </div>
        <p className="mt-3 text-xs text-muted">Research starts an hour before this time. {emailConfigured ? "" : "RESEND_API_KEY isn't set, so reports are archived here but not emailed."}</p>
      </Panel>

      <div className="sticky bottom-0 -mx-4 flex items-center gap-3 border-t border-line bg-bg/95 px-4 py-3 backdrop-blur">
        <Button variant="primary" disabled={pending}>{pending ? "Saving and re-scoring…" : "Save settings"}</Button>
        {state?.error && <span role="alert" className="text-sm text-loss">{state.error}</span>}
        {state?.message && <span role="status" className="text-sm text-gain">{state.message}</span>}
      </div>
    </form>
  );
}
