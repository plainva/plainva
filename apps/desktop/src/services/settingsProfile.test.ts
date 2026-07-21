import { describe, it, expect } from "vitest";
import type { ISettingsStore } from "@plainva/ui";
import { exportProfileValues, applyProfileValues } from "./settingsProfile";
import {
  dailyNotesFolderKey,
  dailyNotesFormatKey,
  templateFolderKey,
  taskDatabaseKey,
  extendedDatabasesKey,
  meetingFolderKey,
  mailRemoteImagesKey,
  syncIntervalKey,
} from "../contexts/VaultContext";
import { backupZipKeepKey, backupSnapshotIntervalKey } from "./backupPolicy";

/** Minimal in-memory ISettingsStore for the port tests. */
function fakeStore(): ISettingsStore & { map: Map<string, unknown> } {
  const map = new Map<string, unknown>();
  return {
    map,
    async get<T>(key: string) {
      return map.get(key) as T | undefined;
    },
    async set(key: string, value: unknown) {
      map.set(key, value);
    },
    async delete(key: string) {
      return map.delete(key);
    },
    async keys() {
      return [...map.keys()];
    },
    async save() {},
  };
}

const V = "C:/Users/x/My Vault";

describe("settingsProfile port", () => {
  it("exports only explicitly-set settings, re-keyed to logical names (drift guard vs VaultContext keys)", async () => {
    const store = fakeStore();
    await store.set(dailyNotesFolderKey(V), "Journal");
    await store.set(dailyNotesFormatKey(V), "YYYY-MM-DD");
    await store.set(taskDatabaseKey(V), "Tasks.base");
    await store.set(extendedDatabasesKey(V), true);
    await store.set(backupZipKeepKey(V), 14);
    // An unrelated key must not leak into the profile.
    await store.set("someGlobalKey", "x");

    const values = await exportProfileValues(store, V);
    expect(values).toEqual({
      dailyNotesFolder: "Journal",
      dailyNotesFormat: "YYYY-MM-DD",
      taskDatabase: "Tasks.base",
      extendedDatabases: true,
      backupZipKeep: 14,
    });
  });

  it("applies present values and resets absent registry keys to default (full LWW convergence)", async () => {
    const store = fakeStore();
    // Pre-existing local settings that the incoming document does NOT contain.
    await store.set(templateFolderKey(V), "OldTemplates");
    await store.set(mailRemoteImagesKey(V), true);
    await store.set("someGlobalKey", "keep-me");

    await applyProfileValues(store, V, {
      dailyNotesFolder: "Daily",
      syncIntervalSeconds: 30,
      backupSnapshotIntervalSeconds: 120,
    });

    // Present values written under the VaultContext keys.
    expect(store.map.get(dailyNotesFolderKey(V))).toBe("Daily");
    expect(store.map.get(syncIntervalKey(V))).toBe(30);
    expect(store.map.get(backupSnapshotIntervalKey(V))).toBe(120);
    // Absent registry keys reset to default (deleted).
    expect(store.map.has(templateFolderKey(V))).toBe(false);
    expect(store.map.has(mailRemoteImagesKey(V))).toBe(false);
    // Non-registry keys are never touched.
    expect(store.map.get("someGlobalKey")).toBe("keep-me");
  });

  it("round-trips: export then apply on a fresh vault reproduces the settings", async () => {
    const src = fakeStore();
    await src.set(dailyNotesFolderKey(V), "Journal");
    await src.set(meetingFolderKey(V), "Meetings");
    const doc = await exportProfileValues(src, V);

    const dst = fakeStore();
    const V2 = "/home/y/vault"; // different device path -> different native keys
    await applyProfileValues(dst, V2, doc);
    expect(dst.map.get(dailyNotesFolderKey(V2))).toBe("Journal");
    expect(dst.map.get(meetingFolderKey(V2))).toBe("Meetings");
  });
});
