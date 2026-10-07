import {
  asMcpError,
  mcpChooseEra,
  McpError,
  mcpRequestMeta,
  mcpRpcFailure,
  readMcpDiscover,
  readMcpInitialize,
  readMcpMessage,
  shareMcpWork,
  MCP_ERROR_METHOD_NOT_FOUND,
  MCP_ERROR_UNSUPPORTED_VERSION,
  MCP_LEGACY_VERSIONS,
  MCP_RESPONSE_LIMIT,
  MCP_TIMEOUTS,
  type McpFailure,
  type McpOpened,
  type McpResponse,
  type McpStdioPort,
  type McpWire,
  type McpWireOptions,
} from "./wire.js";

/**
 * A server that is a program on this computer: one JSON-RPC message per line
 * on its standard input and output, in both generations of the protocol.
 *
 * The program itself is the shell's business — it is started natively, only
 * after the user approved its exact command, and this code never names one.
 * Here is what travels over the pipe: which answer belongs to which request,
 * how long to wait, what to say when a request is given up, and how to find
 * out which generation the program speaks.
 */

export interface McpStdioWireOptions extends McpWireOptions {
  /** The server said its lists changed (an earlier revision does that unasked): they are loaded again before use. */
  onNotification?(method: string): void;
}

interface Pending {
  settle(response: McpResponse): void;
  fail(failure: McpFailure): void;
}

type Settled = { ok: true; response: McpResponse } | { ok: false; error: McpError };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const settled = (call: Promise<McpResponse>): Promise<Settled> =>
  call.then(
    (response): Settled => ({ ok: true, response }),
    (error: unknown): Settled => ({ ok: false, error: asMcpError(error) }),
  );

