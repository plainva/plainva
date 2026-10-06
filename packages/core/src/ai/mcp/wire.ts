import { capMcpText } from "./listing.js";

/**
 * The wire of the MCP client (plan §17.2, P4.5): which revisions of the
 * protocol Plainva speaks, what a request carries, how an answer is read and
 * how a failure is named. Nothing here opens a connection — the transports
 * are the shells' native code, reached through the two ports below — and
 * nothing here decides what a server may do (`pin.ts`, `grants.ts`).
 *
 * Two generations of the protocol exist side by side. A server of the current
 * revision is stateless: every request names its revision and the client in
 * `_meta`, and `server/discover` says what the server speaks. A server of an
 * earlier revision wants an `initialize` handshake first. Plainva asks the
 * modern way and falls back — never keyed to one error code, as the
 * specification demands, because an older server answers the unknown request
 * in any way it likes, or not at all.
 */

/** The stateless revision. */
export const MCP_MODERN_VERSION = "2026-07-28";
/** Revisions with the `initialize` handshake, newest first. */
export const MCP_LEGACY_VERSIONS: readonly string[] = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

export const MCP_META_VERSION = "io.modelcontextprotocol/protocolVersion";
export const MCP_META_CLIENT = "io.modelcontextprotocol/clientInfo";
export const MCP_META_CAPABILITIES = "io.modelcontextprotocol/clientCapabilities";
export const MCP_META_SERVER = "io.modelcontextprotocol/serverInfo";

/** Errors only a server of the stateless revision sends: seeing one means "modern", whatever else went wrong. */
export const MCP_ERROR_HEADER_MISMATCH = -32020;
export const MCP_ERROR_MISSING_CAPABILITY = -32021;
export const MCP_ERROR_UNSUPPORTED_VERSION = -32022;
export const MCP_ERROR_METHOD_NOT_FOUND = -32601;

/** The longest answer the client reads, in characters. A listing of two hundred tools fits many times over. */
export const MCP_RESPONSE_LIMIT = 4 * 1024 * 1024;
/** A server's own error text is cut here: it is shown and logged, and it is a stranger's words. */
export const MCP_ERROR_TEXT_LIMIT = 300;
/** Pages of one list the client follows. */
export const MCP_MAX_PAGES = 20;
/** How often a call is sent again because the server said "come back with this state". */
export const MCP_MAX_INPUT_ROUNDS = 3;
/** The longest a list counts as fresh, whatever the server says. */
export const MCP_MAX_FRESH_MS = 5 * 60 * 1000;

export interface McpTimeouts {
  /** Finding out what a remote server speaks, the handshake of an earlier revision included. */
  open: number;
  /** How long a program gets to come up and answer for the first time — a first start may fetch the program itself. */
  start: number;
  /** How long a program may stay quiet after the first question before the handshake of an earlier revision is tried as well. */
  probe: number;
  list: number;
  call: number;
  prompt: number;
}

export const MCP_TIMEOUTS: McpTimeouts = { open: 20_000, start: 60_000, probe: 4_000, list: 30_000, call: 120_000, prompt: 30_000 };

export type McpEra = "modern" | "legacy";

export interface McpClientInfo {
  name: string;
  version: string;
}

/**
 * What every request of the stateless revision carries. The capabilities are
 * empty on purpose: Plainva offers a server no folders, no model calls, no
 * log channel and no questions to the user — and a server must not ask for
 * what it was not offered.
 */
export function mcpRequestMeta(client: McpClientInfo): Record<string, unknown> {
  return {
    [MCP_META_VERSION]: MCP_MODERN_VERSION,
    [MCP_META_CLIENT]: { name: client.name, version: client.version },
    [MCP_META_CAPABILITIES]: {},
  };
}

export type McpFailure =
  /** No connection, no such host, or the program could not be started. */
  | { kind: "unreachable"; detail?: string }
  /** The shell did not send the request: the server is not registered on this device, or the request breaks a rule. */
  | { kind: "refused"; detail?: string }
  | { kind: "timeout" }
  | { kind: "cancelled" }
  /** The server wants a sign-in, or the one it got is not enough. `challenge` is its `WWW-Authenticate` line. */
  | { kind: "auth"; status: number; challenge?: string }
  /** An HTTP status that is no answer of the protocol. */
  | { kind: "http"; status: number }
  /** An answer that is not the protocol: no JSON, the wrong shape, a server that keeps asking to come back. */
  | { kind: "protocol"; detail: string }
  /** Server and Plainva share no revision. `supported` is what the server named. */
  | { kind: "version"; supported: string[] }
  | { kind: "too-large" }
  /** The program ended. */
  | { kind: "exited"; code: number | null }
  /** The server answered with an error of its own. `message` is the server's text: cut, and data like every other. */
  | { kind: "rpc"; code: number; message: string }
  /** The server asked for something Plainva does not offer: a question to the user, a model call, folders. */
  | { kind: "input-required"; methods: string[] };

