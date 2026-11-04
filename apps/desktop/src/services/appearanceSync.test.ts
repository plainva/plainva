import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A setting changed in one window reaches the others (Sammelplan § 3.132 Nr. 4,
 * § 3.171 Nr. 4).
 *
 * Every window reads its device settings once, at its start (`main.tsx`), into
 * memory caches the editor asks synchronously. "Open new notes in a new tab"
 * and the default view were never read again: changed in the main window, a
 * second window went on with the old answer until it was restarted. Same for a
 * vault's own name, which the title of every window shows.
 */
const settings = new Map<string, unknown>();
const handlers: Array<(payload: { domain: string }) => void> = [];
const broadcasts: unknown[] = [];

vi.mock("./settingsStore", () => ({
  getSettingsStore: async () => ({
    get: async (key: string) => settings.get(key),
    set: async (key: string, value: unknown) => { settings.set(key, value); },
    delete: async (key: string) => { settings.delete(key); },
    save: async () => {},
  }),
}));
vi.mock("./windowBus", () => ({
  getWindowBus: async () => ({
    broadcast: async (_event: string, payload: unknown) => { broadcasts.push(payload); },
    onBroadcast: async (_event: string, handler: (payload: { domain: string }) => void) => { handlers.push(handler); },
  }),
}));

import { installAppearanceSync } from "./appearanceSync";
import { newNoteOpensInNewTab, resetNewNoteTabForTests, setStoredNewNotesInNewTab } from "./newNoteTab";
import { resetViewModeStateForTests, resolveViewModeForPath, setStoredDefaultViewMode } from "./viewModeDefault";
import { renameVault, vaultLabel, vaultNameKey } from "./vaultNames";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("a setting changed in another window", () => {
  it("is read again here: the default view, new notes in a new tab, and a vault's own name", async () => {
    resetViewModeStateForTests();
    resetNewNoteTabForTests(false);
    await installAppearanceSync();
    expect(handlers).toHaveLength(1);
    // This window knows the vault by the name it had.
    await renameVault("/v/Notes", "Old");
    expect(vaultLabel("/v/Notes")).toBe("Old");
    expect(resolveViewModeForPath("a.md")).toBe("live");
    expect(newNoteOpensInNewTab()).toBe(false);

    // The main window changes them: the store has the new answers.
    settings.set("defaultViewMode", "read");
    settings.set("newNotesInNewTab", true);
    settings.set(vaultNameKey("/v/Notes"), "Work");
    handlers[0]({ domain: "appearance" });
    await vi.waitFor(() => {
      expect(resolveViewModeForPath("a.md")).toBe("read");
      expect(newNoteOpensInNewTab()).toBe(true);
      expect(vaultLabel("/v/Notes")).toBe("Work");
    });
  });

  it("is announced by the window that changes it", async () => {
    broadcasts.length = 0;
    await setStoredDefaultViewMode("source");
    await setStoredNewNotesInNewTab(false);
    await renameVault("/v/Notes", "Elsewhere");
    await tick();
    expect(broadcasts).toEqual([{ domain: "appearance" }, { domain: "appearance" }, { domain: "appearance" }]);
  });

  it("covers every device setting a window reads into memory at its start", () => {
    // Each start-up reader of main.tsx is re-run on the broadcast, or named here
    // with the reason it needs none.
    const main = readFileSync(resolve(__dirname, "../main.tsx"), "utf8");
    const sync = readFileSync(resolve(__dirname, "appearanceSync.ts"), "utf8");
    const readers = [...main.matchAll(/^(init[A-Z]\w*)\(\);/gm)].map((m) => m[1]);
    const notSettings: Record<string, string> = {
      initTheme: "re-applied as applyStoredTheme",
      initInputModality: "follows the keyboard and the pointer, no setting",
      initWebviewHardening: "installs event handlers, no setting",
    };
    expect(readers.length).toBeGreaterThan(5);
    for (const reader of readers) {
      if (notSettings[reader]) continue;
      expect(sync, `${reader} is read at the start of every window and must be read again on a change`).toContain(`${reader}()`);
    }
    expect(sync).toContain("applyStoredTheme()");
    expect(sync).toContain("reloadVaultNames()");
  });
});
