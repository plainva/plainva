import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, it, expect, vi } from "vitest";
import { buildAppCommands, COMMAND_GROUPS, commandInventory, filterCommands, type CommandDeps } from "@plainva/ui";

const inventory = commandInventory();

/**
 * Every dep the registry reads, each a spy. Derived rather than written out:
 * the hand-kept fixture this replaces was seven handlers short by the time the
 * registry had 47 commands, and nothing noticed. The three gates get the
 * answers that make every command visible.
 */
function deps(overrides: Partial<CommandDeps> = {}): CommandDeps {
  return {
    ...(Object.fromEntries(inventory.deps.map((k) => [k, vi.fn()])) as CommandDeps),
    activePath: () => "Notes/A.md",
    hasActiveNote: () => true,
    themeTogglePinned: () => false,
    ...overrides,
  };
}

describe("commandRegistry", () => {
  it("builds unique command ids and runs the injected handlers", () => {
    const d = deps();
    const cmds = buildAppCommands(d);
    expect(new Set(cmds.map((c) => c.id)).size).toBe(cmds.length);
    cmds.find((c) => c.id === "new-note")!.run();
    expect(d.newItem).toHaveBeenCalledWith("file");
    cmds.find((c) => c.id === "version-history")!.run();
    expect(d.showVersionHistory).toHaveBeenCalledWith("Notes/A.md");
  });

  it("hides unavailable commands (no active file, pinned theme, no printable doc)", () => {
    const cmds = buildAppCommands(deps({ activePath: () => null, themeTogglePinned: () => true, hasActiveNote: () => false }));
    const visible = filterCommands(cmds, "", (c) => c.titleDefault);
    const ids = visible.map((c) => c.id);
    expect(ids).not.toContain("version-history");
    expect(ids).not.toContain("toggle-theme");
    expect(ids).not.toContain("print");
    expect(ids).toContain("new-note");
  });

  it("offers print for a markdown document and runs the injected handler (P3.10)", () => {
    const d = deps();
    const cmds = buildAppCommands(d);
    const visible = filterCommands(cmds, "", (c) => c.titleDefault);
    expect(visible.map((c) => c.id)).toContain("print");
    cmds.find((c) => c.id === "print")!.run();
    expect(d.printActive).toHaveBeenCalled();
  });

  it("offers export + template commands and gates the note-scoped ones on hasActiveNote (issue #6)", () => {
    const d = deps();
    const cmds = buildAppCommands(d);
    cmds.find((c) => c.id === "export-markdown")!.run();
    expect(d.exportActiveMarkdown).toHaveBeenCalled();
    cmds.find((c) => c.id === "template-new")!.run();
    expect(d.createTemplate).toHaveBeenCalled();
    cmds.find((c) => c.id === "template-from-note")!.run();
    expect(d.saveActiveAsTemplate).toHaveBeenCalled();

    const noDoc = filterCommands(buildAppCommands(deps({ hasActiveNote: () => false })), "", (c) => c.titleDefault);
    const ids = noDoc.map((c) => c.id);
    expect(ids).not.toContain("export-markdown");
    expect(ids).not.toContain("template-from-note");
    // Creating a fresh template needs no active note — it stays available.
    expect(ids).toContain("template-new");
  });

  it("filters by localized title, case-insensitive", () => {
    const cmds = buildAppCommands(deps());
    // "tages" alone also finds the skill "Tagesorientierung" (plan KI-Harness P1.5).
    const hits = filterCommands(cmds, "TAGESEIN", (c) => c.titleDefault);
    expect(hits.map((c) => c.id)).toEqual(["daily-note"]);
    expect(filterCommands(cmds, "XYZ-nope", (c) => c.titleDefault)).toEqual([]);
  });
});

/**
 * The keys of the object literal a shell hands to `callee(...)`: the deps it
 * really wires. Read with the TypeScript parser, not a pattern. The handlers
 * are multi-line closures full of braces, strings and comments, and a guard
 * that miscounted them would pass or fail for the wrong reason.
 *
 * Whatever it cannot vouch for is a finding, never a pass: no call or a second
 * one, an argument that is not an object literal, a spread (its keys are
 * invisible from here), a computed key, a key set to `undefined` outright. A
 * value that is undefined only at runtime — no vault open, no calendar
 * service — is a deliberate gate and counts as wired.
 */
