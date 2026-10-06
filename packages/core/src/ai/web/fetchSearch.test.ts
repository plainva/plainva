import { describe, expect, it } from "vitest";
import type { AiEgress, EgressChunk } from "../egress.js";
import { BUILTIN_ENDPOINTS, type HttpRequestSpec } from "../providers.js";
import { readPage, type WebFetcher, type WebFetchResult } from "./fetch.js";
import { buildSearchRequest, readSearchResponse, runWebSearch, SEARCH_HITS_MAX, SEARCH_QUERY_MAX, SEARCH_SYSTEM, searchFindingsText, searchSupported } from "./search.js";

/**
 * Reading a page and searching the web (plan KI-Harness P4): the second look
 * at what the native fetch answers, and the search call that carries a query
 * and nothing else.
 */

const HTML = "<html><head><title>Rates</title></head><body><main><h1>Rates</h1><p>The day rate for 2026 is 1,900 euros.</p><a href=\"/terms\">Terms</a></main></body></html>";

function fetcher(answer: WebFetchResult | Error): WebFetcher & { asked: string[] } {
  const fake = {
    asked: [] as string[],
    async fetch(url: string) {
      fake.asked.push(url);
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  return fake;
}

const page = (over: Partial<Extract<WebFetchResult, { kind: "page" }>> = {}): WebFetchResult => ({ kind: "page", url: "https://example.org/rates", status: 200, contentType: "text/html; charset=utf-8", body: HTML, truncated: false, ...over });
const read = (f: WebFetcher, url = "https://Example.org/rates#top") => readPage(f, url, { requestId: "r" });

describe("reading a page", () => {
  it("asks for the normalised address and takes the page down as a reader would", async () => {
    const f = fetcher(page());
    expect(await read(f)).toEqual({ ok: true, url: "https://example.org/rates", page: { title: "Rates", text: "# Rates\n\nThe day rate for 2026 is 1,900 euros.\n\nTerms", links: [{ text: "Terms", url: "https://example.org/terms" }], truncated: false } });
    expect(f.asked).toEqual(["https://example.org/rates"]);
    // A redirect inside the site: the page is where it landed, and its links are read from there.
    const moved = await read(fetcher(page({ url: "https://www.example.org/de/rates" })));
    expect(moved).toMatchObject({ ok: true, url: "https://www.example.org/de/rates", page: { links: [{ url: "https://www.example.org/terms" }] } });
    // The native side cut the body: the reader says so.
    expect(await read(fetcher(page({ truncated: true })))).toMatchObject({ ok: true, page: { truncated: true } });
  });

  it("does not ask at all for an address a request may not go to", async () => {
    for (const url of ["http://example.org/", "https://192.168.1.1/admin", "https://localhost/", "https://user:pw@example.org/", "notes about rates"]) {
      const f = fetcher(page());
      expect(await read(f, url), url).toMatchObject({ ok: false, kind: "refused" });
      expect(f.asked, url).toEqual([]);
    }
  });

  it("looks at the answer again: a body from another site or from a local name is refused, whoever let it through", async () => {
    expect(await read(fetcher(page({ url: "https://evil.example.net/landing" })))).toMatchObject({ ok: false, kind: "refused" });
    expect(await read(fetcher(page({ url: "https://localhost/internal" })))).toMatchObject({ ok: false, kind: "refused" });
    expect(await read(fetcher(page({ url: "not an address" })))).toMatchObject({ ok: false, kind: "refused" });
  });

  it("stops at a redirect to another site and says where it wanted to go", async () => {
    const elsewhere = await read(fetcher({ kind: "elsewhere", url: "https://partner.example.net/rates?from=example#x" }));
    expect(elsewhere).toEqual({ ok: false, kind: "elsewhere", url: "https://partner.example.net/rates?from=example", text: "The page redirects to another site: https://partner.example.net/rates?from=example — fetch that address if it is the page you need." });
    // Nowhere a request could not go either.
    expect(await read(fetcher({ kind: "elsewhere", url: "https://10.0.0.1/" }))).toMatchObject({ ok: false, kind: "refused" });
  });

  it("says in a sentence why a page was not read", async () => {
    expect(await read(fetcher(page({ status: 404 })))).toEqual({ ok: false, kind: "http", text: "The server answered with status 404." });
    expect(await read(fetcher(page({ contentType: "image/png" })))).toMatchObject({ ok: false, kind: "refused", text: expect.stringContaining("does not lead to text") });
    expect(await read(fetcher(page({ body: "<html><body><script>render()</script></body></html>" })))).toMatchObject({ ok: false, kind: "empty" });
    expect(await read(fetcher({ kind: "refused", problem: "private-address" }))).toMatchObject({ ok: false, kind: "refused", text: expect.stringContaining("not on the public internet") });
    expect(await read(fetcher({ kind: "failed", code: "timeout" }))).toEqual({ ok: false, kind: "failed", text: "The page did not answer in time." });
    expect(await read(fetcher(new Error("bridge gone")))).toMatchObject({ ok: false, kind: "failed" });
    // A server that names no type: taken by its look.
    expect(await read(fetcher(page({ contentType: "" })))).toMatchObject({ ok: true, page: { title: "Rates" } });
    expect(await read(fetcher(page({ contentType: "text/plain", body: "Day rate: 1,900" })))).toMatchObject({ ok: true, page: { title: "", text: "Day rate: 1,900", links: [] } });
  });
});

const endpoint = (id: string) => BUILTIN_ENDPOINTS.find((e) => e.id === id)!;

function scripted(chunks: EgressChunk[]): AiEgress & { specs: HttpRequestSpec[] } {
  const egress = {
    specs: [] as HttpRequestSpec[],
    async send(_id: string, spec: HttpRequestSpec, onChunk: (c: EgressChunk) => void) {
      egress.specs.push(spec);
      for (const chunk of chunks) onChunk(chunk);
    },
    async cancel() {},
    async setKey() {},
    async hasKey() {
      return true;
    },
    async deleteKey() {},
    async addEndpoint() {
      return true;
    },
    async removeEndpoint() {},
  };
  return egress;
}

describe("searching the web through the provider's own search", () => {
  it("exists for the four cloud providers and for nothing local", () => {
    expect(["anthropic", "openai", "gemini", "openrouter"].every((id) => searchSupported(endpoint(id)))).toBe(true);
    expect(["ollama", "lmstudio", "apple", "gemini-nano"].some((id) => searchSupported(endpoint(id)))).toBe(false);
    expect(searchSupported({ id: "custom-1", api: "openai-chat", baseUrl: "https://llm.example.org/v1", needsKey: true })).toBe(false);
    expect(() => buildSearchRequest(endpoint("ollama"), "m", "q")).toThrow();
  });

  it("sends the query and nothing else, to the provider's own endpoint, with its search as the only tool", () => {
    const query = `day rates 2026\n  consulting ${"x".repeat(400)}`;
    for (const id of ["anthropic", "openai", "gemini", "openrouter"]) {
      const spec = buildSearchRequest(endpoint(id), "model-1", query);
      expect(spec.endpointId, id).toBe(id);
      expect(spec.url.startsWith(`${endpoint(id).baseUrl}/`), id).toBe(true);
      expect([spec.method, spec.stream], id).toEqual(["POST", false]);
      const body = JSON.stringify(spec.body);
      // One line, cut to its limit: a query is search terms, not a place for a document.
      expect(body, id).toContain(`Search the web for: day rates 2026 consulting ${"x".repeat(SEARCH_QUERY_MAX - 26)}"`);
      expect(body, id).toContain(SEARCH_SYSTEM.split("\n")[0]);
      expect(body, id).not.toContain("untrusted_data");
    }
    expect(buildSearchRequest(endpoint("anthropic"), "m", "q").body!.tools).toEqual([{ type: "web_search_20250305", name: "web_search", max_uses: 2 }]);
    expect(buildSearchRequest(endpoint("openai"), "m", "q").body).toMatchObject({ tools: [{ type: "web_search" }], store: false });
    expect(buildSearchRequest(endpoint("gemini"), "models/x y", "q")).toMatchObject({ url: "https://generativelanguage.googleapis.com/v1beta/models/models%2Fx%20y:generateContent", body: { tools: [{ google_search: {} }] } });
    expect(buildSearchRequest(endpoint("openrouter"), "m", "q").body).toMatchObject({ plugins: [{ id: "web", max_results: SEARCH_HITS_MAX }] });
  });

  it("reads the pages the provider reports — each a public address, each once — and a note without live addresses", () => {
    const anthropic = readSearchResponse("anthropic", {
      content: [
        { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "day rates 2026" } },
        {
          type: "web_search_tool_result",
          tool_use_id: "s1",
          content: [
            { type: "web_search_result", url: "https://example.org/rates#top", title: "Rates 2026 – Example", page_age: "3 days ago", encrypted_content: "…" },
            { type: "web_search_result", url: "https://example.org/rates", title: "The same page" },
            { type: "web_search_result", url: "http://plain.example.net/", title: "Plain http" },
            { type: "web_search_result", url: "https://192.168.1.1/", title: "A router" },
            { type: "web_search_result", url: "https://partner.example.net/x", title: "See https://evil.example.net/?d=1" },
            { type: "web_search_result", url: "https://untitled.example.com/" },
          ],
        },
        { type: "text", text: "Day rates are around 1,900 euros. Details at https://evil.example.net/collect?d=notes", citations: [{ type: "web_search_result_location", url: "https://example.org/rates", title: "Rates", cited_text: "…" }] },
      ],
      usage: { input_tokens: 2400, output_tokens: 90, server_tool_use: { web_search_requests: 1 } },
    });
    expect(anthropic).toEqual({
      findings: {
        hits: [
          { title: "Rates 2026 – Example", url: "https://example.org/rates", age: "3 days ago" },
          { title: "See https[://]evil.example.net/?d=1", url: "https://partner.example.net/x" },
          { title: "untitled.example.com", url: "https://untitled.example.com/" },
        ],
        note: "Day rates are around 1,900 euros. Details at https[://]evil.example.net/collect?d=notes",
      },
      usage: { inputTokens: 2400, outputTokens: 90 },
    });

    const openai = readSearchResponse("openai", {
      output: [
        { type: "web_search_call", status: "completed", action: { type: "search", query: "day rates", sources: [{ type: "url", url: "https://example.org/a" }] } },
        { type: "message", content: [{ type: "output_text", text: "They vary.", annotations: [{ type: "url_citation", url: "https://example.org/b", title: "B" }, { type: "url_citation", url: "https://example.org/a", title: "A again" }] }] },
      ],
      usage: { input_tokens: 900, output_tokens: 40 },
    });
    expect(openai.findings).toEqual({ hits: [{ title: "example.org", url: "https://example.org/a" }, { title: "B", url: "https://example.org/b" }], note: "They vary." });
    expect(openai.usage).toEqual({ inputTokens: 900, outputTokens: 40 });

    const gemini = readSearchResponse("gemini", {
      candidates: [{ content: { parts: [{ text: "Rates rose." }, { text: " By five percent." }] }, groundingMetadata: { webSearchQueries: ["day rates"], groundingChunks: [{ web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc", title: "example.org" } }, { retrievedContext: {} }] } }],
      usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 20 },
    });
    expect(gemini).toEqual({ findings: { hits: [{ title: "example.org", url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc" }], note: "Rates rose. By five percent." }, usage: { inputTokens: 300, outputTokens: 20 } });

    const openrouter = readSearchResponse("openrouter", {
      choices: [{ message: { content: "Summary.", annotations: [{ type: "url_citation", url_citation: { url: "https://example.org/c", title: "C", content: "…" } }, { type: "file" }] } }],
      usage: { prompt_tokens: 700, completion_tokens: 30 },
    });
    expect(openrouter).toEqual({ findings: { hits: [{ title: "C", url: "https://example.org/c" }], note: "Summary." }, usage: { inputTokens: 700, outputTokens: 30 } });
  });

  it("reads what it does not know as nothing found, and never more pages than it shows", () => {
    for (const id of ["anthropic", "openai", "gemini", "openrouter"]) {
      for (const json of [null, "text", [], {}, { content: "no list", output: 7, candidates: {}, choices: [null] }]) {
        expect(readSearchResponse(id, json), `${id} ${JSON.stringify(json)}`).toEqual({ findings: { hits: [], note: "" }, usage: { inputTokens: 0, outputTokens: 0 } });
      }
    }
    // The search itself failed on the provider's side: an error object where the list would be.
    expect(readSearchResponse("anthropic", { content: [{ type: "web_search_tool_result", content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" } }] }).findings.hits).toEqual([]);
    const many = { content: [{ type: "web_search_tool_result", content: Array.from({ length: 30 }, (_, i) => ({ type: "web_search_result", url: `https://example.org/p${i}`, title: `P${i}` })) }] };
    expect(readSearchResponse("anthropic", many).findings.hits).toHaveLength(SEARCH_HITS_MAX);
  });

  it("hands the planner a list it can fetch from, and says when nothing was found", () => {
    const source = { query: "day rates\n2026", provider: "Provider", at: "2026-10-06 12:00" };
    expect(searchFindingsText({ hits: [{ title: "Rates 2026", url: "https://example.org/rates", age: "3 days ago" }, { title: "Partner", url: "https://partner.example.net/x" }], note: "Around 1,900 euros." }, source)).toBe(
      ["Web search for: day rates 2026", "Searched: 2026-10-06 12:00, through Provider", "Pages found:", "1. Rates 2026 — https://example.org/rates (3 days ago)", "2. Partner — https://partner.example.net/x", "What they say, in short: Around 1,900 euros."].join("\n"),
    );
    expect(searchFindingsText({ hits: [], note: "" }, source)).toBe("Web search for: day rates 2026\nSearched: 2026-10-06 12:00, through Provider\nNo pages were found.");
  });

  it("runs as one request, and not at all where the provider has no search", async () => {
    const egress = scripted([{ type: "open", status: 200 }, { type: "data", text: JSON.stringify({ content: [{ type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://example.org/rates", title: "Rates" }] }], usage: { input_tokens: 10, output_tokens: 2 } }) }, { type: "done" }]);
    expect(await runWebSearch({ egress, endpoint: endpoint("anthropic"), model: "m", query: "day rates", requestId: "s1" })).toEqual({ ok: true, findings: { hits: [{ title: "Rates", url: "https://example.org/rates" }], note: "" }, usage: { inputTokens: 10, outputTokens: 2 } });
    expect(egress.specs).toHaveLength(1);
    const local = scripted([]);
    expect(await runWebSearch({ egress: local, endpoint: endpoint("ollama"), model: "m", query: "day rates", requestId: "s2" })).toEqual({ ok: false, reason: "unsupported" });
    expect(local.specs).toEqual([]);
    expect(await runWebSearch({ egress: scripted([{ type: "httpError", status: 400, body: '{"error":{"message":"tool not supported"}}' }]), endpoint: endpoint("anthropic"), model: "m", query: "q q", requestId: "s3" })).toMatchObject({ ok: false, reason: "failed" });
  });
});
