# Deploying Opportunity Radar to Railway

This guide sets up three Railway services from one GitHub repo:

| Service | What it runs | Public URL |
|---|---|---|
| **Postgres** | Railway-managed PostgreSQL (app data + job queue) | No |
| **web** | `npm start` — the website | Yes |
| **worker** | `npm run worker` — scheduler, research, daily email | No |

Both app services build from the repo's `Dockerfile`. Railway uses a `Dockerfile` at the repo root automatically.

> Railway's older `railway.json` "config as code" is deprecated: new services can't opt in, and existing files stop being read on 2026-12-01. This guide uses dashboard settings only.

---

## 0. Accounts and keys (about 20 minutes)

| Service | What to do | Result |
|---|---|---|
| Railway | Sign up and choose **Hobby** ($5/month, includes $5 of usage). | Project access |
| GitHub | Railway → Account → connect GitHub, and allow access to `asharma021/business-app`. | Railway can deploy the repo |
| Anthropic | console.anthropic.com → add credit (start with $20) → **API Keys** → create a key. | `ANTHROPIC_API_KEY` |
| Resend | resend.com → **Domains** → add a domain or subdomain you own (e.g. `mail.yourdomain.com`), add the DNS records it shows, wait for **Verified** → **API Keys** → create a key with sending access. | `RESEND_API_KEY`, `EMAIL_FROM` |
| Census | api.census.gov/data/key_signup.html (free, emailed to you). | `CENSUS_API_KEY` |
| Secret | Run `openssl rand -base64 32` locally. | `AUTH_SECRET` |

Optional: a Google OAuth client for "Continue with Google". The authorized redirect URI is `https://<your-domain>/api/auth/callback/google`.

---

## 1. Create the project and database

1. Railway dashboard → **New Project** → **Deploy from GitHub repo** → pick `asharma021/business-app`. This creates the first service. Open it → **Settings** → rename it **web**.
2. Let the first deploy fail; it has no variables yet.
3. In the project canvas → **+ Create** → **Database** → **PostgreSQL**. Railway names it **Postgres**.
4. Open **Postgres** → **Backups**. Enable scheduled backups if your plan offers them. Otherwise, take a manual `pg_dump` weekly until you upgrade.

## 2. Configure the **web** service

**Variables** tab → **Raw Editor** → paste, then fill in the values:

```
DATABASE_URL=${{Postgres.DATABASE_URL}}
APP_URL=https://<temporary railway domain, set in step 2.4>
AUTH_SECRET=<openssl output>
ALLOWED_EMAILS=you@example.com
RESEND_API_KEY=re_...
EMAIL_FROM=Opportunity Radar <radar@mail.yourdomain.com>
ANTHROPIC_API_KEY=sk-ant-...
AI_MODEL=claude-sonnet-5-5
AI_INPUT_USD_PER_MTOK=2
AI_OUTPUT_USD_PER_MTOK=10
AI_WEB_SEARCH_USD_PER_1K=10
AI_DAILY_BUDGET_USD=5
RESEARCH_MAX_PER_RUN=5
DISCOVERY_MAX_SEARCHES=6
CENSUS_API_KEY=...
```

`${{Postgres.DATABASE_URL}}` is a Railway reference to the database's private connection string. Leave it exactly as written.

**Settings** tab:

1. **Deploy → Pre-deploy command:** `npm run db:migrate`. This runs migrations and seeds the source registry before each release, on Railway's private network. If it fails, the release is stopped.
2. **Deploy → Healthcheck path:** `/api/health`. It returns 200 only when the database is reachable.
3. **Deploy → Restart policy:** On failure.
4. **Networking → Generate Domain.** Copy the `*.up.railway.app` URL into `APP_URL` (with `https://`).
5. Redeploy.

`APP_URL` matters for security: sign-in links are always built from it, never from request headers. It must exactly match the address you use in the browser.

## 3. Create the **worker** service

