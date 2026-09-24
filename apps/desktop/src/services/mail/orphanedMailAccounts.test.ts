import { beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import type { IDatabaseAdapter } from "@plainva/core";
import { setPlatformServices } from "@plainva/ui";
import {
  cacheEnvelopes, dismissMailOrphanNotice, findOrphanedMailAccounts, isOrphanedMailAccount, listEnvelopes,
  listMailAccounts, mailAccountsKey, mailOrphanNoticeDismissed, mailSecretKey, removeOrphanedMailAccount, resetMailCache,
  saveMailAccount, setMailPlatform, type MailAccountConfig, type MailTransport,
} from "@plainva/ui/mail";
import { createSerdeSettingsStore, type SerdeSettingsStore } from "../../test-serdeStore";

/**
 * Incomplete mail accounts (finding 2026-09-24, E4).
 *
 * Every failed desktop setup since 0.8.3 left an account entry without a
 * password; the settings sync carried them to every device. The notice offers
 * them for removal — and only them. The rule is strict, and these tests are
 * mostly about what it must NOT offer.
 */

class NodeSqliteAdapter implements IDatabaseAdapter {
  private db = new DatabaseSync(":memory:");
  async execute(sql: string, params: unknown[] = []): Promise<void> {
    this.db.prepare(sql).run(...(params as never[]));
  }
  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...(params as never[])) as T[];
  }
  async queryOne<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    return (await this.query<T>(sql, params))[0] ?? null;
  }
  async transaction<T>(fn: (adapter: IDatabaseAdapter) => Promise<T>): Promise<T> {
    return fn(this);
  }
  async initialize(): Promise<void> {}
  async close(): Promise<void> {}
}

const VAULT = "C:/vaults/wiki";
let store: SerdeSettingsStore;
const secrets = new Map<string, unknown>();
let lockedKeychain = false;
let db: NodeSqliteAdapter;

const account = (id: string, extra: Partial<MailAccountConfig> = {}): MailAccountConfig => ({
  id, label: `${id}@example.invalid`, host: "imap.example.invalid", port: 993, user: `${id}@example.invalid`, ...extra,
});

async function putEntryWithoutPassword(entry: MailAccountConfig): Promise<void> {
  // What the broken rollback left behind: the entry, no credential.
  const list = await listMailAccounts(VAULT);
  await store.set(mailAccountsKey(VAULT), [...list, entry]);
}

beforeEach(() => {
  store = createSerdeSettingsStore();
  secrets.clear();
  lockedKeychain = false;
  db = new NodeSqliteAdapter();
  resetMailCache();
  setPlatformServices({
    loadSettings: async () => store,
    credentials: {
      readSecret: async <T,>(key: string) => {
        if (lockedKeychain) throw new Error("keychain locked");
        return (secrets.get(key) as T) ?? null;
      },
      writeSecret: async <T,>(key: string, value: T) => { secrets.set(key, value); },
      removeSecret: async (key: string) => { secrets.delete(key); },
    },
    openExternal: async () => {},
  });
});

describe("the rule", () => {
  it("counts only an entry with no credential, no fetch and no cached mail", () => {
    expect(isOrphanedMailAccount({ hasCredential: false, fetchedOnce: false, hasCachedMail: false })).toBe(true);
    expect(isOrphanedMailAccount({ hasCredential: true, fetchedOnce: false, hasCachedMail: false })).toBe(false);
    expect(isOrphanedMailAccount({ hasCredential: false, fetchedOnce: true, hasCachedMail: false })).toBe(false);
    expect(isOrphanedMailAccount({ hasCredential: false, fetchedOnce: false, hasCachedMail: true })).toBe(false);
  });

  it("never reads an unknown as absent", () => {
    // A locked keychain, or a window without a writable mail cache, proves nothing.
    expect(isOrphanedMailAccount({ hasCredential: null, fetchedOnce: false, hasCachedMail: false })).toBe(false);
    expect(isOrphanedMailAccount({ hasCredential: false, fetchedOnce: false, hasCachedMail: null })).toBe(false);
  });
});

