import Link from "next/link";
import { requireUser } from "@/auth";
import { EmptyState, PageHeader, Panel } from "@/components/ui";

export const metadata = { title: "Emerging opportunities" };

export default async function EmergingPage() {
  await requireUser();
  return (
    <>
      <PageHeader title="Emerging opportunities" description="Business models you could launch yourself, backed by demand and competition data." />
      <Panel>
        <EmptyState title="Not built yet — planned for Phase 8">
          This page will rank launchable business models using Census, BLS and local demand data, with startup capital, break-even and owner-income scenarios. Until then, the{" "}
          <Link href="/market" className="text-accent hover:underline">market trends</Link> page shows official DFW industry data, and the{" "}
          <Link href="/calculator" className="text-accent hover:underline">calculator</Link> can model a startup by entering expected earnings.
        </EmptyState>
      </Panel>
    </>
  );
}
