# Opportunity Radar AI

A personal research platform for finding businesses that can realistically replace $100k–$200k+ of W-2 income. It discovers and imports opportunities, works out what actually reaches you after debt service and tax, researches each business with Claude, ranks the results transparently, and emails you a daily intelligence report.

**Status: Phase 1 (functional foundation) is complete and tested.** See [What's done and what isn't](#whats-done-and-what-isnt).

---

## Architecture

```
            ┌──────────────────────────────┐        ┌───────────────────────────────┐
 Browser ──▶│ Next.js 15 web app (App Router)│        │ Worker (Node, long-running)    │
            │ • Auth.js (email link, Google) │        │ • pg-boss scheduler (every 10m)│
            │ • Server actions / pages       │        │ • Daily research cycle         │
            │ • Enqueues jobs ───────────────┼──┐  ┌─▶│ • Daily report + email         │
            └───────────────┬───────────────┘  │  │  │ • Single-opportunity research  │
                            │                  ▼  │  └──────────────┬────────────────┘
                            │        ┌──────────────────────┐       │
                            └───────▶│ PostgreSQL            │◀──────┘
                                     │ app tables (Drizzle)  │
                                     │ + pg-boss job queue   │
                                     └──────────────────────┘
       External: Claude API (extraction, web search, research) · Census CBP API · RSS feeds you add · Resend (email)
```

**Why these choices**

- **pg-boss instead of Redis/BullMQ.** Jobs, retries and cron schedules live in the same managed Postgres, so there is one fewer service to run and jobs survive restarts.
- **The dispatcher pattern.** A cron fires every 10 minutes and works out what is due for each user's timezone and report time. Research starts an hour before the report; the report waits until research has finished. A worker that was down catches up the same day. Research runs and email sends are idempotent at the database level (`research_job.idempotency_key`, unique `email_delivery(user, kind, date)`), so duplicate fires can never cause double work or double emails.
- **Drizzle ORM instead of Prisma.** It's a typed, pure-TypeScript data layer with SQL migrations (`drizzle/`). Prisma's engine binaries couldn't be downloaded in the build environment, and Drizzle runs anywhere without them.
- **The worker is a separate process.** Vercel serverless functions can't reliably run multi-minute research jobs, so they never do.

### Repository structure

```
src/
  app/                    Next.js routes
    (app)/                signed-in pages: overview, opportunities, calculator, compare, watchlist,
                          research, reports, market, sources, settings, emerging, import
    actions.ts            server actions (validated with zod, audited, rate-limited)
    login/                sign-in page
    api/                  auth, health check, sign-out
  components/             UI primitives (shadcn-style), income bar, opportunity table, nav
  db/
    schema.ts             normalized schema (26 tables)
    migrate.ts            runs migrations + seeds the source registry
    seed-sources.ts       data-source registry: confirmed vs proposed
  lib/
    finance/calculator.ts salary-replacement engine (pure, unit-tested)
    scoring.ts            0–100 transparent scoring engine (pure, unit-tested)
    ai/                   provider abstraction, schemas, prompt-injection guard, research auditor
    research/             agents, pipeline, scoring service
    sources/              polite HTTP (robots.txt, SSRF guard), Census CBP client
    report/               daily report builder, email renderer, delivery
    ingest.ts             cross-source dedupe, price-change tracking, provenance
    schedule.ts           dispatcher timing logic (unit-tested)
    queue.ts, jobs.ts     job queue + idempotent job records
  worker/index.ts         background worker entry point
drizzle/                  SQL migrations
tests/                    unit tests; tests/integration runs against real Postgres
```

---

## Data sources

The registry is shown in the app under **Research sources**. Only **Automated** sources are ever fetched on a schedule.

| Source | Status | What it provides |
|---|---|---|
| Claude API web search (`web_search` tool) | **Automated** — needs `ANTHROPIC_API_KEY` | Finds public listing pages; also used in research. A candidate is kept only if its URL appeared in the actual search results. Figures are stored as *seller-reported, unverified*. Listing pages are not crawled. |
| U.S. Census County Business Patterns API | **Automated** — works without a key at low volume; `CENSUS_API_KEY` recommended | Establishments, employees and payroll for 15 tracked service industries in the DFW metro (CBSA 19100). Market context, not listings. |
| RSS feeds you add | **Automated once configured** | Any listing feed you're permitted to use. robots.txt is checked on every fetch. |
| Manual URL import | Manual (needs Anthropic key) | Fetches the page once, and only if robots.txt allows it. Otherwise you paste the text. Claude extracts the fields. |
| Manual entry form | Manual (no AI) | You type the figures. Tick "verified" when they're checked against tax returns or statements. |
| CSV upload | Manual (no AI) | Up to 500 rows. Template at `/listing-import-template.csv`. |
| Pasted text / document | Manual | Listing text, CIM excerpts, broker emails. |
| BizBuySell, BizQuest, BusinessesForSale, LoopNet, Franchise Direct, Franchise Gator | Proposed — **not integrated** | No public listings API was identified. Use manual import, or obtain a licensed data feed and add a connector. |
| BLS, FRED, SBA open data, WI/CA franchise (FDD) registries | Proposed — planned for Phase 2 | Documented public data. Not wired in yet. |
| Google Trends, Reddit | Proposed — not automated | No general public API (Trends), or approval required (Reddit). |

**Verification status.** None of these integrations have been called against the live services yet. The build environment's network blocked `api.census.gov` and `api.resend.com`, and no Anthropic key was available. The real Anthropic and Resend SDKs are tested against local mock servers that mirror each API's documented responses. The Census query matches the documented query shape. After deploying, **Research sources → Check connections** (or `npm run check:integrations`) makes one small real request to each service.

---

## Credentials you need

| Service | Needed for | Variables |
|---|---|---|
| Managed **PostgreSQL** 14+ (Railway, Neon, Supabase, RDS) | everything | `DATABASE_URL` |
| **Anthropic API** (console.anthropic.com) | listing extraction, discovery, AI research | `ANTHROPIC_API_KEY`, optionally `AI_MODEL`, price variables for cost tracking |
| **Resend** (resend.com) with a verified sending domain | sign-in emails and the daily report | `RESEND_API_KEY`, `EMAIL_FROM` |
| **Census API key** (free) | reliable market data | `CENSUS_API_KEY` |
| Google OAuth client (optional) | "Continue with Google" | `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` |

Also set `AUTH_SECRET` (`openssl rand -base64 32`), `APP_URL`, and `ALLOWED_EMAILS` (only these addresses can sign in). All variables are listed with comments in `.env.example`, and they are validated at startup: the worker refuses to start if one is invalid.

**Cost tracking.** Tokens and web searches are always recorded. USD cost and the daily budget cap (`AI_DAILY_BUDGET_USD`) take effect only once you set `AI_INPUT_USD_PER_MTOK` and `AI_OUTPUT_USD_PER_MTOK` from Anthropic's pricing page. Prices are deliberately not hard-coded. Web search is billed at $10 per 1,000 searches (per Anthropic's docs at time of writing). `RESEARCH_MAX_PER_RUN` caps how many opportunities get deep research per run.