1. Project canvas → **+ Create** → **GitHub Repo** → the same repo. Rename it **worker**.
2. **Variables** → **Raw Editor** → paste the **same** block as the web service.
3. **Settings:**
   - **Deploy → Custom start command:** `npm run worker`
   - **Deploy → Healthcheck path:** leave empty. The worker has no web server; Railway would mark it unhealthy.
   - **Deploy → Pre-deploy command:** leave empty. The web service runs migrations, and the worker also seeds sources at startup.
   - **Networking:** don't generate a domain.
   - **Replicas:** 1. Running several is safe because jobs are de-duplicated, but it wastes money.
4. Deploy. The logs should end with `Opportunity Radar worker started`.

Deploy order matters only the first time: deploy **web** first so migrations run, then **worker**.

## 4. Custom domain (e.g. `radar.yourdomain.com`)

1. **web** → **Settings** → **Networking** → **+ Custom Domain** → enter the domain → choose port `3000` if asked.
2. Railway shows a **CNAME** and a **TXT** record. Add **both** at your DNS provider. The domain won't verify with only the CNAME.
3. Wait for the green check. DNS can take up to 72 hours, but usually minutes. The TLS certificate is issued automatically, typically within an hour.
4. If you use a root domain (`yourdomain.com`), your DNS provider must support CNAME flattening or ALIAS records (Cloudflare, Namecheap, DNSimple). Route 53 and GoDaddy don't; use a subdomain instead.
5. If the domain is proxied through Cloudflare (orange cloud), set SSL/TLS mode to **Full**, not Full (Strict).
6. Change `APP_URL` to `https://radar.yourdomain.com` on **both** services and redeploy both.
7. If you set up Google sign-in, add the new callback URL in Google Cloud.

## 5. Verify the deployment (in this order)

1. Open `https://<APP_URL>/api/health` → `{"ok":true}`.
2. Sign in with an email from `ALLOWED_EMAILS`. The link arrives from Resend. Sign in with any other address and you should see the same "check your email" screen, but no email arrives.
3. **Research sources → Check connections.** Tick "Also test Claude web search" (one search, about $0.01). All five rows should say **Pass**:
   - Database
   - Background worker: heartbeat within 15 minutes
   - Anthropic API and web search: web search is on by default; this fails only if an admin turned it off in the Claude Console
   - Census
   - Resend: confirms your `EMAIL_FROM` domain is verified
4. **Settings → Send test email.** It should arrive within a minute; check spam.
5. **Settings:** set your income goals, capital budget and financing assumptions → **Save**.
6. **Import → Link or pasted text:** paste a real listing. You land on its page with seller-reported figures and the income bar. Then try **Enter details** and **Upload CSV** (template on that page).
7. On that opportunity → **Request updated research**. Within 2–5 minutes the AI recommendation, sources and score breakdown appear. **Research sources → Research runs** shows tokens, searches and cost.
8. **Research sources → Run research now.** Within a few minutes the run log shows each source (Census, web discovery, RSS) and new opportunities.
9. **Daily intelligence → Build and email today's report now.** The email arrives, and the report is archived.
10. Next morning: the scheduled report arrives at about **7:00–7:10 AM Central**, after research starts at about 6:00. It is listed on **Daily intelligence** as *Emailed*.

---

## Environment variables

