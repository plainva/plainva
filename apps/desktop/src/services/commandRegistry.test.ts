import { describe, it, expect, vi } from "vitest";
import { buildAppCommands, filterCommands, type CommandDeps } from "./commandRegistry";

function deps(overrides: Partial<CommandDeps> = {}): CommandDeps {
  return {
    newItem: vi.fn(),
    openDailyNote: vi.fn(),
    openQuickSwitcher: vi.fn(),
    openTemplatePicker: vi.fn(),
    openGraph: vi.fn(),
    openTasks: vi.fn(),
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
    canPrint: () => true,
    exportActiveMarkdown: vi.fn(),
    createTemplate: vi.fn(),
    saveActiveAsTemplate: vi.fn(),
    toggleReadEdit: vi.fn(),
    toggleSourceMode: vi.fn(),
    renameActive: vi.fn(),
    closeActiveTab: vi.fn(),
    reopenClosedTab: vi.fn(),
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
    const cmds = buildAppCommands(deps({ activePath: () => null, themeTogglePinned: () => true, canPrint: () => false }));
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

  it("offers export + template commands and gates the note-scoped ones on canPrint (issue #6)", () => {
    const d = deps();
    const cmds = buildAppCommands(d);
    cmds.find((c) => c.id === "export-markdown")!.run();
    expect(d.exportActiveMarkdown).toHaveBeenCalled();
    cmds.find((c) => c.id === "template-new")!.run();
    expect(d.createTemplate).toHaveBeenCalled();
    cmds.find((c) => c.id === "template-from-note")!.run();
    expect(d.saveActiveAsTemplate).toHaveBeenCalled();

    const noDoc = filterCommands(buildAppCommands(deps({ canPrint: () => false })), "", (c) => c.titleDefault);
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
