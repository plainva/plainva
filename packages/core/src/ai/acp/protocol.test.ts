import { describe, expect, it } from "vitest";
import {
  ACP_FILE_LIMIT,
  ACP_MAX_AUTH_METHODS,
  ACP_MAX_COMMANDS,
  ACP_MAX_CONFIG_OPTIONS,
  ACP_MAX_OPTIONS,
  ACP_TITLE_LIMIT,
  AcpError,
  AcpRefusal,
  acpBlockText,
  acpInitializeParams,
  acpLines,
  acpRpcFailure,
  readAcpCommands,
  readAcpConfigOptions,
  readAcpFileRead,
  readAcpFileWrite,
  readAcpInitialize,
  readAcpMessage,
  readAcpModes,
  readAcpNewSession,
  readAcpPermissionRequest,
  readAcpSessionSetup,
  readAcpStopReason,
  readAcpUpdate,
} from "./protocol.js";

// Invisible characters, built from their code points so that this file carries none.
const ZERO_WIDTH = String.fromCharCode(0x200b);
const OVERRIDE = String.fromCharCode(0x202e);

const failureOf = (work: () => unknown) => {
  try {
    work();
  } catch (error) {
    if (error instanceof AcpError) return error.failure;
    throw error;
  }
  return null;
};

describe("a message of an agent", () => {
  it("is a request, a notification or a response — and nothing else is one", () => {
    expect(readAcpMessage({ jsonrpc: "2.0", id: 7, method: "fs/read_text_file", params: { path: "/x" } })).toEqual({ kind: "request", id: 7, method: "fs/read_text_file", params: { path: "/x" } });
    expect(readAcpMessage({ jsonrpc: "2.0", id: "a", method: "x" })).toEqual({ kind: "request", id: "a", method: "x", params: {} });
    expect(readAcpMessage({ jsonrpc: "2.0", method: "session/update", params: [1, 2] })).toEqual({ kind: "notification", method: "session/update", params: {} });
    expect(readAcpMessage({ jsonrpc: "2.0", id: 1, result: { sessionId: "s" } })).toEqual({ kind: "response", id: 1, result: { sessionId: "s" } });
    // A result that is no object is an empty one, never a crash.
    expect(readAcpMessage({ jsonrpc: "2.0", id: 1, result: "ok" })).toEqual({ kind: "response", id: 1, result: {} });
    expect(readAcpMessage({ jsonrpc: "2.0", id: 1, result: null })).toEqual({ kind: "response", id: 1, result: {} });
    for (const none of [null, 1, "x", [], {}, { id: 1 }, { method: 5 }, { method: "" }, { method: "m".repeat(101) }]) expect(readAcpMessage(none)).toBeNull();
  });

  it("carries an error whose text is cut and cleaned", () => {
    const read = readAcpMessage({ jsonrpc: "2.0", id: 2, error: { code: -32000, message: `Sign${ZERO_WIDTH} in\nfirst ${"x".repeat(500)}`, data: { secret: "s" } } });
    expect(read?.kind).toBe("response");
    const error = read?.kind === "response" ? read.error : undefined;
    expect(error?.code).toBe(-32000);
    expect(error?.message.startsWith("Sign in first x")).toBe(true);
    expect(error?.message.length).toBeLessThanOrEqual(300);
    expect(error).not.toHaveProperty("data");
    // A code that is no number is none.
    expect(readAcpMessage({ id: 1, error: { code: "x", message: 5 } })).toEqual({ kind: "response", id: 1, error: { code: 0, message: "" } });
  });

  it("names 'sign in first' as what it is", () => {
    expect(acpRpcFailure({ code: -32000, message: "Authentication required" })).toEqual({ kind: "auth" });
    expect(acpRpcFailure({ code: -32603, message: "boom" })).toEqual({ kind: "rpc", code: -32603, message: "boom" });
  });
});

describe("what Plainva tells an agent it offers", () => {
  it("is files through the app, no terminal, and a sign-in that can be shown", () => {
    expect(acpInitializeParams({ name: "plainva", title: "Plainva", version: "1.2.3" })).toEqual({
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false, auth: { terminal: true }, session: { configOptions: { boolean: {} } } },
      clientInfo: { name: "plainva", title: "Plainva", version: "1.2.3" },
    });
  });
});

