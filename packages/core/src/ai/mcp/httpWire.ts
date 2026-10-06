import { createSseParser } from "../streams.js";
import { mcpHeaderValue } from "./headerValues.js";
import {
  asMcpError,
  mcpChooseEra,
  McpError,
  mcpRequestMeta,
  mcpRpcFailure,
  readMcpDiscover,
  readMcpInitialize,
  readMcpMessage,
  MCP_ERROR_HEADER_MISMATCH,
  MCP_ERROR_MISSING_CAPABILITY,
  MCP_ERROR_UNSUPPORTED_VERSION,
  MCP_LEGACY_VERSIONS,
  MCP_MODERN_VERSION,
  MCP_RESPONSE_LIMIT,
  MCP_TIMEOUTS,
  type McpFailure,
  type McpHttpChunk,
  type McpHttpPort,
  type McpHttpRequest,
  type McpOpened,
  type McpRequestOptions,
  type McpResponse,
  type McpWire,
  type McpWireOptions,
} from "./wire.js";

/**
 * A remote server over Streamable HTTP, in both generations of the protocol.
 *
 * Every message is one POST of its own; the answer is one JSON object or an
 * event stream that ends with it. The request itself is the shell's: this
 * code names headers and a body, the native side holds the address and the
 * credentials, follows no redirect and cuts the answer — the web view cannot
 * make it talk to another host.
 *
 * An earlier revision adds a handshake and, where the server hands one out,
 * a session id that travels with every later request.
 */

export interface McpHttpWireOptions extends McpWireOptions {
  /** An id for one exchange, so that it can be stopped. */
  newRequestId(): string;
}

interface HttpAnswer {
  status: number;
  contentType: string;
  session?: string;
  challenge?: string;
  /** The JSON-RPC response the exchange was about, where one came. */
  response: McpResponse | null;
}

/** How long past its own time limit the native side gets before this code gives up on it. */
const NATIVE_GRACE_MS = 5_000;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const ok = (status: number) => status >= 200 && status < 300;

function transportFailure(chunk: Extract<McpHttpChunk, { type: "failed" }>): McpFailure {
  switch (chunk.code) {
    case "timeout":
      return { kind: "timeout" };
    case "too-large":
      return { kind: "too-large" };
    case "refused":
      return { kind: "refused", ...(chunk.message ? { detail: chunk.message.slice(0, 120) } : {}) };
    case "tls":
      return { kind: "unreachable", detail: "tls" };
    default:
      return { kind: "unreachable" };
  }
}

/**
 * One request, one answer. Resolves as soon as the response to `expectId`
 * arrived — a server that leaves its event stream open afterwards is hung up
 * on — and for a notification (`expectId` null) when the answer ended.
 */
function exchange(port: McpHttpPort, requestId: string, request: McpHttpRequest, expectId: number | null, signal?: AbortSignal): Promise<HttpAnswer> {
  return new Promise<HttpAnswer>((resolve, reject) => {
    let head: Omit<HttpAnswer, "response"> | null = null;
    let settled = false;
    let size = 0;
    let json = "";
    let events: ReturnType<typeof createSseParser> | null = null;
    let found: McpResponse | null = null;

    const hangUp = () => void port.cancel(requestId).catch(() => undefined);
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      settle();
    };
    const fail = (failure: McpFailure) => finish(() => reject(new McpError(failure)));
    // Settled first, hung up second: a port that answers a hang-up with "cancelled" must not rename the outcome.
    const onAbort = () => {
      fail({ kind: "cancelled" });
      hangUp();
    };
    const timer = setTimeout(() => {
      fail({ kind: "timeout" });
      hangUp();
    }, request.timeoutMs + NATIVE_GRACE_MS);

    const take = (raw: unknown) => {
      // An earlier revision allowed several messages in one array.
      for (const item of Array.isArray(raw) ? raw : [raw]) {
        const message = readMcpMessage(item);
        if (!message || message.kind !== "response") continue;
        // An error without an id answers the request that could not be read: this one.
        if (message.id === expectId || (message.id === null && message.error)) found = message;
      }
    };
    const parse = (text: string) => {
      try {
        take(JSON.parse(text) as unknown);
      } catch {
        // Not JSON: no answer of the protocol. The status decides what it means.
      }
    };
    const answered = () => finish(() => (head ? resolve({ ...head, response: found }) : reject(new McpError({ kind: "protocol", detail: "no answer" }))));

    if (signal?.aborted) {
      fail({ kind: "cancelled" });
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });

    port
      .send(requestId, request, (chunk) => {
        if (settled) return;
        switch (chunk.type) {
          case "open":
            head = {
              status: chunk.status,
              contentType: chunk.contentType,
              ...(chunk.session ? { session: chunk.session } : {}),
              ...(chunk.challenge ? { challenge: chunk.challenge } : {}),
            };
            if (chunk.contentType.split(";")[0]!.trim().toLowerCase() === "text/event-stream") events = createSseParser();
            return;
          case "data":
            size += chunk.text.length;
            if (size > MCP_RESPONSE_LIMIT) {
              fail({ kind: "too-large" });
              hangUp();
              return;
            }
            if (!events) {
              json += chunk.text;
              return;
            }
            for (const event of events.push(chunk.text)) parse(event.data);
            if (found && expectId !== null) {
              answered();
              hangUp();
            }
            return;
          case "done":
            if (events) for (const event of events.finish()) parse(event.data);
            else if (json.trim()) parse(json);
            answered();
            return;
          case "cancelled":
            fail({ kind: "cancelled" });
            return;
          case "failed":
            fail(transportFailure(chunk));
            return;
        }
      })
      .then(
        // A port that resolves without a last chunk: what arrived until then is the answer.
        () => answered(),
        (error: unknown) => finish(() => reject(asMcpError(error))),
      );
  });
}

