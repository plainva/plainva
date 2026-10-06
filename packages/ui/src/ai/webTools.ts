import {
  checkWebUrl,
  pageExtractText,
  readPage,
  runPageProcessor,
  runWebSearch,
  searchFindingsText,
  searchQuery,
  searchSupported,
  type AiEgress,
  type ProviderEndpoint,
  type RunWeb,
  type ToolExecutor,
  type WebFetcher,
} from "@plainva/core";

/**
 * The two tools that reach the internet, for a conversation that was started
 * with it (plan KI-Harness P4): `fetch_url` and `web_search`. One
 * implementation for both shells; the request itself is the shell's native
 * fetch, and the search is the model provider's own.
 *
 * The model that holds the tools never reads a page. `fetch_url` fetches it
 * natively, takes it down as a reader would, and hands it to a second call
 * WITHOUT any tool; what comes back to the conversation is that call's
 * checked report. A page can therefore make the report say something untrue,
 * and nothing else.
 *
 * Whether a call may go out at all was decided before this runs: the vault's
 * switch, the conversation's own choice, and — while private data is in the
 * run — the user's approval of this very request.
 */

export interface WebToolsHost {
  /** The shell's native fetch; null where there is none — then no page is read. */
  fetcher: WebFetcher | null;
  egress: AiEgress;
  /** The model of the conversation: it reads the page, without tools, and its provider searches. */
  endpoint: ProviderEndpoint;
  model: string;
  providerLabel: string;
  /** The vault's switch, asked at every call: switched off in the middle of a conversation, the next call does not go out. */
  enabled(): boolean;
  newRequestId(): string;
  now(): string;
}

/** What a run did on the internet, gathered while it runs: addresses, queries and numbers — never content. */
export const newRunWeb = (): RunWeb => ({ pages: [], searches: [], inputTokens: 0, outputTokens: 0 });

/** The web tools a conversation with the internet carries with this model: reading where the shell can fetch, searching where the provider can. */
export function webToolNames(fetcher: WebFetcher | null, endpoint: ProviderEndpoint): string[] {
  return [...(fetcher ? ["fetch_url"] : []), ...(searchSupported(endpoint) ? ["web_search"] : [])];
}

export const WEB_OFF = "The internet is switched off for this vault. Answer from the notes, and say that you could not look it up.";

export function createWebExecutor(inner: ToolExecutor, host: WebToolsHost, log: RunWeb): ToolExecutor {
  return {
    async execute(tool, args, call, signal) {
      if (tool.name !== "fetch_url" && tool.name !== "web_search") return inner.execute(tool, args, call, signal);
      if (!host.enabled()) return { content: WEB_OFF, isError: true };
      const a = (args ?? {}) as { url?: unknown; question?: unknown; query?: unknown };

      if (tool.name === "web_search") {
        const query = searchQuery(typeof a.query === "string" ? a.query : "");
        if (!query) return { content: "A search needs a query.", isError: true };
        const requestId = host.newRequestId();
        // STOP reaches a search the way it reaches a model call.
        const stop = () => void host.egress.cancel(requestId).catch(() => undefined);
        signal?.addEventListener("abort", stop, { once: true });
        try {
          const result = await runWebSearch({ egress: host.egress, endpoint: host.endpoint, model: host.model, query, requestId });
          if (!result.ok) {
            if (result.reason === "unsupported") return { content: "This model's provider offers no web search here. Read an address you know with fetch_url.", isError: true };
            return { content: `The search failed${result.failure ? ` (${result.failure.kind})` : ""}.`, isError: true };
          }
          const at = host.now();
          log.inputTokens += result.usage.inputTokens;
          log.outputTokens += result.usage.outputTokens;
          log.searches.push({ query, at, hits: result.findings.hits.length });
          return { content: searchFindingsText(result.findings, { query, provider: host.providerLabel, at }), origin: { kind: "tool", tool: "web_search" } };
        } finally {
          signal?.removeEventListener("abort", stop);
        }
      }

      if (!host.fetcher) return { content: "Pages cannot be read on this device.", isError: true };
      const url = typeof a.url === "string" ? a.url : "";
      const asked = checkWebUrl(url);
      const read = await readPage(host.fetcher, url, { requestId: host.newRequestId(), ...(signal ? { signal } : {}) });
      const at = host.now();
      if (!read.ok) {
        // An address that passed the rules was asked for, whatever came of it: the run's record names it.
        if (asked.ok) log.pages.push({ url: asked.target.url, title: "", at, read: false });
        // A redirect to another site is an answer the model can act on — by asking for that address, which the user then sees.
        return read.kind === "elsewhere" ? { content: read.text, origin: { kind: "web", url: read.url } } : { content: read.text, isError: true };
      }
      const question = typeof a.question === "string" ? a.question : "";
      const report = await runPageProcessor({
        egress: host.egress,
        endpoint: host.endpoint,
        model: host.model,
        task: { url: read.url, question, page: read.page },
        requestId: host.newRequestId(),
        at,
        ...(signal ? { signal } : {}),
      });
      log.inputTokens += report.usage.inputTokens;
      log.outputTokens += report.usage.outputTokens;
      log.pages.push({ url: read.url, title: read.page.title, at, read: report.ok });
      if (!report.ok) {
        // Nothing of the page reaches the conversation without a report: its text stays with the reader.
        if (report.reason === "cancelled") return { content: "The request was stopped.", isError: true };
        return { content: report.reason === "no-record" ? "The page was read, but no report could be made of it." : `The page was read, but the report failed${report.failure ? ` (${report.failure.kind})` : ""}.`, isError: true };
      }
      return { content: pageExtractText(report.extract, { url: read.url, title: read.page.title, truncated: read.page.truncated, fetchedAt: at }), origin: { kind: "web", url: read.url } };
    },
  };
}