describe("what an agent says about itself", () => {
  it("is read for display, and its revision decides whether it is talked to", () => {
    const opened = readAcpInitialize({
      protocolVersion: 1,
      agentInfo: { name: `tracker${ZERO_WIDTH}-agent`, title: `Tracker ${OVERRIDE}Agent`, version: "2.0.1" },
      agentCapabilities: { loadSession: true, promptCapabilities: { image: true, audio: "yes", embeddedContext: true } },
      authMethods: [],
    });
    expect(opened).toEqual({ agent: { name: "tracker-agent", title: "Tracker Agent", version: "2.0.1" }, prompt: { image: true, audio: false, embeddedContext: true }, authMethods: [] });
    expect(readAcpInitialize({ protocolVersion: 1 })).toEqual({ agent: null, prompt: { image: false, audio: false, embeddedContext: false }, authMethods: [] });
    expect(failureOf(() => readAcpInitialize({ protocolVersion: 2 }))).toEqual({ kind: "version", offered: 2 });
    expect(failureOf(() => readAcpInitialize({ protocolVersion: "1" }))).toEqual({ kind: "version", offered: null });
    expect(failureOf(() => readAcpInitialize({}))).toEqual({ kind: "version", offered: null });
  });

  it("offers a sign-in the agent does itself, or one in its own program — and no other", () => {
    const methods = readAcpInitialize({
      protocolVersion: 1,
      authMethods: [
        { id: "browser", name: "Sign in with your account", description: "Opens a browser" },
        { id: "explicit", name: "Explicit", type: "agent" },
        { id: "login", name: "Log in from the terminal", type: "terminal", args: ["--login"], env: { AGENT_INTERACTIVE: "1" } },
        // A key in a variable is a secret Plainva would have to hold: not offered.
        { id: "key", name: "API key", type: "env_var", vars: [{ name: "AGENT_KEY" }] },
        // The same id twice is one method.
        { id: "browser", name: "Again" },
        // No id, or one that cannot be shown.
        { name: "Nameless" },
        { id: "bad\nid", name: "Broken" },
        "not a method",
      ],
    }).authMethods;
    expect(methods).toEqual([
      { id: "browser", name: "Sign in with your account", description: "Opens a browser", kind: "agent", args: [], env: {} },
      { id: "explicit", name: "Explicit", description: "", kind: "agent", args: [], env: {} },
      { id: "login", name: "Log in from the terminal", description: "", kind: "terminal", args: ["--login"], env: { AGENT_INTERACTIVE: "1" } },
    ]);
  });

  it("drops a terminal sign-in whose arguments or values could not be shown or would change how a program loads", () => {
    const terminal = (extra: Record<string, unknown>) => readAcpInitialize({ protocolVersion: 1, authMethods: [{ id: "t", name: "T", type: "terminal", ...extra }] }).authMethods;
    expect(terminal({ args: ["login"] })).toHaveLength(1);
    expect(terminal({})).toEqual([{ id: "t", name: "T", description: "", kind: "terminal", args: [], env: {} }]);
    expect(terminal({ args: ["a\nb"] })).toEqual([]);
    expect(terminal({ args: [5] })).toEqual([]);
    expect(terminal({ args: Array.from({ length: 17 }, () => "x") })).toEqual([]);
    expect(terminal({ args: ["x".repeat(1025)] })).toEqual([]);
    expect(terminal({ env: { "BAD NAME": "1" } })).toEqual([]);
    expect(terminal({ env: { "1X": "1" } })).toEqual([]);
    expect(terminal({ env: { OK: "line\nbreak" } })).toEqual([]);
    expect(terminal({ env: { OK: 5 } })).toEqual([]);
    expect(terminal({ env: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`V${i}`, "1"])) })).toEqual([]);
    // A name is one line, and falls back to the id.
    expect(terminal({ name: "" })[0]?.name).toBe("t");
    // Shown to be copied where no terminal opens: an argument reads as what it is — nothing turns text around or shows nothing.
    expect(terminal({ args: ["--login", `a${String.fromCharCode(0x202e)}b`] })).toEqual([]);
    expect(terminal({ args: [`a${String.fromCharCode(0x2066)}b`] })).toEqual([]);
    expect(terminal({ args: [`a${String.fromCharCode(0x200b)}b`] })).toEqual([]);
    // Nor what the app's names may not hold: a control of the second set, a line separator, a no-break space, a private code point.
    for (const code of [0x85, 0x2028, 0xa0, 0xe000]) expect(terminal({ args: [`a${String.fromCharCode(code)}b`] })).toEqual([]);
    // A value stands in the command to copy too: the same rule — and the same value without such a character passes.
    for (const code of [0x202e, 0x2067, 0x200b, 0xa0]) expect(terminal({ env: { AGENT_MODE: `login${String.fromCharCode(code)}now` } })).toEqual([]);
    expect(terminal({ env: { AGENT_MODE: "loginnow" } })).toHaveLength(1);
    // Letters of a script written from right to left are letters.
    expect(terminal({ args: ["--name", "שלום"] })).toHaveLength(1);
  });

  it("reads no more methods than a person can choose from", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, name: `M${i}` }));
    expect(readAcpInitialize({ protocolVersion: 1, authMethods: many }).authMethods).toHaveLength(ACP_MAX_AUTH_METHODS);
  });

  it("names the session it opened, or the answer is none", () => {
    expect(readAcpNewSession({ sessionId: "sess_1", modes: { currentModeId: "ask" } })).toBe("sess_1");
    expect(failureOf(() => readAcpNewSession({}))).toEqual({ kind: "protocol", detail: "no session id" });
    expect(failureOf(() => readAcpNewSession({ sessionId: "" }))).toEqual({ kind: "protocol", detail: "no session id" });
    expect(failureOf(() => readAcpNewSession({ sessionId: "x".repeat(201) }))).toEqual({ kind: "protocol", detail: "no session id" });
  });

  it("ends a turn for one of five reasons, and an unknown one is an end like any other", () => {
    for (const reason of ["end_turn", "max_tokens", "max_turn_requests", "refusal", "cancelled"]) expect(readAcpStopReason({ stopReason: reason })).toBe(reason);
    expect(readAcpStopReason({ stopReason: "tired" })).toBe("end_turn");
    expect(readAcpStopReason({})).toBe("end_turn");
  });
});

