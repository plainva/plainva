import { beforeEach, describe, expect, it } from "vitest";
import { setPlatformServices } from "@plainva/ui";
import { listMailAccounts, mailAccountsKey, readStoredVacation, removeMailAccount, replaceMailbox, replacementMailAddress, saveStoredVacation, type MailAccountConfig } from "@plainva/ui/mail";

/**
 * Review of plan "Verbinden", finding 1: when Google refuses Gmail and the
 * account page connects it with an app password (E7), the new mailbox takes
 * the refused one's place with everything the person set on it, and the
 * refused one is removed for good - its tombstone keeps another device from
 * bringing it back through the settings profile.
 */

const settings = new Map<string, unknown>();
const secrets = new Map<string, unknown>();
const removed: Array<[string, string, string]> = [];

beforeEach(() => {
  settings.clear();
  secrets.clear();
  removed.length = 0;
  setPlatformServices({
    loadSettings: async () => ({
      get: async <T,>(key: string) => (settings.get(key) as T | undefined) ?? null,
      set: async (key: string, value: unknown) => { settings.set(key, value); },
      delete: async (key: string) => settings.delete(key),
      keys: async () => [...settings.keys()],
      save: async () => undefined,
    }),
    credentials: {
      readSecret: async <T,>(key: string) => (secrets.get(key) as T | undefined) ?? null,
      writeSecret: async (key: string, value: unknown) => { secrets.set(key, value); },
      removeSecret: async (key: string) => { secrets.delete(key); },
    },
    openExternal: async () => undefined,
    noteAccountRemoved: async (vault, kind, id) => { removed.push([vault, kind, id]); },
  });
});

const refused: MailAccountConfig = {
  id: "gmail-oauth",
  kind: "gmail",
  label: "Work mail",
  host: "imap.gmail.com",
  port: 993,
  user: "anna@gmail.com",
  smtpHost: "smtp.gmail.com",
  smtpPort: 465,
  signature: "Anna",
  signatures: { "anna@company.example": "Anna, Company" },
  senders: ["Anna <anna@company.example>"],
  sieveHost: "sieve.example",
  sievePort: 4190,
};
const replacement: MailAccountConfig = { id: "gmail-imap", label: "anna@gmail.com", host: "imap.gmail.com", port: 993, user: "anna@gmail.com", smtpHost: "smtp.gmail.com", smtpPort: 465 };

describe("replacing the mailbox Google refused (E7)", () => {
  it("carries over the name, signatures, senders, filter host and out-of-office notice", async () => {
    settings.set(mailAccountsKey("/v"), [refused, replacement]);
    await saveStoredVacation("/v", refused.id, { enabled: true, message: "Away until Monday" });

    await replaceMailbox("/v", refused.id, replacement.id);

    const [after] = await listMailAccounts("/v");
    expect(after).toEqual({
      ...replacement,
      label: "Work mail",
      signature: "Anna",
      signatures: { "anna@company.example": "Anna, Company" },
      senders: ["Anna <anna@company.example>"],
      sieveHost: "sieve.example",
      sievePort: 4190,
    });
    // Server, backend and user stay the new mailbox's own.
    expect(after.kind).toBeUndefined();
    expect(await readStoredVacation("/v", replacement.id)).toEqual({ enabled: true, message: "Away until Monday" });
    expect((await listMailAccounts("/v")).map((entry) => entry.id)).toEqual([replacement.id]);
  });

  it("leaves a tombstone for the refused mailbox, so the profile does not bring it back", async () => {
    settings.set(mailAccountsKey("/v"), [refused, replacement]);
    await replaceMailbox("/v", refused.id, replacement.id);
    expect(removed).toEqual([["/v", "mail", refused.id]]);
  });
});

describe("removing a mailbox", () => {
  it("leaves a tombstone, wherever it is removed from", async () => {
    settings.set(mailAccountsKey("/v"), [replacement]);
    await removeMailAccount("/v", replacement.id);
    expect(removed).toEqual([["/v", "mail", replacement.id]]);
  });
});

describe("the address the app-password mailbox signs in with", () => {
  it("is the refused mailbox's own, not the card's label", () => {
    expect(replacementMailAddress({ label: "Anna (work)", services: { mail: { mailAccountId: refused.id } } }, [refused])).toBe("anna@gmail.com");
  });

  it("is the card's label only for a card without a mailbox", () => {
    expect(replacementMailAddress({ label: "anna@gmail.com", services: {} }, [])).toBe("anna@gmail.com");
  });
});
