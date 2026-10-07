import { describe, expect, it } from "vitest";
import { createAcpClient, type AcpHost } from "./client.js";
import { AcpError, AcpRefusal, type AcpFileRead, type AcpFileWrite, type AcpPermissionRequest, type AcpUpdate } from "./protocol.js";
import { scriptedAcpAgent, type ScriptedAcpOptions } from "./scripted.js";

const CLIENT = { name: "plainva", title: "Plainva", version: "0.9.0" };
const TOOLBOX = [{ name: "plainva", command: "/opt/plainva/plainva-mcp", args: ["--app", "com.plainva.app"], env: [] }];

interface Recorded {
  updates: AcpUpdate[];
  asked: AcpPermissionRequest[];
  reads: AcpFileRead[];
  writes: AcpFileWrite[];
  exits: (number | null)[];
}

function setup(options: ScriptedAcpOptions = {}, host: Partial<AcpHost> = {}, timeouts: { stop?: number; session?: number } = {}) {
  const agent = scriptedAcpAgent(options);
  const seen: Recorded = { updates: [], asked: [], reads: [], writes: [], exits: [] };
  const client = createAcpClient(
    agent.port,
    {
      update: host.update ?? ((update) => void seen.updates.push(update)),
      permission:
        host.permission ??
        (async (request) => {
          seen.asked.push(request);
          return request.options[0]?.id ?? null;
        }),
      readFile:
        host.readFile ??
        (async (request) => {
          seen.reads.push(request);
          return "the text";
        }),
      writeFile:
        host.writeFile ??
        (async (request) => {
          seen.writes.push(request);
        }),
      exit: host.exit ?? ((code) => void seen.exits.push(code)),
    },
    { client: CLIENT, timeouts },
  );
  return { agent, client, seen };
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

const ALLOW = { optionId: "yes", name: "Allow", kind: "allow_once" };
const REJECT = { optionId: "no", name: "Reject", kind: "reject_once" };

describe("the start of an agent", () => {
  it("shakes hands once, saying what Plainva offers and what it does not", async () => {
    const { agent, client } = setup();
    const opened = await client.open();
    expect(opened.agent).toEqual({ name: "scripted-agent", title: "Scripted Agent", version: "1.0.0" });
    expect(await client.open()).toBe(opened);
    expect(agent.starts).toBe(1);
    expect(agent.received).toEqual([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false, auth: { terminal: true } }, clientInfo: CLIENT },
      },
    ]);
  });

  it("does not talk to an agent of another revision, or to a program that cannot be started", async () => {
    expect(await failure(setup({ version: 3 }).client.open())).toEqual({ kind: "version", offered: 3 });
    expect(await failure(setup({ startFails: "program-moved" }).client.open())).toEqual({ kind: "unreachable", detail: "program-moved" });
  });

  it("opens one session in the vault's folder, with Plainva's tools as a program the agent starts itself", async () => {
    const { agent, client } = setup({ sessionExtras: { modes: { currentModeId: "ask", availableModes: [] } } });
    expect(client.sessionId()).toBeNull();
    expect(await client.newSession({ cwd: "/home/u/Vault", mcpServers: TOOLBOX })).toBe("sess-1");
    expect(client.sessionId()).toBe("sess-1");
    expect(agent.received[1]).toEqual({ jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd: "/home/u/Vault", mcpServers: TOOLBOX } });
    expect(await failure(client.newSession({ cwd: "/home/u/Vault", mcpServers: [] }))).toEqual({ kind: "protocol", detail: "a session is open" });
  });

  it("says that the agent wants a sign-in, and asks it to do one only by a method it named", async () => {
    const { agent, client } = setup({
      needsAuth: true,
      authMethods: [
        { id: "browser", name: "Sign in" },
        { id: "login", name: "Log in from the terminal", type: "terminal", args: ["login"] },
      ],
    });
    expect(await failure(client.newSession({ cwd: "/v", mcpServers: [] }))).toEqual({ kind: "auth" });
    // A method the agent did not name, and one that is done in a terminal, are not asked for.
    expect(await failure(client.authenticate("nonsense"))).toEqual({ kind: "protocol", detail: "no such sign-in" });
    expect(await failure(client.authenticate("login"))).toEqual({ kind: "protocol", detail: "no such sign-in" });
    expect(agent.received.filter((message) => message.method === "authenticate")).toEqual([]);
    await client.authenticate("browser");
    expect(agent.received.at(-1)).toEqual({ jsonrpc: "2.0", id: 3, method: "authenticate", params: { methodId: "browser" } });
    expect(await client.newSession({ cwd: "/v", mcpServers: [] })).toBe("sess-1");
  });

  it("does not wait for a session forever", async () => {
    const { client } = setup({ hangsOnSession: true }, {}, { session: 20 });
    expect(await failure(client.newSession({ cwd: "/v", mcpServers: [] }))).toEqual({ kind: "timeout" });
  });
});

