/**
 * Minimal local stand-ins for the Anthropic Messages API and Resend API, shaped
 * after their documented responses, so the REAL SDK clients and our parsing run end to end.
 */
import http from "node:http";

export interface Recorded {
  path: string;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
}

export function startMock(port: number, handler: (req: Recorded) => { status: number; body: unknown }) {
  const requests: Recorded[] = [];
  const server = http.createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      const rec = { path: req.url ?? "", headers: req.headers, body: data ? JSON.parse(data) : {} };
      requests.push(rec);
      const out = handler(rec);
      res.writeHead(out.status, { "content-type": "application/json", "request-id": "req_mock" });
      res.end(JSON.stringify(out.body));
    });
  });
  return new Promise<{ requests: Recorded[]; close: () => Promise<void> }>((resolve) =>
    server.listen(port, "127.0.0.1", () => resolve({ requests, close: () => new Promise((r) => server.close(() => r())) })),
  );
}

const usage = (extra: Record<string, unknown> = {}) => ({ input_tokens: 1200, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, ...extra });

export function anthropicMessage(content: unknown[], stopReason = "end_turn", webSearches = 0) {
  return {
    id: "msg_mock",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: usage(webSearches ? { server_tool_use: { web_search_requests: webSearches } } : {}),
  };
}

export function webSearchTurn(urls: { url: string; title: string }[], text: string) {
  return anthropicMessage(
    [
      { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "q" } },
      {
        type: "web_search_tool_result",
        tool_use_id: "srvtoolu_1",
        content: urls.map((u) => ({ type: "web_search_result", url: u.url, title: u.title, encrypted_content: "enc", page_age: "October 1, 2026" })),
      },
      {
        type: "text",
        text,
        citations: urls.slice(0, 1).map((u) => ({ type: "web_search_result_location", url: u.url, title: u.title, encrypted_index: "idx", cited_text: "cited snippet" })),
      },
    ],
    "end_turn",
    1,
  );
}

export function toolUse(name: string, input: unknown) {
  return anthropicMessage([{ type: "tool_use", id: `toolu_${Math.random().toString(36).slice(2)}`, name, input }], "tool_use");
}
