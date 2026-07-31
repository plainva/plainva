import { describe, expect, it } from "vitest";
import type { PimAccountCacheSnapshot, PimCacheRepository } from "@plainva/core";
import {
  cleanupRepairedAccount,
  recoverAccountRepairCleanup,
  type AccountRepairCleanupJournal,
  type AccountRepairCleanupResources,
  type ICredentialStore,
  type ISettingsStore,
} from "@plainva/ui";
import type { MailAccountConfig } from "@plainva/ui/mail";

function harness(failSlot?: string) {
  const stored = new Map<string, unknown>();
  const secrets = new Map<string, unknown>([
    ["account-source", { refreshToken: "source-refresh-marker" }],
    ["pim-p1", { pass: "calendar-password-marker" }],
    ["mail-m1", { pass: "mail-password-marker" }],
  ]);
  const settingsWrites: unknown[] = [];
  let mail: MailAccountConfig[] = [
    { id: "m1", label: "Old", host: "imap.invalid", port: 993, user: "old@example.invalid" },
    { id: "m2", label: "Keep", host: "imap.invalid", port: 993, user: "keep@example.invalid" },
  ];
  const pimRows = new Set(["p1", "p2"]);
  let failed = false;
  const store: ISettingsStore = {
    get: async <T,>(key: string) => (stored.get(key) ?? null) as T | null,
    set: async (key, value) => {
      settingsWrites.push(structuredClone(value));
      stored.set(key, structuredClone(value));
    },
    delete: async (key) => stored.delete(key),
    keys: async () => [...stored.keys()],
    save: async () => {},
  };
  const credentials: ICredentialStore = {
    readSecret: async <T,>(slot: string) => (secrets.get(slot) ?? null) as T | null,
    writeSecret: async (slot, value) => void secrets.set(slot, structuredClone(value)),
    removeSecret: async (slot) => {
      if (slot === failSlot && !failed) {
        failed = true;
        throw new Error("injected secret cleanup failure");
      }
      secrets.delete(slot);
    },
  };
  const snapshot = (accountId: string): PimAccountCacheSnapshot => ({
    version: 1,
    accountId,
    tables: {
      pim_accounts: [],
      pim_calendars: [],
      pim_events: [],
      pim_tasklists: [],
      pim_tasks: [],
      pim_state: [],
      pim_task_state: [],
    },
  });
  const pimCache = {
    snapshotAccount: async (id: string) => snapshot(id),
    deleteAccount: async (id: string) => void pimRows.delete(id),
    restoreAccount: async (value: PimAccountCacheSnapshot) => void pimRows.add(value.accountId),
  } as unknown as PimCacheRepository;
  const resources: AccountRepairCleanupResources = {
    store,
    credentials,
    journalKey: "cleanup-journal",
    backupSlot: "cleanup-secret-backup",
    pimCache,
    db: null,
    listMailAccounts: async () => structuredClone(mail),
    replaceMailAccounts: async (accounts) => void (mail = structuredClone(accounts)),
    accountSecretSlot: (id) => `account-${id}`,
    pimSecretSlot: (id) => `pim-${id}`,
    mailSecretSlot: (id) => `mail-${id}`,
  };
  return { resources, stored, secrets, settingsWrites, pimRows, mail: () => mail };
}

const cleanup = {
  targetAccountId: "target",
  accountIds: ["source"],
  pimAccountIds: ["p1"],
  mailAccountIds: ["m1"],
};

describe("confirmed account cleanup", () => {
  it("moves an intact account token, removes only orphans and keeps secrets out of the settings journal", async () => {
    const h = harness();

    await cleanupRepairedAccount(h.resources, cleanup);

    expect(h.secrets.get("account-target")).toEqual({ refreshToken: "source-refresh-marker" });
    expect(h.secrets.has("account-source")).toBe(false);
    expect(h.secrets.has("pim-p1")).toBe(false);
    expect(h.secrets.has("mail-m1")).toBe(false);
    expect(h.secrets.has("cleanup-secret-backup")).toBe(false);
    expect(h.pimRows).toEqual(new Set(["p2"]));
    expect(h.mail().map((account) => account.id)).toEqual(["m2"]);
    expect(h.stored.has("cleanup-journal")).toBe(false);
    expect(JSON.stringify(h.settingsWrites)).not.toContain("source-refresh-marker");
    expect(JSON.stringify(h.settingsWrites)).not.toContain("password-marker");
  });

  it("restores metadata, caches and every credential slot when cleanup fails", async () => {
    const h = harness("mail-m1");

    await expect(cleanupRepairedAccount(h.resources, cleanup)).rejects.toThrow(
      "injected secret cleanup failure",
    );

    expect(h.secrets.get("account-source")).toEqual({ refreshToken: "source-refresh-marker" });
    expect(h.secrets.has("account-target")).toBe(false);
    expect(h.secrets.get("pim-p1")).toEqual({ pass: "calendar-password-marker" });
    expect(h.secrets.get("mail-m1")).toEqual({ pass: "mail-password-marker" });
    expect(h.pimRows).toEqual(new Set(["p1", "p2"]));
    expect(h.mail().map((account) => account.id)).toEqual(["m1", "m2"]);
    expect(h.stored.has("cleanup-journal")).toBe(false);
  });

  it("recovers a prepared cleanup journal after an interrupted run", async () => {
    const h = harness();
    const journal: AccountRepairCleanupJournal = {
      version: 1,
      state: "prepared",
      backupSlot: "cleanup-secret-backup",
      cleanup,
      pim: [await h.resources.pimCache!.snapshotAccount("p1")],
      mailCache: [],
      mailAccounts: await h.resources.listMailAccounts(),
    };
    await h.resources.credentials.writeSecret("cleanup-secret-backup", {
      version: 1,
      entries: [
        { slot: "account-source", value: { refreshToken: "source-refresh-marker" } },
        { slot: "account-target", value: null },
      ],
    });
    await h.resources.store.set("cleanup-journal", journal);
    h.secrets.delete("account-source");
    h.secrets.set("account-target", { refreshToken: "source-refresh-marker" });
    h.pimRows.delete("p1");

    await expect(recoverAccountRepairCleanup(h.resources)).resolves.toBe(true);

    expect(h.secrets.get("account-source")).toEqual({ refreshToken: "source-refresh-marker" });
    expect(h.secrets.has("account-target")).toBe(false);
    expect(h.pimRows.has("p1")).toBe(true);
    expect(h.stored.has("cleanup-journal")).toBe(false);
  });
});
