import { redirect } from "next/navigation";
import { Radar } from "lucide-react";
import { AuthError } from "next-auth";
import { auth, signIn } from "@/auth";
import { features } from "@/lib/env";
import { Button, Input, Notice } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  AccessDenied: "That email isn't on this app's allow list. Add it to ALLOWED_EMAILS to grant access.",
  Verification: "That sign-in link has expired or was already used. Request a new one.",
  Configuration: "Sign-in is misconfigured on the server. Check AUTH_SECRET and email settings.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ sent?: string; error?: string }> }) {
  const session = await auth();
  if (session?.user) redirect("/");
  const sp = await searchParams;

  async function emailSignIn(form: FormData) {
    "use server";
    try {
      await signIn("resend", { email: String(form.get("email") ?? "").trim().toLowerCase(), redirectTo: "/", redirect: false });
    } catch (e) {
      // Don't reveal which emails are allowed: a blocked address sees the same "check your inbox" screen.
      if (!(e instanceof AuthError && e.type === "AccessDenied")) throw e;
    }
    redirect("/login/verify");
  }
  async function googleSignIn() {
    "use server";
    await signIn("google", { redirectTo: "/" });
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2 text-lg font-semibold tracking-tight">
          <Radar className="h-6 w-6 text-accent" aria-hidden /> Opportunity Radar
        </div>
        <h1 className="text-xl font-semibold">Sign in</h1>
        <p className="mt-1 text-sm text-muted">We'll email you a one-time sign-in link.</p>
        <div className="mt-6 space-y-4">
          {sp.error && <Notice tone="error">{ERRORS[sp.error] ?? "Sign-in failed. Try again."}</Notice>}
          <form action={emailSignIn} className="space-y-3">
            <label htmlFor="email" className="sr-only">Email</label>
            <Input id="email" name="email" type="email" required autoComplete="email" placeholder="you@example.com" />
            <Button variant="primary" className="w-full">Email me a sign-in link</Button>
          </form>
          {features.google() && (
            <form action={googleSignIn}>
              <Button className="w-full">Continue with Google</Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