describe("finding incomplete accounts", () => {
  it("finds the entries a failed setup left behind, and nothing that works", async () => {
    await saveMailAccount(VAULT, account("working"), "pw");
    await putEntryWithoutPassword(account("orphan1"));
    await putEntryWithoutPassword(account("orphan2"));
    expect((await findOrphanedMailAccounts(VAULT, db)).map((a) => a.id)).toEqual(["orphan1", "orphan2"]);
  });

  it("keeps an account that fetched mail on this device before the marker existed", async () => {
    await putEntryWithoutPassword(account("old"));
    await cacheEnvelopes(db, "old", "INBOX", [{
      id: "1", subject: "Hi", from: "a@b.invalid", dateTs: Date.parse("2026-09-01T10:00:00Z"), seen: true, flagged: false,
    }]);
    expect(await findOrphanedMailAccounts(VAULT, db)).toEqual([]);
  });

  it("keeps an account another device has fetched with (the marker travels)", async () => {
    await putEntryWithoutPassword(account("synced", { firstFetchAt: "2026-09-20T08:00:00.000Z" }));
    expect(await findOrphanedMailAccounts(VAULT, db)).toEqual([]);
  });

  it("offers nothing while the keychain cannot be read or no mail cache exists", async () => {
    await putEntryWithoutPassword(account("orphan"));
    lockedKeychain = true;
    expect(await findOrphanedMailAccounts(VAULT, db)).toEqual([]);
    lockedKeychain = false;
    expect(await findOrphanedMailAccounts(VAULT, null)).toEqual([]);
  });
});

describe("the fetch marker", () => {
  const page = { total: 1, unseen: 0, messages: [{ uid: 7, subject: "S", from: "a@b.invalid", dateTs: Date.parse("2026-09-24T09:00:00Z"), seen: false, flagged: false }] };

  it("is written once, on the first fetch that works", async () => {
    await saveMailAccount(VAULT, account("m"), "pw");
    let calls = 0;
    setMailPlatform({
      transport: { listEnvelopes: async () => { calls++; return page; } } as unknown as MailTransport,
      http: { api: fetch, token: fetch },
    });
    const [stored] = await listMailAccounts(VAULT);
    expect(stored.firstFetchAt).toBeUndefined();
    await listEnvelopes(VAULT, stored, "INBOX", 0, 50);
    await expect.poll(async () => (await listMailAccounts(VAULT))[0].firstFetchAt).toBeTruthy();
    const first = (await listMailAccounts(VAULT))[0].firstFetchAt;
    await listEnvelopes(VAULT, (await listMailAccounts(VAULT))[0], "INBOX", 0, 50);
    expect((await listMailAccounts(VAULT))[0].firstFetchAt).toBe(first);
    expect(calls).toBe(2);
  });

  it("is not written by a fetch that fails", async () => {
    await saveMailAccount(VAULT, account("m"), "pw");
    setMailPlatform({
      transport: { listEnvelopes: async () => { throw new Error("authentication failed"); } } as unknown as MailTransport,
      http: { api: fetch, token: fetch },
    });
    await expect(listEnvelopes(VAULT, (await listMailAccounts(VAULT))[0], "INBOX", 0, 50)).rejects.toThrow();
    expect((await listMailAccounts(VAULT))[0].firstFetchAt).toBeUndefined();
  });
});

describe("removing one", () => {
  it("removes only that entry", async () => {
    await saveMailAccount(VAULT, account("working"), "pw");
    await putEntryWithoutPassword(account("orphan"));
    await expect(removeOrphanedMailAccount(VAULT, "orphan", db)).resolves.toBe("removed");
    expect((await listMailAccounts(VAULT)).map((a) => a.id)).toEqual(["working"]);
    expect(secrets.has(mailSecretKey(VAULT, "working"))).toBe(true);
  });

  it("keeps an entry that was signed in after the list was shown", async () => {
    await putEntryWithoutPassword(account("late"));
    secrets.set(mailSecretKey(VAULT, "late"), { pass: "now-set" });
    await expect(removeOrphanedMailAccount(VAULT, "late", db)).resolves.toBe("kept");
    expect((await listMailAccounts(VAULT)).map((a) => a.id)).toEqual(["late"]);
  });

  it("never removes a working account, whatever id is passed", async () => {
    await saveMailAccount(VAULT, account("working"), "pw");
    await expect(removeOrphanedMailAccount(VAULT, "working", db)).resolves.toBe("kept");
    expect((await listMailAccounts(VAULT)).map((a) => a.id)).toEqual(["working"]);
  });
});

describe("the notice", () => {
  it("stays away after Later for the same entries, and returns for a new one", async () => {
    expect(await mailOrphanNoticeDismissed(VAULT, ["a"])).toBe(false);
    await dismissMailOrphanNotice(VAULT, ["a"]);
    expect(await mailOrphanNoticeDismissed(VAULT, ["a"])).toBe(true);
    expect(await mailOrphanNoticeDismissed(VAULT, ["a", "b"])).toBe(false);
  });
});
