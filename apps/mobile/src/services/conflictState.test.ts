import { afterEach, describe, expect, it } from "vitest";
import {
  bindConflictStore,
  clearConflict,
  conflictsKey,
  getConflict,
  listConflicts,
  noteConflict,
  readPersistedConflicts,
  resetConflicts,
} from "./conflictState";

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

/** P1 (Build-91 feedback): a conflict is an end state and outlives the app. */
describe("conflictState persistence", () => {
  afterEach(() => resetConflicts());

  it("persists per vault and restores on the next bind", () => {
    const storage = fakeStorage();
    bindConflictStore("local", storage);
    noteConflict("Inbox/Notiz 1.md", "Inbox/Notiz 1.CONFLICT-2026-09-04T17-27-28-950Z.md");
    expect(storage.map.get(conflictsKey("local"))).toContain("CONFLICT-2026-09-04");

    resetConflicts();
    expect(getConflict("Inbox/Notiz 1.md")).toBeNull();

    bindConflictStore("local", storage);
    expect(getConflict("Inbox/Notiz 1.md")?.copyPath).toBe("Inbox/Notiz 1.CONFLICT-2026-09-04T17-27-28-950Z.md");
  });

  it("clearing the last conflict removes the key; other vaults keep theirs", () => {
    const storage = fakeStorage();
    bindConflictStore("cloud-1", storage);
    noteConflict("a.md", "a.CONFLICT-x.md");
    bindConflictStore("local", storage);
    expect(listConflicts()).toEqual([]);
    noteConflict("b.md", "b.CONFLICT-y.md");
    clearConflict("b.md");
    expect(storage.map.has(conflictsKey("local"))).toBe(false);
    expect(readPersistedConflicts("cloud-1", storage)).toEqual([{ path: "a.md", copyPath: "a.CONFLICT-x.md" }]);
  });

  it("drops malformed entries instead of throwing", () => {
    const storage = fakeStorage();
    storage.map.set(conflictsKey("local"), JSON.stringify([{ path: "ok.md", copyPath: "ok.CONFLICT-1.md" }, { path: 3 }, "x", null]));
    expect(readPersistedConflicts("local", storage)).toEqual([{ path: "ok.md", copyPath: "ok.CONFLICT-1.md" }]);
    storage.map.set(conflictsKey("local"), "{not json");
    expect(readPersistedConflicts("local", storage)).toEqual([]);
  });

  it("works without storage at all", () => {
    bindConflictStore("local", null);
    noteConflict("a.md", "a.CONFLICT-1.md");
    expect(getConflict("a.md")).not.toBeNull();
  });

  it("records a late conflict in its original vault without changing the active vault", () => {
    const storage = fakeStorage();
    bindConflictStore("old", storage);
    bindConflictStore("current", storage);
    noteConflict("same.md", "current-copy.md");
    noteConflict("same.md", "old-copy.md", "old");
    expect(getConflict("same.md")?.copyPath).toBe("current-copy.md");
    expect(readPersistedConflicts("old", storage)).toEqual([{ path: "same.md", copyPath: "old-copy.md" }]);
    bindConflictStore("old", storage);
    expect(getConflict("same.md")?.copyPath).toBe("old-copy.md");
  });
});
