// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { setPlatformServices, type ISettingsStore } from "@plainva/ui";
import {
  clearSyncRootFolders,
  readSyncRootFolder,
  syncRootFolderKey,
  writeSyncRootFolder,
} from "./syncRootFolder";
import type { MobileSyncProvider } from "./syncSlot";

const VAULT = "fixture-vault";

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

const drive = (rootFolderName?: string) =>
  ({ provider: "drive", creds: { rootFolderName } }) as unknown as MobileSyncProvider;

describe("where the remote folder lives (finding 2026-08-19)", () => {
  let store: ISettingsStore & { map: Map<string, unknown> };

  beforeEach(() => {
    store = fakeStore();
    setPlatformServices({
      loadSettings: async () => store,
      credentials: { readSecret: async () => null, writeSecret: async () => {}, removeSecret: async () => {} },
      openExternal: async () => {},
    });
  });

  it("carries the folder over from the credentials the first time it is read", async () => {
    expect(await readSyncRootFolder(VAULT, "drive", drive("Wiki"))).toBe("Wiki");
    // Read through: from now on it survives the credential slot being cleared.
    expect(store.map.get(syncRootFolderKey(VAULT, "drive"))).toBe("Wiki");
    expect(await readSyncRootFolder(VAULT, "drive", null)).toBe("Wiki");
  });

  it("keeps an explicitly emptied folder empty", async () => {
    await writeSyncRootFolder(VAULT, "drive", "");
    // A cleared field is a DECISION ("use the default"), not a missing value —
    // reading must not resurrect the stale blob value on top of it.
    expect(await readSyncRootFolder(VAULT, "drive", drive("Wiki"))).toBe("");
  });

  it("does not write a store entry for an account that never had a folder", async () => {
    expect(await readSyncRootFolder(VAULT, "drive", drive(undefined))).toBe("");
    expect(store.map.has(syncRootFolderKey(VAULT, "drive"))).toBe(false);
  });

  it("keeps the providers apart", async () => {
    await writeSyncRootFolder(VAULT, "drive", "DriveFolder");
    await writeSyncRootFolder(VAULT, "dropbox", "/Apps/Plainva");
    expect(await readSyncRootFolder(VAULT, "drive", null)).toBe("DriveFolder");
    expect(await readSyncRootFolder(VAULT, "dropbox", null)).toBe("/Apps/Plainva");
  });

  it("leaves WebDAV and S3 in the credentials, where the form shows them", async () => {
    const s3 = { provider: "s3", creds: { prefix: "notes/" } } as unknown as MobileSyncProvider;
    await writeSyncRootFolder(VAULT, "s3", "ignored");
    expect(store.map.has(syncRootFolderKey(VAULT, "s3"))).toBe(false);
    expect(await readSyncRootFolder(VAULT, "s3", s3)).toBe("notes/");
  });

  it("forgets every provider when the vault is forgotten", async () => {
    await writeSyncRootFolder(VAULT, "drive", "A");
    await writeSyncRootFolder(VAULT, "onedrive", "B");
    await writeSyncRootFolder(VAULT, "dropbox", "/C");
    await clearSyncRootFolders(VAULT);
    expect([...store.map.keys()].filter((k) => k.startsWith("syncRootFolder_"))).toEqual([]);
  });
});
