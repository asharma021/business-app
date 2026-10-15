import { cn } from "@/lib/utils";
import { money } from "@/lib/format";

/**
 * The SDE-to-take-home bar: shows where reported earnings go before they reach
 * you (debt service, manager/capex, estimated tax) and marks your target.
 * The owner-cash segment is colored by outcome: meets target / below target / negative.
 */
export interface IncomeBarData {
  sde: number;
  annualDebtService: number;
  managerCost: number;
  maintenanceCapex: number;
  additionalOperatingCosts: number;
  estimatedTaxes: number;
  afterTaxCashToOwner: number;
}

export function IncomeBar({ data, target, minimum, compact = false }: { data: IncomeBarData | null; target: number; minimum: number; compact?: boolean }) {
  if (!data) return <span className="text-sm text-faint">Needs price and cash flow</span>;
  const other = data.managerCost + data.maintenanceCapex + data.additionalOperatingCosts;
  const owner = data.afterTaxCashToOwner;
  const scale = Math.max(data.sde, target, 1);
  const w = (n: number) => `${Math.max(0, (n / scale) * 100)}%`;
  const tone = owner >= target ? "bg-gain" : owner >= minimum ? "bg-warn" : "bg-loss";
  const label = owner >= target ? "Meets target" : owner >= minimum ? "Above minimum, below target" : owner > 0 ? "Below minimum" : "Negative after debt";
  const summary = `Reported SDE ${money(data.sde)}: debt ${money(data.annualDebtService)}, other ${money(other)}, est. tax ${money(data.estimatedTaxes)}, leaves ${money(owner)} to you. ${label}.`;

  return (
    <div className={cn("min-w-[160px]", compact ? "w-full" : "w-full max-w-md")} role="img" aria-label={summary} title={summary}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={cn("num font-semibold", owner < 0 ? "text-loss" : owner >= target ? "text-gain" : owner >= minimum ? "text-warn" : "text-loss", compact ? "text-sm" : "text-base")}>
          {money(owner)}
          <span className="font-normal text-faint">/yr</span>
        </span>
        {!compact && <span className="text-xs text-muted">{label}</span>}
      </div>
      <div className="relative mt-1 h-2 overflow-hidden rounded-sm bg-raised">
        <div className="absolute inset-y-0 left-0 flex w-full">
          <div className={cn("h-full", tone)} style={{ width: w(Math.max(0, owner)) }} />
          <div className="h-full bg-faint/50" style={{ width: w(data.estimatedTaxes) }} />
          <div className="h-full bg-faint/30" style={{ width: w(other) }} />
          <div className="h-full bg-ink/25" style={{ width: w(data.annualDebtService) }} />
        </div>
        <div className="absolute inset-y-[-2px] w-0.5 bg-ink" style={{ left: `calc(${w(target)} - 1px)` }} aria-hidden />
      </div>
      {!compact && (
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
          <span>SDE {money(data.sde)}</span>
          <span>Debt {money(data.annualDebtService)}</span>
          {other > 0 && <span>Mgr/capex {money(other)}</span>}
          <span>Tax {money(data.estimatedTaxes)}</span>
          <span>Target line {money(target)}</span>
        </div>
      )}
    </div>
  );
}
