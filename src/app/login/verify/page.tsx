import Link from "next/link";
import { Radar } from "lucide-react";
import { features } from "@/lib/env";

export const dynamic = "force-dynamic";
export const metadata = { title: "Check your email" };

export default function VerifyPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2 text-lg font-semibold tracking-tight">
          <Radar className="h-6 w-6 text-accent" aria-hidden /> Opportunity Radar
        </div>
        <h1 className="text-xl font-semibold">Check your email</h1>
        <p className="mt-2 text-sm text-muted">
          If that address is allowed to sign in, a one-time link is on its way. It expires in 24 hours and works once.
          {features.email() ? "" : " Email isn't configured on this server, so the link was printed in the server log."}
        </p>
        <Link href="/login" className="mt-6 inline-block text-sm text-accent hover:underline">Use a different email</Link>
      </div>
    </div>
  );
}
