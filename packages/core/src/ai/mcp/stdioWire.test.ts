import { afterEach, describe, expect, it, vi } from "vitest";
import { createScriptedMcpServer, scriptedMcpStdioPort, type ScriptedMcpOptions, type ScriptedStdioOptions } from "./scripted.js";
import { createMcpStdioWire } from "./stdioWire.js";
import { McpError, MCP_META_CAPABILITIES, MCP_META_CLIENT, MCP_META_VERSION, type McpFailure } from "./wire.js";

const client = { name: "Plainva", version: "0.0.0-test" };
const tools = [{ name: "search_issues", description: "Finds issues.", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } }];

function wired(options: ScriptedMcpOptions = {}, stdio: ScriptedStdioOptions = {}) {
  const server = createScriptedMcpServer({ tools, instructions: "Use the search first.", ...options });
  const port = scriptedMcpStdioPort(server, stdio);
  const notes: string[] = [];
  const wire = createMcpStdioWire(port, { client, onNotification: (method) => notes.push(method) });
  return { server, port, wire, notes };
}

async function failureOf(run: Promise<unknown>): Promise<McpFailure> {
  try {
    await run;
  } catch (error) {
    expect(error).toBeInstanceOf(McpError);
    return (error as McpError).failure;
  }
  throw new Error("did not fail");
}

const written = (port: { written: string[] }) => port.written.map((line) => JSON.parse(line) as { id?: number; method: string; params?: Record<string, unknown>; result?: unknown; error?: unknown });
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.useRealTimers();
});

describe("a program of the stateless revision", () => {
  it("is asked what it speaks, and gets the revision and the client with every request", async () => {
    const { wire, port } = wired({ name: "Local", ttlMs: 1000 });
    const hello = await wire.open();
    expect(hello).toEqual({ era: "modern", version: "2026-07-28", serverInfo: { name: "Local", version: "1.0.0" }, instructions: "Use the search first.", tools: true, prompts: true, ttlMs: 1000 });
    const result = await wire.request("tools/call", { name: "search_issues", arguments: { query: "x" } }, { name: "search_issues", headers: { "Mcp-Param-Region": "eu" } });
    expect(result.content).toEqual([{ type: "text", text: 'search_issues {"query":"x"}' }]);
    const lines = written(port);
    expect(lines.map((line) => line.method)).toEqual(["server/discover", "tools/call"]);
    const meta = { [MCP_META_VERSION]: "2026-07-28", [MCP_META_CLIENT]: client, [MCP_META_CAPABILITIES]: {} };
    expect(lines[0]!.params).toEqual({ _meta: meta });
    // A pipe has no headers: what would be one over HTTP is simply not there.
    expect(lines[1]!.params).toEqual({ name: "search_issues", arguments: { query: "x" }, _meta: meta });
    // One message per line, and nothing else on it.
    for (const line of port.written) expect(line.includes("\n")).toBe(false);
  });

  it("ignores what a program prints that is no message", async () => {
    const { wire } = wired({}, { noise: ["Server listening…", "{ not json", '"just a string"', "[1,2,3]", ""] });
    expect((await wire.open()).era).toBe("modern");
    expect(await wire.request("tools/list", {})).toMatchObject({ tools: [{ name: "search_issues" }] });
  });

  it("asks again what the program says about itself when it is refreshed", async () => {
    const { wire, server } = wired();
    await wire.open();
    server.instructions = "Something else now.";
    expect((await wire.refresh()).instructions).toBe("Something else now.");
  });

  it("never answers a request the program sends: a modern server has none to send", async () => {
    const { wire, port } = wired();
    await wire.open();
    port.push(JSON.stringify({ jsonrpc: "2.0", id: 99, method: "sampling/createMessage", params: {} }));
    port.push(JSON.stringify({ jsonrpc: "2.0", id: 100, method: "ping" }));
    await flush();
    expect(written(port).map((line) => line.method)).toEqual(["server/discover"]);
  });
});

