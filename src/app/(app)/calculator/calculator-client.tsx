"use client";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  calculate,
  FINANCING_PRESETS,
  scenarios,
  SCENARIO_ADJUSTMENTS,
  sensitivity,
  validateFinancing,
  type CalculatorInputs,
  type FinancingStructure,
  type IncomeTargets,
} from "@/lib/finance/calculator";
import type { FinancingDefaults } from "@/lib/preferences";
import { money } from "@/lib/format";
import { Field, Input, Notice, Panel, Select } from "@/components/ui";
import { IncomeBar } from "@/components/income-bar";

interface Initial {
  title: string | null;
  purchasePrice: number;
  sde: number;
  earningsBasis: "SDE" | "EBITDA";
  revenue: number | null;
  financing: FinancingDefaults;
  targets: IncomeTargets;
  fromOpportunity: boolean;
  missing: string[];
}

const STRUCTURES: [Exclude<FinancingStructure, "CUSTOM">, string][] = [
  ["SBA_STYLE", "SBA 7(a)-style (10% down)"],
  ["SBA_PLUS_SELLER", "SBA-style + seller note"],
  ["CONVENTIONAL", "Conventional loan"],
  ["SELLER", "Seller financing"],
  ["CASH", "All cash"],
];

function Num({ label, value, onChange, step = 1000, suffix, hint, id }: { label: string; value: number | null; onChange: (n: number | null) => void; step?: number; suffix?: string; hint?: string; id: string }) {
  return (
    <Field label={suffix ? `${label} (${suffix})` : label} htmlFor={id} hint={hint}>
      <Input id={id} type="number" inputMode="decimal" step={step} value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} />
    </Field>
  );
}

