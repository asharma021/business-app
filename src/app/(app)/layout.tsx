import { and, eq, isNull, sql } from "drizzle-orm";
import { requireUser } from "@/auth";
import { Nav } from "@/components/nav";
import { db } from "@/db";
import { notifications } from "@/db/schema";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(notifications)
    .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));
  return (
    <div className="min-h-screen">
      <Nav email={user.email} unread={Number(n)} />
      <main className="lg:pl-60">
        <div className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
      </main>
    </div>
  );
}