---

## Run locally

```bash
cp .env.example .env          # fill in DATABASE_URL, AUTH_SECRET, ALLOWED_EMAILS at minimum
npm install
npm run db:migrate            # creates tables + seeds the source registry
npm run dev                   # web app on http://localhost:3000
npm run worker                # in a second terminal — scheduler + jobs
```

Without `RESEND_API_KEY`, the sign-in link is printed in the web server's log.

## Tests

```bash
npm test                      # unit tests: calculator, scoring, auditor, dedupe, guard, schedule
npm run test:integration      # against a real Postgres (TEST_DATABASE_URL, must contain "test")
npm run typecheck
npm run build
```

The integration suite runs the critical workflow end to end, with a fake LLM and a fake mailer. The listing is imported (including an embedded prompt injection, which is flagged rather than obeyed). Then it is saved, researched, audited (an invented source URL is stripped, the recommendation is capped), scored, included in the daily report, and emailed exactly once. GitHub Actions (`.github/workflows/ci.yml`) runs all of this on every push.

## Deploy

See **[DEPLOYMENT.md](DEPLOYMENT.md)**. It covers the Railway walkthrough (Postgres, web and worker services, variables, migrations, custom domain), a verification sequence, cost estimates and troubleshooting.

Live check of every integration from any machine with the production variables:

