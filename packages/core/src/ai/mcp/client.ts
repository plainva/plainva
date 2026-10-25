import { mcpElicitCapabilities, mcpElicitReply, readMcpElicitation, MCP_ELICIT_LIMITS, type McpElicitResult, type McpQuestions } from "./elicitation.js";
import { mcpParamHeaders, readMcpHeaderParams } from "./headerValues.js";
import { capMcpText, readMcpListing, MCP_MAX_PROMPTS, MCP_MAX_TOOLS, type McpListing } from "./listing.js";
import {
  McpError,
  mcpTtl,
  MCP_MAX_FRESH_MS,
  MCP_ELICIT_METHOD,
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
 * server has nothing to ask of it — except where a call or a prompt brings
 * `questions` (plan KI-Harness P9-4a): then that one request offers the
 * server to ask the user, and the client asks through them. It follows no
 * instruction a server sends, and it decides nothing. What it returns is raw:
 * `listing()` is compared with the pin before anyone reads it (`pin.ts`), a
 * call's result becomes one fenced text (`results.ts`), and whether a call
 * may go out at all was settled before it got here (`grants.ts`).
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
  /** Where the server may ask the user something during this call; left out, it may not. */
  questions?: McpQuestions;
}

export interface McpClient {
  open(signal?: AbortSignal): Promise<McpHello>;
  /** Instructions, tools and prompts as the server lists them now. */
  listing(signal?: AbortSignal): Promise<McpListingLoad>;
  /** One call. Returns the raw result; see `mcpResultView`. */
  callTool(name: string, args: Record<string, unknown>, options?: McpCallOptions): Promise<Record<string, unknown>>;
  /** What a prompt expands to, raw: this is what `checkMcpPromptBody` compares. `questions` as for a call. */
  getPrompt(name: string, args: Record<string, string>, signal?: AbortSignal, questions?: McpQuestions): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** What a prompt expansion is pinned by: its description and its messages, nothing of the envelope around them. */
export function mcpPromptBody(result: Record<string, unknown>): { description: string; messages: unknown[] } {
  return { description: typeof result.description === "string" ? result.description : "", messages: Array.isArray(result.messages) ? result.messages : [] };
}

/** The longest text a server's prompt becomes as a message. */
export const MCP_PROMPT_TEXT_LIMIT = 20_000;

/**
 * A prompt expansion as the one message it becomes when the user sends it:
 * the text of its parts, in order; a part the server wrote as the assistant's
 * is marked as such; what is no text — a picture, a sound, a link — is
 * counted and left out. Cleaned of invisible characters and cut, like every
 * text a server supplies: the user reads exactly what would go.
 */
export function mcpPromptText(body: { messages: readonly unknown[] }): { text: string; dropped: number; truncated: boolean } {
  let dropped = 0;
  const parts: string[] = [];
  for (const message of body.messages) {
    if (!isRecord(message)) {
      dropped++;
      continue;
    }
    const texts: string[] = [];
    for (const block of Array.isArray(message.content) ? message.content : [message.content]) {
      if (isRecord(block) && block.type === "text" && typeof block.text === "string") texts.push(block.text);
      else if (isRecord(block) && block.type === "resource" && isRecord(block.resource) && typeof block.resource.text === "string") texts.push(block.resource.text);
      else dropped++;
    }
    const text = texts.join("\n\n").trim();
    if (text) parts.push(message.role === "assistant" ? `[assistant]\n${text}` : text);
  }
  const capped = capMcpText(parts.join("\n\n"), MCP_PROMPT_TEXT_LIMIT);
  return { text: capped.text, dropped, truncated: capped.truncated };
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

  /**
   * One request that the server may answer with "come back with this state"
   * — and, where `questions` lets it, with questions to the user (MCP
   * 2026-07-28, multi round-trip requests): each is asked, one at a time, and
   * the request goes again with the answers under the server's keys and its
   * state as it gave it. After a "no" or a stop of the user, the further
   * questions of this request get the same answer without being shown.
   */
  const roundTrip = async (method: string, params: Record<string, unknown>, request: McpRequestOptions, questions?: McpQuestions): Promise<Record<string, unknown>> => {
    let state: string | undefined;
    // The answers of a round as pairs: a key the server chose is never a property name of the object they go in.
    let answers: [string, McpElicitResult][] | undefined;
    let settled: McpElicitResult | null = null;
    // One card that says Plainva refused a question is enough for one request; the next refusals go unshown.
    let refusedShown = false;
    // Only the stateless revision asks within a request; an earlier one would ask on a stream of its own, which is not offered.
    const era = (await wire.open(request.signal)).era;
    const offered = questions && questions.modes.length > 0 && era === "modern" ? questions : undefined;
    // Why a question of the server goes unasked, where it asks one anyway: its revision first — there nothing can allow it.
    const unoffered = era !== "modern" ? "revision" : !questions ? "vault" : "kind";
    const options: McpRequestOptions = offered ? { ...request, capabilities: mcpElicitCapabilities(offered.modes) } : request;
    const unfollowed = (methods: string[]) => new McpError({ kind: "input-required", methods: methods.slice(0, 5), ...(methods.every((name) => name === MCP_ELICIT_METHOD) ? { unoffered } : {}) });
    const reply = (value: McpElicitResult) => {
      offered?.replied?.(value);
      return value;
    };
    for (let round = 0; round <= MCP_MAX_INPUT_ROUNDS; round++) {
      const sent = { ...params, ...(answers ? { inputResponses: Object.fromEntries(answers) } : {}), ...(state !== undefined ? { requestState: state } : {}) };
      let result: Record<string, unknown>;
      try {
        result = await wire.request(method, sent, options);
      } catch (error) {
        // A server that said it cannot go on without being able to ask (-32021): the same as asking where nothing was offered.
        if (error instanceof McpError && error.failure.kind === "input-required") throw unfollowed(error.failure.methods);
        throw error;
      }
      if (result.resultType !== "input_required") return result;
      const asked = isRecord(result.inputRequests) ? Object.entries(result.inputRequests) : [];
      state = typeof result.requestState === "string" ? result.requestState : undefined;
      answers = undefined;
      if (asked.length === 0) {
        if (state === undefined) throw new McpError({ kind: "protocol", detail: "an unfinished result without a state" });
        continue;
      }
      const methods = [...new Set(asked.map(([, entry]) => (isRecord(entry) && typeof entry.method === "string" ? entry.method.slice(0, 64) : "unknown")))];
      // What this request did not offer is not followed, and none of what the server asked is shown.
      if (!offered || methods.some((name) => name !== MCP_ELICIT_METHOD)) throw unfollowed(methods);
      if (asked.length > MCP_ELICIT_LIMITS.perRound) throw new McpError({ kind: "protocol", detail: "too many questions at once" });
      // Nobody is asked what could not be sent any more.
      if (round === MCP_MAX_INPUT_ROUNDS) break;
      answers = [];
      for (const [key, entry] of asked) {
        if (settled) {
          answers.push([key, reply(settled)]);
          continue;
        }
        const question = readMcpElicitation(isRecord(entry) ? entry.params : undefined, { modes: offered.modes, local: offered.local === true });
        if (question.kind === "refused" && refusedShown) {
          answers.push([key, reply({ action: "decline" })]);
          continue;
        }
        // Whoever asks the user cannot fail the request: a side that could not ask has nothing to say, which is a stop.
        const given = await offered.ask(question, request.signal).catch((): McpElicitResult => ({ action: "cancel" }));
        if (request.signal?.aborted) throw new McpError({ kind: "cancelled" });
        const answer = mcpElicitReply(question, given);
        // A question Plainva refused is not the user's "no": the next one is asked.
        if (question.kind === "refused") refusedShown = true;
        else if (answer.action !== "accept") settled = answer;
        answers.push([key, reply(answer)]);
      }
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
      return roundTrip("tools/call", { name, arguments: args }, { name, headers, timeoutMs: timeouts.call, ...(call.signal ? { signal: call.signal } : {}) }, call.questions);
    },

    getPrompt(name, args, signal, questions) {
      return roundTrip("prompts/get", { name, arguments: args }, { name, timeoutMs: timeouts.prompt, ...(signal ? { signal } : {}) }, questions);
    },

    close: () => wire.close(),
  };
}
