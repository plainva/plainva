import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The cloud folder used to be a field of the credential slot, so removing an
 * account took it with it. Reconnecting then found nothing to carry over, the
 * sync target fell back to its default AND CREATED that folder, and the vault
 * quietly started uploading into a fresh, empty remote (finding 2026-08-19).
 *
 * These assertions pin the two halves of the fix: the value now lives in the
 * per-vault settings, and an existing vault carries its old value over on the
 * first read.
 */

const settings = new Map<string, unknown>();
vi.mock("./settingsStore", () => ({
  getSettingsStore: vi.fn(async () => ({
    get: async (key: string) => settings.get(key),
    set: async (key: string, value: unknown) => {
      settings.set(key, value);
    },
    delete: async (key: string) => {
      settings.delete(key);
    },
    save: async () => undefined,
  })),
}));

const slots = new Map<string, unknown>();
vi.mock("./CredentialManager", () => ({
  credentialManager: {
    getDriveCredentials: vi.fn(async () => slots.get("drive") ?? null),
    getOneDriveCredentials: vi.fn(async () => slots.get("onedrive") ?? null),
    getDropboxCredentials: vi.fn(async () => slots.get("dropbox") ?? null),
    getS3Credentials: vi.fn(async () => slots.get("s3") ?? null),
    getWebDavCredentials: vi.fn(async () => slots.get("webdav") ?? null),
  },
}));

import { readSyncRootFolder, syncRootFolderKey, writeSyncRootFolder } from "./syncRootFolder";

describe("syncRootFolder", () => {
  beforeEach(() => {
    settings.clear();
    slots.clear();
  });

  it("survives an account that was removed", async () => {
    await writeSyncRootFolder("/v", "drive", "wiki");
    slots.delete("drive"); // what removeCloudAccount leaves behind

    expect(await readSyncRootFolder("/v", "drive")).toBe("wiki");
  });

  it("carries the old slot value over on the first read", async () => {
    slots.set("drive", { clientId: "c", clientSecret: "s", refreshToken: "r", rootFolderName: "Apps/Plainva" });

    expect(await readSyncRootFolder("/v", "drive")).toBe("Apps/Plainva");
    // Written through, so the value no longer depends on the slot staying alive.
    expect(settings.get(syncRootFolderKey("/v", "drive"))).toBe("Apps/Plainva");
  });

  it("keeps an explicitly emptied folder empty instead of migrating again", async () => {
    slots.set("drive", { clientId: "c", clientSecret: "s", refreshToken: "r", rootFolderName: "wiki" });
    await writeSyncRootFolder("/v", "drive", "");

    // "" is a decision ("use the default"), not a missing value — re-running the
    // migration here would silently resurrect the old name.
    expect(await readSyncRootFolder("/v", "drive")).toBe("");
  });

  it("keeps providers apart", async () => {
    await writeSyncRootFolder("/v", "drive", "wiki");
    await writeSyncRootFolder("/v", "onedrive", "Vault");

    expect(await readSyncRootFolder("/v", "drive")).toBe("wiki");
    expect(await readSyncRootFolder("/v", "onedrive")).toBe("Vault");
  });

  it("leaves WebDAV and S3 with their credentials", async () => {
    slots.set("webdav", { url: "https://cloud.example/remote.php/dav/files/me/vault", user: "u", pass: "p" });
    slots.set("s3", { prefix: "vault/", bucket: "b" });

    // Their "folder" is part of the connection itself and reappears in the form
    // on every reconnect — there is no silent loss to protect against.
    expect(await readSyncRootFolder("/v", "webdav")).toContain("remote.php");
    expect(await readSyncRootFolder("/v", "s3")).toBe("vault/");
    expect(settings.size).toBe(0);
  });

  it("uses the vault path, so two vaults never share a folder", async () => {
    await writeSyncRootFolder("/a", "drive", "one");
    await writeSyncRootFolder("/b", "drive", "two");

    expect(await readSyncRootFolder("/a", "drive")).toBe("one");
    expect(await readSyncRootFolder("/b", "drive")).toBe("two");
  });
});
