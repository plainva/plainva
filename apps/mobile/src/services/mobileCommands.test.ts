import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { COMMAND_GROUPS, PARITY_FEATURES, commandInventory, type ParityFeatureDef } from "@plainva/ui";
import { MOBILE_ABSENT_COMMANDS, buildMobileCommands, type MobileCommandHost } from "./mobileCommands";
import { takeNoteCommand, type NoteCommand } from "./noteCommands";

function host(over: Partial<MobileCommandHost> = {}): MobileCommandHost {
  return {
    newNote: vi.fn(),
    newFromTemplate: vi.fn(),
    newFolder: vi.fn(),
    newDatabase: vi.fn(),
    openDaily: vi.fn(),
    openSearch: vi.fn(),
    openFindReplace: vi.fn(),
    openGraph: vi.fn(),
    openTasks: vi.fn(),
    openCalendar: vi.fn(),
    openMail: vi.fn(),
    openSettings: vi.fn(),
    switchVault: vi.fn(),
    refreshVault: vi.fn(),
    activeNote: () => "Notes/A.md",
    renameActive: vi.fn(),
    toggleReadEdit: vi.fn(),
    exportActive: vi.fn(),
    ...over,
  };
}

describe("mobile commands", () => {
  it("offers only what the phone can serve", () => {
    const ids = buildMobileCommands(host()).map((c) => c.id);
    // Present: the phone has these surfaces.
    for (const id of ["new-note", "daily-note", "open-graph", "open-mail", "open-settings"]) {
      expect(ids, `${id} should be offered`).toContain(id);
    }
    // Absent by construction, not by a filter someone can forget to update.
    for (const id of ["split-vertical", "toggle-left-sidebar", "close-tab", "print", "focus-mode"]) {
      expect(ids, `${id} has no mobile surface and must not appear`).not.toContain(id);
    }
  });

  it("routes the create kinds to the phone's own actions", () => {
    const h = host();
    const cmds = buildMobileCommands(h);
    cmds.find((c) => c.id === "new-folder")!.run();
    cmds.find((c) => c.id === "new-base")!.run();
    cmds.find((c) => c.id === "new-note-from-template")!.run();
    cmds.find((c) => c.id === "new-note")!.run();
    expect(h.newFolder).toHaveBeenCalledOnce();
    expect(h.newDatabase).toHaveBeenCalledOnce();
    expect(h.newFromTemplate).toHaveBeenCalledOnce();
    expect(h.newNote).toHaveBeenCalledOnce();
  });

  it("offers the journal's two commands where the shell serves them (plan Journal, J4/J5)", () => {
    const h = host({ newJournalEntry: vi.fn(), openJournal: vi.fn() });
    const cmds = buildMobileCommands(h);
    cmds.find((c) => c.id === "journal-entry")!.run();
    cmds.find((c) => c.id === "open-journal")!.run();
    expect(h.newJournalEntry).toHaveBeenCalledOnce();
    expect(h.openJournal).toHaveBeenCalledOnce();
    // A host without them offers neither — a command that does nothing is worse than none.
    const ids = buildMobileCommands(host()).map((c) => c.id);
    expect(ids).not.toContain("journal-entry");
    expect(ids).not.toContain("open-journal");
  });

  it("hides the note commands while nothing is open", () => {
    const cmds = buildMobileCommands(host({ activeNote: () => null }));
    const rename = cmds.find((c) => c.id === "rename-active")!;
    const share = cmds.find((c) => c.id === "export-markdown")!;
    expect(rename.isAvailable?.()).toBe(false);
    expect(share.isAvailable?.()).toBe(false);
  });

  /**
   * The twelve the palette gained when the gap `palette-command-reach` closed
   * (2026-10-06): six the shell serves, six the open note carries out.
   */
  const VAULT_REACH: Array<[string, keyof MobileCommandHost]> = [
    ["template-new", "newTemplate"],
    ["open-comments", "openComments"],
    ["import-pkm", "openImport"],
    ["backup-now", "backupNow"],
    ["rebuild-index", "rebuildIndex"],
    ["update-indexes", "updateIndexes"],
  ];
  const NOTE_REACH: Array<[string, NoteCommand]> = [
    ["version-history", "history"],
    ["insert-template", "insert-template"],
    ["template-from-note", "save-as-template"],
    ["toggle-source", "toggle-source"],
    ["mail-mailto", "mailto"],
    ["mail-draft", "compose-mail"],
  ];
  const reachHost = () => host(Object.fromEntries(VAULT_REACH.map(([, key]) => [key, vi.fn()])));

  it("offers each of the twelve the phone already served on a screen of its own", () => {
    const h = reachHost();
    const cmds = buildMobileCommands(h);
    for (const [id, key] of VAULT_REACH) {
      const cmd = cmds.find((c) => c.id === id);
      expect(cmd, `${id} should be offered`).toBeDefined();
      expect(cmd!.isAvailable?.() ?? true, `${id} needs no open note`).toBe(true);
      cmd!.run();
      expect(h[key], `${id} runs the shell's ${key}`).toHaveBeenCalledOnce();
    }
    for (const [id] of NOTE_REACH) {
      const cmd = cmds.find((c) => c.id === id);
      expect(cmd, `${id} should be offered`).toBeDefined();
      expect(cmd!.isAvailable?.(), `${id} is listed while a note is open`).toBe(true);
    }
  });

  it("does not offer a shell command whose handler the shell does not pass", () => {
    const ids = buildMobileCommands(host()).map((c) => c.id);
    for (const [id] of VAULT_REACH) expect(ids, `${id} without a handler`).not.toContain(id);
  });

  it("hides the six note commands while no note is open, and asks nothing of nobody", () => {
    const cmds = buildMobileCommands(reachHost());
    const closed = buildMobileCommands({ ...reachHost(), activeNote: () => null });
    for (const [id] of [...NOTE_REACH, ["toggle-read-edit"], ["rename-active"], ["export-markdown"]]) {
      expect(cmds.find((c) => c.id === id)!.isAvailable?.(), `${id} with a note`).toBe(true);
      const cmd = closed.find((c) => c.id === id)!;
      expect(cmd.isAvailable?.(), `${id} without a note`).toBe(false);
      cmd.run();
    }
    expect(takeNoteCommand("Notes/A.md")).toBeNull();
  });

  it("hands each note command to the note the palette was opened over", () => {
    // As App.tsx builds it: no override, so each one takes its default route.
    const cmds = buildMobileCommands({ ...reachHost(), renameActive: undefined, toggleReadEdit: undefined, exportActive: undefined });
    for (const [id, command] of [...NOTE_REACH, ["rename-active", "rename"], ["toggle-read-edit", "toggle-edit"], ["export-markdown", "export"]] as Array<[string, NoteCommand]>) {
      cmds.find((c) => c.id === id)!.run();
      // Parked under the note's path — another note must not pick it up.
      expect(takeNoteCommand("Notes/Other.md"), `${id} is not for another note`).toBeNull();
      expect(takeNoteCommand("Notes/A.md"), `${id} asks the note for "${command}"`).toBe(command);
    }
  });

  it("leaves Markdown source out for a plain-text file, as the note menu does", () => {
    const cmds = buildMobileCommands({ ...reachHost(), activeNote: () => "Data/list.csv" });
    expect(cmds.find((c) => c.id === "toggle-source")!.isAvailable?.()).toBe(false);
    // The file actions stay: a text file can be renamed, exported and mailed.
    expect(cmds.find((c) => c.id === "rename-active")!.isAvailable?.()).toBe(true);
    expect(cmds.find((c) => c.id === "mail-mailto")!.isAvailable?.()).toBe(true);
  });

  it("carries the shared groups and icons", () => {
    for (const c of buildMobileCommands(host())) {
      expect(COMMAND_GROUPS, `${c.id} has an unknown group`).toContain(c.group);
      expect(c.icon, `${c.id} has no icon`).toBeTruthy();
    }
  });
});

