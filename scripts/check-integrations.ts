/**
 * Live integration check. Run after deploying (or locally with a filled-in .env):
 *   npm run check:integrations            # database, worker, Anthropic, Census, Resend
 *   npm run check:integrations -- --web-search   # also runs one real web search (~$0.01)
 *   npm run check:integrations -- --email you@example.com   # also sends a real test email
 */
import { pool } from "@/db";
import { runAllChecks } from "@/lib/health/checks";
import { sendTestEmail } from "@/lib/report/deliver";

const args = process.argv.slice(2);
const emailIdx = args.indexOf("--email");

async function main() {
  const results = await runAllChecks({ webSearch: args.includes("--web-search") });
  if (emailIdx >= 0) {
    const to = args[emailIdx + 1];
    const t = Date.now();
    try {
      const r = await sendTestEmail(null, to);
      results.push({ name: "Test email", status: "ok", detail: `Sent to ${to} (Resend id ${r.id})`, ms: Date.now() - t });
    } catch (e) {
      results.push({ name: "Test email", status: "fail", detail: (e as Error).message, ms: Date.now() - t });
    }
  }
  const icon = { ok: "PASS", warn: "WARN", fail: "FAIL", skipped: "SKIP" } as const;
  for (const r of results) console.log(`${icon[r.status].padEnd(5)} ${r.name.padEnd(38)} ${r.detail} (${r.ms}ms)`);
  await pool.end();
  process.exit(results.some((r) => r.status === "fail") ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