export function createMcpStdioWire(port: McpStdioPort, options: McpStdioWireOptions): McpWire {
  const timeouts = { ...MCP_TIMEOUTS, ...options.timeouts };
  const meta = () => mcpRequestMeta(options.client);
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let started = false;
  let exited: { code: number | null } | null = null;
  let closed = false;
  /** While the handshake of an earlier revision runs, and after it: the server may send requests of its own. */
  let handshaking = false;
  let opened: McpOpened | null = null;

  const write = (message: Record<string, unknown>) => port.write(JSON.stringify(message));

  const onLine = (line: string) => {
    if (line.length > MCP_RESPONSE_LIMIT) return;
    let raw: unknown;
    try {
      raw = JSON.parse(line) as unknown;
    } catch {
      // A program that prints something else to its output: not a message, not an error of the protocol.
      return;
    }
    const message = readMcpMessage(raw);
    if (!message) return;
    if (message.kind === "response") {
      if (typeof message.id !== "number") return;
      const waiting = pending.get(message.id);
      if (!waiting) return;
      pending.delete(message.id);
      waiting.settle(message);
      return;
    }
    if (message.kind === "notification") {
      options.onNotification?.(message.method);
      return;
    }
    // A request from the server. Only an earlier revision may send one, and Plainva offered it nothing:
    // a ping is answered, everything else is told that there is no such method here.
    if (!handshaking && opened?.era !== "legacy") return;
    const answer =
      message.method === "ping"
        ? { jsonrpc: "2.0", id: message.id, result: {} }
        : { jsonrpc: "2.0", id: message.id, error: { code: MCP_ERROR_METHOD_NOT_FOUND, message: "Method not found" } };
    void write(answer).catch(() => undefined);
  };

  const onExit = (code: number | null) => {
    exited = { code };
    opened = null;
    for (const [id, waiting] of [...pending]) {
      pending.delete(id);
      waiting.fail(closed ? { kind: "cancelled" } : { kind: "exited", code });
    }
  };

  /** Sends one request and waits for its response; rejects only for what the pipe did, never for what the server said. */
  const call = (method: string, params: Record<string, unknown>, timeoutMs: number, signal: AbortSignal | undefined, tellOnGiveUp: boolean): Promise<McpResponse> =>
    new Promise<McpResponse>((resolve, reject) => {
      // A wire that was closed stopped its program itself: that is a stop, not a program that ended.
      if (closed || signal?.aborted) {
        reject(new McpError({ kind: "cancelled" }));
        return;
      }
      if (exited) {
        reject(new McpError({ kind: "exited", code: exited.code }));
        return;
      }
      const id = nextId++;
      const done = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        pending.delete(id);
      };
      const giveUp = (failure: McpFailure, reason: string) => {
        done();
        // The server is told to stop working on it; a request that may never have been heard needs no such note.
        if (tellOnGiveUp && !exited) void write({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: id, reason } }).catch(() => undefined);
        reject(new McpError(failure));
      };
      const onAbort = () => giveUp({ kind: "cancelled" }, "cancelled");
      const timer = setTimeout(() => giveUp({ kind: "timeout" }, "timeout"), timeoutMs);
      signal?.addEventListener("abort", onAbort, { once: true });
      pending.set(id, {
        settle: (response) => {
          done();
          resolve(response);
        },
        fail: (failure) => {
          done();
          reject(new McpError(failure));
        },
      });
      write({ jsonrpc: "2.0", id, method, params }).catch((error: unknown) => {
        if (!pending.has(id)) return;
        done();
        reject(asMcpError(error));
      });
    });

  const hello = (signal?: AbortSignal) => {
    handshaking = true;
    return call(
      "initialize",
      { protocolVersion: MCP_LEGACY_VERSIONS[0], capabilities: {}, clientInfo: { name: options.client.name, version: options.client.version } },
      timeouts.start,
      signal,
      false,
    );
  };

  /** The second half of the handshake: read what the server answered, then tell it the answer arrived. */
  const greeted = async (response: McpResponse): Promise<McpOpened> => {
    if (response.error) throw new McpError(mcpRpcFailure(response.error));
    const result = response.result ?? {};
    const version = typeof result.protocolVersion === "string" ? result.protocolVersion : "";
    if (!MCP_LEGACY_VERSIONS.includes(version)) throw new McpError({ kind: "version", supported: version ? [version.slice(0, 32)] : [] });
    await write({ jsonrpc: "2.0", method: "notifications/initialized" });
    return readMcpInitialize(result, version);
  };

  /** What a `server/discover` answer means: the stateless revision, an earlier one, or nothing in common. */
  const probed = (response: McpResponse): "modern" | "legacy" => {
    if (response.result) {
      if (!Array.isArray(response.result.supportedVersions)) return "legacy";
      const choice = mcpChooseEra(response.result.supportedVersions);
      if (choice.era === "none") throw new McpError({ kind: "version", supported: choice.supported });
      return choice.era;
    }
    if (response.error?.code === MCP_ERROR_UNSUPPORTED_VERSION) {
      const choice = mcpChooseEra(isRecord(response.error.data) ? response.error.data.supported : undefined);
      if (choice.era === "legacy") return "legacy";
      throw new McpError({ kind: "version", supported: choice.era === "none" ? choice.supported : [] });
    }
    // Any other error: an earlier revision, which answers the unknown request as it likes.
    return "legacy";
  };

  const connect = async (signal?: AbortSignal): Promise<McpOpened> => {
    if (!started) {
      started = true;
      try {
        await port.start(onLine, onExit);
      } catch (error) {
        started = false;
        throw error;
      }
    }
    const discover = settled(call("server/discover", { _meta: meta() }, timeouts.start, signal, false));
    let quietTimer: ReturnType<typeof setTimeout> | undefined;
    const quiet = new Promise<null>((resolve) => {
      quietTimer = setTimeout(() => resolve(null), timeouts.probe);
    });
    const first = await Promise.race([discover, quiet]);
    clearTimeout(quietTimer);
    if (first) {
      if (!first.ok) throw first.error;
      if (probed(first.response) === "modern") return readMcpDiscover(first.response.result!);
      return greeted(await hello(signal));
    }
    // Quiet so far. An earlier revision may ignore what it does not know before its handshake — or the
    // program is still coming up. The handshake is sent as well, and whichever answer arrives decides.
    const greeting = settled(hello(signal));
    const second = await Promise.race([discover.then((probe) => ({ probe })), greeting.then((greet) => ({ greet }))]);
    if ("probe" in second) {
      if (!second.probe.ok) {
        // The first question was given up; the handshake may still be answered.
        const greet = await greeting;
        if (!greet.ok) throw second.probe.error.failure.kind === "timeout" ? greet.error : second.probe.error;
        return greeted(greet.response);
      }
      if (probed(second.probe.response) === "modern") {
        handshaking = false;
        return readMcpDiscover(second.probe.response.result!);
      }
      const greet = await greeting;
      if (!greet.ok) throw greet.error;
      return greeted(greet.response);
    }
    if (second.greet.ok && !second.greet.response.error) return greeted(second.greet.response);
    // The handshake was refused or lost. A server of the stateless revision refuses it — and answers the first question.
    const probe = await discover;
    if (probe.ok && probed(probe.response) === "modern") {
      handshaking = false;
      return readMcpDiscover(probe.response.result!);
    }
    if (!second.greet.ok) throw second.greet.error;
    return greeted(second.greet.response);
  };

  // One opening for everybody who waits for it: a caller that gives up does not cancel it for the others.
  const connecting = shareMcpWork((signal) => connect(signal));
  const open = (signal?: AbortSignal): Promise<McpOpened> => {
    if (closed) return Promise.reject(new McpError({ kind: "cancelled" }));
    if (opened) return Promise.resolve(opened);
    if (exited) return Promise.reject(new McpError({ kind: "exited", code: exited.code }));
    return connecting(signal).then(
      (result) => {
        // The program may have ended, or the wire may have been closed, while it was being asked.
        if (exited) throw new McpError({ kind: "exited", code: exited.code });
        if (closed) throw new McpError({ kind: "cancelled" });
        opened = result;
        return result;
      },
      (error: unknown) => {
        throw asMcpError(error);
      },
    );
  };

  const answerOf = (response: McpResponse, modern: boolean): Record<string, unknown> => {
    if (response.error) {
      if (modern && response.error.code === MCP_ERROR_UNSUPPORTED_VERSION) {
        const choice = mcpChooseEra(isRecord(response.error.data) ? response.error.data.supported : undefined);
        throw new McpError({ kind: "version", supported: choice.era === "none" ? choice.supported : [] });
      }
      throw new McpError(mcpRpcFailure(response.error));
    }
    return response.result ?? {};
  };

  return {
    transport: "stdio",
    open,
    async refresh(signal) {
      const current = await open(signal);
      if (current.era === "legacy") return current;
      opened = readMcpDiscover(answerOf(await call("server/discover", { _meta: meta() }, timeouts.open, signal, true), true));
      return opened;
    },
    async request(method, params, request = {}) {
      const current = await open(request.signal);
      const modern = current.era === "modern";
      const response = await call(method, modern ? { ...params, _meta: meta() } : params, request.timeoutMs ?? timeouts.call, request.signal, true);
      return answerOf(response, modern);
    },
    async close() {
      closed = true;
      opened = null;
      for (const [id, waiting] of [...pending]) {
        pending.delete(id);
        waiting.fail({ kind: "cancelled" });
      }
      if (started && !exited) await port.stop().catch(() => undefined);
    },
  };
}
