"use client";
import { useActionState } from "react";
import { RefreshCw } from "lucide-react";
import { runResearchNow, type ActionState } from "@/app/actions";
import { Button } from "@/components/ui";

export function RunResearchButton() {
  const [state, action, pending] = useActionState<ActionState>(async () => runResearchNow(), undefined);
  return (
    <form action={action} className="flex items-center gap-3">
      {state?.message && <span role="status" className="text-sm text-gain">{state.message}</span>}
      {state?.error && <span role="alert" className="text-sm text-loss">{state.error}</span>}
      <Button variant="primary" disabled={pending}>
        <RefreshCw className={pending ? "h-4 w-4 animate-spin" : "h-4 w-4"} aria-hidden />
        {pending ? "Queuing…" : "Run research now"}
      </Button>
    </form>
  );
}
