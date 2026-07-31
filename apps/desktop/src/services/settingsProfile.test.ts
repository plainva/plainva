import { describe, it, expect } from "vitest";
import type { ISettingsStore } from "@plainva/ui";
import { exportProfileValues, applyProfileValues, sanitizeProfileValues, isMemberProfileField } from "./settingsProfile";
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
      taskDatabase: "Tasks.base",
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
    // Explicit shared defaults are represented by an absent native key.
    expect(store.map.has(backupSnapshotIntervalKey(V))).toBe(false);
    // Absent registry keys reset to default (deleted).
    expect(store.map.has(templateFolderKey(V))).toBe(false);
    expect(store.map.has(mailRemoteImagesKey(V))).toBe(false);
    // Non-registry keys are never touched.
    expect(store.map.get("someGlobalKey")).toBe("keep-me");
  });

  it("stores an explicit shared default as absence", async () => {
    const store = fakeStore();
    await store.set(dailyNotesFormatKey(V), "DD.MM.YYYY");
    await store.set(syncIntervalKey(V), 60);

    await applyProfileValues(store, V, {
      dailyNotesFormat: "YYYY-MM-DD",
      syncIntervalSeconds: 15,
    });

    expect(store.map.has(dailyNotesFormatKey(V))).toBe(false);
    expect(store.map.has(syncIntervalKey(V))).toBe(false);
    expect(await exportProfileValues(store, V)).toEqual({});
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
    // "Meetings" is the common fallback, so the sparse native representation
    // is intentionally absent on the target too.
    expect(dst.map.has(meetingFolderKey(V2))).toBe(false);
  });
});

/**
 * The validator had NO coverage at all, which is how a Microsoft mailbox could
 * disable the entire settings sync unnoticed: it is stored with host "" and
 * port 0 (correct — Graph speaks no IMAP), the validator demanded port > 0, and
 * `applyProfileValues` ran it as its first statement. One such account meant no
 * accounts, no calendar selection and not even the daily-notes folder arrived,
 * on every device and every cycle, reported only to the console.
 */
describe("settingsProfile validation", () => {
  const imapAccount = { id: "m1", label: "Mailbox", host: "imap.example.com", port: 993, user: "me@example.com" };
  const graphAccount = { id: "m2", label: "Microsoft", host: "", port: 0, user: "me@outlook.com", kind: "microsoft" as const, clientId: "cid" };

  it("accepts a Microsoft mailbox (host \"\", port 0) instead of rejecting the whole profile", () => {
    const { values, skipped } = sanitizeProfileValues({ mailAccounts: [graphAccount] });
    expect(skipped).toEqual([]);
    expect(values.mailAccounts).toEqual([graphAccount]);
  });

  it("still rejects an IMAP mailbox without a usable port", () => {
    const { values, skipped } = sanitizeProfileValues({ mailAccounts: [{ ...imapAccount, port: 0 }] });
    expect(values.mailAccounts).toEqual([]);
    expect(skipped.join(" ")).toContain("mail account");
  });

  it("keeps the good rows when one account is malformed, instead of dropping everything", () => {
    const { values, skipped } = sanitizeProfileValues({
      dailyNotesFolder: "Daily",
      mailAccounts: [imapAccount, { id: 42 }],
    });
    expect(values.mailAccounts).toEqual([imapAccount]);
    expect(values.dailyNotesFolder).toBe("Daily"); // unrelated settings survive
    expect(skipped).toHaveLength(1);
  });

  it("does not delete a local setting because the incoming value was invalid", async () => {
    const store = fakeStore();
    await store.set(dailyNotesFolderKey(V), "Daily");
    // A Windows path separator is rejected by validVaultPath. Absence normally
    // means "reset to default" — an invalid value must not trigger that.
    await applyProfileValues(store, V, { dailyNotesFolder: "Journal\\Sub" });
    expect(store.map.get(dailyNotesFolderKey(V))).toBe("Daily");
  });

  it("reports what it skipped instead of failing the whole import", async () => {
    const store = fakeStore();
    const skipped: string[][] = [];
    await applyProfileValues(store, V, { dailyNotesFolder: "Daily", backupZipKeep: "seven" }, { onSkipped: (r) => skipped.push(r) });
    expect(store.map.get(dailyNotesFolderKey(V))).toBe("Daily");
    expect(skipped.flat().join(" ")).toContain("backupZipKeep");
  });
});

describe("profile field scope (bars plan P6)", () => {
  it("keeps vault conventions shared", () => {
    // Where the daily notes live is a property of the ARCHIVE: everyone working
    // in it should see the same folders, so these stay in the shared file.
    for (const logical of ["dailyNotesFolder", "templateFolder", "taskDatabase", "defaultNoteType", "meetingFolder"]) {
      expect(isMemberProfileField(logical)).toBe(false);
    }
  });

  it("treats arrangement, accounts and personal rules as the member's own", () => {
    for (const logical of [
      "barLayoutRibbon",
      "barLayoutLeftTabs",
      "barLayoutLeftSections",
      "barLayoutRightSections",
      "bookmarks",
      "mailAccounts",
      "pimAccounts",
      "pimSelections",
      "cloudAccounts",
      "backupZipEnabled",
      "syncIntervalSeconds",
      "defaultCalendar",
    ]) {
      expect(isMemberProfileField(logical)).toBe(true);
    }
  });

  it("leaves a field it does not know with the vault", () => {
    // The forward-compatibility bucket of a newer Plainva: guessing a scope for
    // it would be worse than keeping the behaviour we have.
    expect(isMemberProfileField("somethingFromTheFuture")).toBe(false);
  });
});
