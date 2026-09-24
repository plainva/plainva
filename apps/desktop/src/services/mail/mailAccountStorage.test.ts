import { beforeEach, describe, expect, it } from "vitest";
import { ServiceConnectionError, setPlatformServices } from "@plainva/ui";
import {
  getMailPassword, getMailRefreshToken, listMailAccounts, mailSecretKey, saveMailAccount,
  saveMicrosoftMailAccount, type MailAccountConfig,
} from "@plainva/ui/mail";
import { createSerdeSettingsStore, serdeOrdered, type SerdeSettingsStore } from "../../test-serdeStore";

/**
 * Saving a mail account against a store that answers like the desktop's
 * (finding 2026-09-24).
 *
 * Every new mail account on the desktop ended in "storageFailed" since 0.8.3:
 * the check after saving compared the account list as JSON text, and the Rust
 * store returns the keys sorted. The rollback used the same comparison, never
 * recognised its own write, and each attempt left an account entry without a
 * password behind. These tests run the real shared writer against a store with
 * serde's key order; the old text comparison fails every one of them.
 */

let store: SerdeSettingsStore;
const secrets = new Map<string, unknown>();

beforeEach(() => {
  store = createSerdeSettingsStore();
  secrets.clear();
  setPlatformServices({
    loadSettings: async () => store,
    credentials: {
      // The keychain holds text; a read returns what was written. Sorted as
      // well, so a secret check cannot lean on order either.
      readSecret: async <T,>(key: string) => (secrets.has(key) ? serdeOrdered(secrets.get(key)) as T : null),
      writeSecret: async <T,>(key: string, value: T) => { secrets.set(key, serdeOrdered(value)); },
      removeSecret: async (key: string) => { secrets.delete(key); },
    },
    openExternal: async () => {},
  });
});

const VAULT = "C:/vaults/wiki";

describe("a new mail account on the desktop store", () => {
  it("stores an IMAP account with its app password (Gmail, the reported case)", async () => {
    // Exactly the shape the connect wizard builds: id first, host after label.
    const account: MailAccountConfig = {
      id: "m1", label: "m.muster@gmail.com", host: "imap.gmail.com", port: 993,
      user: "m.muster@gmail.com", smtpHost: "smtp.gmail.com", smtpPort: 465,
    };
    await saveMailAccount(VAULT, account, "abcd efgh ijkl mnop");
    expect(await listMailAccounts(VAULT)).toEqual([account]);
    expect(await getMailPassword(VAULT, "m1")).toBe("abcd efgh ijkl mnop");
  });

  it("stores a Microsoft (Graph) mail account with its token", async () => {
    const account: MailAccountConfig = { id: "ms", label: "Microsoft", host: "", port: 0, user: "", kind: "microsoft", clientId: "client" };
    await saveMicrosoftMailAccount(VAULT, account, "RT");
    // The second save of the same flow: the address is known now.
    await saveMicrosoftMailAccount(VAULT, { ...account, label: "me@outlook.com", user: "me@outlook.com" }, "RT");
    expect(await listMailAccounts(VAULT)).toEqual([{ ...account, label: "me@outlook.com", user: "me@outlook.com" }]);
    expect(await getMailRefreshToken(VAULT, "ms")).toBe("RT");
  });

  it("adds a second account beside an existing one without disturbing it", async () => {
    const first: MailAccountConfig = { id: "a", label: "A", host: "imap.a.invalid", port: 993, user: "a@a.invalid" };
    const second: MailAccountConfig = { id: "b", label: "B", host: "imap.b.invalid", port: 993, user: "b@b.invalid" };
    await saveMailAccount(VAULT, first, "pa");
    await saveMailAccount(VAULT, second, "pb");
    expect((await listMailAccounts(VAULT)).map((a) => a.id)).toEqual(["a", "b"]);
    expect(await getMailPassword(VAULT, "a")).toBe("pa");
  });

  /**
   * The rollback on a REAL failure: the disk refuses the save. Neither the
   * account entry nor the password may stay behind — before the fix the entry
   * stayed, because the rollback did not recognise the list it had written.
   */
  it("rolls back entry and password when saving really fails", async () => {
    const existing: MailAccountConfig = { id: "keep", label: "Keep", host: "imap.k.invalid", port: 993, user: "k@k.invalid" };
    await saveMailAccount(VAULT, existing, "pk");
    store.failNextSave();
    const failed = saveMailAccount(VAULT, { id: "new", label: "New", host: "imap.n.invalid", port: 993, user: "n@n.invalid" }, "pn");
    await expect(failed).rejects.toThrow("disk full");
    expect(await listMailAccounts(VAULT)).toEqual([existing]);
    expect(secrets.has(mailSecretKey(VAULT, "new"))).toBe(false);
    expect(await getMailPassword(VAULT, "keep")).toBe("pk");
  });

  it("reports a write that did not land as storageFailed, and leaves nothing half-created", async () => {
    // A store that accepts the call and keeps nothing (a read-only profile).
    const set = store.set;
    store.set = async () => undefined;
    const failed = saveMailAccount(VAULT, { id: "x", label: "X", host: "imap.x.invalid", port: 993, user: "x@x.invalid" }, "px");
    await expect(failed).rejects.toBeInstanceOf(ServiceConnectionError);
    await expect(failed).rejects.toMatchObject({ reason: "storageFailed" });
    store.set = set;
    expect(await listMailAccounts(VAULT)).toEqual([]);
    expect(secrets.size).toBe(0);
  });
});
