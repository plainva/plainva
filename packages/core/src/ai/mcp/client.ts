import { mcpParamHeaders, readMcpHeaderParams } from "./headerValues.js";
import { readMcpListing, MCP_MAX_PROMPTS, MCP_MAX_TOOLS, type McpListing } from "./listing.js";
import {
  McpError,
  mcpTtl,
  MCP_MAX_FRESH_MS,
  MCP_MAX_INPUT_ROUNDS,
  MCP_MAX_PAGES,
  MCP_TIMEOUTS,
  type McpEra,
  type McpRequestOptions,
  type McpTimeouts,
  type McpWire,
} from "./wire.js";

/**
 * The MCP client (plan §17.2, P4.5): the few things Plainva asks of a foreign
 * server, whatever generation it speaks and however it is reached — what it
 * is, what it offers, one call, one prompt.
 *
 * This is the reading half and nothing else. It declares no capability, so a
 * server has nothing to ask of it; it follows no instruction a server sends;
 * and it decides nothing. What it returns is raw: `listing()` is compared
 * with the pin before anyone reads it (`pin.ts`), a call's result becomes one
 * fenced text (`results.ts`), and whether a call may go out at all was
 * settled before it got here (`grants.ts`).
 */

export interface McpHello {
  era: McpEra;
  version: string;
  /** The server's own words about itself, for display. */
  serverInfo: { name: string; version: string } | null;
  tools: boolean;
  prompts: boolean;
}

export interface McpListingLoad {
  listing: McpListing;
  /** How long the server says these lists stay fresh, capped; 0 where it says nothing. A hint — the pin is compared at every load. */
  freshForMs: number;
  /** The server has more than the client reads; the rest is not offered. */
  clipped: { tools: boolean; prompts: boolean };
}

export interface McpCallOptions {
  signal?: AbortSignal;
  /** The tool's input schema as the server listed it: over HTTP, arguments it marks travel as headers too. */
  inputSchema?: unknown;
}

