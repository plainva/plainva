import { fromBase64 } from "../../workspace/encoding.js";
import { mcpParamHeaders, readMcpHeaderParams } from "./headerValues.js";
import type { McpPromptDescriptor, McpToolDescriptor } from "./listing.js";
import {
  MCP_ERROR_HEADER_MISMATCH,
  MCP_ERROR_METHOD_NOT_FOUND,
  MCP_ERROR_UNSUPPORTED_VERSION,
  MCP_LEGACY_VERSIONS,
  MCP_META_SERVER,
  MCP_META_VERSION,
  MCP_MODERN_VERSION,
  type McpEra,
  type McpHttpChunk,
  type McpHttpFailureCode,
  type McpHttpPort,
  type McpHttpRequest,
  type McpStdioPort,
} from "./wire.js";

/**
 * A server in a script — the other end of the client, for tests in every
 * package. It speaks either generation of the protocol, checks what a real
 * server checks (the revision in `_meta`, the mirrored headers, the session
 * of an earlier revision), and everything about it can be rewritten while it
 * runs: that is how the cases the client exists for are played — a server
 * that changes its tool list after three honest calls, a result that reads
 * like an instruction, a prompt that expands to something else.
 *
 * Like the injection corpus it is part of the package, not of one test file,
 * so that the session tests of both shells drive the same server.
 */

export interface ScriptedMcpOptions {
  era?: McpEra;
  /** The revision an earlier-generation server answers its handshake with. */
  legacyVersion?: string;
  name?: string;
  version?: string;
  instructions?: string;
  tools?: McpToolDescriptor[];
  prompts?: McpPromptDescriptor[];
  /** The freshness hint of a modern server; left out, it gives none. */
  ttlMs?: number;
  /** Entries per page of a list; left out, a list is one page. */
  pageSize?: number;
  /** An earlier revision over HTTP: hand out a session id and demand it. */
  session?: boolean;
  /** An earlier revision as a program: say nothing to requests before the handshake. */
  quiet?: boolean;
  /** The credential the server wants over HTTP. */
  bearer?: string;
}

export interface ScriptedReply {
  /** HTTP status; over a pipe it means nothing. */
  status: number;
  session?: string;
  challenge?: string;
  /** The JSON-RPC answer, or null where there is none (a notification, a refusal without a body). */
  message: Record<string, unknown> | null;
}

