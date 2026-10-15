"use client";
import { useActionState } from "react";
import { importListing, type ActionState } from "@/app/actions";
import { Button, Field, Input, Notice, Textarea } from "@/components/ui";

export function ImportForm({ aiEnabled }: { aiEnabled: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(importListing, undefined);
  return (
    <form action={action} className="space-y-4">
      {!aiEnabled && <Notice tone="warn">Listing extraction needs an Anthropic API key (ANTHROPIC_API_KEY). Imports will fail until it's configured.</Notice>}
      {state?.error && <Notice tone="error">{state.error}</Notice>}
      <Field label="Listing URL" htmlFor="url" hint="Optional when you paste text below, but recommended — it becomes the source link.">
        <Input id="url" name="url" type="url" placeholder="https://www.example-broker.com/listing/12345" />
      </Field>
      <Field label="Listing text" htmlFor="text" hint="Paste the description, asking price, revenue and cash flow. Leave empty to fetch the URL.">
        <Textarea id="text" name="text" rows={10} placeholder="Established commercial cleaning company in Plano, TX. Asking price $1,150,000. Cash flow $470,000…" />
      </Field>
      <div className="flex items-center gap-3">
        <Button variant="primary" disabled={pending}>{pending ? "Importing — reading the listing…" : "Import listing"}</Button>
        {pending && <span className="text-sm text-muted" role="status">This usually takes 10–30 seconds.</span>}
      </div>
    </form>
  );
}
