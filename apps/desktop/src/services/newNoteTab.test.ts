import { beforeEach, describe, expect, it, vi } from "vitest";

let storeValues: Record<string, unknown> = {};
vi.mock("@tauri-apps/plugin-store", () => {
  const load = vi.fn(async () => ({
    get: async (key: string) => storeValues[key],
    set: async (key: string, value: unknown) => { storeValues[key] = value; },
    save: async () => {},
  }));
  return { Store: { load }, load };
});

import {
  DEFAULT_NEW_NOTES_IN_NEW_TAB,
  getStoredNewNotesInNewTab,
  initNewNotesInNewTab,
  newNoteOpensInNewTab,
  resetNewNoteTabForTests,
  setStoredNewNotesInNewTab,
} from "./newNoteTab";

/** "Open new notes in a new tab" (issue 135, 2026-10-19). */
describe("newNoteTab", () => {
  beforeEach(() => {
    storeValues = {};
    resetNewNoteTabForTests();
  });

  it("is off by default: a new note replaces the note in the active tab, as before", async () => {
    expect(DEFAULT_NEW_NOTES_IN_NEW_TAB).toBe(false);
    expect(await getStoredNewNotesInNewTab()).toBe(false);
    expect(newNoteOpensInNewTab()).toBe(false);
  });

  it("opens a new note in a tab of its own once switched on", async () => {
    await setStoredNewNotesInNewTab(true);
    expect(storeValues.newNotesInNewTab).toBe(true);
    expect(newNoteOpensInNewTab()).toBe(true);
  });

  it("keeps a new tab the user asked for, whatever the switch says", () => {
    expect(newNoteOpensInNewTab(true)).toBe(true);
  });

  it("reads the stored choice at start", async () => {
    storeValues.newNotesInNewTab = true;
    initNewNotesInNewTab();
    await vi.waitFor(() => expect(newNoteOpensInNewTab()).toBe(true));
  });
});