export function CalculatorClient({ initial }: { initial: Initial }) {
  const f = initial.financing;
  const [s, setS] = useState({
    price: initial.purchasePrice as number | null,
    sde: initial.sde as number | null,
    basis: initial.earningsBasis,
    revenue: initial.revenue,
    payroll: null as number | null,
    structure: f.structure as FinancingStructure,
    down: f.downPaymentPct * 100,
    seniorPct: (f.seniorLoan?.pct ?? 0) * 100,
    seniorRate: f.seniorLoan?.ratePct ?? 10.5,
    seniorTerm: f.seniorLoan?.termYears ?? 10,
    sellerPct: (f.sellerNote?.pct ?? 0) * 100,
    sellerRate: f.sellerNote?.ratePct ?? 6,
    sellerTerm: f.sellerNote?.termYears ?? 5,
    closing: f.closingCostsPct * 100,
    wc: Math.round((initial.purchasePrice ?? 0) * f.workingCapitalPctOfPrice) as number | null,
    role: f.operating.ownerRole,
    manager: f.operating.managerSalary as number | null,
    capex: f.operating.maintenanceCapex as number | null,
    other: f.operating.additionalOperatingCosts as number | null,
    tax: f.operating.effectiveTaxRatePct,
    cm: f.operating.contributionMarginPct * 100,
    target: initial.targets.target as number | null,
    minimum: initial.targets.minimum as number | null,
  });
  const set = <K extends keyof typeof s>(k: K) => (v: (typeof s)[K]) => setS((p) => ({ ...p, [k]: v, ...(["down", "seniorPct", "sellerPct", "seniorRate", "seniorTerm", "sellerRate", "sellerTerm"].includes(k) ? { structure: "CUSTOM" as const } : {}) }));

  const applyPreset = (k: Exclude<FinancingStructure, "CUSTOM">) => {
    const p = FINANCING_PRESETS[k];
    setS((prev) => ({
      ...prev,
      structure: k,
      down: p.downPaymentPct * 100,
      seniorPct: (p.seniorLoan?.pct ?? 0) * 100,
      seniorRate: p.seniorLoan?.ratePct ?? prev.seniorRate,
      seniorTerm: p.seniorLoan?.termYears ?? prev.seniorTerm,
      sellerPct: (p.sellerNote?.pct ?? 0) * 100,
      sellerRate: p.sellerNote?.ratePct ?? prev.sellerRate,
      sellerTerm: p.sellerNote?.termYears ?? prev.sellerTerm,
      closing: p.closingCostsPct * 100,
    }));
  };

  const inputs: CalculatorInputs | null = useMemo(() => {
    if (s.price == null || s.sde == null || s.target == null || s.minimum == null) return null;
    return {
      deal: { purchasePrice: s.price, sde: s.sde, earningsBasis: s.basis, revenue: s.revenue, payroll: s.payroll },
      financing: {
        structure: s.structure,
        downPaymentPct: s.down / 100,
        seniorLoan: s.seniorPct > 0 ? { pct: s.seniorPct / 100, ratePct: s.seniorRate, termYears: s.seniorTerm } : null,
        sellerNote: s.sellerPct > 0 ? { pct: s.sellerPct / 100, ratePct: s.sellerRate, termYears: s.sellerTerm } : null,
        closingCostsPct: s.closing / 100,
        workingCapitalReserve: s.wc ?? 0,
      },
      operating: {
        ownerRole: s.role,
        managerSalary: s.manager ?? 0,
        maintenanceCapex: s.capex ?? 0,
        additionalOperatingCosts: s.other ?? 0,
        effectiveTaxRatePct: s.tax,
        contributionMarginPct: s.cm / 100,
        dscrThreshold: f.operating.dscrThreshold,
      },
      targets: { target: s.target, minimum: s.minimum, stretch: initial.targets.stretch },
    };
  }, [s, f.operating.dscrThreshold, initial.targets.stretch]);

  const errors = inputs ? validateFinancing(inputs.financing) : [];
  const valid = inputs && errors.length === 0;
  const base = valid ? calculate(inputs) : null;
  const sc = valid ? scenarios(inputs) : null;
  const sens = valid ? sensitivity(inputs) : [];
  const chart = sc
    ? (["CONSERVATIVE", "BASE", "OPTIMISTIC"] as const).map((k) => ({ name: k === "BASE" ? "Base" : k[0] + k.slice(1).toLowerCase(), cash: sc[k].afterTaxCashToOwner }))
    : [];
  const colorFor = (v: number) => (v >= (s.target ?? 0) ? "rgb(var(--gain))" : v >= (s.minimum ?? 0) ? "rgb(var(--warn))" : "rgb(var(--loss))");

  return (
    <div className="grid gap-6 xl:grid-cols-[400px_minmax(0,1fr)]">
      <div className="space-y-6">
        {initial.title && (
          <Notice>
            Prefilled from <span className="font-medium">{initial.title}</span>.{" "}
            {initial.missing.length ? `Not disclosed: ${initial.missing.join(", ")} — placeholder values shown, replace them.` : "Figures are seller-reported."}
          </Notice>
        )}
        <Panel title="The deal">
          <div className="grid grid-cols-2 gap-3">
            <Num id="price" label="Purchase price" value={s.price} onChange={set("price")} suffix="$" step={10000} />
            <Num id="sde" label={s.basis === "SDE" ? "SDE / cash flow" : "EBITDA"} value={s.sde} onChange={set("sde")} suffix="$/yr" step={5000} />
            <div className="col-span-2">
              <Field label="These earnings are" htmlFor="basis" hint={s.basis === "SDE" ? "Before any owner salary — most small-business listings report this." : "After a market-rate manager/owner salary — no manager cost is subtracted again."}>
                <Select id="basis" value={s.basis} onChange={(e) => set("basis")(e.target.value as "SDE" | "EBITDA")}>
                  <option value="SDE">SDE (seller's discretionary earnings)</option>
                  <option value="EBITDA">EBITDA</option>
                </Select>
              </Field>
            </div>
            <Num id="revenue" label="Revenue" value={s.revenue} onChange={set("revenue")} suffix="$/yr" step={10000} hint="Needed for revenue sensitivity" />
            <Num id="payroll" label="Payroll" value={s.payroll} onChange={set("payroll")} suffix="$/yr" step={5000} hint="Needed for payroll sensitivity" />
          </div>
        </Panel>
        <Panel title="Financing">
          <div className="space-y-3">
            <Field label="Structure" htmlFor="structure" hint="SBA eligibility and approval are never assumed. Rates are placeholders — use a current lender quote.">
              <Select id="structure" value={s.structure} onChange={(e) => e.target.value !== "CUSTOM" && applyPreset(e.target.value as Exclude<FinancingStructure, "CUSTOM">)}>
                {STRUCTURES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                <option value="CUSTOM">Custom</option>
              </Select>
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Num id="down" label="Down" value={s.down} onChange={(v) => set("down")(v ?? 0)} suffix="%" step={1} />
              <Num id="closing" label="Closing" value={s.closing} onChange={(v) => set("closing")(v ?? 0)} suffix="%" step={0.5} />
              <Num id="wc" label="Working cap." value={s.wc} onChange={set("wc")} suffix="$" step={5000} />
              <Num id="seniorPct" label="Bank loan" value={s.seniorPct} onChange={(v) => set("seniorPct")(v ?? 0)} suffix="%" step={1} />
              <Num id="seniorRate" label="Rate" value={s.seniorRate} onChange={(v) => set("seniorRate")(v ?? 0)} suffix="%" step={0.25} />
              <Num id="seniorTerm" label="Term" value={s.seniorTerm} onChange={(v) => set("seniorTerm")(v ?? 1)} suffix="yrs" step={1} />
              <Num id="sellerPct" label="Seller note" value={s.sellerPct} onChange={(v) => set("sellerPct")(v ?? 0)} suffix="%" step={1} />
              <Num id="sellerRate" label="Rate" value={s.sellerRate} onChange={(v) => set("sellerRate")(v ?? 0)} suffix="%" step={0.25} />
              <Num id="sellerTerm" label="Term" value={s.sellerTerm} onChange={(v) => set("sellerTerm")(v ?? 1)} suffix="yrs" step={1} />
            </div>
          </div>
        </Panel>
        <Panel title="Operating and tax">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Field label="Your role" htmlFor="role">
                <Select id="role" value={s.role} onChange={(e) => set("role")(e.target.value as typeof s.role)}>
                  <option value="OWNER_OPERATED">I'll run it (owner-operated)</option>
                  <option value="SEMI_ABSENTEE">Hire a manager (semi-absentee)</option>
                </Select>
              </Field>
            </div>
            <Num id="manager" label="Manager cost" value={s.manager} onChange={set("manager")} suffix="$/yr" step={5000} hint={s.role === "OWNER_OPERATED" ? "Only applied when semi-absentee" : "Fully loaded salary"} />
            <Num id="capex" label="Maintenance capex" value={s.capex} onChange={set("capex")} suffix="$/yr" step={1000} />
            <Num id="other" label="Other added costs" value={s.other} onChange={set("other")} suffix="$/yr" step={1000} />
            <Num id="tax" label="Effective tax" value={s.tax} onChange={(v) => set("tax")(v ?? 0)} suffix="%" step={1} hint="Federal + self-employment; Texas has no state income tax" />
            <Num id="cm" label="Contribution margin" value={s.cm} onChange={(v) => set("cm")(v ?? 0)} suffix="%" step={5} hint="Share of lost revenue that hits earnings" />
          </div>
        </Panel>
        <Panel title="Your income goal">
          <div className="grid grid-cols-2 gap-3">
            <Num id="target" label="Target" value={s.target} onChange={set("target")} suffix="$/yr" step={5000} />
            <Num id="minimum" label="Minimum" value={s.minimum} onChange={set("minimum")} suffix="$/yr" step={5000} />
          </div>
        </Panel>
      </div>

      <div className="min-w-0 space-y-6">
        {!inputs && <Notice tone="warn">Enter a purchase price, SDE and income goal to see results.</Notice>}
        {errors.map((e) => <Notice key={e} tone="error">{e}</Notice>)}
        {base && sc && (
          <>
            <Panel>
              <p className="text-sm text-muted">{base.incomeKind === "OWNER_COMPENSATION_FOR_WORKING" ? "Cash to you for running the business full-time" : "Passive cash to you after paying a manager"}, base case</p>
              <div className="mt-2">
                <IncomeBar data={base} target={s.target!} minimum={s.minimum!} />
              </div>
              <p className="mt-4 max-w-[70ch] text-sm">
                {base.meetsTarget
                  ? `Under these assumptions this deal clears your ${money(s.target)} target with ${money(base.afterTaxCashToOwner - s.target!)} to spare.`
                  : `To reach ${money(s.target)} after debt and tax, the business needs about ${money(base.requiredSde)} of SDE — ${money(base.sdeGapToTarget)} more than the ${money(s.sde)} reported.`}{" "}
                Break-even SDE (zero cash to you before tax) is {money(base.breakEvenSde)}.
              </p>
            </Panel>

            <Panel title="Scenarios">
              <div className="h-56" role="img" aria-label={`Cash to owner by scenario: ${chart.map((c) => `${c.name} ${money(c.cash)}`).join(", ")}. Target ${money(s.target)}.`}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chart} margin={{ top: 16, right: 16, bottom: 0, left: 8 }} barCategoryGap="35%">
                    <CartesianGrid vertical={false} stroke="rgb(var(--line))" />
                    <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: "rgb(var(--muted))", fontSize: 12 }} />
                    <YAxis tickFormatter={(v) => money(v, { compact: true })} tickLine={false} axisLine={false} width={64} tick={{ fill: "rgb(var(--muted))", fontSize: 12 }} />
                    <Tooltip
                      cursor={{ fill: "rgb(var(--raised))" }}
                      formatter={(v) => [money(Number(v)), "Cash to you / yr"]}
                      contentStyle={{ background: "rgb(var(--surface))", border: "1px solid rgb(var(--line))", borderRadius: 6, fontSize: 12, color: "rgb(var(--ink))" }}
                    />
                    <ReferenceLine y={s.target!} stroke="rgb(var(--ink))" strokeDasharray="4 3" label={{ value: `Target ${money(s.target, { compact: true })}`, position: "insideTopRight", fill: "rgb(var(--muted))", fontSize: 11 }} />
                    <Bar dataKey="cash" radius={[4, 4, 0, 0]} maxBarSize={72}>
                      {chart.map((c) => <Cell key={c.name} fill={colorFor(c.cash)} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead className="border-b border-line text-xs text-muted">
                    <tr><th scope="col" className="py-1.5 text-left font-medium">Result</th>{["Conservative", "Base", "Optimistic"].map((h) => <th key={h} scope="col" className="py-1.5 text-right font-medium">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {([
                      ["Required earnings before debt service", (r) => money(r.requiredEarningsBeforeDebtService)],
                      ["Annual debt service", (r) => money(r.annualDebtService)],
                      ["Monthly debt service", (r) => money(r.monthlyDebtService)],
                      ["Manager replacement", (r) => money(r.managerCost)],
                      ["Working capital reserve", (r) => money(r.workingCapitalReserve)],
                      ["Maintenance capex + other", (r) => money(r.maintenanceCapex + r.additionalOperatingCosts)],
                      ["Estimated taxes", (r) => money(r.estimatedTaxes)],
                      ["Cash to you per year", (r) => money(r.afterTaxCashToOwner)],
                      ["Cash to you per month", (r) => money(r.monthlyAfterTaxCash)],
                      ["Upfront cash needed", (r) => money(r.upfrontInvestment)],
                      ["Debt service coverage", (r) => (r.dscr === null ? "No debt" : `${r.dscr.toFixed(2)}×`)],
                      ["Cash-on-cash return", (r) => (r.cashOnCashReturnPct === null ? "—" : `${r.cashOnCashReturnPct.toFixed(1)}%`)],
                      ["Years to recover cash invested", (r) => (r.paybackYears === null ? "Never at this rate" : r.paybackYears.toFixed(1))],
                      ["Meets target?", (r) => (r.meetsTarget ? "Yes" : r.meetsMinimum ? "Minimum only" : "No")],
                    ] as [string, (r: ReturnType<typeof calculate>) => string][]).map(([label, fn]) => (
                      <tr key={label}>
                        <th scope="row" className="py-1.5 text-left font-normal text-muted">{label}</th>
                        {(["CONSERVATIVE", "BASE", "OPTIMISTIC"] as const).map((k) => <td key={k} className="num py-1.5 text-right">{fn(sc[k])}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-muted">
                  Conservative: SDE −{Math.round((1 - SCENARIO_ADJUSTMENTS.CONSERVATIVE.sdeMultiplier) * 100)}%, rates +{SCENARIO_ADJUSTMENTS.CONSERVATIVE.rateDeltaPts} pts, extra costs {SCENARIO_ADJUSTMENTS.CONSERVATIVE.extraCostPctOfSde * 100}% of SDE. Optimistic: SDE +{Math.round((SCENARIO_ADJUSTMENTS.OPTIMISTIC.sdeMultiplier - 1) * 100)}%, rates {SCENARIO_ADJUSTMENTS.OPTIMISTIC.rateDeltaPts} pts. Taxes ignore goodwill amortization (overstates tax slightly) and use first-year interest.
                </p>
              </div>
            </Panel>

            <Panel title="What could go wrong (base case)">
              <table className="w-full text-sm">
                <thead className="border-b border-line text-xs text-muted">
                  <tr><th scope="col" className="py-1.5 text-left font-medium">If…</th><th scope="col" className="py-1.5 text-right font-medium">Cash to you</th><th scope="col" className="py-1.5 text-right font-medium">Change</th><th scope="col" className="py-1.5 text-right font-medium">Target?</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {sens.map((r) => (
                    <tr key={r.label}>
                      <th scope="row" className="py-1.5 text-left font-normal">{r.label}{r.note && <span className="block text-xs text-faint">{r.note}</span>}</th>
                      <td className="num py-1.5 text-right">{r.afterTaxCashToOwner === null ? "—" : money(r.afterTaxCashToOwner)}</td>
                      <td className="num py-1.5 text-right text-loss">{r.delta === null ? "—" : money(r.delta)}</td>
                      <td className="py-1.5 text-right">{r.meetsTarget === null ? "—" : r.meetsTarget ? "Still meets" : "Misses"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
            {base.warnings.length > 0 && <div className="space-y-2">{base.warnings.map((w) => <Notice key={w} tone={w.startsWith("Owner-operated") ? "info" : "warn"}>{w}</Notice>)}</div>}
          </>
        )}
      </div>
    </div>
  );
}
