/**
 * Polite, safe HTTP fetching for permitted sources.
 *  - http(s) only; refuses private/loopback/link-local addresses (SSRF defense)
 *  - checks robots.txt for our user agent before fetching; never bypasses it
 *  - timeout and response-size caps
 *  - no cookies, no logins, no CAPTCHA handling — blocked means blocked
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import robotsParser from "robots-parser";
import * as cheerio from "cheerio";
import { env } from "@/lib/env";

const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 20_000;
const robotsCache = new Map<string, { robots: ReturnType<typeof robotsParser> | null; at: number }>();

export class FetchBlockedError extends Error {
  constructor(
    message: string,
    readonly reason: "robots" | "private_address" | "scheme" | "http" | "size" | "timeout",
  ) {
    super(message);
  }
}

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::") return true;
    if (v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80")) return true;
    const mapped = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateAddress(mapped[1]) : false;
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  );
}

async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchBlockedError("Invalid URL", "scheme");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new FetchBlockedError("Only http(s) URLs are allowed", "scheme");
  if (url.username || url.password) throw new FetchBlockedError("URLs with credentials are not allowed", "scheme");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new FetchBlockedError("Refusing to fetch a private/internal address", "private_address");
  return url;
}

async function rawGet(url: URL, accept: string): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    // redirect: "manual" so each hop is re-validated against SSRF + robots rules.
    return await fetch(url, { headers: { "user-agent": env().HTTP_USER_AGENT, accept }, redirect: "manual", signal: ctrl.signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new FetchBlockedError("Request timed out", "timeout");
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export async function robotsAllows(url: URL): Promise<boolean> {
  const origin = url.origin;
  const cached = robotsCache.get(origin);
  let robots = cached && Date.now() - cached.at < 6 * 3600_000 ? cached.robots : undefined;
  if (robots === undefined) {
    const robotsUrl = `${origin}/robots.txt`;
    try {
      const res = await rawGet(new URL(robotsUrl), "text/plain");
      // 4xx → no restrictions (RFC 9309); 5xx/unreachable → treat as disallow.
      if (res.status >= 500) robots = robotsParser(robotsUrl, "User-agent: *\nDisallow: /");
      else robots = res.ok ? robotsParser(robotsUrl, (await res.text()).slice(0, 500_000)) : null;
    } catch {
      robots = robotsParser(robotsUrl, "User-agent: *\nDisallow: /");
    }
    robotsCache.set(origin, { robots, at: Date.now() });
  }
  if (!robots) return true;
  return robots.isAllowed(url.toString(), env().HTTP_USER_AGENT.split("/")[0]) !== false;
}

export interface FetchResult {
  url: string;
  status: number;
  contentType: string | null;
  body: string;
}

export async function politeFetch(rawUrl: string, accept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"): Promise<FetchResult> {
  let url = await assertPublicUrl(rawUrl);
  for (let hop = 0; hop < 5; hop++) {
    if (!(await robotsAllows(url))) throw new FetchBlockedError(`robots.txt disallows ${url.hostname}${url.pathname}`, "robots");
    const res = await rawGet(url, accept);
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = await assertPublicUrl(new URL(res.headers.get("location")!, url).toString());
      continue;
    }
    if (!res.ok) throw new FetchBlockedError(`HTTP ${res.status} from ${url.hostname}`, "http");
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_BYTES) throw new FetchBlockedError("Response too large", "size");
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) throw new FetchBlockedError("Response too large", "size");
    return { url: url.toString(), status: res.status, contentType: res.headers.get("content-type"), body: new TextDecoder().decode(buf) };
  }
  throw new FetchBlockedError("Too many redirects", "http");
}

/** Readable text from HTML: drops scripts, styles, nav chrome and hidden elements. */
export function htmlToText(html: string): { title: string | null; text: string } {
  const $ = cheerio.load(html);
  $("script, style, noscript, iframe, svg, nav, footer, header, form, [hidden], [aria-hidden=true]").remove();
  $("[style*='display:none'], [style*='display: none']").remove();
  const title = $("title").first().text().trim() || $("h1").first().text().trim() || null;
  const text = $("body").text().replace(/\s+/g, " ").trim();
  return { title, text };
}
