// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const files = new Map<string, string>();
const removedDirs: string[] = [];
vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA" },
  Encoding: { UTF8: "utf8" },
  Filesystem: {
    deleteFile: vi.fn(async ({ path }: { path: string }) => {
      if (!files.delete(path)) throw new Error("not found");
    }),
    rmdir: vi.fn(async ({ path }: { path: string }) => {
      removedDirs.push(path);
    }),
  },
}));

import { setPlatformServices, barLayoutKey, type ISettingsStore } from "@plainva/ui";
import { mailAccountsKey, mailSecretKey } from "@plainva/ui/mail";
import { accountSecretKey } from "./accountBroker";
import { pimSecretKey } from "./pim/pimCredentials";
import { mobileWorkspaceSecretKeys } from "./mobileWorkspaceSecurity";
import { profileJournalPath } from "./profileImportJournal";
import {
  collectVaultSecretKeys,
  forgetVaultFiles,
  mobileKeyringCacheKey,
  forgetVaultSecrets,
  forgetVaultStoreKeys,
} from "./vaultForget";

const VAULT = "abc123";
const OTHER = "keepme";

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

describe("what a forgotten vault leaves behind (finding 2026-08-19)", () => {
  let store: ISettingsStore & { map: Map<string, unknown> };
  let removedSecrets: string[];

  beforeEach(() => {
    files.clear();
    removedDirs.length = 0;
    removedSecrets = [];
    store = fakeStore();
    setPlatformServices({
      loadSettings: async () => store,
      credentials: {
        readSecret: async () => null,
        writeSecret: async () => {},
        removeSecret: async (key: string) => {
          removedSecrets.push(key);
        },
      },
      openExternal: async () => {},
    });
  });

  it("takes every per-vault settings key, including the encoded ones", async () => {
    // Built with the REAL builders, so a renamed key breaks this test rather
    // than silently leaving data on the device.
    const mine = [
      `mobile-vault-${VAULT}`,
      `settingsSyncMobile_${VAULT}`,
      `settingsSyncAccountMapMobile_${VAULT}`,
      `settingsSyncUnknownMobile_${VAULT}`,
      `accountRepairJournalMobile_${VAULT}`,
      `cloudAccounts_${VAULT}`,
      `syncRootFolder_drive_${VAULT}`,
      `mobileRecentSearches_${VAULT}`,
      // These two encode the vault id — a suffix sweep alone cannot see them.
      mailAccountsKey(VAULT),
      barLayoutKey("mobileBar", VAULT),
    ];
    for (const key of mine) await store.set(key, 1);
    await store.set(`settingsSyncMobile_${OTHER}`, 1);
    await store.set(mailAccountsKey(OTHER), 1);
    await store.set("barLayoutDefault_mobileBar", 1);

    await forgetVaultStoreKeys(VAULT);

    for (const key of mine) expect(store.map.has(key), key).toBe(false);
    // Another vault and the global default are none of its business.
    expect(store.map.has(`settingsSyncMobile_${OTHER}`)).toBe(true);
    expect(store.map.has(mailAccountsKey(OTHER))).toBe(true);
    expect(store.map.has("barLayoutDefault_mobileBar")).toBe(true);
  });

  it("removes the per-service secret slot of every account", async () => {
    const keys = await collectVaultSecretKeys(VAULT, {
      cloud: ["card-1"],
      pim: ["pim-1", "pim-2"],
      mail: ["mail-1"],
    });
    await forgetVaultSecrets(keys);

    // These are refresh tokens and app passwords for accounts the user
    // believes they just removed.
    expect(removedSecrets).toEqual(
      expect.arrayContaining([
        accountSecretKey(VAULT, "card-1"),
        pimSecretKey(VAULT, "pim-1"),
        pimSecretKey(VAULT, "pim-2"),
        mailSecretKey(VAULT, "mail-1"),
      ]),
    );
    // The cached master key of the encrypted profile: a CREDENTIAL, not a store
    // key, so no sweep would ever find it - and it is the one that opens the
    // rest.
    expect(removedSecrets).toContain(mobileKeyringCacheKey(VAULT));
    // The workspace's own device key and its pending pairing. Built with the
    // real builders, so a rename in the workspace module cannot drift past this
    // sweep unnoticed (finding 2026-08-30).
    expect(removedSecrets).toEqual(expect.arrayContaining(mobileWorkspaceSecretKeys(VAULT, [])));
    expect(removedSecrets).toHaveLength(7);
  });

  it("removes the admin key of every publication", async () => {
    const keys = await collectVaultSecretKeys(VAULT, {
      cloud: [],
      pim: [],
      mail: [],
      publications: ["pub-a", "pub-b"],
    });
    await forgetVaultSecrets(keys);

    // Unlike an account, a publication is named ONLY inside the index database
    // this deletion is about to remove - so a slot missed here is a publisher
    // admin key that can never be found again (keystores cannot be enumerated).
    expect(removedSecrets).toEqual(
      expect.arrayContaining(mobileWorkspaceSecretKeys(VAULT, ["pub-a", "pub-b"])),
    );
    // Two publications, plus runtime + pairing + the keyring cache.
    expect(removedSecrets).toHaveLength(5);
  });

  it("keeps going when one slot cannot be reached", async () => {
    setPlatformServices({
      loadSettings: async () => store,
      credentials: {
        readSecret: async () => null,
        writeSecret: async () => {},
        removeSecret: async (key: string) => {
          if (key.includes("boom")) throw new Error("keystore unavailable");
          removedSecrets.push(key);
        },
      },
      openExternal: async () => {},
    });
    await forgetVaultSecrets([
      accountSecretKey(VAULT, "boom"),
      pimSecretKey(VAULT, "fine"),
    ]);
    expect(removedSecrets).toEqual([pimSecretKey(VAULT, "fine")]);
  });

  it("takes the drafts and the import journal, which live outside the container", async () => {
    files.set(profileJournalPath(VAULT), "{}");
    await forgetVaultFiles(VAULT);
    expect(removedDirs).toContain(`drafts/${VAULT}`);
    expect(files.has(profileJournalPath(VAULT))).toBe(false);
  });

  it("survives a vault that never wrote drafts or a journal", async () => {
    await expect(forgetVaultFiles(VAULT)).resolves.toBeUndefined();
  });
});
