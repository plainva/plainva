import { describe, it, expect, vi, beforeEach } from "vitest";

let storeValues: Record<string, unknown> = {};
const setSpy = vi.fn(async (key: string, value: unknown) => {
  storeValues[key] = value;
});
vi.mock("@tauri-apps/plugin-store", () => {
  const load = vi.fn(async () => ({
    get: async (key: string) => storeValues[key],
    set: setSpy,
    save: async () => {},
  }));
  return { Store: { load }, load };
});

import {
  DEFAULT_VIEW_MODE,
  getStoredDefaultViewMode,
  initDefaultViewMode,
  isEditorViewMode,
  rememberSessionViewMode,
  resetViewModeStateForTests,
  resolveViewModeForPath,
  setStoredDefaultViewMode,
} from "./viewModeDefault";
import { markFreshNote, resetFreshNotesForTests } from "@plainva/ui";

beforeEach(() => {
  resetFreshNotesForTests();
  storeValues = {};
  setSpy.mockClear();
  resetViewModeStateForTests();
});

describe("viewModeDefault service", () => {
  it("validates stored values and falls back to the default", async () => {
    expect(isEditorViewMode("read")).toBe(true);
    expect(isEditorViewMode("live")).toBe(true);
    expect(isEditorViewMode("source")).toBe(true);
    expect(isEditorViewMode("preview")).toBe(false);
    storeValues["defaultViewMode"] = "preview";
    expect(await getStoredDefaultViewMode()).toBe(DEFAULT_VIEW_MODE);
    storeValues["defaultViewMode"] = "read";
    expect(await getStoredDefaultViewMode()).toBe("read");
  });

  it("setStoredDefaultViewMode persists and updates the sync cache immediately", async () => {
    await setStoredDefaultViewMode("source");
    expect(setSpy).toHaveBeenCalledWith("defaultViewMode", "source");
    expect(resolveViewModeForPath("notes/a.md")).toBe("source");
  });

  it("initDefaultViewMode fills the sync cache from the store", async () => {
    storeValues["defaultViewMode"] = "read";
    expect(resolveViewModeForPath("notes/a.md")).toBe(DEFAULT_VIEW_MODE);
    initDefaultViewMode();
    await vi.waitFor(() => expect(resolveViewModeForPath("notes/a.md")).toBe("read"));
  });

  it("remembers a manual switch per file for the session, other files keep the default", async () => {
    await setStoredDefaultViewMode("read");
    rememberSessionViewMode("notes/a.md", "source");
    expect(resolveViewModeForPath("notes/a.md")).toBe("source");
    expect(resolveViewModeForPath("notes/b.md")).toBe("read");
    // Null/empty paths never remember and resolve to the default.
    rememberSessionViewMode(null, "live");
    rememberSessionViewMode("", "live");
    expect(resolveViewModeForPath(null)).toBe("read");
  });

  // Wish 2026-10-19: a note just created opens to be written in.
  it("opens a note just created in live preview when the default is read", async () => {
    await setStoredDefaultViewMode("read");
    markFreshNote("notes/new.md");
    expect(resolveViewModeForPath("notes/new.md")).toBe("live");
    expect(resolveViewModeForPath("notes/old.md")).toBe("read");
    // The user's own choice in the note wins.
    rememberSessionViewMode("notes/new.md", "read");
    expect(resolveViewModeForPath("notes/new.md")).toBe("read");
  });

  it("leaves a default of source or live alone for a new note", async () => {
    markFreshNote("notes/new.md");
    await setStoredDefaultViewMode("source");
    expect(resolveViewModeForPath("notes/new.md")).toBe("source");
    await setStoredDefaultViewMode("live");
    expect(resolveViewModeForPath("notes/new.md")).toBe("live");
  });
});
