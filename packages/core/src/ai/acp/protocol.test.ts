import { describe, expect, it } from "vitest";
import {
  ACP_FILE_LIMIT,
  ACP_MAX_AUTH_METHODS,
  ACP_MAX_OPTIONS,
  ACP_TITLE_LIMIT,
  AcpError,
  AcpRefusal,
  acpBlockText,
  acpInitializeParams,
  acpLines,
  acpRpcFailure,
  readAcpFileRead,
  readAcpFileWrite,
  readAcpInitialize,
  readAcpMessage,
  readAcpNewSession,
  readAcpPermissionRequest,
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
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false, auth: { terminal: true } },
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
    expect(update({ sessionUpdate: "available_commands_update", availableCommands: [] })).toEqual({ kind: "other", name: "available_commands_update" });
    expect(update({ sessionUpdate: "current_mode_update", currentModeId: "yolo" })).toEqual({ kind: "other", name: "current_mode_update" });
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
