import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { env } from "@/lib/env";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  webSearches: number;
}
export const emptyUsage = (): Usage => ({ inputTokens: 0, outputTokens: 0, webSearches: 0 });
export function addUsage(a: Usage, b: Usage): Usage {
  return { inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens, webSearches: a.webSearches + b.webSearches };
}

/** USD cost, or null when token prices aren't configured (we never guess prices). */
export function costUsd(u: Usage): number | null {
  const e = env();
  if (e.AI_INPUT_USD_PER_MTOK === undefined || e.AI_OUTPUT_USD_PER_MTOK === undefined) return null;
  return (
    (u.inputTokens / 1e6) * e.AI_INPUT_USD_PER_MTOK +
    (u.outputTokens / 1e6) * e.AI_OUTPUT_USD_PER_MTOK +
    (u.webSearches / 1000) * e.AI_WEB_SEARCH_USD_PER_1K
  );
}

export interface SearchSource {
  url: string;
  title: string | null;
  pageAge?: string | null;
}
export interface Citation {
  url: string;
  title: string | null;
  citedText: string | null;
}

export interface ResearchResult {
  text: string;
  citations: Citation[];
  /** every URL returned by web_search — the evidence set */
  searchResults: SearchSource[];
  usage: Usage;
}

export interface LLMProvider {
  readonly model: string;
  /** Free-form research with optional web search. */
  research(opts: { system: string; prompt: string; webSearch?: { maxUses: number } }): Promise<ResearchResult>;
  /** Forced structured output validated against a zod schema. */
  structured<T>(opts: { system: string; prompt: string; schema: z.ZodType<T>; toolName: string; toolDescription: string; maxTokens?: number }): Promise<{ data: T; usage: Usage }>;
}

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;
  constructor(
    apiKey: string,
    readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 3, timeout: 300_000 });
  }

  async research({ system, prompt, webSearch }: { system: string; prompt: string; webSearch?: { maxUses: number } }): Promise<ResearchResult> {
    const tools: Anthropic.Messages.ToolUnion[] = webSearch
      ? [
          {
            type: "web_search_20250305",
            name: "web_search",
            max_uses: webSearch.maxUses,
            user_location: { type: "approximate", city: "Dallas", region: "Texas", country: "US", timezone: "America/Chicago" },
          },
        ]
      : [];
    const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: prompt }];
    const usage = emptyUsage();
    const textParts: string[] = [];
    const citations: Citation[] = [];
    const searchResults: SearchSource[] = [];

    // Server tools may pause long turns; continue up to 4 times.
    for (let i = 0; i < 4; i++) {
      const res = await this.client.messages.create({ model: this.model, max_tokens: 8000, system, messages, tools });
      usage.inputTokens += res.usage.input_tokens;
      usage.outputTokens += res.usage.output_tokens;
      usage.webSearches += res.usage.server_tool_use?.web_search_requests ?? 0;
      for (const block of res.content) {
        if (block.type === "text") {
          textParts.push(block.text);
          for (const c of block.citations ?? []) {
            if (c.type === "web_search_result_location") citations.push({ url: c.url, title: c.title ?? null, citedText: c.cited_text ?? null });
          }
        } else if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
          for (const r of block.content) searchResults.push({ url: r.url, title: r.title ?? null, pageAge: r.page_age ?? null });
        }
      }
      if (res.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: res.content });
    }
    return { text: textParts.join(""), citations, searchResults, usage };
  }

  async structured<T>({
    system,
    prompt,
    schema,
    toolName,
    toolDescription,
    maxTokens = 8000,
  }: {
    system: string;
    prompt: string;
    schema: z.ZodType<T>;
    toolName: string;
    toolDescription: string;
    maxTokens?: number;
  }): Promise<{ data: T; usage: Usage }> {
    const inputSchema = zodToJsonSchema(schema, { target: "jsonSchema7", $refStrategy: "none" }) as Anthropic.Messages.Tool.InputSchema;
    const usage = emptyUsage();
    const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: prompt }];
    let lastError = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.client.messages.create({
        model: this.model,
        max_tokens: maxTokens,
        system,
        messages,
        tools: [{ name: toolName, description: toolDescription, input_schema: inputSchema }],
        tool_choice: { type: "tool", name: toolName },
      });
      usage.inputTokens += res.usage.input_tokens;
      usage.outputTokens += res.usage.output_tokens;
      const call = res.content.find((b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use");
      if (!call) {
        lastError = "Model did not return structured output";
        continue;
      }
      const parsed = schema.safeParse(call.input);
      if (parsed.success) return { data: parsed.data, usage };
      lastError = parsed.error.issues.slice(0, 8).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      messages.push({ role: "assistant", content: res.content });
      messages.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: call.id, is_error: true, content: `Validation failed: ${lastError}. Call ${toolName} again with corrected input.` }],
      });
    }
    throw new Error(`Structured output failed validation: ${lastError}`);
  }
}

let provider: LLMProvider | null = null;
/** Returns the configured provider, or null when no AI key is set (features degrade gracefully). */
export function getProvider(): LLMProvider | null {
  if (provider) return provider;
  const e = env();
  if (!e.ANTHROPIC_API_KEY) return null;
  provider = new AnthropicProvider(e.ANTHROPIC_API_KEY, e.AI_MODEL);
  return provider;
}
export function setProviderForTests(p: LLMProvider | null) {
  provider = p;
}