describe("a program of an earlier revision", () => {
  it("is found by its answer to the modern question and greeted", async () => {
    const { wire, port, server } = wired({ era: "legacy", legacyVersion: "2025-06-18" });
    const hello = await wire.open();
    expect(hello).toMatchObject({ era: "legacy", version: "2025-06-18", instructions: "Use the search first.", ttlMs: null });
    expect(server.methods).toEqual(["server/discover", "initialize", "notifications/initialized"]);
    await wire.request("tools/list", {});
    const lines = written(port);
    expect(lines[1]!.params).toEqual({ protocolVersion: "2025-11-25", capabilities: {}, clientInfo: client });
    expect(lines[3]).toEqual({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} });
    expect(await wire.refresh()).toBe(hello);
  });

  it("is greeted as well when it says nothing to a question it does not know", async () => {
    vi.useFakeTimers();
    const { wire, port, server } = wired({ era: "legacy", quiet: true });
    const opening = wire.open();
    await vi.advanceTimersByTimeAsync(3_999);
    expect(server.methods).toEqual(["server/discover"]);
    await vi.advanceTimersByTimeAsync(2);
    expect((await opening).era).toBe("legacy");
    expect(written(port).map((line) => line.method)).toEqual(["server/discover", "initialize", "notifications/initialized"]);
    // The question it never answered is not followed by a note to stop working on it.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(written(port).some((line) => line.method === "notifications/cancelled")).toBe(false);
  });

  it("answers a ping, and tells every other request of the server that there is no such thing here", async () => {
    const { wire, port } = wired({ era: "legacy" });
    await wire.open();
    port.push(JSON.stringify({ jsonrpc: "2.0", id: "p1", method: "ping" }));
    port.push(JSON.stringify({ jsonrpc: "2.0", id: 7, method: "sampling/createMessage", params: { messages: [] } }));
    port.push(JSON.stringify({ jsonrpc: "2.0", id: 8, method: "roots/list" }));
    await flush();
    const answers = written(port).slice(3);
    expect(answers).toEqual([
      { jsonrpc: "2.0", id: "p1", result: {} },
      { jsonrpc: "2.0", id: 7, error: { code: -32601, message: "Method not found" } },
      { jsonrpc: "2.0", id: 8, error: { code: -32601, message: "Method not found" } },
    ]);
  });

  it("passes on that the lists changed", async () => {
    const { wire, port, notes } = wired({ era: "legacy" });
    await wire.open();
    port.push(JSON.stringify({ jsonrpc: "2.0", method: "notifications/tools/list_changed" }));
    await flush();
    expect(notes).toEqual(["notifications/tools/list_changed"]);
  });

  it("is not spoken to when it names a revision Plainva does not know", async () => {
    expect(await failureOf(wired({ era: "legacy", legacyVersion: "2031-01-01" }).wire.open())).toEqual({ kind: "version", supported: ["2031-01-01"] });
  });
});

describe("a program that is slow to come up", () => {
  it("is modern when its first answer says so, however late — the handshake sent meanwhile is forgotten", async () => {
    vi.useFakeTimers();
    const { wire, port } = wired({}, { held: true });
    const opening = wire.open();
    await vi.advanceTimersByTimeAsync(4_001);
    expect(written(port).map((line) => line.method)).toEqual(["server/discover", "initialize"]);
    await vi.advanceTimersByTimeAsync(20_000);
    port.release();
    expect((await opening).era).toBe("modern");
    await wire.request("tools/list", {});
    const last = written(port)[2]!;
    expect(last.method).toBe("tools/list");
    expect(last.params).toHaveProperty("_meta");
    expect(written(port).some((line) => line.method === "notifications/initialized")).toBe(false);
  });

  it("is of an earlier revision when its late answers say that", async () => {
    vi.useFakeTimers();
    const { wire, port } = wired({ era: "legacy" }, { held: true });
    const opening = wire.open();
    await vi.advanceTimersByTimeAsync(10_000);
    port.release();
    expect((await opening).era).toBe("legacy");
    expect(written(port).map((line) => line.method)).toEqual(["server/discover", "initialize", "notifications/initialized"]);
  });

  it("is given up when it never answers at all", async () => {
    vi.useFakeTimers();
    const { wire } = wired({}, { held: true });
    const opening = failureOf(wire.open());
    await vi.advanceTimersByTimeAsync(64_001);
    expect(await opening).toEqual({ kind: "timeout" });
  });
});

