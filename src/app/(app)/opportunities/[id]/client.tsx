"use client";
import Link from "next/link";
import { useActionState, useTransition } from "react";
import { Bookmark, ExternalLink, Printer, RefreshCw, Columns3 } from "lucide-react";
import { addNote, completeNote, requestResearch, setPipelineStatus, toggleFeedback, toggleSave, type ActionState } from "@/app/actions";
import { Button, buttonClass, Input, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";

export function OpportunityActions({ id, saved, pipeline, originalUrl }: { id: string; saved: boolean; pipeline: string; originalUrl: string | null }) {
  const [pending, start] = useTransition();
  const [research, doResearch, researching] = useActionState<ActionState>(async () => requestResearch(id), undefined);
  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <Button variant={saved ? "primary" : "secondary"} disabled={pending} onClick={() => start(() => toggleSave(id))} aria-pressed={saved}>
        <Bookmark className={cn("h-4 w-4", saved && "fill-current")} aria-hidden /> {saved ? "Saved" : "Save"}
      </Button>
      <form action={doResearch}>
        <Button disabled={researching}>
          <RefreshCw className={cn("h-4 w-4", researching && "animate-spin")} aria-hidden /> Request updated research
        </Button>
      </form>
      <Link href={`/compare?ids=${id}`} className={buttonClass("secondary")}><Columns3 className="h-4 w-4" aria-hidden /> Compare</Link>
      {originalUrl && (
        <a href={originalUrl} target="_blank" rel="noopener noreferrer nofollow" className={buttonClass("secondary")}>
          <ExternalLink className="h-4 w-4" aria-hidden /> Original listing
        </a>
      )}
      <Button onClick={() => window.print()} title="Opens the print dialog — choose Save as PDF">
        <Printer className="h-4 w-4" aria-hidden /> PDF
      </Button>
      <Button variant={pipeline === "CONTACTED" ? "primary" : "ghost"} disabled={pending} onClick={() => start(() => setPipelineStatus(id, pipeline === "CONTACTED" ? "NONE" : "CONTACTED"))} aria-pressed={pipeline === "CONTACTED"}>
        {pipeline === "CONTACTED" ? "Contacted" : "Mark contacted"}
      </Button>
      <Button variant={pipeline === "REJECTED" ? "danger" : "ghost"} disabled={pending} onClick={() => start(() => setPipelineStatus(id, pipeline === "REJECTED" ? "NONE" : "REJECTED"))} aria-pressed={pipeline === "REJECTED"}>
        {pipeline === "REJECTED" ? "Rejected" : "Mark rejected"}
      </Button>
      {(research?.message || research?.error) && (
        <p role="status" className={cn("w-full text-sm", research.error ? "text-loss" : "text-gain")}>{research.error ?? research.message}</p>
      )}
    </div>
  );
}

const FEEDBACK: [string, string][] = [
  ["INTERESTED", "Interested"],
  ["WORTH_INVESTIGATING", "Worth investigating"],
  ["ATTRACTIVE_CASH_FLOW", "Attractive cash flow"],
  ["CONTACTED_SELLER", "Contacted seller"],
  ["NOT_INTERESTED", "Not interested"],
  ["TOO_EXPENSIVE", "Too expensive"],
  ["TOO_RISKY", "Too risky"],
  ["TOO_MUCH_WORK", "Too much operational work"],
];

export function FeedbackChips({ id, active }: { id: string; active: string[] }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Feedback">
      {FEEDBACK.map(([k, label]) => {
        const on = active.includes(k);
        return (
          <button
            key={k}
            type="button"
            disabled={pending}
            aria-pressed={on}
            onClick={() => start(() => toggleFeedback(id, k))}
            className={cn("rounded border px-2 py-1 text-xs", on ? "border-accent bg-accent/10 text-accent" : "border-line text-muted hover:text-ink")}
          >
            {label}
          </button>
        );
      })}
      <p className="mt-2 w-full text-xs text-faint">Recorded with this opportunity. Learning from feedback to adjust rankings is planned for a later phase; it will never change your hard financial limits.</p>
    </div>
  );
}

export function NoteForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addNote.bind(null, id), undefined);
  return (
    <form action={action} className="space-y-2" key={state?.ok ? Date.now() : "form"}>
      <label htmlFor="note-body" className="sr-only">Note</label>
      <Textarea id="note-body" name="body" rows={3} placeholder="Add a note…" />
      <div className="flex items-center gap-2">
        <label htmlFor="note-due" className="text-xs text-muted">Follow up on</label>
        <Input id="note-due" name="dueAt" type="date" className="h-8 w-auto" />
        <Button className="ml-auto h-8" disabled={pending}>Add</Button>
      </div>
      {state?.error && <p className="text-sm text-loss" role="alert">{state.error}</p>}
    </form>
  );
}

export function CompleteNoteButton({ noteId, oppId }: { noteId: string; oppId: string }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending} onClick={() => start(() => completeNote(noteId, oppId))} className="text-accent hover:underline">
      Mark done
    </button>
  );
}
