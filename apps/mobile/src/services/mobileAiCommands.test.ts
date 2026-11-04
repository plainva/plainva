// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AI_COMMANDS, AI_WITHHELD_COMMANDS, aiNavigationCommands, CALENDAR_GOTO_EVENT, consumePendingCalendarDay } from "@plainva/ui";
import { buildMobileCommands, type MobileCommandHost } from "./mobileCommands";

/**
 * What the assistant can do in the phone's shell (plan KI-Harness P4-4): the
 * commands of the phone's own palette that show something — the same registry
 * and the same decision per command as on the desktop, so the two shells
 * differ exactly where their palettes do.
 */

function host(over: Partial<MobileCommandHost> = {}): MobileCommandHost {
  return {
    newNote: vi.fn(),
    newFromTemplate: vi.fn(),
    newFolder: vi.fn(),
    newDatabase: vi.fn(),
    openDaily: vi.fn(),
    newEvent: vi.fn(),
    newTask: vi.fn(),
    newJournalEntry: vi.fn(),
    openJournal: vi.fn(),
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

const commandsOf = (h: MobileCommandHost) =>
  aiNavigationCommands({
    commands: () => buildMobileCommands(h),
    openNote: () => undefined,
    resolveNote: async (target) => (target === "Notes/A.md" ? target : null),
  });

describe("the assistant's commands on the phone", () => {
  it("are the palette's that show something — and nothing that creates, exports or changes", async () => {
    const h = host();
    const ids = commandsOf(h).map((c) => c.id);
    // Markdown source and the version history joined when the phone's palette learned them (2026-10-06): the assistant
    // gets what the palette of this shell holds, and both only show something.
    expect(ids).toEqual(["open-file", "open-graph", "open-tasks", "open-calendar", "open-journal", "open-mail", "toggle-read-edit", "toggle-source", "open-settings", "version-history", "open-note", "show-in-graph"]);
    // Every command the phone's palette has is decided, like the desktop's.
    for (const command of buildMobileCommands(h)) expect(command.id in AI_COMMANDS || command.id in AI_WITHHELD_COMMANDS, command.id).toBe(true);
    await commandsOf(h).find((c) => c.id === "open-tasks")!.run();
    expect(h.openTasks).toHaveBeenCalledOnce();
    for (const spy of [h.newNote, h.newFolder, h.newDatabase, h.openDaily, h.newEvent, h.newTask, h.newJournalEntry, h.exportActive, h.renameActive, h.switchVault, h.refreshVault, h.openFindReplace]) expect(spy).not.toHaveBeenCalled();
    // A shell without a journal screen does not offer it; a note-scoped command says no while nothing is open.
    expect(commandsOf(host({ openJournal: undefined })).map((c) => c.id)).not.toContain("open-journal");
    const closed = host({ activeNote: () => null });
    expect(await commandsOf(closed).find((c) => c.id === "toggle-read-edit")!.run()).toBe(false);
    expect(closed.toggleReadEdit).not.toHaveBeenCalled();
  });

  it("turns the calendar to a day, and the calendar screen takes it", async () => {
    const h = host();
    const announced: string[] = [];
    const listen = (event: Event) => void announced.push((event as CustomEvent<{ dayKey: string }>).detail.dayKey);
    window.addEventListener(CALENDAR_GOTO_EVENT, listen);
    expect(await commandsOf(h).find((c) => c.id === "open-calendar")!.run({ date: "2026-10-12" })).toBe(true);
    window.removeEventListener(CALENDAR_GOTO_EVENT, listen);
    expect(h.openCalendar).toHaveBeenCalledOnce();
    // Announced for a calendar that shows already, parked for one that mounts now.
    expect(announced).toEqual(["2026-10-12"]);
    expect(consumePendingCalendarDay()).toBe("2026-10-12");
    const screen = readFileSync(resolve(process.cwd(), "src/screens/PimCalendarScreen.tsx"), "utf8");
    expect(screen).toContain("show(consumePendingCalendarDay());");
    expect(screen).toContain("window.addEventListener(CALENDAR_GOTO_EVENT, onGoto);");
  });

  it("reaches the vault's mail through the shared client, like the desktop", () => {
    const service = readFileSync(resolve(process.cwd(), "src/services/ai/mobileAi.ts"), "utf8");
    expect(service).toContain("mail: vaultMailSource(vault.vaultId, () => vault.db)");
    expect(service).toContain("aiNavigationCommands(");
    const desktop = readFileSync(resolve(process.cwd(), "../desktop/src/services/ai/desktopAi.ts"), "utf8");
    expect(desktop).toContain("mail: vaultMailSource(input.vaultPath, input.db)");
  });
});
