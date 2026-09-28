import { describe, expect, it } from "vitest";
import { coreTools, findTools, parseToolInput, TOOL_DESCRIPTION_LIMIT, TOOL_MANIFESTS, TOOL_NAME_PATTERN, toolByName, toolInputJsonSchema, toolsFor } from "./tools.js";
import { ruleOfTwo, runTraits } from "./ruleOfTwo.js";

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

  it("the harness always loads exactly the six core tools", () => {
    expect(coreTools().map((t) => t.name)).toEqual(["search_vault", "read_note", "get_outline", "query_base", "get_tasks", "run_command"]);
  });

  it("the MCP surface is small and read-only", () => {
    const mcp = toolsFor("mcp");
    expect(mcp.map((t) => t.name).sort()).toEqual(["get_backlinks", "get_outline", "get_recent", "get_tasks", "open_in_app", "query_base", "read_note", "search_vault"]);
    for (const tool of mcp) expect(["read", "ui"], tool.name).toContain(tool.risk);
  });

  it("no tool reads secrets, runs a shell or writes outside the proposal path yet", () => {
    for (const tool of TOOL_MANIFESTS) {
      expect(["read", "ui"], `${tool.name} is ${tool.risk}`).toContain(tool.risk);
      expect(tool.name).not.toMatch(/keychain|secret|shell|exec|sql/);
    }
  });

  it("results with vault or third-party content are marked untrusted", () => {
    for (const name of ["search_vault", "read_note", "get_outline", "query_base", "get_tasks", "get_backlinks", "get_calendar", "get_recent"]) {
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

  it("finds further tools by what they do", () => {
    expect(findTools("backlinks to this note").map((t) => t.name)).toContain("get_backlinks");
    expect(findTools("calendar appointments").map((t) => t.name)[0]).toBe("get_calendar");
    expect(findTools("xx")).toEqual([]);
    expect(findTools("search").every((t) => !t.core)).toBe(true);
  });
});

describe("rule of two", () => {
  const read = TOOL_MANIFESTS.filter((t) => t.risk === "read");

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
