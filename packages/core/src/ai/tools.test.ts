import { describe, expect, it } from "vitest";
import {
  calledToolName,
  coreTools,
  dispatchedArgs,
  findTools,
  findToolsText,
  MAIL_TOOL_NAMES,
  META_TOOL_NAMES,
  parseToolInput,
  PLAN_TOOL_NAMES,
  PROPOSAL_TOOL_NAMES,
  TOOL_DESCRIPTION_LIMIT,
  TOOL_MANIFESTS,
  TOOL_NAME_PATTERN,
  toolByName,
  toolInputJsonSchema,
  toolsFor,
  WEB_TOOL_NAMES,
  WRITE_TOOL_NAMES,
} from "./tools.js";
import { isEffectTool, ruleOfTwo, runTraits } from "./ruleOfTwo.js";

describe("tool manifests", () => {
  it("every name reaches every provider and is unique", () => {
    const names = TOOL_MANIFESTS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name, name).toMatch(TOOL_NAME_PATTERN);
  });

  it("descriptions describe, within the limit, and never instruct about other rules", () => {
    for (const tool of TOOL_MANIFESTS) {
      expect(tool.description.length, tool.name).toBeLessThanOrEqual(TOOL_DESCRIPTION_LIMIT);
      expect(tool.description, tool.name).not.toMatch(/ignore|disregard|system prompt|always call/i);
    }
  });

  it("a conversation loads the tools an answer about the vault usually needs, and the two that reach the rest", () => {
    expect(coreTools().map((t) => t.name)).toEqual([
      "search_vault",
      "read_note",
      "get_outline",
      "query_base",
      "get_tasks",
      "run_command",
      "find_tools",
      "call_tool",
      "get_backlinks",
      "graph_neighborhood",
      "get_calendar",
      "get_event",
      "get_recent",
    ]);
    // Mail is never loaded on its own: it is found, and its first call asks.
    for (const name of MAIL_TOOL_NAMES) expect(toolByName(name), name).toMatchObject({ core: false, risk: "read", untrustedResult: true, dataClasses: ["mail"], surfaces: ["harness"] });
    expect(META_TOOL_NAMES).toEqual(["find_tools", "call_tool"]);
  });

  it("the MCP surface is small and read-only", () => {
    const mcp = toolsFor("mcp");
    expect(mcp.map((t) => t.name).sort()).toEqual(["get_backlinks", "get_outline", "get_recent", "get_tasks", "open_in_app", "query_base", "read_note", "search_vault"]);
    for (const tool of mcp) expect(["read", "ui"], tool.name).toContain(tool.risk);
  });

  it("no tool reads secrets or runs a shell, and the only ones that write are the proposals and the plans", () => {
    for (const tool of TOOL_MANIFESTS) {
      const expected = PROPOSAL_TOOL_NAMES.includes(tool.name) ? "write" : PLAN_TOOL_NAMES.includes(tool.name) ? "critical" : null;
      if (expected) expect(tool.risk, tool.name).toBe(expected);
      else expect(["read", "ui"], `${tool.name} is ${tool.risk}`).toContain(tool.risk);
      expect(tool.name).not.toMatch(/keychain|secret|shell|exec|sql/);
    }
    // Nothing acts outside the vault on its own, and nothing runs a script.
    expect(TOOL_MANIFESTS.filter((tool) => tool.risk === "external" || tool.risk === "script")).toEqual([]);
  });

  it("a writing tool is found, never loaded, answers in Plainva's own words and stays off the MCP surface", () => {
    expect(WRITE_TOOL_NAMES).toEqual([...PROPOSAL_TOOL_NAMES, ...PLAN_TOOL_NAMES]);
    for (const name of WRITE_TOOL_NAMES) {
      expect(toolByName(name), name).toMatchObject({ core: false, untrustedResult: false, dataClasses: [], surfaces: ["harness"], native: null });
      expect(isEffectTool(toolByName(name)!), name).toBe(true);
    }
    expect(TOOL_MANIFESTS.filter((tool) => tool.risk === "write" || tool.risk === "critical").map((tool) => tool.name)).toEqual([...WRITE_TOOL_NAMES]);
    // Found by what the user asks for.
    const pool = WRITE_TOOL_NAMES.map((name) => toolByName(name)!);
    expect(findTools("change the text of a note", pool)[0]?.name).toBe("propose_edit");
    expect(findTools("set a property value", pool)[0]?.name).toBe("set_property");
    expect(findTools("new task", pool)[0]?.name).toBe("create_task");
    expect(findTools("rename", pool)[0]?.name).toBe("rename_note");
    expect(findTools("delete this note", pool)[0]?.name).toBe("delete_note");
  });

  it("a writing tool takes what its form says and nothing else", () => {
    const edit = toolByName("propose_edit")!;
    expect(parseToolInput(edit, { path: "Projects/Offer.md", edits: [{ find: "in May", replace: "in June" }] }).ok).toBe(true);
    expect(parseToolInput(edit, { path: "Projects/Offer.md", append: "One more line.", section: "Costs" }).ok).toBe(true);
    expect(parseToolInput(edit, { path: "Projects/Offer.md", edits: [{ find: "", replace: "x" }] }).ok).toBe(false);
    expect(parseToolInput(edit, { edits: [] }).ok).toBe(false);
    const property = toolByName("set_property")!;
    for (const value of ["done", 3, false, ["a", 1], null]) expect(parseToolInput(property, { path: "a.md", key: "status", value }).ok, JSON.stringify(value)).toBe(true);
    expect(parseToolInput(property, { path: "a.md", key: "status", value: { nested: true } }).ok).toBe(false);
    expect(parseToolInput(property, { path: "a.md", key: "status" }).ok).toBe(false);
    expect(parseToolInput(toolByName("create_entry")!, { base: "Costs.base", title: "Tiles", properties: { amount: 4500, tags: ["roof"] } }).ok).toBe(true);
    expect(parseToolInput(toolByName("create_task")!, { text: "" }).ok).toBe(false);
    expect(parseToolInput(toolByName("rename_note")!, { path: "a.md", title: "" }).ok).toBe(false);
    expect(parseToolInput(toolByName("move_note")!, { path: "a.md", folder: "" }).ok).toBe(true);
  });

  it("results with vault or third-party content are marked untrusted", () => {
    for (const name of ["search_vault", "read_note", "get_outline", "query_base", "get_tasks", "get_backlinks", "get_calendar", "get_event", "get_recent", "search_mail", "read_mail"]) {
      expect(toolByName(name)?.untrustedResult, name).toBe(true);
    }
  });

  it("produces a JSON schema per input, with limits and defaults", () => {
    const schema = toolInputJsonSchema(toolByName("search_vault")!);
    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(["query"]);
    expect((schema.properties as Record<string, { maximum?: number }>).limit?.maximum).toBe(25);
    expect(schema).not.toHaveProperty("$schema");
    for (const tool of TOOL_MANIFESTS) expect(toolInputJsonSchema(tool).type, tool.name).toBe("object");
  });

  it("validates arguments and fills defaults", () => {
    expect(parseToolInput(toolByName("search_vault")!, { query: "offer" })).toEqual({ ok: true, value: { query: "offer", limit: 10 } });
    const bad = parseToolInput(toolByName("search_vault")!, { query: "", limit: 500 });
    expect(bad.ok).toBe(false);
    expect(parseToolInput(toolByName("get_calendar")!, { from: "2026-09-01", to: "tomorrow" }).ok).toBe(false);
  });

  it("finds further tools by what they do, among the tools it is given", () => {
    const pool = MAIL_TOOL_NAMES.map((name) => toolByName(name)!);
    expect(findTools("read a message from the mail", pool).map((t) => t.name)).toEqual(["read_mail", "search_mail"]);
    expect(findTools("newest messages of a folder", pool)[0]?.name).toBe("search_mail");
    expect(findTools("xx", pool)).toEqual([]);
    // Nothing outside the pool is ever found, whatever the words.
    expect(findTools("backlinks calendar web page", pool)).toEqual([]);
    expect(findTools("mail", [])).toEqual([]);
  });

  it("the tool search answers with what a call needs: the name, what it does, the arguments", () => {
    const pool = MAIL_TOOL_NAMES.map((name) => toolByName(name)!);
    const commands = [
      { id: "open-graph", label: "Open the graph view" },
      { id: "open-note", label: "Open a note or a database; args: { path }" },
    ];
    const mail = findToolsText("mail", pool, commands);
    expect(mail).toContain("- search_mail — ");
    expect(mail).toContain("- read_mail — ");
    expect(mail).toContain('"required":["message","question"]');
    expect(mail).toContain("call one through call_tool");
    expect(mail).not.toContain("open-graph");

    const graph = findToolsText("show the graph", pool, commands);
    expect(graph).toContain("- open-graph — Open the graph view");
    expect(graph).toContain("through run_command");
    expect(graph).not.toContain("search_mail");

    // "commands" lists them all; a query in another language lists everything rather than nothing.
    expect(findToolsText("commands", pool, commands)).toContain("- open-note — ");
    const other = findToolsText("Postfach", pool, commands);
    expect(other).toContain("Nothing matches");
    expect(other).toContain("- search_mail — ");
    expect(other).toContain("- open-graph — ");
    expect(findToolsText("anything", [], [])).toBe("There are no further tools and no app commands in this conversation.");
  });

  it("a dispatched call is known by the tool it names", () => {
    expect(calledToolName({ name: "call_tool", args: { name: "search_mail", args: { query: "offer" } } })).toBe("search_mail");
    expect(calledToolName({ name: "search_vault", args: { query: "x" } })).toBe("search_vault");
    // A name that is none stays the dispatcher's: nothing made up is shown as a tool.
    expect(calledToolName({ name: "call_tool", args: { name: "Search Mail!" } })).toBe("call_tool");
    expect(calledToolName({ name: "call_tool", args: null })).toBe("call_tool");
    expect(dispatchedArgs({ name: "x", args: { a: 1 } })).toEqual({ a: 1 });
    expect(dispatchedArgs({ name: "x", args: '{"a":1}' })).toEqual({ a: 1 });
    expect(dispatchedArgs({ name: "x" })).toEqual({});
    // Text that is no JSON goes on as it is, and fails the tool's own validation.
    expect(dispatchedArgs({ name: "x", args: "a=1" })).toBe("a=1");
  });
});