```bash
npm run check:integrations                        # database, worker heartbeat, Anthropic, Census, Resend
npm run check:integrations -- --web-search        # plus one real Claude web search (~$0.01)
npm run check:integrations -- --email you@x.com   # plus a real test email
```

## Verify after deploying

Follow section 5 of [DEPLOYMENT.md](DEPLOYMENT.md#5-verify-the-deployment-in-this-order).

---

## What's done and what isn't

**Phase 1 — complete and tested**

- Authentication: email magic link via Resend, optional Google sign-in, an allow-list, and database sessions.
- Normalized schema (27 tables) with three migrations, indexes and unique constraints that prevent duplicate opportunities and duplicate daily emails.
- Automated discovery via Claude web search, Census market data and configurable RSS feeds.
- Three manual import methods: link or pasted text (AI extraction), a structured entry form, and CSV upload (no AI needed for the last two).
- Cross-source deduplication (exact fingerprint plus fuzzy matching), with price and status change history.
- AI research: business, market, competition, operations, risks and due-diligence questions, with citations. A deterministic auditor removes unverifiable URLs and caps recommendations while financials are unverified.
- Salary-replacement calculator that keeps revenue, SDE, EBITDA, debt service and owner cash separate: it starts from SDE (or EBITDA when SDE isn't disclosed, without subtracting a manager twice) and never treats revenue as earnings. SBA-style, conventional, seller and cash structures; owner-operated vs semi-absentee; DSCR; required SDE; break-even; payback; three scenarios; sensitivity analysis.
- Transparent 0–100 scoring with adjustable weights and evidence confidence caps, plus separate attractiveness, feasibility, confidence and fit scores.
- Dashboard, searchable and filterable opportunity database, detail pages, watchlist, compare (up to 5), report archive, market data and source health.
- Background worker: 7:00 AM Central default (configurable per user, DST-correct), manual "Run research now", retries, failure notifications, a heartbeat, and per-run metrics including AI cost. The AI budget cap applies to scheduled, on-demand and import usage.
- Operations tools: **Send test email**, **Build and email today's report now**, **Check connections** (live checks of the database, worker, Anthropic, Census and Resend), and `npm run check:integrations`.
- Daily email with every required section. When nothing qualifies, it says "No compelling opportunities found today."
- Security: allow-listed auth that doesn't reveal which emails are allowed, sign-in links pinned to `APP_URL` (immune to Host-header poisoning), zod input validation, rate limits and audit log, SSRF-safe fetching, robots.txt compliance, prompt-injection containment, security headers.

**Known gaps in Phase 1**

- **PDF** export uses the browser's print dialog (Save as PDF). Server-side PDF generation isn't built.
- **Feedback** buttons are recorded but don't yet change rankings (Phase 2 recommendation engine).
- **Separate email alerts** (price drop, new match) aren't sent individually. These changes appear in the daily email's watchlist and price-reduction sections instead.
- **Error monitoring** is structured logging plus in-app failure notifications. No Sentry or similar is wired in.
- **Backups** rely on your managed Postgres provider's backups. Turn them on.
- **UI components** follow shadcn/ui conventions but were written by hand, because the shadcn CLI registry wasn't reachable from the build environment.

**Phases 2–10** — not started. These include more licensed sources, FDD research, the multi-agent queue with budgets, IRR, the in-app advisor chat, weekly/monthly reports, the acquisition pipeline with document uploads, the emerging-opportunity radar, portfolio planning and the admin dashboard.

### Blockers that need you

1. **API keys.** Anthropic and Resend keys (and ideally a Census key) are needed before discovery, research and email can run for real. None of the three has been exercised live yet.
2. **Listing data access.** If you want automated feeds from BizBuySell or similar marketplaces, that requires a licensing or data agreement with them. Until then, use manual import and any broker RSS feeds you're permitted to use.
3. **Hosting.** Create the Postgres database and the web and worker services.