describe("what an agent reports", () => {
  const update = (body: Record<string, unknown>) => readAcpUpdate({ sessionId: "s1", update: body })?.update;

  it("is text in one of three voices", () => {
    expect(update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hello" } })).toEqual({ kind: "text", role: "agent", text: "Hello" });
    expect(update({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Hm" } })).toEqual({ kind: "text", role: "thought", text: "Hm" });
    expect(update({ sessionUpdate: "user_message_chunk", content: { type: "text", text: "Hi" } })).toEqual({ kind: "text", role: "user", text: "Hi" });
    // Characters nobody sees do not reach the thread.
    expect(update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: `a${ZERO_WIDTH}b${OVERRIDE}c` } })).toEqual({ kind: "text", role: "agent", text: "abc" });
    // An empty chunk is none.
    expect(readAcpUpdate({ sessionId: "s1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "" } } })).toBeNull();
  });

  it("turns what is not text into a word for it — nothing is fetched or drawn", () => {
    expect(acpBlockText({ type: "image", mimeType: "image/png", data: "AAAA" })).toBe("[image]");
    expect(acpBlockText({ type: "audio", mimeType: "audio/wav", data: "AAAA" })).toBe("[audio]");
    expect(acpBlockText({ type: "resource_link", uri: "file:///vault/a.md", name: "a.md" })).toBe("a.md (file:///vault/a.md)");
    expect(acpBlockText({ type: "resource", resource: { uri: "file:///vault/a.md", text: "the text" } })).toBe("the text");
    expect(acpBlockText({ type: "hologram" })).toBe("");
    expect(acpBlockText("text")).toBe("");
  });

  it("is a tool call: announced, or changed in what it names", () => {
    expect(
      update({
        sessionUpdate: "tool_call",
        toolCallId: "call_1",
        title: "Editing\nplan.md",
        kind: "edit",
        status: "pending",
        locations: [{ path: "/vault/plan.md", line: 12 }, { path: "bad\u0000path" }, { line: 3 }, { path: "/vault/b.md", line: -1 }],
        content: [
          { type: "content", content: { type: "text", text: "Reading" } },
          { type: "diff", path: "/vault/plan.md", oldText: "a\nb", newText: "a\nb\nc" },
          { type: "diff", path: "/vault/new.md", oldText: null, newText: "x" },
          { type: "terminal", terminalId: "t1" },
          { type: "diff", path: "/vault/none.md" },
          { type: "mystery" },
        ],
        rawInput: { secret: "not read" },
      }),
    ).toEqual({
      kind: "tool",
      tool: {
        id: "call_1",
        fresh: true,
        title: "Editing plan.md",
        toolKind: "edit",
        status: "pending",
        locations: [
          { path: "/vault/plan.md", line: 12 },
          { path: "/vault/b.md", line: null },
        ],
        content: [{ type: "text", text: "Reading" }, { type: "diff", path: "/vault/plan.md", oldLines: 2, newLines: 3 }, { type: "diff", path: "/vault/new.md", oldLines: null, newLines: 1 }, { type: "terminal" }],
      },
    });
    // An update names only what changed; a kind or a status Plainva does not know is left out.
    expect(update({ sessionUpdate: "tool_call_update", toolCallId: "call_1", status: "completed", kind: "teleport" })).toEqual({ kind: "tool", tool: { id: "call_1", fresh: false, status: "completed" } });
    expect(readAcpUpdate({ sessionId: "s1", update: { sessionUpdate: "tool_call", title: "No id" } })).toBeNull();
    const long = update({ sessionUpdate: "tool_call", toolCallId: "c", title: "t".repeat(1000) });
    expect(long?.kind === "tool" ? long.tool.title?.length : 0).toBe(ACP_TITLE_LIMIT);
  });

  it("is a plan whose entries have a priority and a state", () => {
    expect(
      update({ sessionUpdate: "plan", entries: [{ content: "Read the note", priority: "high", status: "completed" }, { content: "Write", priority: "urgent", status: "soon" }, { content: "" }, "x"] }),
    ).toEqual({
      kind: "plan",
      entries: [
        { content: "Read the note", priority: "high", status: "completed" },
        { content: "Write", priority: "medium", status: "pending" },
      ],
    });
    expect(update({ sessionUpdate: "plan" })).toEqual({ kind: "plan", entries: [] });
  });

  it("is otherwise something Plainva shows nothing for", () => {
    // Its commands, its modes and its settings are read since plan P9-7; the rest is passed by.
    expect(update({ sessionUpdate: "usage_update", used: 1200, size: 200_000 })).toEqual({ kind: "other", name: "usage_update" });
    expect(update({ sessionUpdate: "session_info_update", title: "Fixing the tests" })).toEqual({ kind: "other", name: "session_info_update" });
    for (const none of [{}, { sessionId: "s1" }, { sessionId: "s1", update: {} }, { sessionId: 5, update: { sessionUpdate: "plan" } }, { update: { sessionUpdate: "plan" } }]) expect(readAcpUpdate(none)).toBeNull();
  });
});

describe("what an agent asks the host for", () => {
  it("is a choice among options of four kinds", () => {
    const request = readAcpPermissionRequest({
      sessionId: "s1",
      toolCall: { toolCallId: "call_2", title: "Delete old.md", kind: "delete" },
      options: [
        { optionId: "yes", name: "Allow", kind: "allow_once" },
        { optionId: "always", name: `Always${ZERO_WIDTH} allow`, kind: "allow_always" },
        { optionId: "no", name: "Reject", kind: "reject_once" },
        { optionId: "never", name: "Never", kind: "reject_always" },
        // A kind Plainva does not know cannot be shown for what it is.
        { optionId: "root", name: "Allow everything forever", kind: "allow_all_sessions" },
        // The same id twice.
        { optionId: "yes", name: "Allow (again)", kind: "allow_once" },
        { name: "No id", kind: "allow_once" },
      ],
    });
    expect(request).toEqual({
      sessionId: "s1",
      tool: { id: "call_2", fresh: false, title: "Delete old.md", toolKind: "delete" },
      options: [
        { id: "yes", name: "Allow", kind: "allow_once" },
        { id: "always", name: "Always allow", kind: "allow_always" },
        { id: "no", name: "Reject", kind: "reject_once" },
        { id: "never", name: "Never", kind: "reject_always" },
      ],
    });
  });

  it("is no question where there is nothing to choose from, or nothing it is about", () => {
    const toolCall = { toolCallId: "c" };
    expect(readAcpPermissionRequest({ sessionId: "s1", toolCall, options: [] })).toBeNull();
    expect(readAcpPermissionRequest({ sessionId: "s1", toolCall, options: [{ optionId: "x", name: "X", kind: "maybe" }] })).toBeNull();
    expect(readAcpPermissionRequest({ sessionId: "s1", toolCall: {}, options: [{ optionId: "x", name: "X", kind: "allow_once" }] })).toBeNull();
    expect(readAcpPermissionRequest({ toolCall, options: [{ optionId: "x", name: "X", kind: "allow_once" }] })).toBeNull();
    const many = Array.from({ length: 30 }, (_, i) => ({ optionId: `o${i}`, name: `O${i}`, kind: "allow_once" }));
    expect(readAcpPermissionRequest({ sessionId: "s1", toolCall, options: many })?.options).toHaveLength(ACP_MAX_OPTIONS);
  });

  it("is a file to read: a session, a path, and which lines", () => {
    expect(readAcpFileRead({ sessionId: "s1", path: "/vault/a.md" })).toEqual({ sessionId: "s1", path: "/vault/a.md", line: null, limit: null });
    expect(readAcpFileRead({ sessionId: "s1", path: "/vault/a.md", line: 10, limit: 50 })).toEqual({ sessionId: "s1", path: "/vault/a.md", line: 10, limit: 50 });
    // A line that is none counts from the beginning.
    expect(readAcpFileRead({ sessionId: "s1", path: "/vault/a.md", line: 0, limit: -3 })).toEqual({ sessionId: "s1", path: "/vault/a.md", line: null, limit: null });
    for (const none of [{}, { sessionId: "s1" }, { path: "/x" }, { sessionId: "s1", path: 5 }, { sessionId: "s1", path: "a\nb" }, { sessionId: "s1", path: "x".repeat(5000) }]) {
      expect(() => readAcpFileRead(none)).toThrow(AcpRefusal);
    }
  });

  it("is a file to write: its whole new text, no longer than a note", () => {
    expect(readAcpFileWrite({ sessionId: "s1", path: "/vault/a.md", content: "text" })).toEqual({ sessionId: "s1", path: "/vault/a.md", content: "text" });
    expect(readAcpFileWrite({ sessionId: "s1", path: "/vault/a.md", content: "" }).content).toBe("");
    expect(() => readAcpFileWrite({ sessionId: "s1", path: "/vault/a.md" })).toThrow(AcpRefusal);
    expect(() => readAcpFileWrite({ sessionId: "s1", path: "/vault/a.md", content: 5 })).toThrow(AcpRefusal);
    expect(() => readAcpFileWrite({ sessionId: "s1", path: "/vault/a.md", content: "x".repeat(ACP_FILE_LIMIT + 1) })).toThrow("too long");
  });

  it("gets the lines it asked for", () => {
    const content = "one\ntwo\nthree\nfour";
    expect(acpLines(content, null, null)).toBe(content);
    expect(acpLines(content, 2, null)).toBe("two\nthree\nfour");
    expect(acpLines(content, 2, 2)).toBe("two\nthree");
    expect(acpLines(content, null, 1)).toBe("one");
    expect(acpLines(content, 9, 5)).toBe("");
  });
});

/** Plan KI-Harness P9-7: what an agent lets the user set, and its commands — a stranger's words, read with care. */
describe("an agent's settings, modes and commands", () => {
  it("reads settings in the agent's order: choices flat or in groups, switches, and leaves out what it cannot show", () => {
    const options = readAcpConfigOptions([
      { id: "mode", name: "Mode", category: "mode", type: "select", currentValue: "ask", options: [{ value: "ask", name: "Ask" }, { value: "code", name: "Code", description: "Edits\u0007 without asking" }] },
      { id: "model", name: "Model", category: "model", currentValue: "b", options: [{ group: "g1", name: "Fast", options: [{ value: "a", name: "A" }] }, { group: "g2", options: [{ value: "b", name: "B" }] }] },
      { id: "think", name: "Think", category: "thought_level", type: "boolean", currentValue: true },
      { id: "x", name: "Custom", category: "_vendor", type: "select", currentValue: "1", options: [{ value: "1" }] },
      // Not a kind Plainva knows (even with values it could list and a current one among them), a current value it does
      // not list, no id, a second "mode": all left out.
      { id: "n", name: "Number", type: "number", currentValue: "3", options: [{ value: "3", name: "Three" }] },
      { id: "lost", name: "Lost", type: "select", currentValue: "gone", options: [{ value: "here", name: "Here" }] },
      { name: "No id", currentValue: "a", options: [{ value: "a" }] },
      { id: "mode", name: "Again", currentValue: "x", options: [{ value: "x" }] },
      "nonsense",
    ])!;
    expect(options.map((option) => [option.id, option.category, option.type, option.current])).toEqual([
      ["mode", "mode", "select", "ask"],
      ["model", "model", "select", "b"],
      ["think", "thought_level", "boolean", true],
      ["x", "other", "select", "1"],
    ]);
    const [mode, model, , custom] = options;
    // The agent's own words, cleaned of what nobody sees, in one line.
    expect(mode!.type === "select" && mode!.values[1]).toEqual({ value: "code", name: "Code", description: "Edits without asking" });
    expect(model!.type === "select" && model!.values).toEqual([
      { value: "a", name: "A", description: "", group: "Fast" },
      { value: "b", name: "B", description: "", group: "g2" },
    ]);
    // A value without a name is shown by its value.
    expect(custom!.type === "select" && custom!.values[0]!.name).toBe("1");
    expect(readAcpConfigOptions(undefined)).toBeNull();
    expect(readAcpConfigOptions([])).toEqual([]);
    // Too many: the first ones, in the agent's order.
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `o${i}`, name: `O${i}`, type: "boolean", currentValue: false }));
    expect(readAcpConfigOptions(many)!.map((option) => option.id)).toEqual(many.slice(0, ACP_MAX_CONFIG_OPTIONS).map((option) => option.id));
  });

  it("reads the older modes, and takes settings alone where an agent sends both", () => {
    const modes = { currentModeId: "ask", availableModes: [{ id: "ask", name: "Ask" }, { id: "plan", name: "Plan", description: "Only plans" }, { id: "ask" }] };
    expect(readAcpModes(modes)).toEqual({ current: "ask", available: [{ id: "ask", name: "Ask", description: "" }, { id: "plan", name: "Plan", description: "Only plans" }] });
    expect(readAcpModes({ currentModeId: "gone", availableModes: modes.availableModes })).toBeNull();
    expect(readAcpModes(null)).toBeNull();
    expect(readAcpSessionSetup({ sessionId: "s1", modes })).toEqual({ sessionId: "s1", config: null, modes: readAcpModes(modes) });
    expect(readAcpSessionSetup({ sessionId: "s1", modes, configOptions: [] })).toEqual({ sessionId: "s1", config: [], modes: null });
  });

  it("shows a name without what a person cannot see, falls back to the id only cleaned, and leaves out what shows nothing", () => {
    const hidden = String.fromCharCode(0xe000) + String.fromCharCode(0x3164) + String.fromCharCode(0xd800);
    const options = readAcpConfigOptions([
      { id: "mode", name: `Mo${hidden}de`, currentValue: "a", options: [{ value: "a", name: `A${String.fromCharCode(0x2028)}B` }, { value: `b${String.fromCharCode(0x0085)}c` }] },
      { id: String.fromCharCode(0x200b), currentValue: "x", options: [{ value: "x", name: "X" }] },
    ])!;
    expect(options.map((option) => option.name)).toEqual(["Mode"]);
    const [mode] = options;
    expect(mode!.type === "select" && mode!.values.map((value) => value.name)).toEqual(["A B", "b c"]);
    expect(readAcpModes({ currentModeId: "a", availableModes: [{ id: "a", name: hidden }] })).toEqual({ current: "a", available: [{ id: "a", name: "a", description: "" }] });
  });

  it("keeps the current value of a long list, past the values it shows", () => {
    const many = Array.from({ length: 150 }, (_, i) => ({ value: `v${i}`, name: `V${i}` }));
    const [long] = readAcpConfigOptions([{ id: "model", name: "Model", currentValue: "v140", options: many }])!;
    expect(long!.type === "select" && long!.values.length).toBe(101);
    expect(long!.type === "select" && long!.values[100]).toEqual({ value: "v140", name: "V140", description: "" });
  });

  it("reads commands by names a message can begin with, the whole list each time", () => {
    expect(
      readAcpCommands([
        { name: "web", description: "Search the web", input: { hint: "what to search for" } },
        { name: "/plan", description: "Make a plan" },
        { name: "project:fix-tests", description: "Fix them" },
        { name: "two words", description: "No" },
        { name: "", description: "No" },
        { name: "web", description: "Twice" },
        { name: "x\u0000y", description: "No" },
        { description: "No name" },
        // Names in any script are names; a symbol, a direction mark or an invisible character is not part of one.
        { name: "übersetzen", description: "Translate" },
        { name: "要約", description: "Summarize" },
        { name: "plan✓", description: "No" },
        { name: "a\u202Eb", description: "No" },
        { name: "a\u200Bb", description: "No" },
        // An ignorable letter or mark shows nothing: a Hangul filler alone or after a name, a variation selector.
        { name: "\u3164", description: "No" },
        { name: "plan\u3164", description: "No" },
        { name: "plan\uFE0F", description: "No" },
        // Four marks in a row, on a letter none of them composes with in NFC.
        { name: "x\u0301\u0302\u0303\u0304", description: "No" },
        // Read in NFC: the decomposed spelling of a name already listed is that name.
        { name: "u\u0308bersetzen", description: "Twice" },
      ]),
    ).toEqual([
      { name: "web", description: "Search the web", hint: "what to search for" },
      { name: "plan", description: "Make a plan", hint: null },
      { name: "project:fix-tests", description: "Fix them", hint: null },
      { name: "übersetzen", description: "Translate", hint: null },
      { name: "要約", description: "Summarize", hint: null },
    ]);
    expect(readAcpCommands("nonsense")).toEqual([]);
    // A name is kept as the agent spells it — that is the name it recognises —, and its other spelling is the same command.
    const spelled = "re\u0301sume\u0301";
    expect(readAcpCommands([{ name: spelled, description: "As spelled" }, { name: spelled.normalize("NFC"), description: "Twice" }])).toEqual([{ name: spelled, description: "As spelled", hint: null }]);
    expect(readAcpCommands(Array.from({ length: 80 }, (_, i) => ({ name: `c${i}`, description: "" })))).toHaveLength(ACP_MAX_COMMANDS);
  });

  it("reads the reports of a setting, a mode and the commands, instead of passing them by", () => {
    const options = [{ id: "mode", name: "Mode", category: "mode", currentValue: "code", options: [{ value: "code", name: "Code" }] }];
    expect(readAcpUpdate({ sessionId: "s1", update: { sessionUpdate: "config_option_update", configOptions: options } })).toEqual({ sessionId: "s1", update: { kind: "config", options: readAcpConfigOptions(options) } });
    expect(readAcpUpdate({ sessionId: "s1", update: { sessionUpdate: "current_mode_update", currentModeId: "plan" } })).toEqual({ sessionId: "s1", update: { kind: "mode", current: "plan" } });
    expect(readAcpUpdate({ sessionId: "s1", update: { sessionUpdate: "available_commands_update", availableCommands: [{ name: "web", description: "Search" }] } })).toEqual({
      sessionId: "s1",
      update: { kind: "commands", commands: [{ name: "web", description: "Search", hint: null }] },
    });
    // A report without its list says nothing.
    expect(readAcpUpdate({ sessionId: "s1", update: { sessionUpdate: "config_option_update" } })).toBeNull();
    expect(readAcpUpdate({ sessionId: "s1", update: { sessionUpdate: "available_commands_update" } })).toBeNull();
    expect(readAcpUpdate({ sessionId: "s1", update: { sessionUpdate: "current_mode_update" } })).toBeNull();
  });

  it("tells the agent that a switch can be shown as one", () => {
    expect(acpInitializeParams({ name: "plainva", title: "Plainva", version: "1" }).clientCapabilities).toEqual({
      fs: { readTextFile: true, writeTextFile: true },
      terminal: false,
      auth: { terminal: true },
      session: { configOptions: { boolean: {} } },
    });
  });
});
