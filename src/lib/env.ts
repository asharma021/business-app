import { z } from "zod";

/**
 * Validated environment. Parsed lazily so `next build` doesn't require
 * runtime secrets; every server entry point calls env() before use.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  APP_URL: z.string().url().default("http://localhost:3000"),

  // Auth
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 chars (openssl rand -base64 32)"),
  ALLOWED_EMAILS: z
    .string()
    .min(3, "ALLOWED_EMAILS is required — comma-separated list of emails allowed to sign in")
    .transform((s) => s.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)),
  AUTH_GOOGLE_ID: z.string().optional(),
  AUTH_GOOGLE_SECRET: z.string().optional(),

  // Email
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("Opportunity Radar <radar@example.com>"),

  // AI
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default("claude-sonnet-5-5"),
  // Token prices are NOT hard-coded; set them from your provider's pricing page
  // to enable USD cost tracking. Tokens and web searches are always recorded.
  AI_INPUT_USD_PER_MTOK: z.coerce.number().nonnegative().optional(),
  AI_OUTPUT_USD_PER_MTOK: z.coerce.number().nonnegative().optional(),
  AI_WEB_SEARCH_USD_PER_1K: z.coerce.number().nonnegative().default(10),
  AI_DAILY_BUDGET_USD: z.coerce.number().positive().default(5),
  RESEARCH_MAX_PER_RUN: z.coerce.number().int().positive().default(5),
  DISCOVERY_MAX_SEARCHES: z.coerce.number().int().positive().default(6),

  // Data sources
  CENSUS_API_KEY: z.string().optional(),
  HTTP_USER_AGENT: z.string().default("OpportunityRadarBot/0.1 (+personal research; respects robots.txt)"),
});

export type Env = z.infer<typeof schema>;
let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${msg}`);
  }
  cached = parsed.data;
  return cached;
}

export const features = {
  ai: () => Boolean(env().ANTHROPIC_API_KEY),
  email: () => Boolean(env().RESEND_API_KEY),
  google: () => Boolean(env().AUTH_GOOGLE_ID && env().AUTH_GOOGLE_SECRET),
};