function wiredKeys(source: string, callee: string): { keys: string[]; problems: string[] } {
  const tree = ts.createSourceFile("shell.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === callee) calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  if (calls.length !== 1) return { keys: [], problems: [`expected one ${callee}(...) call, found ${calls.length}`] };
  const [arg] = calls[0].arguments;
  if (!arg || !ts.isObjectLiteralExpression(arg)) {
    return { keys: [], problems: [`${callee}(...) must be handed an object literal, so its keys can be read`] };
  }
  const keys: string[] = [];
  const problems: string[] = [];
  for (const p of arg.properties) {
    if (ts.isSpreadAssignment(p)) {
      problems.push(`a spread (...${p.expression.getText(tree)}) hides its keys`);
      continue;
    }
    const name = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null;
    if (name === null) {
      problems.push(`a computed key (${p.name.getText(tree)}) cannot be read`);
    } else if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.initializer) && p.initializer.text === "undefined") {
      problems.push(`${name} is set to undefined`);
    } else {
      keys.push(name);
    }
  }
  return { keys, problems };
}

/**
 * Since S15 a command exists only where its handler does — that is what lets
 * the phone offer a subset honestly instead of showing dead entries. The risk
 * that buys is the opposite one: a desktop dep quietly renamed or dropped, or
 * a command added to the registry and never wired, and the palette shrinking
 * without a word.
 *
 * So this reads what AppShell.tsx REALLY hands to buildAppCommands and holds
 * it against what the registry reads. Until 2026-09-24 it compared a hand-kept
 * fixture with a hard-coded 40 instead: the registry had grown to 47, the
 * fixture was seven handlers short, and the two numbers still agreed.
 */
describe("the desktop offers every command (S15 drift guard)", () => {
  const wiring = wiredKeys(readFileSync(fileURLToPath(new URL("../AppShell.tsx", import.meta.url)), "utf8"), "buildAppCommands");

  it("reads the palette's wiring in AppShell.tsx", () => {
    expect(wiring.problems).toEqual([]);
  });

  it("wires every dep the registry reads, and none it does not", () => {
    expect(inventory.deps.filter((k) => !wiring.keys.includes(k)), "read by the registry, not wired in AppShell.tsx").toEqual([]);
    expect(wiring.keys.filter((k) => !inventory.deps.includes(k)), "wired in AppShell.tsx, read by no command").toEqual([]);
  });

  it("so the palette builds each command the registry knows", () => {
    const wired = Object.fromEntries(wiring.keys.map((k) => [k, vi.fn()])) as CommandDeps;
    const offered = new Set(buildAppCommands(wired).map((c) => c.id));
    expect(inventory.commands.map((c) => c.id).filter((id) => !offered.has(id))).toEqual([]);
  });

  it("drops exactly the command whose handler is missing", () => {
    const withoutGraph = buildAppCommands({ ...deps(), openGraph: undefined });
    expect(withoutGraph.some((c) => c.id === "open-graph")).toBe(false);
    // and nothing else
    expect(withoutGraph.length).toBe(buildAppCommands(deps()).length - 1);
  });

  it("gives every command a group, an icon and an id of its own", () => {
    const ids = inventory.commands.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of inventory.commands) {
      expect(COMMAND_GROUPS, `${c.id} has an unknown group`).toContain(c.group);
      expect(typeof c.icon, `${c.id} has no icon`).not.toBe("undefined");
    }
  });
});

/** A guard that only ever sees a valid shell says nothing about what it would catch. */
describe("the drift guard itself catches", () => {
  it("the gates the registry only reads lazily", () => {
    for (const gate of ["activePath", "hasActiveNote", "themeTogglePinned"]) expect(inventory.deps).toContain(gate);
  });

  it("a dep the shell leaves out", () => {
    const { keys } = wiredKeys("buildAppCommands({ openGraph: () => go(), split });", "buildAppCommands");
    expect(keys).toEqual(["openGraph", "split"]);
    expect(inventory.deps.filter((k) => !keys.includes(k))).toContain("openTasks");
  });

  it("nothing in a comment or a string", () => {
    const source = 'buildAppCommands({ /* openTasks: go */ openGraph: () => go("openMail: x") });';
    expect(wiredKeys(source, "buildAppCommands").keys).toEqual(["openGraph"]);
  });

  it.each([
    ["no call at all", "const commands = [];", /found 0/],
    ["a second call", "buildAppCommands({}); buildAppCommands({});", /found 2/],
    ["deps handed over as a variable", "buildAppCommands(deps);", /object literal/],
    ["a spread", "buildAppCommands({ ...base, openGraph });", /spread/],
    ["a computed key", "buildAppCommands({ [name]: go });", /computed key/],
    ["a key set to undefined", "buildAppCommands({ openGraph: undefined });", /set to undefined/],
  ])("%s", (_name, source, expected) => {
    expect(wiredKeys(source, "buildAppCommands").problems.join(" | ")).toMatch(expected);
  });

  it("but counts a gate that is undefined only at runtime as wired", () => {
    const source = "buildAppCommands({ openCommsWindow: vaultPath ? open : undefined });";
    expect(wiredKeys(source, "buildAppCommands")).toEqual({ keys: ["openCommsWindow"], problems: [] });
  });
});
