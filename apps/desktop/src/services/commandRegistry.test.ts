import { describe, it, expect, vi } from "vitest";
import { buildAppCommands, COMMAND_GROUPS, filterCommands, type CommandDeps } from "@plainva/ui";

function deps(overrides: Partial<CommandDeps> = {}): CommandDeps {
  return {
    newItem: vi.fn(),
    openDailyNote: vi.fn(),
    openQuickSwitcher: vi.fn(),
    openTemplatePicker: vi.fn(),
    openGraph: vi.fn(),
    openTasks: vi.fn(),
    openCalendar: vi.fn(),
    openMail: vi.fn(),
    openCommsWindow: vi.fn(),
    copyNoteAsEmail: vi.fn(),
    sendNoteViaMailto: vi.fn(),
    saveNoteAsMailDraft: vi.fn(),
    openFindReplace: vi.fn(),
    split: vi.fn(),
    toggleLeftSidebar: vi.fn(),
    toggleRightSidebar: vi.fn(),
    toggleFocusMode: vi.fn(),
    toggleTheme: vi.fn(),
    themeTogglePinned: () => false,
    openSettings: vi.fn(),
    openShortcuts: vi.fn(),
    activePath: () => "Notes/A.md",
    showVersionHistory: vi.fn(),
    backupNow: vi.fn(),
    updateAllIndexes: vi.fn(),
    switchVault: vi.fn(),
    printActive: vi.fn(),
    hasActiveNote: () => true,
    exportActiveMarkdown: vi.fn(),
    createTemplate: vi.fn(),
    saveActiveAsTemplate: vi.fn(),
    toggleReadEdit: vi.fn(),
    toggleSourceMode: vi.fn(),
    renameActive: vi.fn(),
    closeActiveTab: vi.fn(),
    reopenClosedTab: vi.fn(),
    refreshVault: vi.fn(),
    rebuildIndex: vi.fn(),
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
    const hits = filterCommands(cmds, "tages", (c) => c.titleDefault);
    expect(hits.map((c) => c.id)).toEqual(["daily-note"]);
    expect(filterCommands(cmds, "XYZ-nope", (c) => c.titleDefault)).toEqual([]);
  });
});

/**
 * Since S15 a command exists only where its handler does — that is what lets
 * the phone offer a subset honestly instead of showing dead entries. The risk
 * that buys is the opposite one: a desktop dep quietly renamed or dropped, and
 * a command disappearing from the palette without a word.
 */
describe("the desktop offers every command (S15 drift guard)", () => {
  it("builds each entry the registry knows", () => {
    const all = buildAppCommands({ ...deps(), openImport: vi.fn() });
    // The number is not the point — the point is that removing a dep here
    // fails loudly instead of shrinking the palette in silence.
    expect(all.length).toBe(40);
    expect(new Set(all.map((c) => c.id)).size).toBe(all.length);
  });

  it("drops exactly the command whose handler is missing", () => {
    const withoutGraph = buildAppCommands({ ...deps(), openGraph: undefined });
    expect(withoutGraph.some((c) => c.id === "open-graph")).toBe(false);
    // and nothing else
    expect(withoutGraph.length).toBe(buildAppCommands(deps()).length - 1);
  });

  it("gives every command a group and an icon", () => {
    for (const c of buildAppCommands(deps())) {
      expect(COMMAND_GROUPS, `${c.id} has an unknown group`).toContain(c.group);
      expect(typeof c.icon, `${c.id} has no icon`).not.toBe("undefined");
    }
  });
});