/** A failure in plain words — for a log line and for a model that should know why a tool did not answer. */
export function mcpFailureText(failure: McpFailure): string {
  switch (failure.kind) {
    case "unreachable":
      return "The server could not be reached.";
    case "refused":
      return "Plainva did not send the request: the server is not set up on this device.";
    case "timeout":
      return "The server did not answer in time.";
    case "cancelled":
      return "The request was stopped.";
    case "auth":
      return failure.status === 403 ? "The server refused the request: the sign-in does not allow it." : "The server wants a sign-in.";
    case "http":
      return `The server answered with status ${failure.status}.`;
    case "protocol":
      return `The server's answer could not be read (${failure.detail}).`;
    case "version":
      return "The server speaks no revision of the protocol that Plainva knows.";
    case "too-large":
      return "The server's answer is too large.";
    case "exited":
      return "The server's program ended.";
    case "rpc":
      return `The server answered with an error (${failure.code}).`;
    case "input-required":
      return "The server asked for input that Plainva does not provide.";
  }
}

export class McpError extends Error {
  readonly failure: McpFailure;
  constructor(failure: McpFailure) {
    super(mcpFailureText(failure));
    this.name = "McpError";
    this.failure = failure;
  }
}

/** Whatever was thrown, as a failure: a port may throw an `McpError` of its own, anything else is "unreachable". */
export function asMcpError(error: unknown): McpError {
  if (error instanceof McpError) return error;
  return new McpError({ kind: "unreachable", detail: (error instanceof Error ? error.message : String(error)).slice(0, MCP_ERROR_TEXT_LIMIT) });
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export interface McpRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export type McpMessage =
  /** `id` is null where a server could not tell which request it answers (an error before it read one). */
  | { kind: "response"; id: number | string | null; result?: Record<string, unknown>; error?: McpRpcError }
  | { kind: "request"; id: number | string; method: string }
  | { kind: "notification"; method: string };

export type McpResponse = Extract<McpMessage, { kind: "response" }>;

/** One JSON-RPC message as a server sent it, read defensively; null for anything that is none. */
export function readMcpMessage(raw: unknown): McpMessage | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === "number" || typeof raw.id === "string" ? raw.id : null;
  if (typeof raw.method === "string") return id === null ? { kind: "notification", method: raw.method } : { kind: "request", id, method: raw.method };
  if (isRecord(raw.error)) {
    const code = typeof raw.error.code === "number" && Number.isFinite(raw.error.code) ? raw.error.code : 0;
    const message = typeof raw.error.message === "string" ? raw.error.message : "";
    return { kind: "response", id, error: { code, message, ...(raw.error.data !== undefined ? { data: raw.error.data } : {}) } };
  }
  // A result is an object in this protocol; anything else is read as an empty one, never as a crash.
  if ("result" in raw) return { kind: "response", id, result: isRecord(raw.result) ? raw.result : {} };
  return null;
}

/** A server's own error as a failure. Its text is cut and cleaned: it may be shown, and it is not the app's. */
export function mcpRpcFailure(error: McpRpcError): McpFailure {
  return { kind: "rpc", code: error.code, message: capMcpText(error.message, MCP_ERROR_TEXT_LIMIT).text };
}

export type McpEraChoice = { era: "modern" } | { era: "legacy" } | { era: "none"; supported: string[] };

/**
 * Which generation to speak with a server that named its revisions — in a
 * `server/discover` answer or in the error that says the asked revision is
 * not supported. The stateless one where it is offered; otherwise the
 * handshake, where the server names a revision that has one; otherwise
 * nothing in common.
 */
export function mcpChooseEra(supported: unknown): McpEraChoice {
  const versions = (Array.isArray(supported) ? supported : []).filter((v): v is string => typeof v === "string");
  if (versions.includes(MCP_MODERN_VERSION)) return { era: "modern" };
  if (versions.some((v) => MCP_LEGACY_VERSIONS.includes(v))) return { era: "legacy" };
  return { era: "none", supported: versions.slice(0, 10).map((v) => v.slice(0, 32)) };
}

