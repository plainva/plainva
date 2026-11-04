import { describe, expect, it, vi } from "vitest";
import { ACP_MAX_INFLIGHT, acpNoSuchMethod, createAcpConnection, type AcpPeer, type AcpPort } from "./connection.js";
import { ACP_MESSAGE_LIMIT, AcpError, AcpRefusal } from "./protocol.js";

/** A pipe in the test's hands: what the host wrote, and a way to say what the program says. */
function pipe(options: { startFails?: string; writeFails?: boolean } = {}) {
  let onLine: (line: string) => void = () => undefined;
  let onExit: (code: number | null) => void = () => undefined;
  const state = { written: [] as Record<string, unknown>[], started: 0, stopped: 0 };
  const port: AcpPort = {
    async start(line, exit) {
      if (options.startFails) throw new Error(options.startFails);
      state.started++;
      onLine = line;
      onExit = exit;
    },
    async write(line) {
      if (options.writeFails) throw new Error("the program does not take input");
      state.written.push(JSON.parse(line) as Record<string, unknown>);
    },
    async stop() {
      state.stopped++;
      onExit(null);
    },
  };
  return { port, state, say: (message: unknown) => onLine(typeof message === "string" ? message : JSON.stringify(message)), exit: (code: number | null) => onExit(code) };
}

function quietPeer(overrides: Partial<AcpPeer> = {}): AcpPeer & { notes: [string, Record<string, unknown>][]; exits: (number | null)[] } {
  const peer = {
    notes: [] as [string, Record<string, unknown>][],
    exits: [] as (number | null)[],
    request: overrides.request ?? (async () => ({})),
    notification: overrides.notification ?? ((method: string, params: Record<string, unknown>) => void peer.notes.push([method, params])),
    exit: overrides.exit ?? ((code: number | null) => void peer.exits.push(code)),
  };
  return peer;
}

const failure = async (work: Promise<unknown>) => {
  try {
    await work;
  } catch (error) {
    if (error instanceof AcpError) return error.failure;
    throw error;
  }
  return null;
};

