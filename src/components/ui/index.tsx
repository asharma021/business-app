import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { money } from "@/lib/format";

// ───────── Buttons & inputs (shadcn/ui-style primitives) ─────────

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
const buttonBase =
  "inline-flex items-center justify-center gap-1.5 rounded px-3 h-9 text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap";
const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent/90",
  secondary: "border border-line bg-surface text-ink hover:bg-raised",
  ghost: "text-muted hover:text-ink hover:bg-raised",
  danger: "border border-loss/40 text-loss hover:bg-loss/10",
};
export function buttonClass(variant: ButtonVariant = "secondary", className?: string) {
  return cn(buttonBase, buttonVariants[variant], className);
}
export function Button({ variant = "secondary", className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button className={buttonClass(variant, className)} {...p} />;
}
export function LinkButton({ variant = "secondary", className, ...p }: React.ComponentProps<typeof Link> & { variant?: ButtonVariant }) {
  return <Link className={buttonClass(variant, className)} {...p} />;
}

const field = "w-full rounded border border-line bg-surface px-3 h-9 text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none";
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input ref={ref} className={cn(field, className)} {...p} />
));
Input.displayName = "Input";
export function Textarea({ className, ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(field, "h-auto py-2 leading-relaxed", className)} {...p} />;
}
export function Select({ className, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(field, "pr-8", className)} {...p} />;
}
export function Label({ className, ...p }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("block text-sm font-medium text-ink mb-1", className)} {...p} />;
}
export function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

// ───────── Layout ─────────

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, action, children, className, flush }: { title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={cn("rounded-lg border border-line bg-surface", className)}>
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {action}
        </header>
      )}
      <div className={flush ? "" : "p-4"}>{children}</div>
    </section>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "error" | "ok"; children: React.ReactNode }) {
  const tones = {
    info: "border-line bg-raised text-ink",
    warn: "border-warn/40 bg-warn/10 text-ink",
    error: "border-loss/40 bg-loss/10 text-ink",
    ok: "border-gain/40 bg-gain/10 text-ink",
  };
  return <div className={cn("rounded border px-3 py-2 text-sm", tones[tone])}>{children}</div>;
}

// ───────── Data display ─────────

export function Money({ value, className, suffix }: { value: number | null | undefined; className?: string; suffix?: string }) {
  if (value === null || value === undefined) return <span className={cn("text-faint", className)}>Not disclosed</span>;
  return (
    <span className={cn("num", className)}>
      {money(value)}
      {suffix}
    </span>
  );
}

export function Badge({ tone = "neutral", children, className }: { tone?: "neutral" | "gain" | "warn" | "loss" | "accent"; children: React.ReactNode; className?: string }) {
  const tones = {
    neutral: "bg-raised text-muted",
    gain: "bg-gain/10 text-gain",
    warn: "bg-warn/10 text-warn",
    loss: "bg-loss/10 text-loss",
    accent: "bg-accent/10 text-accent",
  };
  return <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium", tones[tone], className)}>{children}</span>;
}

export function ScoreBadge({ score, confidence }: { score: number | null | undefined; confidence?: number | null }) {
  if (score === null || score === undefined) return <span className="text-sm text-faint">Unscored</span>;
  const tone = score >= 70 ? "text-gain" : score >= 50 ? "text-ink" : "text-muted";
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className={cn("num text-base font-semibold", tone)}>{score}</span>
      {confidence !== undefined && confidence !== null && (
        <span className="text-xs text-faint" title="Evidence confidence (0–100)">
          conf {confidence}
        </span>
      )}
    </span>
  );
}

export const RECOMMENDATION_LABEL: Record<string, { label: string; tone: "gain" | "warn" | "loss" | "neutral" | "accent" }> = {
  STRONG_CANDIDATE: { label: "Strong candidate", tone: "gain" },
  PROMISING_NEEDS_VERIFICATION: { label: "Promising, verify", tone: "accent" },
  HIGH_RISK: { label: "High risk", tone: "loss" },
  FINANCIALLY_UNATTRACTIVE: { label: "Financially unattractive", tone: "warn" },
  INSUFFICIENT_DATA: { label: "Insufficient data", tone: "neutral" },
};

export function RecommendationBadge({ value }: { value: string | null | undefined }) {
  if (!value) return null;
  const r = RECOMMENDATION_LABEL[value] ?? { label: value, tone: "neutral" as const };
  return <Badge tone={r.tone}>{r.label}</Badge>;
}

export const RESEARCH_STATUS_LABEL: Record<string, string> = {
  NEW: "New",
  QUEUED: "Queued for research",
  RESEARCHING: "Researching",
  RESEARCHED: "Researched",
  NEEDS_INFO: "Needs financials",
  FAILED: "Research failed",
};
