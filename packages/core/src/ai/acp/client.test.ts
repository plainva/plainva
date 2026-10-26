import { describe, expect, it, vi } from "vitest";
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
      ...(host.opened ? { opened: host.opened } : {}),
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
const lastOf = <T,>(list: readonly T[]): T | undefined => list[list.length - 1];
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
        params: { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false, auth: { terminal: true }, session: { configOptions: { boolean: {} } } }, clientInfo: CLIENT },
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
    expect((await client.newSession({ cwd: "/home/u/Vault", mcpServers: TOOLBOX })).sessionId).toBe("sess-1");
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
    expect((await client.newSession({ cwd: "/v", mcpServers: [] })).sessionId).toBe("sess-1");
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

/** Plan KI-Harness P9-7: what the user may set for the session, through the client. */
describe("the settings of a session", () => {
  const CONFIG = [
    { id: "mode", name: "Mode", category: "mode", currentValue: "ask", options: [{ value: "ask", name: "Ask" }, { value: "code", name: "Code" }] },
    { id: "think", name: "Think", category: "thought_level", type: "boolean", currentValue: false },
  ];
  const MODES = { currentModeId: "ask", availableModes: [{ id: "ask", name: "Ask" }, { id: "plan", name: "Plan" }] };

  it("are what the agent opened the session with, and change only to what it offered", async () => {
    const { agent, client } = setup({ configOptions: CONFIG, modes: MODES });
    const opened = await client.newSession({ cwd: "/v", mcpServers: [] });
    expect(opened.config!.map((option) => [option.id, option.current])).toEqual([
      ["mode", "ask"],
      ["think", false],
    ]);
    // Where an agent sends settings, the older modes stand back.
    expect(opened.modes).toBeNull();
    expect(client.settings()).toEqual({ config: opened.config, modes: null });
    const next = await client.setConfigOption("mode", "code");
    expect(lastOf(agent.received)).toEqual({ jsonrpc: "2.0", id: 3, method: "session/set_config_option", params: { sessionId: "sess-1", configId: "mode", value: "code" } });
    expect(next.map((option) => option.current)).toEqual(["code", false]);
    await client.setConfigOption("think", true);
    expect(lastOf(agent.received)).toMatchObject({ method: "session/set_config_option", params: { configId: "think", value: true, type: "boolean" } });
    expect(client.settings().config!.map((option) => option.current)).toEqual(["code", true]);
    // A setting or a value it did not offer, a switch set to a word, a mode in the older way: refused without asking.
    const sent = agent.received.length;
    expect(await failure(client.setConfigOption("mode", "root"))).toEqual({ kind: "protocol", detail: "no such setting" });
    expect(await failure(client.setConfigOption("budget", "9"))).toEqual({ kind: "protocol", detail: "no such setting" });
    expect(await failure(client.setConfigOption("think", "yes"))).toEqual({ kind: "protocol", detail: "no such setting" });
    expect(await failure(client.setMode("plan"))).toEqual({ kind: "protocol", detail: "no such mode" });
    expect(agent.received).toHaveLength(sent);
  });

  it("follow what the agent reports of them itself", async () => {
    const { agent, client, seen } = setup({ configOptions: CONFIG, turns: [[{ update: { sessionUpdate: "config_option_update", configOptions: [{ ...CONFIG[0], currentValue: "code" }, CONFIG[1]] } }]] });
    await client.newSession({ cwd: "/v", mcpServers: [] });
    await client.prompt([{ type: "text", text: "Go" }]);
    expect(client.settings().config!.map((option) => option.current)).toEqual(["code", false]);
    expect(seen.updates.filter((update) => update.kind === "config")).toHaveLength(1);
    void agent;
  });

  it("in the older way: a mode it offered, and a report of a mode it never offered is passed by", async () => {
    const { agent, client, seen } = setup({ modes: MODES, turns: [[{ update: { sessionUpdate: "current_mode_update", currentModeId: "yolo" } }, { update: { sessionUpdate: "current_mode_update", currentModeId: "ask" } }]] });
    const opened = await client.newSession({ cwd: "/v", mcpServers: [] });
    expect(opened).toEqual({ sessionId: "sess-1", config: null, modes: { current: "ask", available: [{ id: "ask", name: "Ask", description: "" }, { id: "plan", name: "Plan", description: "" }] } });
    await client.setMode("plan");
    expect(lastOf(agent.received)).toEqual({ jsonrpc: "2.0", id: 3, method: "session/set_mode", params: { sessionId: "sess-1", modeId: "plan" } });
    expect(client.settings().modes!.current).toBe("plan");
    expect(await failure(client.setMode("yolo"))).toEqual({ kind: "protocol", detail: "no such mode" });
    await client.prompt([{ type: "text", text: "Go" }]);
    // The answer to the change reaches the host as a report where it was read; the agent's own switch after it.
    expect(seen.updates.filter((update) => update.kind === "mode")).toEqual([
      { kind: "mode", current: "plan", answer: true },
      { kind: "mode", current: "ask" },
    ]);
    expect(client.settings().modes!.current).toBe("ask");
  });

  it("keep what the agent reported right behind its answer to session/new — for this session, in its order", async () => {
    const { client, seen } = setup({
      configOptions: CONFIG,
      afterSession: [
        { update: { sessionUpdate: "available_commands_update", availableCommands: [{ name: "web", description: "Search the web" }] } },
        { update: { sessionUpdate: "config_option_update", configOptions: [{ ...CONFIG[0], currentValue: "code" }, CONFIG[1]] } },
        // Another session's report is no report of this one.
        { sessionId: "sess-9", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Elsewhere." } } },
      ],
    });
    const opened = await client.newSession({ cwd: "/v", mcpServers: [] });
    expect(seen.updates).toEqual([
      { kind: "commands", commands: [{ name: "web", description: "Search the web", hint: null }] },
      { kind: "config", options: opened.config },
    ]);
    // What the client hands back is the session as it stands after them.
    expect(opened.config!.map((option) => option.current)).toEqual(["code", false]);
    expect(client.settings().config).toEqual(opened.config);
  });

  it("take the answer to a change where it is read: a report the agent sends right behind it stands", async () => {
    const { client, seen } = setup({ configOptions: CONFIG, afterChange: [{ sessionUpdate: "config_option_update", configOptions: [{ ...CONFIG[0], currentValue: "code" }, { ...CONFIG[1], currentValue: true }] }] });
    await client.newSession({ cwd: "/v", mcpServers: [] });
    await client.setConfigOption("mode", "code");
    // First the answer, then what the agent said behind it — and that is what stands.
    expect(seen.updates.filter((update) => update.kind === "config").map((update) => (update.kind === "config" ? [update.answer === true, update.options.map((option) => option.current)] : null))).toEqual([
      [true, ["code", false]],
      [false, ["code", true]],
    ]);
    expect(client.settings().config!.map((option) => option.current)).toEqual(["code", true]);
  });

  it("count what the agent reported before its answer to session/new first, and the answer after it", async () => {
    const { client, seen } = setup({
      configOptions: CONFIG,
      beforeSession: [
        { update: { sessionUpdate: "available_commands_update", availableCommands: [{ name: "web", description: "Search the web" }] } },
        { update: { sessionUpdate: "config_option_update", configOptions: [{ ...CONFIG[0], currentValue: "code" }, CONFIG[1]] } },
      ],
    });
    const opened = await client.newSession({ cwd: "/v", mcpServers: [] });
    // The commands it reported first are kept; the settings it reported are the older word, the answer's stand.
    expect(seen.updates.map((update) => update.kind)).toEqual(["commands", "config"]);
    expect(opened.config!.map((option) => option.current)).toEqual(["ask", false]);
  });

  it("keep the newest report of each kind from before the answer, so that a burst does not crowd out the rest", async () => {
    const burst = Array.from({ length: 70 }, (_, index) => ({ update: { sessionUpdate: "config_option_update", configOptions: [{ ...CONFIG[0], currentValue: index % 2 ? "code" : "ask" }, CONFIG[1]] } }));
    const { client, seen } = setup({
      configOptions: CONFIG,
      beforeSession: [...burst, { update: { sessionUpdate: "available_commands_update", availableCommands: [{ name: "plan", description: "Make a plan" }] } }],
    });
    await client.newSession({ cwd: "/v", mcpServers: [] });
    expect(seen.updates.map((update) => update.kind)).toEqual(["config", "commands"]);
    // The newest of the settings reports stands for the seventy: the last one said "code".
    expect(seen.updates[0]!.kind === "config" && seen.updates[0]!.options[0]!.current).toBe("code");
    expect(seen.updates[1]).toEqual({ kind: "commands", commands: [{ name: "plan", description: "Make a plan", hint: null }] });
  });

  it("let no other report crowd out the settings or the commands from before the answer, and keep a few sessions only", async () => {
    const chatter = Array.from({ length: 70 }, () => ({ update: { sessionUpdate: "usage_update", used: 1 } }));
    const elsewhere = ["s-2", "s-3", "s-4", "s-5"].map((sessionId) => ({ sessionId, update: { sessionUpdate: "available_commands_update", availableCommands: [{ name: "x", description: "Elsewhere" }] } }));
    const { client, seen } = setup({
      configOptions: CONFIG,
      beforeSession: [...elsewhere, ...chatter, { update: { sessionUpdate: "available_commands_update", availableCommands: [{ name: "plan", description: "Make a plan" }] } }],
    });
    await client.newSession({ cwd: "/v", mcpServers: [] });
    // Four other sessions filled the room for sessions before this one spoke: its own reports are not kept then —
    // and with this session first, they are, whatever else comes.
    expect(seen.updates.filter((update) => update.kind === "commands")).toEqual([]);
    const first = setup({ configOptions: CONFIG, beforeSession: [...chatter, { update: { sessionUpdate: "available_commands_update", availableCommands: [{ name: "plan", description: "Make a plan" }] } }, ...elsewhere] });
    await first.client.newSession({ cwd: "/v", mcpServers: [] });
    expect(first.seen.updates.filter((update) => update.kind === "commands")).toEqual([{ kind: "commands", commands: [{ name: "plan", description: "Make a plan", hint: null }] }]);
  });

  it("tell the host the session's settings where the answer to session/new is read, before what the agent reports behind it", async () => {
    const order: string[] = [];
    const { client } = setup(
      { configOptions: CONFIG, afterSession: [{ update: { sessionUpdate: "config_option_update", configOptions: [{ ...CONFIG[0], currentValue: "code" }, CONFIG[1]] } }] },
      {
        opened: (settings) => void order.push(`opened ${settings.config!.map((option) => option.current).join(",")}`),
        update: (update) => void order.push(`${update.kind} ${update.kind === "config" ? update.options.map((option) => option.current).join(",") : ""}`),
      },
    );
    const opened = await client.newSession({ cwd: "/v", mcpServers: [] });
    expect(order).toEqual(["opened ask,false", "config code,false"]);
    expect(opened.config!.map((option) => option.current)).toEqual(["code", false]);
  });

  it("keep their state when the host fails where an answer is read", async () => {
    const told: string[] = [];
    const { client } = setup(
      { configOptions: CONFIG, beforeSession: [{ update: { sessionUpdate: "available_commands_update", availableCommands: [] } }] },
      {
        update: (update) => {
          if (update.kind === "commands") throw new Error("a host's own mistake");
        },
        opened: (settings) => void told.push(settings.config!.map((option) => option.current).join(",")),
      },
    );
    const opened = await client.newSession({ cwd: "/v", mcpServers: [] });
    // The answer was taken where it was read, whole, though the host failed on the report before it.
    expect(opened.config!.map((option) => option.current)).toEqual(["ask", false]);
    expect(told).toEqual(["ask,false"]);
  });

  it("end the older modes with the first report of settings", async () => {
    const { client } = setup({ modes: MODES, afterSession: [{ update: { sessionUpdate: "config_option_update", configOptions: [] } }] });
    const opened = await client.newSession({ cwd: "/v", mcpServers: [] });
    expect(opened).toMatchObject({ config: [], modes: null });
    expect(await failure(client.setMode("plan"))).toEqual({ kind: "protocol", detail: "no such mode" });
  });

  it("take a bare answer at its word only for a value the setting still offers", async () => {
    const narrowed = [{ ...CONFIG[0], options: [{ value: "ask", name: "Ask" }] }, CONFIG[1]];
    const { client } = setup({ configOptions: CONFIG, answersSettingsBare: true, beforeChange: [{ sessionUpdate: "config_option_update", configOptions: narrowed }] });
    await client.newSession({ cwd: "/v", mcpServers: [] });
    const after = await client.setConfigOption("mode", "code");
    expect(after.map((option) => option.current)).toEqual(["ask", false]);
  });

  it("wait for the agent's answer to a change as long as it takes", async () => {
    const { client } = setup({ configOptions: CONFIG, hangsOnSettings: true });
    await client.newSession({ cwd: "/v", mcpServers: [] });
    vi.useFakeTimers();
    try {
      let settled = false;
      void client.setConfigOption("mode", "code").then(
        () => void (settled = true),
        () => void (settled = true),
      );
      await vi.advanceTimersByTimeAsync(60 * 60_000);
      expect(settled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("take an answer without the list at its word for the one that was asked, and an agent's no as its error", async () => {
    const bare = setup({ configOptions: CONFIG, answersSettingsBare: true });
    await bare.client.newSession({ cwd: "/v", mcpServers: [] });
    expect((await bare.client.setConfigOption("mode", "code")).map((option) => option.current)).toEqual(["code", false]);
    const refusing = setup({ configOptions: CONFIG, refusesSettings: true });
    await refusing.client.newSession({ cwd: "/v", mcpServers: [] });
    expect(await failure(refusing.client.setConfigOption("mode", "code"))).toEqual({ kind: "rpc", code: -32602, message: "That setting cannot be changed now." });
    expect(refusing.client.settings().config!.map((option) => option.current)).toEqual(["ask", false]);
  });
});