/** Lets everything that is queued run: the write lane, and what hangs on it. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("the pipe to an agent", () => {
  it("matches an answer to its request, by its number", async () => {
    const { port, state, say } = pipe();
    const connection = createAcpConnection(port, quietPeer());
    await connection.start();
    const first = connection.request("initialize", { protocolVersion: 1 });
    const second = connection.request("session/new", { cwd: "/vault" });
    await settle();
    expect(state.written).toEqual([
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1 } },
      { jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd: "/vault" } },
    ]);
    // Answers arrive in any order; one for a number nobody asked with is nobody's.
    say({ jsonrpc: "2.0", id: 99, result: { stray: true } });
    say({ jsonrpc: "2.0", id: "1", result: { wrong: "a string is not the number" } });
    say({ jsonrpc: "2.0", id: 2, result: { sessionId: "s" } });
    say({ jsonrpc: "2.0", id: 1, result: { protocolVersion: 1 } });
    expect(await first).toEqual({ protocolVersion: 1 });
    expect(await second).toEqual({ sessionId: "s" });
    // A second answer to the same request is nobody's either.
    say({ jsonrpc: "2.0", id: 1, result: { again: true } });
  });

  it("names an agent's own error, and 'sign in first' as what it is", async () => {
    const { port, say } = pipe();
    const connection = createAcpConnection(port, quietPeer());
    await connection.start();
    const refused = failure(connection.request("session/new", {}));
    const broken = failure(connection.request("session/prompt", {}));
    await settle();
    say({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "Authentication required" } });
    say({ jsonrpc: "2.0", id: 2, error: { code: -32603, message: "boom" } });
    expect(await refused).toEqual({ kind: "auth" });
    expect(await broken).toEqual({ kind: "rpc", code: -32603, message: "boom" });
  });

  it("is deaf to what is no message", async () => {
    const { port, say } = pipe();
    const peer = quietPeer();
    const connection = createAcpConnection(port, peer);
    await connection.start();
    const asked = connection.request("initialize", {});
    await settle();
    say("npm warn deprecated something");
    say("{ not json");
    say("[1,2,3]");
    say("null");
    say(`{"jsonrpc":"2.0","id":1,"result":{"pad":"${"x".repeat(ACP_MESSAGE_LIMIT)}"}}`);
    expect(peer.notes).toEqual([]);
    say({ jsonrpc: "2.0", id: 1, result: { ok: true } });
    expect(await asked).toEqual({ ok: true });
  });

  it("hands a report to the host, and a host that stumbles over one keeps the pipe", async () => {
    const { port, say } = pipe();
    const seen: string[] = [];
    const connection = createAcpConnection(
      port,
      quietPeer({
        notification(method) {
          seen.push(method);
          throw new Error("the host stumbled");
        },
      }),
    );
    await connection.start();
    say({ jsonrpc: "2.0", method: "session/update", params: { a: 1 } });
    say({ jsonrpc: "2.0", method: "session/update", params: { a: 2 } });
    expect(seen).toEqual(["session/update", "session/update"]);
  });

  it("answers a request of the agent with what the host decided", async () => {
    const { port, state, say } = pipe();
    const connection = createAcpConnection(
      port,
      quietPeer({
        async request(method, params) {
          if (method === "fs/read_text_file") return { content: `text of ${String(params.path)}` };
          if (method === "fs/write_text_file") throw new AcpRefusal(-32602, "Plainva takes changes to notes only.");
          if (method === "explode") throw new Error("C:\\Users\\someone\\secret.txt could not be opened");
          throw acpNoSuchMethod();
        },
      }),
    );
    await connection.start();
    say({ jsonrpc: "2.0", id: 5, method: "fs/read_text_file", params: { path: "/vault/a.md" } });
    say({ jsonrpc: "2.0", id: "six", method: "fs/write_text_file", params: {} });
    say({ jsonrpc: "2.0", id: 7, method: "explode", params: {} });
    say({ jsonrpc: "2.0", id: 8, method: "terminal/create", params: { command: "rm" } });
    await settle();
    expect(state.written).toEqual([
      { jsonrpc: "2.0", id: 5, result: { content: "text of /vault/a.md" } },
      // A refusal carries Plainva's own words; the id is the agent's, as it sent it.
      { jsonrpc: "2.0", id: "six", error: { code: -32602, message: "Plainva takes changes to notes only." } },
      // Whatever else went wrong stays in the app: no path, no system message.
      { jsonrpc: "2.0", id: 7, error: { code: -32603, message: "Internal error" } },
      { jsonrpc: "2.0", id: 8, error: { code: -32601, message: "Method not found" } },
    ]);
  });

  it("works on a bounded number of the agent's requests at once", async () => {
    const { port, state, say } = pipe();
    const release: (() => void)[] = [];
    const connection = createAcpConnection(
      port,
      quietPeer({
        request: () =>
          new Promise((resolve) => {
            release.push(() => resolve({ done: true }));
          }),
      }),
    );
    await connection.start();
    for (let i = 0; i < ACP_MAX_INFLIGHT + 2; i++) say({ jsonrpc: "2.0", id: i, method: "fs/read_text_file", params: {} });
    await settle();
    expect(release).toHaveLength(ACP_MAX_INFLIGHT);
    expect(state.written).toEqual([
      { jsonrpc: "2.0", id: ACP_MAX_INFLIGHT, error: { code: -32603, message: "Too many requests at once." } },
      { jsonrpc: "2.0", id: ACP_MAX_INFLIGHT + 1, error: { code: -32603, message: "Too many requests at once." } },
    ]);
    // Once one is done there is room again.
    release[0]!();
    await settle();
    say({ jsonrpc: "2.0", id: 100, method: "fs/read_text_file", params: {} });
    await settle();
    expect(release).toHaveLength(ACP_MAX_INFLIGHT + 1);
  });

  it("tells everybody who waits when the program ends, and the host once", async () => {
    const { port, exit } = pipe();
    const peer = quietPeer();
    const connection = createAcpConnection(port, peer);
    await connection.start();
    const waiting = failure(connection.request("session/prompt", {}));
    await settle();
    expect(connection.ended()).toBeNull();
    exit(3);
    exit(3);
    expect(await waiting).toEqual({ kind: "exited", code: 3 });
    expect(peer.exits).toEqual([3]);
    expect(connection.ended()).toEqual({ code: 3 });
    expect(await failure(connection.request("session/prompt", {}))).toEqual({ kind: "exited", code: 3 });
    // A notification to a program that is gone is nothing, not an error.
    await connection.notify("session/cancel", {});
  });

  it("stops the program when it is closed, and what waited was stopped — not a program that ended", async () => {
    const { port, state } = pipe();
    const peer = quietPeer();
    const connection = createAcpConnection(port, peer);
    await connection.start();
    const waiting = failure(connection.request("session/prompt", {}));
    await settle();
    await connection.close();
    await connection.close();
    expect(await waiting).toEqual({ kind: "cancelled" });
    expect(state.stopped).toBe(1);
    expect(peer.exits).toEqual([null]);
    expect(await failure(connection.request("initialize", {}))).toEqual({ kind: "cancelled" });
    expect(await failure(connection.start())).toEqual({ kind: "cancelled" });
  });

  it("gives up a request after its time, or when it is called off", async () => {
    vi.useFakeTimers();
    try {
      const { port, say } = pipe();
      const connection = createAcpConnection(port, quietPeer());
      await connection.start();
      const slow = failure(connection.request("initialize", {}, { timeoutMs: 1000 }));
      await vi.advanceTimersByTimeAsync(1001);
      expect(await slow).toEqual({ kind: "timeout" });
      // The late answer is nobody's.
      say({ jsonrpc: "2.0", id: 1, result: {} });

      const abort = new AbortController();
      const called = failure(connection.request("session/new", {}, { signal: abort.signal }));
      abort.abort();
      expect(await called).toEqual({ kind: "cancelled" });
      expect(await failure(connection.request("session/new", {}, { signal: abort.signal }))).toEqual({ kind: "cancelled" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("says why a program could not be started, and that nothing was asked of one that was not", async () => {
    const broken = createAcpConnection(pipe({ startFails: "program-moved" }).port, quietPeer());
    expect(await failure(broken.start())).toEqual({ kind: "unreachable", detail: "program-moved" });
    expect(await failure(broken.request("initialize", {}))).toEqual({ kind: "unreachable", detail: "not started" });
    const mute = pipe({ writeFails: true });
    const connection = createAcpConnection(mute.port, quietPeer());
    await connection.start();
    expect(await failure(connection.request("initialize", {}))).toEqual({ kind: "unreachable", detail: "the program does not take input" });
  });

  it("writes in the order things were said", async () => {
    const { port, state, say } = pipe();
    const connection = createAcpConnection(port, quietPeer({ request: async () => ({ ok: true }) }));
    await connection.start();
    void connection.request("a", {}).catch(() => undefined);
    void connection.notify("b", {});
    say({ jsonrpc: "2.0", id: 1, method: "c", params: {} });
    void connection.request("d", {}).catch(() => undefined);
    await settle();
    expect(state.written.map((message) => message.method ?? "answer")).toEqual(["a", "b", "d", "answer"]);
  });
});
