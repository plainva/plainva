// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const files = new Map<string, string>();
vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA" },
  Encoding: { UTF8: "utf8" },
  Filesystem: {
    writeFile: vi.fn(async ({ path, data }: { path: string; data: string }) => {
      files.set(path, data);
    }),
    readFile: vi.fn(async ({ path }: { path: string }) => {
      if (!files.has(path)) throw new Error("not found");
      return { data: files.get(path)! };
    }),
    deleteFile: vi.fn(async ({ path }: { path: string }) => {
      files.delete(path);
    }),
    readdir: vi.fn(async () => ({ files: [] })),
  },
}));
// Routes atomicWriteText through the mocked Filesystem instead of the plugin.
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false },
  registerPlugin: () => ({}),
}));

import type { IVaultAdapter } from "@plainva/core";
import { setPlatformServices, type ISettingsStore } from "@plainva/ui";
import {
  captureProfileSnapshot,
  clearProfileJournal,
  profileJournalPath,
  recoverProfileImportIfNeeded,
  restoreProfileSnapshot,
  writeProfileJournal,
} from "./profileImportJournal";
import type { MobileVault } from "./vaultService";

const VAULT = "fixture-vault";

function fakeStore(): ISettingsStore & { map: Map<string, unknown> } {
  const map = new Map<string, unknown>();
  return {
    map,
    async get<T>(key: string) {
      return map.get(key) as T | undefined;
    },
    async set(key: string, value: unknown) {
      map.set(key, structuredClone(value));
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

function install(store: ISettingsStore): void {
  setPlatformServices({
    loadSettings: async () => store,
    credentials: { readSecret: async () => null, writeSecret: async () => {}, removeSecret: async () => {} },
    openExternal: async () => {},
  });
}

function mobileVault(vaultFiles = new Map<string, string>()): MobileVault {
  const adapter = {
    async exists(path: string) {
      return vaultFiles.has(path);
    },
    async readTextFile(path: string) {
      const value = vaultFiles.get(path);
      if (value === undefined) throw new Error(`missing fixture file: ${path}`);
      return value;
    },
    async writeTextFile(path: string, value: string) {
      vaultFiles.set(path, value);
    },
    async deleteItem(path: string) {
      vaultFiles.delete(path);
    },
  } as unknown as IVaultAdapter;
  return { vaultId: VAULT, adapter, db: null } as unknown as MobileVault;
}

describe("the way back out of a half-finished settings import (finding 2026-08-19)", () => {
  let store: ISettingsStore & { map: Map<string, unknown> };

  beforeEach(() => {
    files.clear();
    store = fakeStore();
    install(store);
  });

  it("puts every part back the way it found it", async () => {
    const vaultFiles = new Map<string, string>([[".plainva/bookmarks.json", '{"items":["Notes/Keep.md"]}']]);
    const vault = mobileVault(vaultFiles);
    await store.set(`mobile-vault-${VAULT}`, { dailyFolder: "Journal", inboxFolder: "In" });
    await store.set(`settingsSyncUnknownMobile_${VAULT}`, { futureField: 42 });
    await store.set(`settingsSyncAccountMapMobile_${VAULT}`, { pimLocalToLogical: { local: "shared" } });
    await store.set(`cloudAccounts_${VAULT}`, [{ id: "card", family: "google", label: "a@b.c", services: {} }]);

    const snapshot = await captureProfileSnapshot(vault);

    // An import runs and changes all of it.
    await store.set(`mobile-vault-${VAULT}`, { dailyFolder: "Imported", inboxFolder: "Imported" });
    await store.set(`settingsSyncUnknownMobile_${VAULT}`, { other: 1 });
    await store.set(`settingsSyncAccountMapMobile_${VAULT}`, { pimLocalToLogical: { x: "y" } });
    await store.set(`cloudAccounts_${VAULT}`, []);
    vaultFiles.set(".plainva/bookmarks.json", '{"items":["Notes/Imported.md"]}');

    await restoreProfileSnapshot(vault, snapshot);

    const settings = await store.get<Record<string, unknown>>(`mobile-vault-${VAULT}`);
    expect(settings?.dailyFolder).toBe("Journal");
    expect(settings?.inboxFolder).toBe("In");
    expect(await store.get(`settingsSyncUnknownMobile_${VAULT}`)).toEqual({ futureField: 42 });
    expect((await store.get<Record<string, unknown>>(`settingsSyncAccountMapMobile_${VAULT}`))?.pimLocalToLogical)
      .toEqual({ local: "shared" });
    expect(await store.get<unknown[]>(`cloudAccounts_${VAULT}`)).toHaveLength(1);
    expect(vaultFiles.get(".plainva/bookmarks.json")).toContain("Keep.md");
  });

  it("restores 'there were no bookmarks' as an absent file, not an empty one", async () => {
    const vaultFiles = new Map<string, string>();
    const vault = mobileVault(vaultFiles);
    const snapshot = await captureProfileSnapshot(vault);
    expect(snapshot.bookmarks.existed).toBe(false);

    vaultFiles.set(".plainva/bookmarks.json", '{"items":["Notes/Imported.md"]}');
    await restoreProfileSnapshot(vault, snapshot);

    expect(vaultFiles.has(".plainva/bookmarks.json")).toBe(false);
  });

  it("keeps credentials out of the journal that sits on disk", async () => {
    const vault = mobileVault();
    await store.set(`cloudAccounts_${VAULT}`, [
      { id: "card", family: "google", label: "a@b.c", services: {}, byoClientId: "cloud-client-marker" },
    ]);

    const snapshot = await captureProfileSnapshot(vault);
    await writeProfileJournal(VAULT, snapshot);

    // The journal outlives the process; a refresh token in it would be a new
    // leak rather than a safeguard.
    expect(files.get(profileJournalPath(VAULT))).not.toContain("cloud-client-marker");
  });

  it("takes the local client id back from the device on rollback", async () => {
    const vault = mobileVault();
    await store.set(`cloudAccounts_${VAULT}`, [
      { id: "card", family: "google", label: "a@b.c", services: {}, byoClientId: "own-registration" },
    ]);
    const snapshot = await captureProfileSnapshot(vault);

    await restoreProfileSnapshot(vault, snapshot);

    // The projection dropped it; without the re-merge the rollback would have
    // silently deleted the user's own OAuth registration.
    const cards = await store.get<Array<{ byoClientId?: string }>>(`cloudAccounts_${VAULT}`);
    expect(cards?.[0]?.byoClientId).toBe("own-registration");
  });

  it("rolls back a journal left behind by a crash, then clears it", async () => {
    const vault = mobileVault();
    await store.set(`mobile-vault-${VAULT}`, { dailyFolder: "Journal" });
    const snapshot = await captureProfileSnapshot(vault);
    await writeProfileJournal(VAULT, snapshot);

    // ...the process dies here, halfway through the apply.
    await store.set(`mobile-vault-${VAULT}`, { dailyFolder: "Half" });

    expect(await recoverProfileImportIfNeeded(vault)).toBe(true);
    expect((await store.get<Record<string, unknown>>(`mobile-vault-${VAULT}`))?.dailyFolder).toBe("Journal");
    expect(files.has(profileJournalPath(VAULT))).toBe(false);
  });

  it("does nothing when there is no journal, and refuses a torn one", async () => {
    const vault = mobileVault();
    expect(await recoverProfileImportIfNeeded(vault)).toBe(false);

    files.set(profileJournalPath(VAULT), '{"startedAt":"2026-08-19T00:00:00.0');
    expect(await recoverProfileImportIfNeeded(vault)).toBe(false);
    files.set(profileJournalPath(VAULT), JSON.stringify({ startedAt: "x", snapshot: {} }));
    expect(await recoverProfileImportIfNeeded(vault)).toBe(false);
  });

  it("leaves the journal behind when the rollback itself fails", async () => {
    const vaultFiles = new Map<string, string>([[".plainva/bookmarks.json", '{"items":["Notes/Keep.md"]}']]);
    const vault = mobileVault(vaultFiles);
    const snapshot = await captureProfileSnapshot(vault);
    await writeProfileJournal(VAULT, snapshot);

    // A write that cannot land: the journal has to survive, or the next start
    // would have nothing left to restore from.
    (vault.adapter as unknown as { writeTextFile: () => Promise<void> }).writeTextFile = async () => {
      throw new Error("disk full");
    };
    await expect(recoverProfileImportIfNeeded(vault)).rejects.toThrow("disk full");
    expect(files.has(profileJournalPath(VAULT))).toBe(true);

    await clearProfileJournal(VAULT);
    expect(files.has(profileJournalPath(VAULT))).toBe(false);
  });
});