export interface ScriptedMcpServer {
  era: McpEra;
  instructions: string;
  tools: McpToolDescriptor[];
  prompts: McpPromptDescriptor[];
  ttlMs: number | undefined;
  /** What a call returns; `count` is the number of this call, from 1. Replace it to script a behaviour. */
  onCall: (name: string, args: Record<string, unknown>, count: number, params: Record<string, unknown>) => Record<string, unknown>;
  /** What a prompt expands to. */
  onPrompt: (name: string, args: Record<string, unknown>, count: number) => Record<string, unknown>;
  readonly calls: { name: string; args: Record<string, unknown> }[];
  /** Every method received, in order. */
  readonly methods: string[];
  /** The sessions of an earlier revision end on the server's side. */
  dropSessions(): void;
  endSession(id: string | undefined): void;
  handle(message: unknown, headers?: Readonly<Record<string, string>>): ScriptedReply;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function decodeHeader(value: string | undefined): string | undefined {
  if (value === undefined || !(value.startsWith("=?base64?") && value.endsWith("?="))) return value;
  try {
    return new TextDecoder().decode(fromBase64(value.slice(9, -2)));
  } catch {
    return undefined;
  }
}

export function createScriptedMcpServer(options: ScriptedMcpOptions = {}): ScriptedMcpServer {
  const legacyVersion = options.legacyVersion ?? MCP_LEGACY_VERSIONS[0]!;
  const info = { name: options.name ?? "Scripted", version: options.version ?? "1.0.0" };
  const sessions = new Set<string>();
  let sessionCount = 0;
  let greeted = false;
  let callCount = 0;
  let promptCount = 0;

  const server: ScriptedMcpServer = {
    era: options.era ?? "modern",
    instructions: options.instructions ?? "",
    tools: options.tools ?? [],
    prompts: options.prompts ?? [],
    ttlMs: options.ttlMs,
    onCall: (name, args) => ({ content: [{ type: "text", text: `${name} ${JSON.stringify(args)}` }] }),
    onPrompt: (name) => ({ messages: [{ role: "user", content: { type: "text", text: `Prompt ${name}` } }] }),
    calls: [],
    methods: [],
    dropSessions: () => sessions.clear(),
    endSession: (id) => {
      if (id) sessions.delete(id);
    },

    handle(raw, rawHeaders) {
      const headers = rawHeaders ? Object.fromEntries(Object.entries(rawHeaders).map(([key, value]) => [key.toLowerCase(), value])) : null;
      const message = isRecord(raw) ? raw : {};
      const method = typeof message.method === "string" ? message.method : "";
      const id = typeof message.id === "number" || typeof message.id === "string" ? message.id : null;
      const params = isRecord(message.params) ? message.params : {};
      const modern = server.era === "modern";
      server.methods.push(method);

      const result = (value: Record<string, unknown>, extra: Partial<ScriptedReply> = {}): ScriptedReply => ({
        status: 200,
        ...extra,
        message: { jsonrpc: "2.0", id, result: modern ? { resultType: "complete", ...value } : value },
      });
      const error = (status: number, code: number, text: string, data?: unknown): ScriptedReply => ({
        status,
        message: { jsonrpc: "2.0", id, error: { code, message: text, ...(data !== undefined ? { data } : {}) } },
      });
      const fresh = modern && server.ttlMs !== undefined ? { ttlMs: server.ttlMs, cacheScope: "private" } : {};
      const page = (all: readonly unknown[], key: string): ScriptedReply => {
        const size = options.pageSize ?? all.length;
        const from = typeof params.cursor === "string" ? Number(params.cursor) || 0 : 0;
        const next = from + size < all.length ? { nextCursor: String(from + size) } : {};
        return result({ [key]: all.slice(from, from + Math.max(size, 1)), ...next, ...fresh });
      };

      if (headers && options.bearer !== undefined && headers.authorization !== `Bearer ${options.bearer}`) {
        return { status: 401, challenge: 'Bearer realm="mcp"', message: null };
      }

      if (modern) {
        if (id === null) return { status: 202, message: null };
        if (method === "initialize") return error(404, MCP_ERROR_METHOD_NOT_FOUND, "Method not found");
        const meta = isRecord(params._meta) ? params._meta : {};
        if (meta[MCP_META_VERSION] !== MCP_MODERN_VERSION) {
          return error(400, MCP_ERROR_UNSUPPORTED_VERSION, "Unsupported protocol version", { supported: [MCP_MODERN_VERSION], requested: meta[MCP_META_VERSION] ?? null });
        }
        if (headers) {
          if (headers["mcp-protocol-version"] !== MCP_MODERN_VERSION || headers["mcp-method"] !== method) return error(400, MCP_ERROR_HEADER_MISMATCH, "Header mismatch");
          if ((method === "tools/call" || method === "prompts/get") && decodeHeader(headers["mcp-name"]) !== params.name) return error(400, MCP_ERROR_HEADER_MISMATCH, "Header mismatch: Mcp-Name");
        }
      } else {
        if (method === "initialize") {
          greeted = true;
          const session = options.session ? `session-${++sessionCount}` : undefined;
          if (session) sessions.add(session);
          return result(
            { protocolVersion: legacyVersion, capabilities: { tools: { listChanged: true }, prompts: {} }, serverInfo: info, ...(server.instructions ? { instructions: server.instructions } : {}) },
            session ? { session } : {},
          );
        }
        if (id === null) return { status: 202, message: null };
        if (headers && options.session) {
          const session = headers["mcp-session-id"];
          if (!session) return { status: 400, message: null };
          if (!sessions.has(session)) return { status: 404, message: null };
        } else if (!greeted) {
          if (options.quiet) return { status: 0, message: null };
          return error(headers ? 400 : 200, MCP_ERROR_METHOD_NOT_FOUND, "Method not found");
        }
      }

      const args = isRecord(params.arguments) ? params.arguments : {};
      switch (method) {
        case "server/discover":
          if (!modern) return error(200, MCP_ERROR_METHOD_NOT_FOUND, "Method not found");
          return result({
            supportedVersions: [MCP_MODERN_VERSION],
            capabilities: { tools: {}, prompts: {} },
            ...(server.instructions ? { instructions: server.instructions } : {}),
            _meta: { [MCP_META_SERVER]: info },
            ...fresh,
          });
        case "ping":
          return modern ? error(404, MCP_ERROR_METHOD_NOT_FOUND, "Method not found") : result({});
        case "tools/list":
          return page(server.tools, "tools");
        case "prompts/list":
          return page(server.prompts, "prompts");
        case "tools/call": {
          const tool = server.tools.find((t) => t.name === params.name);
          if (!tool) return error(200, -32602, `Unknown tool: ${String(params.name)}`);
          if (modern && headers) {
            const marked = readMcpHeaderParams(tool.inputSchema);
            const expected = marked.ok ? mcpParamHeaders(marked.params, args) : {};
            for (const [name, value] of Object.entries(expected)) {
              if (headers[name.toLowerCase()] !== value) return error(400, MCP_ERROR_HEADER_MISMATCH, `Header mismatch: ${name}`);
            }
          }
          server.calls.push({ name: tool.name, args });
          return result(server.onCall(tool.name, args, ++callCount, params));
        }
        case "prompts/get": {
          const prompt = server.prompts.find((p) => p.name === params.name);
          if (!prompt) return error(200, -32602, `Unknown prompt: ${String(params.name)}`);
          return result(server.onPrompt(prompt.name, args, ++promptCount));
        }
        default:
          return error(modern ? 404 : 200, MCP_ERROR_METHOD_NOT_FOUND, "Method not found");
      }
    },
  };
  return server;
}

export interface ScriptedHttpOptions {
  /** Answer requests as an event stream, with a progress note before the response. */
  stream?: boolean;
  /** Leave the event stream open after the response, as a careless server does: only hanging up ends it. */
  keepOpen?: boolean;
  /** Hand the body over in pieces of this many characters. */
  pieces?: number;
  /** What the native side adds on its own: the credential of this server. */
  bearer?: string;
}

export interface ScriptedHttpPort extends McpHttpPort {
  readonly requests: { id: string; request: McpHttpRequest }[];
  readonly cancelled: string[];
  /** The next exchanges fail like this, as the network or the shell would make them. */
  failWith: McpHttpFailureCode | null;
  /** The next exchanges never answer. */
  hang: boolean;
}

/** The scripted server behind the HTTP port: what the shell's native request would bring back. */
export function scriptedMcpHttpPort(server: ScriptedMcpServer, options: ScriptedHttpOptions = {}): ScriptedHttpPort {
  const open = new Map<string, () => void>();
  const port: ScriptedHttpPort = {
    requests: [],
    cancelled: [],
    failWith: null,
    hang: false,
    send(id, request, onChunk) {
      port.requests.push({ id, request });
      return new Promise<void>((resolve) => {
        const end = (last: McpHttpChunk) => {
          open.delete(id);
          onChunk(last);
          resolve();
        };
        open.set(id, () => end({ type: "cancelled" }));
        if (port.hang) return;
        queueMicrotask(() => {
          if (!open.has(id)) return;
          if (port.failWith) return end({ type: "failed", code: port.failWith });
          const headers = { ...request.headers, ...(options.bearer !== undefined ? { Authorization: `Bearer ${options.bearer}` } : {}) };
          if (request.method === "DELETE") {
            const session = Object.entries(headers).find(([key]) => key.toLowerCase() === "mcp-session-id")?.[1];
            server.endSession(session);
            onChunk({ type: "open", status: server.era === "modern" ? 405 : 200, contentType: "" });
            return end({ type: "done" });
          }
          let message: unknown = null;
          try {
            message = JSON.parse(request.body) as unknown;
          } catch {
            // Left as null: the server answers what it answers to nothing.
          }
          const reply = server.handle(message, headers);
          const stream = Boolean(options.stream) && reply.message !== null && reply.status === 200;
          onChunk({
            type: "open",
            status: reply.status,
            contentType: reply.message === null ? "text/plain" : stream ? "text/event-stream" : "application/json",
            ...(reply.session ? { session: reply.session } : {}),
            ...(reply.challenge ? { challenge: reply.challenge } : {}),
          });
          const body =
            reply.message === null
              ? ""
              : stream
                ? `: hello\n\nevent: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: { progress: 1 } })}\n\nevent: message\ndata: ${JSON.stringify(reply.message)}\n\n`
                : JSON.stringify(reply.message);
          const size = options.pieces ?? body.length;
          for (let at = 0; at < body.length && open.has(id); at += Math.max(size, 1)) onChunk({ type: "data", text: body.slice(at, at + Math.max(size, 1)) });
          if (!open.has(id)) return;
          if (stream && options.keepOpen) return;
          end({ type: "done" });
        });
      });
    },
    cancel(id) {
      port.cancelled.push(id);
      open.get(id)?.();
      return Promise.resolve();
    },
  };
  return port;
}

export interface ScriptedStdioOptions {
  /** Lines the program prints that are no messages (a banner, a log line on the wrong stream). */
  noise?: string[];
  /** The program cannot be started. */
  startError?: string;
  /** The program reads nothing until `release()` — still coming up. */
  held?: boolean;
}

export interface ScriptedStdioPort extends McpStdioPort {
  readonly written: string[];
  stopped: boolean;
  /** The program starts reading what was written to it. */
  release(): void;
  /** The program prints a line of its own accord. */
  push(line: string): void;
  /** The program ends. */
  exit(code: number | null): void;
}

/** The scripted server behind the pipe of a program. */
export function scriptedMcpStdioPort(server: ScriptedMcpServer, options: ScriptedStdioOptions = {}): ScriptedStdioPort {
  let onLine: ((line: string) => void) | null = null;
  let onExit: ((code: number | null) => void) | null = null;
  let held = Boolean(options.held);
  const waiting: string[] = [];
  const read = (line: string) => {
    let message: unknown;
    try {
      message = JSON.parse(line) as unknown;
    } catch {
      return;
    }
    const reply = server.handle(message);
    if (reply.message) queueMicrotask(() => onLine?.(JSON.stringify(reply.message)));
  };
  const port: ScriptedStdioPort = {
    written: [],
    stopped: false,
    start(line, exit) {
      if (options.startError) return Promise.reject(new Error(options.startError));
      onLine = line;
      onExit = exit;
      for (const text of options.noise ?? []) queueMicrotask(() => onLine?.(text));
      return Promise.resolve();
    },
    write(line) {
      if (!onLine) return Promise.reject(new Error("not running"));
      port.written.push(line);
      if (held) waiting.push(line);
      else read(line);
      return Promise.resolve();
    },
    stop() {
      port.stopped = true;
      port.exit(0);
      return Promise.resolve();
    },
    release() {
      held = false;
      for (const line of waiting.splice(0)) read(line);
    },
    push(line) {
      queueMicrotask(() => onLine?.(line));
    },
    exit(code) {
      const exit = onExit;
      onLine = null;
      onExit = null;
      exit?.(code);
    },
  };
  return port;
}
