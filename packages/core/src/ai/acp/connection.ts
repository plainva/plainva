import { ACP_ERROR_INTERNAL, ACP_ERROR_METHOD_NOT_FOUND, ACP_MESSAGE_LIMIT, AcpError, AcpRefusal, acpRpcFailure, asAcpError, readAcpMessage, type AcpFailure } from "./protocol.js";

/**
 * The pipe between Plainva and an agent's program: JSON-RPC in both
 * directions, one message per line. Unlike a tool server, an agent asks as
 * well as answers — for a file, for the user's leave — and it reports what
 * it does without being asked.
 *
 * The program itself is the shell's business: it is started natively, from
 * an entry the user confirmed, and this code never names one. Here is which
 * answer belongs to which request, what a request of the agent is answered
 * with, and what happens when the program ends.
 */

/** The approved program of the agent this port is bound to: lines in, lines out. The shape of an MCP program's port. */
export interface AcpPort {
  /** Starts the program. `onExit` is called once, when it ended; `code` is null where it was ended by force. */
  start(onLine: (line: string) => void, onExit: (code: number | null) => void): Promise<void>;
  write(line: string): Promise<void>;
  /** Closes the program's input, waits a moment, then ends it. */
  stop(): Promise<void>;
}

export interface AcpPeer {
  /** A request of the agent. Resolve with its result; throw an `AcpRefusal` to answer with an error the agent can read. */
  request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>>;
  notification(method: string, params: Record<string, unknown>): void;
  /** The program ended. Called once. */
  exit(code: number | null): void;
}

export interface AcpRequestOptions {
  /** Without one a request waits as long as the program runs: a turn of an agent has no fixed length. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface AcpConnection {
  /** Starts the program. Rejects with an `AcpError` where it could not be started. */
  start(): Promise<void>;
  /** Sends a request and resolves with its result object. Rejects with an `AcpError`. */
  request(method: string, params: Record<string, unknown>, options?: AcpRequestOptions): Promise<Record<string, unknown>>;
  /** Sends a notification. A program that is gone takes none: that is not an error. */
  notify(method: string, params: Record<string, unknown>): Promise<void>;
  /** Ends the program. Everything that waits is told it was stopped. */
  close(): Promise<void>;
  /** How the program ended; null while it runs or was never started. */
  ended(): { code: number | null } | null;
}

/** Requests of the agent that are worked on at the same time. An agent that asks faster than that is told to come back. */
export const ACP_MAX_INFLIGHT = 16;

interface Pending {
  settle(result: Record<string, unknown>): void;
  fail(failure: AcpFailure): void;
}

export function createAcpConnection(port: AcpPort, peer: AcpPeer): AcpConnection {
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let started = false;
  let exited: { code: number | null } | null = null;
  let closed = false;
  let inflight = 0;
  // One lane: answers and requests reach the program in the order they were made.
  let lane: Promise<unknown> = Promise.resolve();

  const write = (message: Record<string, unknown>): Promise<void> => {
    const sent = lane.catch(() => undefined).then(() => (exited || closed ? undefined : port.write(JSON.stringify(message))));
    lane = sent;
    return sent;
  };

  const answer = (id: number | string, method: string, params: Record<string, unknown>) => {
    if (inflight >= ACP_MAX_INFLIGHT) {
      void write({ jsonrpc: "2.0", id, error: { code: ACP_ERROR_INTERNAL, message: "Too many requests at once." } }).catch(() => undefined);
      return;
    }
    inflight++;
    let work: Promise<Record<string, unknown>>;
    try {
      work = peer.request(method, params);
    } catch (error) {
      work = Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    work
      .then(
        (result) => ({ jsonrpc: "2.0", id, result }),
        (error: unknown) =>
          // Only a refusal carries words of Plainva's for the agent; whatever else went wrong stays here.
          error instanceof AcpRefusal ? { jsonrpc: "2.0", id, error: { code: error.code, message: error.message } } : { jsonrpc: "2.0", id, error: { code: ACP_ERROR_INTERNAL, message: "Internal error" } },
      )
      .then((message) => write(message))
      .catch(() => undefined)
      .finally(() => {
        inflight--;
      });
  };

  const onLine = (line: string) => {
    if (closed || line.length > ACP_MESSAGE_LIMIT) return;
    let raw: unknown;
    try {
      raw = JSON.parse(line) as unknown;
    } catch {
      // A program that prints something else to its output: not a message, not an error of the protocol.
      return;
    }
    const message = readAcpMessage(raw);
    if (!message) return;
    if (message.kind === "response") {
      if (typeof message.id !== "number") return;
      const waiting = pending.get(message.id);
      if (!waiting) return;
      pending.delete(message.id);
      if (message.error) waiting.fail(acpRpcFailure(message.error));
      else waiting.settle(message.result ?? {});
      return;
    }
    if (message.kind === "notification") {
      try {
        peer.notification(message.method, message.params);
      } catch {
        // What the host makes of a report is the host's; a report is never answered.
      }
      return;
    }
    answer(message.id, message.method, message.params);
  };

  const onExit = (code: number | null) => {
    if (exited) return;
    exited = { code };
    for (const [id, waiting] of [...pending]) {
      pending.delete(id);
      waiting.fail(closed ? { kind: "cancelled" } : { kind: "exited", code });
    }
    try {
      peer.exit(code);
    } catch {
      // The host's reaction to the end is its own.
    }
  };

  return {
    async start() {
      if (closed) throw new AcpError({ kind: "cancelled" });
      if (started) return;
      started = true;
      try {
        await port.start(onLine, onExit);
      } catch (error) {
        started = false;
        throw asAcpError(error);
      }
    },
    request(method, params, options = {}) {
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        if (closed || options.signal?.aborted) {
          reject(new AcpError({ kind: "cancelled" }));
          return;
        }
        if (exited) {
          reject(new AcpError({ kind: "exited", code: exited.code }));
          return;
        }
        if (!started) {
          reject(new AcpError({ kind: "unreachable", detail: "not started" }));
          return;
        }
        const id = nextId++;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const done = () => {
          if (timer !== undefined) clearTimeout(timer);
          options.signal?.removeEventListener("abort", onAbort);
          pending.delete(id);
        };
        const giveUp = (failure: AcpFailure) => {
          done();
          reject(new AcpError(failure));
        };
        const onAbort = () => giveUp({ kind: "cancelled" });
        if (options.timeoutMs !== undefined) timer = setTimeout(() => giveUp({ kind: "timeout" }), options.timeoutMs);
        options.signal?.addEventListener("abort", onAbort, { once: true });
        pending.set(id, {
          settle: (result) => {
            done();
            resolve(result);
          },
          fail: (failure) => {
            done();
            reject(new AcpError(failure));
          },
        });
        write({ jsonrpc: "2.0", id, method, params }).catch((error: unknown) => {
          if (!pending.has(id)) return;
          done();
          reject(asAcpError(error));
        });
      });
    },
    async notify(method, params) {
      if (!started) return;
      await write({ jsonrpc: "2.0", method, params }).catch(() => undefined);
    },
    async close() {
      if (closed) return;
      closed = true;
      for (const [id, waiting] of [...pending]) {
        pending.delete(id);
        waiting.fail({ kind: "cancelled" });
      }
      if (started && !exited) await port.stop().catch(() => undefined);
    },
    ended: () => exited,
  };
}

/** The answer to a request Plainva has no method for. */
export function acpNoSuchMethod(): AcpRefusal {
  return new AcpRefusal(ACP_ERROR_METHOD_NOT_FOUND, "Method not found");
}