describe("rule of two", () => {
  const read = TOOL_MANIFESTS.filter((t) => t.risk === "read" && !t.outward);

  it("reading the web changes nothing, but its call is a way out: with vault content, all three", () => {
    const web = TOOL_MANIFESTS.filter((t) => t.outward);
    // Exactly the web tools, harness only: Plainva's MCP server is no proxy onto the internet.
    expect(web.map((t) => t.name)).toEqual([...WEB_TOOL_NAMES]);
    expect(web.every((t) => t.risk === "read" && t.untrustedResult && !t.core && t.dataClasses.includes("web") && t.surfaces.join() === "harness")).toBe(true);
    expect(web.every(isEffectTool)).toBe(true);
    expect(read.some(isEffectTool)).toBe(false);
    const verdict = ruleOfTwo(runTraits([...read, ...web], { privateContext: true, untrustedContext: true }));
    expect(verdict).toEqual({ allThree: true, approvalPerEffect: true, unattendedAllowed: false });
    // On their own, with nothing private in reach: untrusted text and a way out — two of three.
    expect(ruleOfTwo(runTraits(web, { privateContext: false, untrustedContext: false }))).toEqual({ allThree: false, approvalPerEffect: false, unattendedAllowed: true });
  });

  it("reading the vault is untrusted and private, but changes nothing", () => {
    const traits = runTraits(read, { privateContext: true, untrustedContext: true });
    expect(traits).toEqual({ untrustedInput: true, privateData: true, stateOrOutward: false });
    expect(ruleOfTwo(traits)).toEqual({ allThree: false, approvalPerEffect: false, unattendedAllowed: true });
  });

  it("a writing tool on vault content has all three: approval per effect, never a routine", () => {
    const writer = { ...read[0]!, name: "propose_edit", risk: "write" as const };
    const verdict = ruleOfTwo(runTraits([...read, writer], { privateContext: true, untrustedContext: true }));
    expect(verdict).toEqual({ allThree: true, approvalPerEffect: true, unattendedAllowed: false });
  });

  it("navigation is not a state change", () => {
    const traits = runTraits(TOOL_MANIFESTS.filter((t) => t.risk === "ui"), { privateContext: true, untrustedContext: true });
    expect(traits.stateOrOutward).toBe(false);
  });
});
