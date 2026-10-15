import NextAuth, { type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import Resend from "next-auth/providers/resend";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { accounts, auditLogs, sessions, users, verificationTokens } from "@/db/schema";
import { env, features } from "@/lib/env";
import { getOrCreatePreference } from "@/lib/preferences";

/** Lazily built so `next build` doesn't need secrets. */
function config(): NextAuthConfig {
  const e = env();
  const providers: NextAuthConfig["providers"] = [
    Resend({
      apiKey: e.RESEND_API_KEY ?? "unset",
      from: e.EMAIL_FROM,
      // Without RESEND_API_KEY (local dev), print the sign-in link to the server log.
      ...(features.email()
        ? {}
        : {
            sendVerificationRequest: async ({ identifier, url }: { identifier: string; url: string }) => {
              console.log(`\n[auth] Sign-in link for ${identifier}:\n${url}\n`);
            },
          }),
    }),
  ];
  if (features.google()) providers.push(Google({ clientId: e.AUTH_GOOGLE_ID, clientSecret: e.AUTH_GOOGLE_SECRET }));

  return {
    secret: e.AUTH_SECRET,
    trustHost: true,
    adapter: DrizzleAdapter(db, { usersTable: users, accountsTable: accounts, sessionsTable: sessions, verificationTokensTable: verificationTokens }),
    session: { strategy: "database", maxAge: 30 * 24 * 3600 },
    providers,
    pages: { signIn: "/login", verifyRequest: "/login?sent=1", error: "/login" },
    callbacks: {
      // Personal app: only allow-listed emails can sign in (or receive a link).
      async signIn({ user, email }) {
        const addr = (user.email ?? "").toLowerCase();
        const ok = e.ALLOWED_EMAILS.includes(addr);
        if (!ok) console.warn(`[auth] blocked sign-in attempt for ${addr}${email?.verificationRequest ? " (link request)" : ""}`);
        return ok;
      },
      async session({ session, user }) {
        session.user.id = user.id;
        return session;
      },
    },
    events: {
      async signIn({ user }) {
        if (user.id) {
          await getOrCreatePreference(user.id, user.email);
          await db.insert(auditLogs).values({ userId: user.id, action: "auth.sign_in" });
        }
      },
    },
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth(() => config());

export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return { id: session.user.id, email: session.user.email ?? null, name: session.user.name ?? null };
}
