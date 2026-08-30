import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, unknown>();
vi.mock("./settingsStore", () => ({
  getSettingsStore: vi.fn(async () => ({
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: unknown) => void store.set(key, value),
    delete: async (key: string) => void store.delete(key),
    keys: async () => [...store.keys()],
    save: async () => undefined,
  })),
}));

const clearedRuntimes: string[] = [];
const clearedPublications: Array<{ vaultPath: string; ids: string[] }> = [];
vi.mock("./workspaceSecurity/workspaceKeychain", () => ({
  clearWorkspaceRuntime: vi.fn(async (vaultPath: string) => void clearedRuntimes.push(vaultPath)),
  clearPublicationRuntimes: vi.fn(async (vaultPath: string, ids: string[]) =>
    void clearedPublications.push({ vaultPath, ids })
  ),
}));

let indexDbExists = true;
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(async () => indexDbExists),
  readDir: vi.fn(async () => []),
  remove: vi.fn(async () => undefined),
}));
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: vi.fn(async () => "C:/AppData/Plainva"),
  join: vi.fn(async (...parts: string[]) => parts.join("/")),
}));

// The DB is faked, the STORE is real: what this has to prove is that the ids
// come out of `workspace_publication`, and a fake store would only prove that
// a fake was called.
let dbRows: Array<Record<string, unknown>> = [];
let dbThrows: Error | null = null;
const dbClosed: string[] = [];
vi.mock("../adapters/TauriDatabaseAdapter", () => ({
  TauriDatabaseAdapter: class {
    constructor(private readonly url: string) {}
    async initialize() {
      if (dbThrows) throw dbThrows;
    }
    async query() {
      if (dbThrows) throw dbThrows;
      return dbRows;
    }
    async queryOne() {
      return dbRows[0] ?? null;
    }
    async execute() {}
    async close() {
      dbClosed.push(this.url);
    }
  },
}));

import {
  collectPerVaultLocalStorageKeys,
  collectVaultKeychainSlots,
  forgetWorkspaceCredentials,
  perVaultStoreSuffix,
} from "./vaultForget";
import { accountSecretKey } from "./accountBroker";
import { pimSecretKey } from "./pim/pimCredentials";
import { mailSecretKey } from "@plainva/ui/mail";
import { keychainSlotName } from "@plainva/ui";
import {
  backupZipDestKey,
  backupMaxAgeDaysKey,
  backupSnapshotIntervalKey,
} from "./backupPolicy";
import {
  dailyNotesFolderKey,
  defaultNoteTypeKey,
  okfPromptDismissedKey,
  syncIntervalKey,
  templateFolderKey,
} from "../contexts/VaultContext";

const VAULT = "C:/Vaults/Mein Vault";

describe("perVaultStoreSuffix", () => {
  it("matches the suffix every per-vault settings key is built with", () => {
    const suffix = perVaultStoreSuffix(VAULT);
    // Representative keys from both key families (VaultContext + backupPolicy):
    // the suffix scan must cover them all, so forgetting cannot drift when new
    // per-vault keys are added.
    for (const key of [
      syncIntervalKey(VAULT),
      dailyNotesFolderKey(VAULT),
      templateFolderKey(VAULT),
      defaultNoteTypeKey(VAULT),
      okfPromptDismissedKey(VAULT),
      backupZipDestKey(VAULT),
      backupSnapshotIntervalKey(VAULT),
      backupMaxAgeDaysKey(VAULT),
    ]) {
      expect(key.endsWith(suffix)).toBe(true);
    }
  });

  it("never matches another vault's keys or global keys", () => {
    const suffix = perVaultStoreSuffix(VAULT);
    expect(syncIntervalKey("C:/Vaults/Anderer").endsWith(suffix)).toBe(false);
    expect("autoOpenLastVault".endsWith(suffix)).toBe(false);
    expect("recentVaults".endsWith(suffix)).toBe(false);
  });
});

describe("collectPerVaultLocalStorageKeys", () => {
  it("collects exactly the vault's key families, incl. per-file variants", () => {
    const all = [
      `plainva-layout-${VAULT}`,
      `recentPaths-${VAULT}`,
      `plainva-base-active-view-${VAULT}`,
      `plainva-base-active-view-${VAULT}:Projekte.base`,
      `plainva-base-subitems-${VAULT}`,
      `plainva-prop-types::${VAULT}`,
      `plainva-left-sections-${VAULT}-order`,
      `plainva-left-sections-${VAULT}-open-recents`,
      `plainva-left-sections-${VAULT}-open-bookmarks`,
      `plainva-mail-cols-${VAULT}`,
      // Per-window variants (multi-window C1): the second window keeps its own
      // panes and its own expanded folders, and "forget this vault" has to take
      // both with it. Prefix matching covers them without a second entry.
      `plainva-layout-${VAULT}-full-1`,
      `plainva-expanded-${VAULT}`,
      `plainva-expanded-${VAULT}-full-1`,
      // Must survive: other vaults + global keys.
      "plainva-layout-C:/Vaults/Anderer",
      "plainva-left-sections-C:/Vaults/Anderer-order",
      "plainva-mail-cols-C:/Vaults/Anderer",
      "plainva-expanded-C:/Vaults/Anderer-full-1",
      "plainva-calendar-show-weeks",
      "plainva-recent-emoji",
    ];
    const hit = collectPerVaultLocalStorageKeys(VAULT, all);
    expect(hit).toHaveLength(13);
    expect(hit).not.toContain("plainva-layout-C:/Vaults/Anderer");
    expect(hit).not.toContain("plainva-left-sections-C:/Vaults/Anderer-order");
    expect(hit).not.toContain("plainva-mail-cols-C:/Vaults/Anderer");
    expect(hit).not.toContain("plainva-expanded-C:/Vaults/Anderer-full-1");
    expect(hit).not.toContain("plainva-calendar-show-weeks");
  });
});