describe("a turn", () => {
  it("sends text and links, hands every report on in order, and ends for a reason", async () => {
    const { agent, client, seen } = setup({
      turns: [
        [
          { say: "Looking", role: "thought" },
          { tool: { toolCallId: "c1", title: "Search the vault", kind: "search", status: "pending" } },
          { toolUpdate: { toolCallId: "c1", status: "completed" } },
          { plan: [{ content: "Answer", priority: "high", status: "in_progress" }] },
          { say: "Here " },
          { say: "it is." },
        ],
      ],
    });
    await client.newSession({ cwd: "/v", mcpServers: [] });
    const blocks = [
      { type: "text" as const, text: "What is open?" },
      { type: "resource_link" as const, uri: "file:///v/Plan.md", name: "Plan.md" },
    ];
    expect(await client.prompt(blocks)).toBe("end_turn");
    expect(agent.received.at(-1)).toEqual({ jsonrpc: "2.0", id: 3, method: "session/prompt", params: { sessionId: "sess-1", prompt: blocks } });
    expect(seen.updates).toEqual([
      { kind: "text", role: "thought", text: "Looking" },
      { kind: "tool", tool: { id: "c1", fresh: true, title: "Search the vault", toolKind: "search", status: "pending" } },
      { kind: "tool", tool: { id: "c1", fresh: false, status: "completed" } },
      { kind: "plan", entries: [{ content: "Answer", priority: "high", status: "in_progress" }] },
      { kind: "text", role: "agent", text: "Here " },
      { kind: "text", role: "agent", text: "it is." },
    ]);
    // A second turn in the same session.
    expect(await client.prompt([{ type: "text", text: "Thanks" }])).toBe("end_turn");
    expect(seen.updates.at(-1)).toEqual({ kind: "text", role: "agent", text: "Done." });
  });

  it("needs a session, and hears nothing that is said about another one", async () => {
    const fresh = setup();
    await fresh.client.open();
    expect(await failure(fresh.client.prompt([{ type: "text", text: "Hi" }]))).toEqual({ kind: "protocol", detail: "no session" });

    const { client, seen } = setup({
      turns: [
        [
          { notify: { method: "session/update", params: { sessionId: "somebody-else", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "not for you" } } } } },
          { notify: { method: "something/else", params: { sessionId: "sess-1" } } },
          { raw: "plain text on the output" },
          { say: "For you." },
        ],
      ],
    });
    await client.newSession({ cwd: "/v", mcpServers: [] });
    await client.prompt([{ type: "text", text: "Hi" }]);
    expect(seen.updates).toEqual([{ kind: "text", role: "agent", text: "For you." }]);
  });

  it("asks the user what the agent asks, and answers with the user's choice — only one the agent offered", async () => {
    const ask = { ask: { toolCall: { toolCallId: "c9", title: "Delete old.md", kind: "delete" }, options: [ALLOW, REJECT] } };
    const chosen = setup({ turns: [[ask]] });
    await chosen.client.newSession({ cwd: "/v", mcpServers: [] });
    await chosen.client.prompt([{ type: "text", text: "Clean up" }]);
    expect(chosen.seen.asked).toEqual([
      {
        sessionId: "sess-1",
        tool: { id: "c9", fresh: false, title: "Delete old.md", toolKind: "delete" },
        options: [
          { id: "yes", name: "Allow", kind: "allow_once" },
          { id: "no", name: "Reject", kind: "reject_once" },
        ],
      },
    ]);
    expect(chosen.agent.answers).toEqual([{ method: "session/request_permission", result: { outcome: { outcome: "selected", optionId: "yes" } } }]);

    for (const answer of [null, "an-id-from-nowhere"]) {
      const none = setup({ turns: [[ask]] }, { permission: async () => answer });
      await none.client.newSession({ cwd: "/v", mcpServers: [] });
      await none.client.prompt([{ type: "text", text: "Clean up" }]);
      expect(none.agent.answers).toEqual([{ method: "session/request_permission", result: { outcome: { outcome: "cancelled" } } }]);
    }
  });

  it("does not ask the user where there is nothing to choose from", async () => {
    const { agent, client, seen } = setup({ turns: [[{ ask: { toolCall: { toolCallId: "c9" }, options: [{ optionId: "x", name: "?", kind: "something-new" }] } }]] });
    await client.newSession({ cwd: "/v", mcpServers: [] });
    await client.prompt([{ type: "text", text: "Go" }]);
    expect(seen.asked).toEqual([]);
    expect(agent.answers).toEqual([{ method: "session/request_permission", result: { outcome: { outcome: "cancelled" } } }]);
  });

  it("hands a file over, takes one, and says in its own words why not", async () => {
    const reads: AcpFileRead[] = [];
    const writes: AcpFileWrite[] = [];
    const { agent, client } = setup(
      {
        turns: [
          [
            { read: { path: "/v/Plan.md", line: 2, limit: 10 } },
            { write: { path: "/v/Plan.md", content: "new text" } },
            { read: { path: "/etc/passwd" } },
            { write: { path: "/v/.agent/policy.yml", content: "cloud: allow" } },
          ],
        ],
      },
      {
        async readFile(request) {
          reads.push(request);
          if (!request.path.startsWith("/v/")) throw new AcpRefusal(-32602, "Plainva reads files of the open vault only.");
          return "line two";
        },
        async writeFile(request) {
          writes.push(request);
          if (request.path.includes("/.agent/")) throw new AcpRefusal(-32602, "Plainva does not take changes to its own folders.");
        },
      },
    );
    await client.newSession({ cwd: "/v", mcpServers: [] });
    await client.prompt([{ type: "text", text: "Go" }]);
    expect(reads).toEqual([
      { sessionId: "sess-1", path: "/v/Plan.md", line: 2, limit: 10 },
      { sessionId: "sess-1", path: "/etc/passwd", line: null, limit: null },
    ]);
    expect(writes).toEqual([
      { sessionId: "sess-1", path: "/v/Plan.md", content: "new text" },
      { sessionId: "sess-1", path: "/v/.agent/policy.yml", content: "cloud: allow" },
    ]);
    expect(agent.answers).toEqual([
      { method: "fs/read_text_file", result: { content: "line two" } },
      { method: "fs/write_text_file", result: {} },
      { method: "fs/read_text_file", error: { code: -32602, message: "Plainva reads files of the open vault only." } },
      { method: "fs/write_text_file", error: { code: -32602, message: "Plainva does not take changes to its own folders." } },
    ]);
  });

  it("refuses what names another session, and has no method for what it never offered", async () => {
    const { agent, client, seen } = setup({
      turns: [
        [
          { request: { method: "fs/read_text_file", params: { sessionId: "somebody-else", path: "/v/a.md" } } },
          { request: { method: "fs/write_text_file", params: { sessionId: "somebody-else", path: "/v/a.md", content: "x" } } },
          { request: { method: "session/request_permission", params: { sessionId: "somebody-else", toolCall: { toolCallId: "c" }, options: [ALLOW] } } },
          { request: { method: "terminal/create", params: { sessionId: "sess-1", command: "rm", args: ["-rf", "."] } } },
          { request: { method: "elicitation/create", params: { sessionId: "sess-1" } } },
          { request: { method: "fs/read_text_file", params: { sessionId: "sess-1" } } },
        ],
      ],
    });
    await client.newSession({ cwd: "/v", mcpServers: [] });
    await client.prompt([{ type: "text", text: "Go" }]);
    expect(seen.reads).toEqual([]);
    expect(seen.writes).toEqual([]);
    expect(seen.asked).toEqual([]);
    expect(agent.answers.map((answer) => answer.error)).toEqual([
      { code: -32602, message: "Unknown session." },
      { code: -32602, message: "Unknown session." },
      { code: -32602, message: "Unknown session." },
      { code: -32601, message: "Method not found" },
      { code: -32601, message: "Method not found" },
      { code: -32602, message: "A session and a path are needed." },
    ]);
  });

  it("stops when the user stops it: the agent is told, an open question is moot, and the turn ends as stopped", async () => {
    const abort = new AbortController();
    let questionEnded = false;
    const { agent, client } = setup(
      { turns: [[{ say: "Working" }, { ask: { toolCall: { toolCallId: "c1", title: "Run" }, options: [ALLOW] } }, { wait: "cancel" }, { say: "late" }]] },
      {
        permission: (_request, signal) =>
          new Promise((resolve) => {
            // The user never answers; the stop does.
            signal.addEventListener("abort", () => {
              questionEnded = true;
              resolve(null);
            });
            abort.abort();
          }),
      },
    );
    await client.newSession({ cwd: "/v", mcpServers: [] });
    expect(await client.prompt([{ type: "text", text: "Go" }], abort.signal)).toBe("cancelled");
    expect(questionEnded).toBe(true);
    expect(agent.cancels).toBe(1);
    expect(agent.received.find((message) => message.method === "session/cancel")).toEqual({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId: "sess-1" } });
    expect(agent.answers).toEqual([{ method: "session/request_permission", result: { outcome: { outcome: "cancelled" } } }]);
    // A turn that was stopped before it began asks nothing of the agent.
    const before = agent.received.length;
    expect(await client.prompt([{ type: "text", text: "Again" }], abort.signal)).toBe("cancelled");
    expect(agent.received.length).toBe(before);
  });

  it("does not wait forever for an agent that will not stop", async () => {
    const abort = new AbortController();
    const { agent, client } = setup({ ignoresCancel: true, turns: [[{ wait: "cancel" }]] }, {}, { stop: 20 });
    await client.newSession({ cwd: "/v", mcpServers: [] });
    const turn = client.prompt([{ type: "text", text: "Go" }], abort.signal);
    abort.abort();
    expect(await turn).toBe("cancelled");
    expect(agent.cancels).toBe(1);
  });

  it("ends with the program: the turn fails as an exit, an open question is moot, the host is told once", async () => {
    let questionEnded = false;
    const { agent, client, seen } = setup(
      { turns: [[{ say: "Working" }, { ask: { toolCall: { toolCallId: "c1" }, options: [ALLOW] } }]] },
      {
        permission: (_request, signal) =>
          new Promise((resolve) => {
            signal.addEventListener("abort", () => {
              questionEnded = true;
              resolve("yes");
            });
            agent.crash(137);
          }),
      },
    );
    await client.newSession({ cwd: "/v", mcpServers: [] });
    expect(await failure(client.prompt([{ type: "text", text: "Go" }]))).toEqual({ kind: "exited", code: 137 });
    expect(questionEnded).toBe(true);
    expect(seen.exits).toEqual([137]);
    expect(await failure(client.prompt([{ type: "text", text: "Again" }]))).toEqual({ kind: "exited", code: 137 });
  });

  it("ends the program when it is closed", async () => {
    const { agent, client, seen } = setup();
    await client.newSession({ cwd: "/v", mcpServers: [] });
    await client.close();
    expect(agent.stopped).toBe(true);
    expect(agent.running).toBe(false);
    expect(seen.exits).toEqual([null]);
    expect(await failure(client.prompt([{ type: "text", text: "Hi" }]))).toEqual({ kind: "cancelled" });
  });
});