export interface McpClient {
  open(signal?: AbortSignal): Promise<McpHello>;
  /** Instructions, tools and prompts as the server lists them now. */
  listing(signal?: AbortSignal): Promise<McpListingLoad>;
  /** One call. Returns the raw result; see `mcpResultView`. */
  callTool(name: string, args: Record<string, unknown>, options?: McpCallOptions): Promise<Record<string, unknown>>;
  /** What a prompt expands to, raw: this is what `checkMcpPromptBody` compares. */
  getPrompt(name: string, args: Record<string, string>, signal?: AbortSignal): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** What a prompt expansion is pinned by: its description and its messages, nothing of the envelope around them. */
export function mcpPromptBody(result: Record<string, unknown>): { description: string; messages: unknown[] } {
  return { description: typeof result.description === "string" ? result.description : "", messages: Array.isArray(result.messages) ? result.messages : [] };
}

export function createMcpClient(wire: McpWire, options: { timeouts?: Partial<McpTimeouts> } = {}): McpClient {
  const timeouts = { ...MCP_TIMEOUTS, ...options.timeouts };
  let listed = false;

  /** All pages of one list, up to `max` entries. */
  const pages = async (method: string, key: string, max: number, signal: AbortSignal | undefined) => {
    const items: unknown[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    let ttl: number | null = null;
    let clipped = false;
    for (let page = 0; page < MCP_MAX_PAGES; page++) {
      const result = await wire.request(method, cursor === undefined ? {} : { cursor }, { timeoutMs: timeouts.list, ...(signal ? { signal } : {}) });
      const hint = mcpTtl(result.ttlMs);
      // The shortest promise counts; a page without one promises nothing.
      ttl = page === 0 ? hint : hint === null || ttl === null ? null : Math.min(ttl, hint);
      if (Array.isArray(result[key])) items.push(...(result[key] as unknown[]));
      const next = typeof result.nextCursor === "string" && result.nextCursor !== "" ? result.nextCursor : undefined;
      if (items.length > max) {
        clipped = true;
        break;
      }
      // A cursor that comes back is a server going in circles.
      if (next === undefined || seen.has(next)) break;
      if (page === MCP_MAX_PAGES - 1) clipped = true;
      seen.add(next);
      cursor = next;
    }
    return { items: items.slice(0, max), ttl, clipped };
  };

  /** One request that the server may answer with "come back with this state" — and may not answer with a question. */
  const roundTrip = async (method: string, params: Record<string, unknown>, request: McpRequestOptions): Promise<Record<string, unknown>> => {
    let state: string | undefined;
    for (let round = 0; round <= MCP_MAX_INPUT_ROUNDS; round++) {
      const result = await wire.request(method, state === undefined ? params : { ...params, requestState: state }, request);
      if (result.resultType !== "input_required") return result;
      const asked = isRecord(result.inputRequests) ? Object.values(result.inputRequests) : [];
      if (asked.length > 0) {
        // Plainva declared no capability: a server that asks anyway is not followed, and what it asked is not shown.
        const methods = [...new Set(asked.map((entry) => (isRecord(entry) && typeof entry.method === "string" ? entry.method.slice(0, 64) : "unknown")))];
        throw new McpError({ kind: "input-required", methods: methods.slice(0, 5) });
      }
      if (typeof result.requestState !== "string") throw new McpError({ kind: "protocol", detail: "an unfinished result without a state" });
      state = result.requestState;
    }
    throw new McpError({ kind: "protocol", detail: "the server kept asking to come back" });
  };

  return {
    async open(signal) {
      const hello = await wire.open(signal);
      return { era: hello.era, version: hello.version, serverInfo: hello.serverInfo, tools: hello.tools, prompts: hello.prompts };
    },

    async listing(signal) {
      // The first listing reads what opening the connection learned; every later one asks again where the protocol can.
      const hello = listed ? await wire.refresh(signal) : await wire.open(signal);
      listed = true;
      const tools = hello.tools ? await pages("tools/list", "tools", MCP_MAX_TOOLS, signal) : { items: [], ttl: null, clipped: false };
      const prompts = hello.prompts ? await pages("prompts/list", "prompts", MCP_MAX_PROMPTS, signal) : { items: [], ttl: null, clipped: false };
      const hints = [hello.era === "modern" ? hello.ttlMs : Number.POSITIVE_INFINITY, hello.tools ? tools.ttl : Number.POSITIVE_INFINITY, hello.prompts ? prompts.ttl : Number.POSITIVE_INFINITY];
      const fresh = hints.some((hint) => hint === null) ? 0 : Math.min(...(hints as number[]));
      return {
        listing: readMcpListing({ instructions: hello.instructions, tools: tools.items, prompts: prompts.items }),
        freshForMs: Number.isFinite(fresh) ? Math.min(fresh, MCP_MAX_FRESH_MS) : 0,
        clipped: { tools: tools.clipped, prompts: prompts.clipped },
      };
    },

    async callTool(name, args, call = {}) {
      let headers: Record<string, string> = {};
      if (wire.transport === "http" && call.inputSchema !== undefined) {
        const marked = readMcpHeaderParams(call.inputSchema);
        // A tool whose marks break the rules is not offered over HTTP; one that got here anyway is not called.
        if (!marked.ok) throw new McpError({ kind: "refused", detail: `x-mcp-header: ${marked.problem}` });
        headers = mcpParamHeaders(marked.params, args);
      }
      return roundTrip("tools/call", { name, arguments: args }, { name, headers, timeoutMs: timeouts.call, ...(call.signal ? { signal: call.signal } : {}) });
    },

    getPrompt(name, args, signal) {
      return roundTrip("prompts/get", { name, arguments: args }, { name, timeoutMs: timeouts.prompt, ...(signal ? { signal } : {}) });
    },

    close: () => wire.close(),
  };
}