export function createMcpHttpWire(port: McpHttpPort, options: McpHttpWireOptions): McpWire {
  const timeouts = { ...MCP_TIMEOUTS, ...options.timeouts };
  const meta = () => mcpRequestMeta(options.client);
  let nextId = 1;
  let opening: Promise<McpOpened> | null = null;
  let opened: McpOpened | null = null;
  let session: string | undefined;

  const post = (message: Record<string, unknown>, headers: Record<string, string>, expectId: number | null, timeoutMs: number, signal?: AbortSignal) =>
    exchange(
      port,
      options.newRequestId(),
      { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers }, body: JSON.stringify(message), timeoutMs },
      expectId,
      signal,
    );

  const modern = (method: string, params: Record<string, unknown>, request: McpRequestOptions, timeoutMs: number) => {
    const id = nextId++;
    return post(
      { jsonrpc: "2.0", id, method, params: { ...params, _meta: meta() } },
      {
        "MCP-Protocol-Version": MCP_MODERN_VERSION,
        "Mcp-Method": method,
        ...(request.name !== undefined ? { "Mcp-Name": mcpHeaderValue(request.name) } : {}),
        ...request.headers,
      },
      id,
      timeoutMs,
      request.signal,
    );
  };

  const legacyHeaders = (version: string): Record<string, string> => ({ "MCP-Protocol-Version": version, ...(session ? { "Mcp-Session-Id": session } : {}) });

  const legacy = (method: string, params: Record<string, unknown>, request: McpRequestOptions, timeoutMs: number, version: string) => {
    const id = nextId++;
    return post({ jsonrpc: "2.0", id, method, params }, legacyHeaders(version), id, timeoutMs, request.signal);
  };

  const needsSignIn = (answer: HttpAnswer): McpError | null =>
    answer.status === 401 || answer.status === 403 ? new McpError({ kind: "auth", status: answer.status, ...(answer.challenge ? { challenge: answer.challenge.slice(0, 2000) } : {}) }) : null;

  /** The handshake of an earlier revision: `initialize`, then the note that it arrived. */
  const handshake = async (signal?: AbortSignal): Promise<McpOpened> => {
    session = undefined;
    const id = nextId++;
    const answer = await post(
      { jsonrpc: "2.0", id, method: "initialize", params: { protocolVersion: MCP_LEGACY_VERSIONS[0], capabilities: {}, clientInfo: { name: options.client.name, version: options.client.version } } },
      {},
      id,
      timeouts.open,
      signal,
    );
    const signIn = needsSignIn(answer);
    if (signIn) throw signIn;
    if (answer.response?.error) throw new McpError(mcpRpcFailure(answer.response.error));
    if (!answer.response || !ok(answer.status)) throw new McpError(ok(answer.status) ? { kind: "protocol", detail: "no answer to initialize" } : { kind: "http", status: answer.status });
    const result = answer.response.result ?? {};
    const version = typeof result.protocolVersion === "string" ? result.protocolVersion : "";
    if (!MCP_LEGACY_VERSIONS.includes(version)) throw new McpError({ kind: "version", supported: version ? [version.slice(0, 32)] : [] });
    session = answer.session;
    // A server that does not take the note says so at the next request; only a stop is passed on.
    await post({ jsonrpc: "2.0", method: "notifications/initialized" }, legacyHeaders(version), null, timeouts.open, signal).catch((error: unknown) => {
      if (asMcpError(error).failure.kind === "cancelled") throw error;
    });
    return readMcpInitialize(result, version);
  };

  /** A `server/discover` answer of a server that is known to be modern. */
  const discovered = (answer: HttpAnswer): McpOpened => {
    const signIn = needsSignIn(answer);
    if (signIn) throw signIn;
    if (answer.response?.error) {
      if (answer.response.error.code === MCP_ERROR_UNSUPPORTED_VERSION) throw new McpError({ kind: "version", supported: supportedOf(answer.response.error.data) });
      throw new McpError(mcpRpcFailure(answer.response.error));
    }
    if (!answer.response?.result || !ok(answer.status)) throw new McpError(ok(answer.status) ? { kind: "protocol", detail: "no answer to server/discover" } : { kind: "http", status: answer.status });
    return readMcpDiscover(answer.response.result);
  };

  const supportedOf = (data: unknown): string[] => {
    const choice = mcpChooseEra(isRecord(data) ? data.supported : undefined);
    return choice.era === "none" ? choice.supported : [];
  };

  const connect = async (signal?: AbortSignal): Promise<McpOpened> => {
    const probe = await modern("server/discover", {}, { ...(signal ? { signal } : {}) }, timeouts.open);
    const signIn = needsSignIn(probe);
    if (signIn) throw signIn;
    const response = probe.response;
    if (response?.result && ok(probe.status)) {
      // Without the list of revisions this is no discover answer; the handshake finds out what it is.
      if (!Array.isArray(response.result.supportedVersions)) return handshake(signal);
      const choice = mcpChooseEra(response.result.supportedVersions);
      if (choice.era === "modern") return readMcpDiscover(response.result);
      if (choice.era === "legacy") return handshake(signal);
      throw new McpError({ kind: "version", supported: choice.supported });
    }
    if (response?.error) {
      const code = response.error.code;
      if (code === MCP_ERROR_UNSUPPORTED_VERSION) {
        const choice = mcpChooseEra(isRecord(response.error.data) ? response.error.data.supported : undefined);
        if (choice.era === "legacy") return handshake(signal);
        throw new McpError({ kind: "version", supported: choice.era === "none" ? choice.supported : [] });
      }
      // The two other errors only a modern server sends: it is modern, and it did not like the request.
      if (code === MCP_ERROR_HEADER_MISMATCH || code === MCP_ERROR_MISSING_CAPABILITY) throw new McpError(mcpRpcFailure(response.error));
      return handshake(signal);
    }
    // No answer of the protocol at all. A server in trouble says so; everything else may be an earlier revision.
    if (probe.status === 429 || probe.status >= 500) throw new McpError({ kind: "http", status: probe.status });
    return handshake(signal);
  };

  const open = (signal?: AbortSignal): Promise<McpOpened> => {
    if (opened) return Promise.resolve(opened);
    opening ??= connect(signal).then(
      (hello) => {
        opened = hello;
        opening = null;
        return hello;
      },
      (error: unknown) => {
        opening = null;
        throw asMcpError(error);
      },
    );
    return opening;
  };

  return {
    transport: "http",
    open,
    async refresh(signal) {
      const hello = await open(signal);
      if (hello.era === "legacy") return hello;
      opened = discovered(await modern("server/discover", {}, { ...(signal ? { signal } : {}) }, timeouts.open));
      return opened;
    },
    async request(method, params, request = {}) {
      const timeoutMs = request.timeoutMs ?? timeouts.call;
      let hello = await open(request.signal);
      for (let attempt = 0; ; attempt++) {
        const answer = hello.era === "modern" ? await modern(method, params, request, timeoutMs) : await legacy(method, params, request, timeoutMs, hello.version);
        const signIn = needsSignIn(answer);
        if (signIn) throw signIn;
        const response = answer.response;
        if (response?.error) {
          if (hello.era === "modern" && response.error.code === MCP_ERROR_UNSUPPORTED_VERSION) throw new McpError({ kind: "version", supported: supportedOf(response.error.data) });
          throw new McpError(mcpRpcFailure(response.error));
        }
        if (response?.result && ok(answer.status)) return response.result;
        // A session of an earlier revision can end on the server's side: one new handshake, one more try.
        if (hello.era === "legacy" && answer.status === 404 && session && attempt === 0) {
          hello = opened = await handshake(request.signal);
          continue;
        }
        throw new McpError(ok(answer.status) ? { kind: "protocol", detail: `no answer to ${method.slice(0, 40)}` } : { kind: "http", status: answer.status });
      }
    },
    async close() {
      const hello = opened;
      opened = null;
      if (hello?.era !== "legacy" || !session) return;
      const headers = legacyHeaders(hello.version);
      session = undefined;
      // Ending a session is a courtesy; whatever comes of it, the wire is closed.
      await exchange(port, options.newRequestId(), { method: "DELETE", headers, body: "", timeoutMs: 5_000 }, null).catch(() => undefined);
    },
  };
}