/** What a server said when the connection was opened. */
export interface McpOpened {
  era: McpEra;
  version: string;
  /** The server's own words about itself — for display, never the ground of a decision. */
  serverInfo: { name: string; version: string } | null;
  /** In full: this is what gets pinned. It is cut where it is shown. */
  instructions: string;
  tools: boolean;
  prompts: boolean;
  /** The server's hint for how long this stays fresh, in milliseconds; null when it gave none. */
  ttlMs: number | null;
}

function serverInfo(raw: unknown): McpOpened["serverInfo"] {
  if (!isRecord(raw) || typeof raw.name !== "string") return null;
  const name = capMcpText(raw.name, 80).text;
  if (!name) return null;
  return { name, version: capMcpText(raw.version, 40).text };
}

/** A hint for freshness: a number of milliseconds that is not negative, or nothing. */
export function mcpTtl(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : null;
}

function capabilities(raw: unknown): { tools: boolean; prompts: boolean } {
  const all = isRecord(raw) ? raw : {};
  return { tools: isRecord(all.tools), prompts: isRecord(all.prompts) };
}

/** Reads a `server/discover` result. */
export function readMcpDiscover(result: Record<string, unknown>): McpOpened {
  const meta = isRecord(result._meta) ? result._meta : {};
  return {
    era: "modern",
    version: MCP_MODERN_VERSION,
    serverInfo: serverInfo(meta[MCP_META_SERVER]),
    instructions: typeof result.instructions === "string" ? result.instructions : "",
    ...capabilities(result.capabilities),
    ttlMs: mcpTtl(result.ttlMs),
  };
}

/** Reads an `initialize` result of an earlier revision. */
export function readMcpInitialize(result: Record<string, unknown>, version: string): McpOpened {
  return {
    era: "legacy",
    version,
    serverInfo: serverInfo(result.serverInfo),
    instructions: typeof result.instructions === "string" ? result.instructions : "",
    ...capabilities(result.capabilities),
    ttlMs: null,
  };
}

export interface McpRequestOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** `tools/call` and `prompts/get`: the name, mirrored into a header over HTTP. */
  name?: string;
  /** `tools/call` over HTTP: the `Mcp-Param-*` headers of the call, ready to send. */
  headers?: Readonly<Record<string, string>>;
}

/** One server, whatever its generation and transport. Every method rejects with an `McpError`. */
export interface McpWire {
  readonly transport: "http" | "stdio";
  /** Finds out what the server speaks. Asked once; later calls answer from what was learned. */
  open(signal?: AbortSignal): Promise<McpOpened>;
  /** What the server says about itself now: asked again where the protocol allows it, else what `open` learned. */
  refresh(signal?: AbortSignal): Promise<McpOpened>;
  /** Sends a request and returns its result object. */
  request(method: string, params: Record<string, unknown>, options?: McpRequestOptions): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

export interface McpWireOptions {
  client: McpClientInfo;
  timeouts?: Partial<McpTimeouts>;
}

/* ---- the two ports: what a shell implements natively -------------------------------------- */

export interface McpHttpRequest {
  method: "POST" | "DELETE";
  /** Only protocol headers. Address and credentials are the native side's: the web view names neither. */
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}

export type McpHttpFailureCode = "offline" | "timeout" | "tls" | "refused" | "too-large" | "error";

export type McpHttpChunk =
  /** The answer began. `session` and `challenge` are the two response headers the protocol reads. */
  | { type: "open"; status: number; contentType: string; session?: string; challenge?: string }
  | { type: "data"; text: string }
  | { type: "done" }
  | { type: "cancelled" }
  | { type: "failed"; code: McpHttpFailureCode; message?: string };

/** One exchange with the server this port is bound to. Chunks arrive in order; `send` resolves after the last. */
export interface McpHttpPort {
  send(requestId: string, request: McpHttpRequest, onChunk: (chunk: McpHttpChunk) => void): Promise<void>;
  cancel(requestId: string): Promise<void>;
}

/** The approved program of the server this port is bound to: lines in, lines out. */
export interface McpStdioPort {
  /** Starts the program. `onExit` is called once, when it ended; `code` is null where it was ended by force. */
  start(onLine: (line: string) => void, onExit: (code: number | null) => void): Promise<void>;
  write(line: string): Promise<void>;
  /** Closes the program's input, waits a moment, then ends it. */
  stop(): Promise<void>;
}