| Variable | web | worker | Notes |
|---|:-:|:-:|---|
| `DATABASE_URL` | ✓ | ✓ | `${{Postgres.DATABASE_URL}}` |
| `APP_URL` | ✓ | ✓ | Exact public URL; used for sign-in links and email links |
| `AUTH_SECRET` | ✓ | ✓ | 32+ random characters; changing it signs everyone out |
| `ALLOWED_EMAILS` | ✓ | ✓ | Comma-separated |
| `RESEND_API_KEY`, `EMAIL_FROM` | ✓ | ✓ | Domain in `EMAIL_FROM` must be verified in Resend |
| `ANTHROPIC_API_KEY`, `AI_MODEL` | ✓ | ✓ | Web uses it for imports; worker for research |
| `AI_INPUT_USD_PER_MTOK`, `AI_OUTPUT_USD_PER_MTOK`, `AI_WEB_SEARCH_USD_PER_1K` | ✓ | ✓ | Defaults match Claude Sonnet 5.5 pricing ($2 / $10 per million tokens, $10 per 1,000 searches) as of October 2026 |
| `AI_DAILY_BUDGET_USD` | ✓ | ✓ | Hard stop on AI spend per rolling 24 hours |
| `RESEARCH_MAX_PER_RUN`, `DISCOVERY_MAX_SEARCHES` | | ✓ | Main cost levers |
| `CENSUS_API_KEY` | ✓ | ✓ | Optional but recommended |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | ✓ | | Optional |

The web app and worker validate these at startup, and the worker refuses to start if any are invalid. None of them are sent to the browser; a build-time scan of the client bundles found no secret values.

---

## Estimated monthly cost

Assumptions: Claude Sonnet 5.5 at $2 / $10 per million tokens and $10 per 1,000 web searches (Anthropic pricing page, October 2026); Railway Hobby at $5/month with $5 of included usage, with compute at about $20 per vCPU-month and $10 per GB-month of memory; Resend free tier (3,000 emails/month, 100/day).

Per-operation AI cost estimates (not yet measured against the live API — check **Research runs** after the first week):

| Operation | Estimated tokens | Estimated cost |
|---|---|---|
| Listing extraction (import by link or text) | ~6k in / 1k out | ~$0.02 |
| Web discovery run (6 searches) | ~60–80k in / 5k out + 6 searches | ~$0.20–0.30 |
| Deep research per opportunity (5 searches + structured report) | ~50–80k in / 6–8k out + 5 searches | ~$0.20–0.35 |
| CSV / manual entry, Census, scoring, reports | none | $0 |

| Usage level | Settings | AI (Anthropic) | Railway | Resend | Census | **Total / month** |
|---|---|---|---|---|---|---|
| **Low** | `RESEARCH_MAX_PER_RUN=2`, 6 searches/day, ~20 imports | ~$20–30 | ~$5–10 | $0 | $0 | **~$25–40** |
| **Medium** (defaults) | `RESEARCH_MAX_PER_RUN=5`, 6 searches/day, ~60 imports, a few on-demand researches | ~$40–65 | ~$8–15 | $0 | $0 | **~$50–80** |
| **High** | `RESEARCH_MAX_PER_RUN=15`, `DISCOVERY_MAX_SEARCHES=12`, ~200 imports | ~$120–180 | ~$15–25 | $0 | $0 | **~$135–205** |

Notes:

- **Railway.** Three small always-on services (web, worker and Postgres, at roughly 150–300 MB RAM each and near-idle CPU). Hobby's $5 credit covers part of it; the rest is billed by usage. Upgrade to Pro ($20/month, includes $20 usage) if you want more headroom or team features.
- **The AI budget cap.** `AI_DAILY_BUDGET_USD=5` caps spend at about $150/month even at "High". Lower it to hard-limit costs, e.g. `2` gives at most about $60/month.
- **Domain.** About $10–15/year if you buy one.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Health check fails on web | `DATABASE_URL` missing or not the `${{Postgres.DATABASE_URL}}` reference |
| Worker crash-loops with "Invalid environment configuration" | A variable is missing on the worker; the log names it |
| "Background worker: Fail" in connection checks | Worker not running, or a healthcheck path was set on it |
| Sign-in links point at the wrong host | `APP_URL` doesn't match the domain you're using; fix it on both services and redeploy |
| Test email fails "domain is not verified" | Finish Resend DNS verification for the `EMAIL_FROM` domain |
| Anthropic web search check fails but the basic check passes | An admin disabled web search for your organization in the Claude Console; re-enable it there |
| No daily email | **Daily intelligence** shows the delivery status and error; **Research sources → Research runs** shows that morning's run |