/**
 * The keys of the object literal App.tsx hands to `callee(...)`, read with the
 * TypeScript parser; anything it cannot vouch for (no call, a second one, a
 * non-literal argument, a spread, a computed key, a key set to `undefined`
 * outright) is a problem, never a pass.
 *
 * The same reader as the desktop guard's (apps/desktop/src/services/
 * commandRegistry.test.ts), kept in both suites on purpose: a guard has to run
 * where the files it reads change, and the test cache re-runs this suite for
 * App.tsx, not the desktop's.
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
 * Every way MOBILE_ABSENT_COMMANDS can disagree with the registry, with what
 * the phone really offers and with the parity catalog; empty means they agree.
 * Pure, so the guard runs against broken fixtures as well as the real thing.
 */
function absenceFindings(
  registry: readonly string[],
  offered: ReadonlySet<string>,
  absent: Readonly<Record<string, string>>,
  catalog: readonly ParityFeatureDef[],
): string[] {
  const out: string[] = [];
  const entries = new Set(catalog.map((f) => f.id));
  for (const id of registry) {
    if (!offered.has(id) && !(id in absent)) out.push(`${id}: neither offered on the phone nor named in MOBILE_ABSENT_COMMANDS`);
  }
  for (const [id, parity] of Object.entries(absent)) {
    if (!registry.includes(id)) out.push(`${id}: named, but the registry builds no such command`);
    else if (offered.has(id)) out.push(`${id}: the phone offers it now - delete its line`);
    if (!entries.has(parity)) out.push(`${id}: points at "${parity}", which is no parity-catalog entry`);
  }
  // The other end of the thread. An entry that sends its reader to this table
  // (the palette gap does) must still be pointed at from it: once the phone
  // offers the last of its commands, the gap is closed and the entry goes,
  // instead of rotting into a claim nothing checks any more.
  const pointedAt = new Set(Object.values(absent));
  for (const f of catalog) {
    const sendsHere = `${f.desktopReason ?? ""} ${f.mobileReason ?? ""}`.includes("MOBILE_ABSENT_COMMANDS");
    if (sendsHere && !pointedAt.has(f.id)) out.push(`${f.id}: no line of MOBILE_ABSENT_COMMANDS points at it any more - delete the entry`);
  }
  return out;
}

