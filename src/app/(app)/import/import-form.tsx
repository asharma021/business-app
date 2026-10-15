"use client";
import Link from "next/link";
import { useActionState } from "react";
import { importCsvListings, importListing, importManualListing, type ActionState, type CsvActionState } from "@/app/actions";
import { Button, Field, Input, Notice, Select, Textarea } from "@/components/ui";

export function ImportForm({ aiEnabled }: { aiEnabled: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(importListing, undefined);
  return (
    <form action={action} className="space-y-4">
      {!aiEnabled && <Notice tone="warn">Reading listings from a link or pasted text needs ANTHROPIC_API_KEY. Use Enter details or Upload CSV instead until it's configured.</Notice>}
      {state?.error && <Notice tone="error">{state.error}</Notice>}
      <Field label="Listing link" htmlFor="url" hint="Optional when you paste text below, but recommended — it becomes the source link.">
        <Input id="url" name="url" type="url" placeholder="https://www.example-broker.com/listing/12345" />
      </Field>
      <Field label="Listing text" htmlFor="text" hint="Paste the description, asking price, revenue and cash flow. Leave empty to fetch the link.">
        <Textarea id="text" name="text" rows={10} placeholder="Established commercial cleaning company in Plano, TX. Asking price $1,150,000. Cash flow $470,000…" />
      </Field>
      <div className="flex items-center gap-3">
        <Button variant="primary" disabled={pending || !aiEnabled}>{pending ? "Reading the listing…" : "Import listing"}</Button>
        {pending && <span className="text-sm text-muted" role="status">This usually takes 10–30 seconds.</span>}
      </div>
    </form>
  );
}

const money = { inputMode: "numeric" as const, placeholder: "Not disclosed" };

export function ManualForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(importManualListing, undefined);
  return (
    <form action={action} className="space-y-4">
      {state?.error && <Notice tone="error">{state.error}</Notice>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Title" htmlFor="m-title"><Input id="m-title" name="title" required placeholder="Commercial cleaning company with recurring contracts" /></Field></div>
        <div className="sm:col-span-2"><Field label="Listing link" htmlFor="m-url" hint="Optional"><Input id="m-url" name="url" type="url" placeholder="https://…" /></Field></div>
        <Field label="Type" htmlFor="m-type"><Select id="m-type" name="type" defaultValue="ACQUISITION"><option value="ACQUISITION">Business for sale</option><option value="FRANCHISE">Franchise / franchise resale</option></Select></Field>
        <Field label="Industry" htmlFor="m-industry"><Input id="m-industry" name="industry" placeholder="Janitorial services" /></Field>
        <Field label="City" htmlFor="m-city"><Input id="m-city" name="city" placeholder="Plano" /></Field>
        <Field label="State" htmlFor="m-state"><Input id="m-state" name="state" maxLength={2} placeholder="TX" /></Field>
        <Field label="Asking price ($)" htmlFor="m-ask"><Input id="m-ask" name="askingPrice" {...money} /></Field>
        <Field label="Annual revenue ($)" htmlFor="m-rev" hint="Gross sales — not used as earnings"><Input id="m-rev" name="revenue" {...money} /></Field>
        <Field label="Cash flow / SDE ($)" htmlFor="m-cf" hint="Earnings before one owner's salary"><Input id="m-cf" name="cashFlow" {...money} /></Field>
        <Field label="EBITDA ($)" htmlFor="m-ebitda" hint="Earnings after a paid manager/owner"><Input id="m-ebitda" name="ebitda" {...money} /></Field>
        <Field label="Year established" htmlFor="m-year"><Input id="m-year" name="yearEstablished" inputMode="numeric" /></Field>
        <Field label="Employees" htmlFor="m-emp"><Input id="m-emp" name="employees" inputMode="numeric" /></Field>
        <Field label="Seller financing" htmlFor="m-sf"><Select id="m-sf" name="sellerFinancing" defaultValue=""><option value="">Not disclosed</option><option value="yes">Available</option><option value="no">Not available</option></Select></Field>
        <div className="sm:col-span-2"><Field label="Notes / description" htmlFor="m-desc"><Textarea id="m-desc" name="description" rows={3} /></Field></div>
      </div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="verified" className="mt-1" /> I verified these figures against tax returns or financial statements.</label>
      <Button variant="primary" disabled={pending}>{pending ? "Saving…" : "Save listing"}</Button>
    </form>
  );
}

export function CsvForm() {
  const [state, action, pending] = useActionState<CsvActionState, FormData>(importCsvListings, undefined);
  const s = state?.summary;
  return (
    <form action={action} className="space-y-4">
      {state?.error && <Notice tone="error">{state.error}</Notice>}
      <Field label="CSV file" htmlFor="csv" hint="Up to 500 rows and 1 MB. Columns: title, url, type, industry, city, state, asking_price, revenue, cash_flow, ebitda, year_established, employees, seller_financing, description.">
        <Input id="csv" name="file" type="file" accept=".csv,text/csv" required className="h-auto py-1.5" />
      </Field>
      <Button variant="primary" disabled={pending}>{pending ? "Importing…" : "Upload and import"}</Button>
      {s && (
        <div className="space-y-2" role="status">
          <Notice tone={s.errors.length ? "warn" : "ok"}>
            {s.created} new, {s.merged} matched existing opportunities{s.errors.length ? `, ${s.errors.length} row(s) skipped` : ""}.{" "}
            {s.created + s.merged > 0 && <Link href="/opportunities?sort=newest" className="text-accent hover:underline">View them</Link>}
          </Notice>
          {s.unknownColumns.length > 0 && <p className="text-sm text-muted">Ignored columns: {s.unknownColumns.join(", ")}</p>}
          {s.errors.length > 0 && (
            <ul className="max-h-48 overflow-y-auto rounded border border-line p-2 text-sm">
              {s.errors.map((e, i) => <li key={i}><span className="num text-muted">Line {e.line}:</span> {e.message}</li>)}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