describe("collectVaultKeychainSlots (E2)", () => {
  const OTHER = "C:/Vaults/Anderer";
  beforeEach(() => store.clear());

  it("names every slot the vault owns, using the same builders production does", async () => {
    await store.set(`cloudAccounts_${btoa(unescape(encodeURIComponent(VAULT)))}`, [
      {
        id: "card-google",
        family: "google",
        label: "person@example.invalid",
        services: {
          calendar: { pimAccountId: "pim-google" },
          mail: { mailAccountId: "mail-google" },
        },
      },
      { id: "card-files-only", family: "webdav", label: "Files", services: {} },
    ]);
    await store.set(`mailAccounts_${btoa(unescape(encodeURIComponent(VAULT)))}`, [
      { id: "mail-google" },
      { id: "mail-standalone" }, // not referenced by any card
    ]);
    // An account dropped from its card still has a slot; the profile map is
    // keyed by slot name and is the only place that still remembers it.
    await store.set(`settingsSyncAccountMap_${btoa(unescape(encodeURIComponent(VAULT)))}`, {
      secretLocalToLogical: { [pimSecretKey(VAULT, "pim-orphaned")]: "logical-x" },
    });
    // Another vault's records must not be swept along.
    await store.set(`mailAccounts_${btoa(unescape(encodeURIComponent(OTHER)))}`, [{ id: "mail-other" }]);

    const slots = await collectVaultKeychainSlots(VAULT);

    // Built with the real key builders — a drift in any of them fails here
    // rather than leaving a credential behind in the keychain.
    expect(slots).toEqual(
      expect.arrayContaining([
        accountSecretKey(VAULT, "card-google"),
        accountSecretKey(VAULT, "card-files-only"),
        pimSecretKey(VAULT, "pim-google"),
        pimSecretKey(VAULT, "pim-orphaned"),
        mailSecretKey(VAULT, "mail-google"),
        mailSecretKey(VAULT, "mail-standalone"),
        `mkcache_${btoa(unescape(encodeURIComponent(VAULT)))}`,
        `account_repair_backup_${btoa(unescape(encodeURIComponent(VAULT)))}`,
      ]),
    );
    expect(slots).not.toContain(mailSecretKey(OTHER, "mail-other"));
    expect(new Set(slots).size).toBe(slots.length);
  });

  it("still names the vault-wide slots when the store holds nothing", async () => {
    // A vault removed before it ever had an account: the master-key cache is
    // exactly the leftover the maintainer found for a path that no longer exists.
    const b64 = btoa(unescape(encodeURIComponent(VAULT)));
    const slots = await collectVaultKeychainSlots(VAULT);
    expect(slots).toContain(`mkcache_${b64}`);
    expect(slots).toContain(`account_repair_backup_${b64}`);
    // Both name shapes (P6): a vault whose rename never finished still holds
    // the old names, and forgetting it must reach either.
    expect(slots).toContain(keychainSlotName({ vaultKey: VAULT, service: "encryption" }));
    expect(slots).toContain(keychainSlotName({ vaultKey: VAULT, service: "repair" }));
  });
});


describe("forgetWorkspaceCredentials (finding 2026-08-30)", () => {
  beforeEach(() => {
    clearedRuntimes.length = 0;
    clearedPublications.length = 0;
    dbClosed.length = 0;
    dbRows = [];
    dbThrows = null;
    indexDbExists = true;
  });

  it("removes the workspace device key and the admin key of every publication", async () => {
    dbRows = [
      { publication_id: "pub-a", slice_id: "s1", config_json: "{}", manifest_json: "{}", last_error: null, last_refreshed_at: null, created_at: "2026-08-30T08:00:00.000Z" },
      { publication_id: "pub-b", slice_id: "s2", config_json: "{}", manifest_json: "{}", last_error: null, last_refreshed_at: null, created_at: "2026-08-30T09:00:00.000Z" },
    ];

    await forgetWorkspaceCredentials(VAULT);

    // "Forget this vault" left these behind until now: the device key of an
    // encrypted workspace, in the OS keychain, for a vault the user believes
    // they just removed.
    expect(clearedRuntimes).toEqual([VAULT]);
    expect(clearedPublications).toEqual([{ vaultPath: VAULT, ids: ["pub-a", "pub-b"] }]);
    // Owner-only close: leaving the pool open would tear down the next window's
    // connection to the same file.
    expect(dbClosed).toHaveLength(1);
  });

  it("still removes the runtime slot when the ids cannot be read", async () => {
    // A vault that never had a workspace has no such table, and a locked DB is
    // somebody else's problem. Neither may cost us the bigger key.
    dbThrows = new Error("no such table: workspace_publication");

    await forgetWorkspaceCredentials(VAULT);

    expect(clearedRuntimes).toEqual([VAULT]);
    expect(clearedPublications).toEqual([{ vaultPath: VAULT, ids: [] }]);
    expect(dbClosed).toHaveLength(1);
  });

  it("does not create an index database just to look inside it", async () => {
    // `Database.load` on a sqlite: URL CREATES the file - so a vault whose
    // index is already gone must not be opened at all.
    indexDbExists = false;

    await forgetWorkspaceCredentials(VAULT);

    expect(dbClosed).toEqual([]);
    expect(clearedRuntimes).toEqual([VAULT]);
  });
});
