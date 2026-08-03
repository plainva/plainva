import { describe, expect, it, vi } from "vitest";
import { COMMAND_GROUPS } from "@plainva/ui";
import { buildMobileCommands, type MobileCommandHost } from "./mobileCommands";

function host(over: Partial<MobileCommandHost> = {}): MobileCommandHost {
  return {
    newNote: vi.fn(),
    newFromTemplate: vi.fn(),
    newFolder: vi.fn(),
    newDatabase: vi.fn(),
    openDaily: vi.fn(),
    openSearch: vi.fn(),
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
    shareActive: vi.fn(),
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

  it("hides the note commands while nothing is open", () => {
    const cmds = buildMobileCommands(host({ activeNote: () => null }));
    const rename = cmds.find((c) => c.id === "rename-active")!;
    const share = cmds.find((c) => c.id === "export-markdown")!;
    expect(rename.isAvailable?.()).toBe(false);
    expect(share.isAvailable?.()).toBe(false);
  });

  it("carries the shared groups and icons", () => {
    for (const c of buildMobileCommands(host())) {
      expect(COMMAND_GROUPS, `${c.id} has an unknown group`).toContain(c.group);
      expect(c.icon, `${c.id} has no icon`).toBeTruthy();
    }
  });
});