describe("what the pipe does", () => {
  it("says that a program could not be started, and tries again when asked again", async () => {
    const server = createScriptedMcpServer({ tools });
    let fail = true;
    const working = scriptedMcpStdioPort(server);
    const wire = createMcpStdioWire({ ...working, start: (onLine, onExit) => (fail ? Promise.reject(new Error("no such program")) : working.start(onLine, onExit)), write: (line) => working.write(line), stop: () => working.stop() }, { client });
    expect(await failureOf(wire.open())).toEqual({ kind: "unreachable", detail: "no such program" });
    fail = false;
    expect((await wire.open()).era).toBe("modern");
  });

  it("fails what is waiting when the program ends, and says so from then on", async () => {
    const { wire, port, server } = wired();
    await wire.open();
    server.handle = () => ({ status: 0, message: null });
    const run = failureOf(wire.request("tools/list", {}));
    port.exit(3);
    expect(await run).toEqual({ kind: "exited", code: 3 });
    expect(await failureOf(wire.request("tools/list", {}))).toEqual({ kind: "exited", code: 3 });
    expect(await failureOf(wire.open())).toEqual({ kind: "exited", code: 3 });
  });

  it("fails an opening that the program's end interrupts", async () => {
    const { wire, port } = wired({}, { held: true });
    const opening = failureOf(wire.open());
    await flush();
    port.exit(null);
    expect(await opening).toEqual({ kind: "exited", code: null });
  });

  it("opens once for everybody who waits — one that gives up leaves the others waiting", async () => {
    const { wire, port } = wired({}, { held: true });
    const gone = new AbortController();
    const one = failureOf(wire.open(gone.signal));
    const two = wire.open();
    await flush();
    gone.abort();
    expect(await one).toEqual({ kind: "cancelled" });
    port.release();
    expect((await two).era).toBe("modern");
    // The program was asked once, and nobody told it to stop.
    expect(written(port).map((line) => line.method)).toEqual(["server/discover"]);
    expect(port.stopped).toBe(false);
  });

  it("gives an opening up when the last one who waited has gone, and asks anew for whoever comes next", async () => {
    const { wire, port } = wired({}, { held: true });
    const a = new AbortController();
    const b = new AbortController();
    const one = failureOf(wire.open(a.signal));
    const two = failureOf(wire.open(b.signal));
    await flush();
    a.abort();
    expect(await one).toEqual({ kind: "cancelled" });
    expect(written(port).some((line) => line.method === "notifications/cancelled")).toBe(false);
    b.abort();
    expect(await two).toEqual({ kind: "cancelled" });
    port.release();
    expect((await wire.open()).era).toBe("modern");
    expect(written(port).filter((line) => line.method === "server/discover")).toHaveLength(2);
  });

  it("tells the program to stop working on a request that is given up", async () => {
    vi.useFakeTimers();
    const { wire, port, server } = wired();
    await wire.open();
    server.handle = () => ({ status: 0, message: null });
    const slow = failureOf(wire.request("tools/call", { name: "search_issues", arguments: {} }, { timeoutMs: 500 }));
    await vi.advanceTimersByTimeAsync(501);
    expect(await slow).toEqual({ kind: "timeout" });

    const stop = new AbortController();
    const stopped = failureOf(wire.request("tools/call", { name: "search_issues", arguments: {} }, { signal: stop.signal }));
    // Until the request is written: a request that never left needs no note.
    await vi.advanceTimersByTimeAsync(0);
    stop.abort();
    expect(await stopped).toEqual({ kind: "cancelled" });

    const notes = written(port).filter((line) => line.method === "notifications/cancelled");
    expect(notes.map((note) => note.params)).toEqual([
      { requestId: 2, reason: "timeout" },
      { requestId: 3, reason: "cancelled" },
    ]);

    const before = new AbortController();
    before.abort();
    const count = port.written.length;
    expect(await failureOf(wire.request("tools/list", {}, { signal: before.signal }))).toEqual({ kind: "cancelled" });
    expect(port.written).toHaveLength(count);
  });

  it("ignores an answer nobody waits for, and one whose line is too long", async () => {
    const { wire, port } = wired();
    await wire.open();
    port.push(JSON.stringify({ jsonrpc: "2.0", id: 999, result: { tools: [] } }));
    port.push(JSON.stringify({ jsonrpc: "2.0", id: "text-id", result: {} }));
    port.push(`{"jsonrpc":"2.0","id":2,"result":{"pad":"${"x".repeat(4 * 1024 * 1024)}"}}`);
    await flush();
    expect(await wire.request("tools/list", {})).toMatchObject({ tools: [{ name: "search_issues" }] });
  });

  it("stops the program when the wire is closed, and fails what was waiting as stopped", async () => {
    const { wire, port, server } = wired();
    await wire.open();
    server.handle = () => ({ status: 0, message: null });
    const run = failureOf(wire.request("tools/list", {}));
    await flush();
    await wire.close();
    expect(await run).toEqual({ kind: "cancelled" });
    expect(port.stopped).toBe(true);
    // Closed is closed: nothing is asked of a program this wire stopped itself.
    expect(await failureOf(wire.request("tools/list", {}))).toEqual({ kind: "cancelled" });
    expect(await failureOf(wire.open())).toEqual({ kind: "cancelled" });
  });

  it("passes on an error the program answers with", async () => {
    const { wire } = wired();
    expect(await failureOf(wire.request("tools/call", { name: "nope", arguments: {} }))).toEqual({ kind: "rpc", code: -32602, message: "Unknown tool: nope" });
    expect(await failureOf(wire.request("no/such", {}))).toEqual({ kind: "rpc", code: -32601, message: "Method not found" });
  });
});