/**
 * The phone's counterpart of the desktop's drift guard. The desktop must build
 * every command; the phone may leave some out, but only by name. What it
 * offers is computed, not asserted: the host keys App.tsx really passes go
 * through the real buildMobileCommands, and whatever the registry can build
 * beyond that must stand in MOBILE_ABSENT_COMMANDS with its catalog entry.
 */
describe("the phone names every command it leaves out (S15 drift guard)", () => {
  const wiring = wiredKeys(readFileSync(fileURLToPath(new URL("../App.tsx", import.meta.url)), "utf8"), "buildMobileCommands");
  const registry = commandInventory().commands.map((c) => c.id);
  const wired = Object.fromEntries(wiring.keys.map((k) => [k, vi.fn()])) as unknown as MobileCommandHost;
  const offered = new Set(buildMobileCommands(wired).map((c) => c.id));

  it("reads the palette's wiring in App.tsx", () => {
    expect(wiring.problems).toEqual([]);
  });

  it("offers or names each command the registry knows, and names nothing it offers", () => {
    expect(absenceFindings(registry, offered, MOBILE_ABSENT_COMMANDS, PARITY_FEATURES)).toEqual([]);
  });
});

/** A guard that only ever sees a valid table says nothing about what it would catch. */
describe("the mobile drift guard itself catches", () => {
  const decision: ParityFeatureDef = {
    id: "split-editor",
    title: "Two editor panes side by side",
    area: "platform",
    kind: "decision",
    desktop: "yes",
    mobile: null,
    mobileReason: "A phone screen cannot carry two editing surfaces at a usable width.",
    verified: "2026-09-24",
  };
  const catalog = [decision];

  it("a command the registry gained", () => {
    expect(absenceFindings(["a", "b"], new Set(["a"]), {}, catalog).join(" | ")).toMatch(/b: neither offered/);
  });

  it("a line the phone has outgrown", () => {
    expect(absenceFindings(["a"], new Set(["a"]), { a: "split-editor" }, catalog).join(" | ")).toMatch(/delete its line/);
  });

  it("a line naming no command", () => {
    expect(absenceFindings([], new Set(), { ghost: "split-editor" }, catalog).join(" | ")).toMatch(/no such command/);
  });

  it("a line pointing past the catalog", () => {
    expect(absenceFindings(["a"], new Set(), { a: "nowhere" }, catalog).join(" | ")).toMatch(/no parity-catalog entry/);
  });

  it("a gap entry left behind when its last command arrived", () => {
    const gap: ParityFeatureDef = {
      ...decision,
      id: "palette-gap",
      kind: "gap",
      mobile: "partial",
      mobileReason: "Not in the palette yet; MOBILE_ABSENT_COMMANDS names each command.",
    };
    expect(absenceFindings(["a"], new Set(["a"]), {}, [gap]).join(" | ")).toMatch(/palette-gap: .*delete the entry/);
    expect(absenceFindings(["a"], new Set(), { a: "palette-gap" }, [gap])).toEqual([]);
  });

  it("a host key App.tsx stops passing", () => {
    const { keys } = wiredKeys("buildMobileCommands({ newNote, openGraph: () => go() });", "buildMobileCommands");
    const thin = Object.fromEntries(keys.map((k) => [k, vi.fn()])) as unknown as MobileCommandHost;
    const offeredThen = new Set(buildMobileCommands(thin).map((c) => c.id));
    expect(absenceFindings(["open-graph", "open-mail"], offeredThen, {}, catalog)).toEqual([
      "open-mail: neither offered on the phone nor named in MOBILE_ABSENT_COMMANDS",
    ]);
  });

  it.each([
    ["no call at all", "const commands = [];", /found 0/],
    ["a host handed over as a variable", "buildMobileCommands(host);", /object literal/],
    ["a spread", "buildMobileCommands({ ...base, openGraph });", /spread/],
    ["a key set to undefined", "buildMobileCommands({ openMail: undefined });", /set to undefined/],
  ])("%s", (_name, source, expected) => {
    expect(wiredKeys(source, "buildMobileCommands").problems.join(" | ")).toMatch(expected);
  });
});
