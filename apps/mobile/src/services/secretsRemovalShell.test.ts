import { beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalSecretId, type SecretsBundle } from "@plainva/core";
import { calDavSecretBinding, imapSecretBinding, retiredServiceSignIn, setPlatformServices } from "@plainva/ui";

/**
 * What takes a calendar account or a mailbox away on the phone, run through
 * the phone's own secrets port (review 2026-11-25), as on the desktop
 * (`apps/desktop/src/services/secretsRemovalShell.test.ts`): only "Remove
 * account" writes a tombstone, also when a secrets round starts while the
 * account goes, and only once the calendar runtime is up; every other way
 * an account goes writes none; a slot signed out here is not signed in again
 * from elsewhere.
 */

const CAL = "https://cloud.example.com/remote.php/dav";
const state = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  slots: new Map<string, unknown>(),
  calendars: [] as Array<{ id: string; user: string }>,
  ready: true,
}));
vi.mock("./pim/pimService", () => ({
  listPimAccounts: vi.fn(async () => state.calendars.map((row) => ({ id: row.id, provider: "caldav", label: row.user, config: { url: "https://cloud.example.com/remote.php/dav", user: row.user }, enabled: true }))),
  isPimRuntimeReady: vi.fn(() => state.ready),
}));

import { createMobileSecretsPort, retireCalDavSecret, retireImapSecret } from "./mobileSecretsPort";
import { pimSecretKey } from "./pim/pimCredentials";
import { mailAccountsKey, mailSecretKey, removeMailAccount, removeMailAccountOnPurpose, type MailAccountConfig } from "@plainva/ui/mail";

const VAULT = "vault-1";

beforeEach(() => {
  state.store.clear();
  state.slots.clear();
  state.calendars = [];
  state.ready = true;
  setPlatformServices({
    loadSettings: async () => ({
      get: async <T,>(key: string) => (structuredClone(state.store.get(key)) as T | undefined) ?? null,
      set: async (key: string, value: unknown) => void state.store.set(key, structuredClone(value)),
      delete: async (key: string) => state.store.delete(key),
      keys: async () => [...state.store.keys()],
      save: async () => undefined,
    }),
    credentials: {
      readSecret: async <T,>(key: string) => (structuredClone(state.slots.get(key)) as T | undefined) ?? null,
      writeSecret: async (key: string, value: unknown) => void state.slots.set(key, structuredClone(value)),
      removeSecret: async (key: string) => void state.slots.delete(key),
    },
    openExternal: async () => undefined,
    noteAccountRemoved: async () => undefined,
    retireMailSecret: (vaultKey, mailbox, remove) => retireImapSecret(vaultKey, mailbox, remove),
  });
});

const calId = (user: string) => canonicalSecretId(calDavSecretBinding("webdav", CAL, user));
const mailbox = (id: string, user: string): MailAccountConfig => ({ id, label: user, host: "imap.example.com", port: 993, user });
const mailId = (user: string) => canonicalSecretId(imapSecretBinding("imap", "imap.example.com", 993, user));
const port = () => createMobileSecretsPort(VAULT);
function calendars(...users: string[]) {
  state.calendars = users.map((user, i) => ({ id: `c${i + 1}`, user }));
  users.forEach((user, i) => state.slots.set(pimSecretKey(VAULT, `c${i + 1}`), { kind: "caldav", url: CAL, user, pass: `${user}-pw` }));
}

describe("phone: what takes an account away, and what writes a tombstone", () => {
  it("\"Remove account\" of a calendar: a secrets round that starts while the account goes still writes its tombstone", async () => {
    calendars("anna", "bert");
    await port().exportBundle();
    let during: Promise<SecretsBundle> | null = null;
    // As `removePimAccount` does it: the mark, then the account in the same line.
    await retireCalDavSecret(VAULT, CAL, "anna", async () => {
      during = port().exportBundle();
      await new Promise((resolve) => setTimeout(resolve, 10));
      state.calendars = state.calendars.filter((row) => row.id !== "c1");
      state.slots.delete(pimSecretKey(VAULT, "c1"));
    });
    const raced = await during!;
    expect(raced.entries[calId("anna")]?.tombstone).toBe(true);
    expect(raced.entries[calId("bert")]?.secret).toEqual({ pass: "bert-pw" });
  });

  it("a calendar removal waits while the runtime is not up: a list without calendars is no removal", async () => {
    calendars("anna", "bert");
    await port().exportBundle();
    state.ready = false;
    await retireCalDavSecret(VAULT, CAL, "anna", async () => {
      state.calendars = state.calendars.filter((row) => row.id !== "c1");
    });
    expect((await port().exportBundle()).entries[calId("anna")]?.tombstone).toBeUndefined();
    state.ready = true;
    expect((await port().exportBundle()).entries[calId("anna")]?.tombstone).toBe(true);
  });

  it("a calendar account the profile takes away writes no tombstone", async () => {
    calendars("anna", "bert");
    await port().exportBundle();
    state.calendars = state.calendars.filter((row) => row.id !== "c1");
    state.slots.delete(pimSecretKey(VAULT, "c1"));
    const after = await port().exportBundle();
    expect(Object.values(after.entries).filter((entry) => entry.tombstone)).toEqual([]);
  });

  it("an IMAP mailbox: \"Remove account\" writes its tombstone, folding, replacing or undoing a connect writes none", async () => {
    state.store.set(mailAccountsKey(VAULT), [mailbox("m1", "anna@example.com"), mailbox("m2", "bert@example.com"), mailbox("m3", "carl@example.com")]);
    for (const [id, pass] of [["m1", "A1"], ["m2", "B1"], ["m3", "C1"]]) state.slots.set(mailSecretKey(VAULT, id), { pass });
    await port().exportBundle();
    await removeMailAccount(VAULT, "m1");
    expect((await port().exportBundle()).entries[mailId("anna@example.com")]).toBeUndefined();
    await removeMailAccountOnPurpose(VAULT, "m2");
    const removed = await port().exportBundle();
    expect(removed.entries[mailId("bert@example.com")]?.tombstone).toBe(true);
    expect(removed.entries[mailId("carl@example.com")]?.secret).toEqual({ pass: "C1" });
    expect(state.slots.has(mailSecretKey(VAULT, "m2"))).toBe(false);
  });

  it("a slot signed out here is not signed in again by a newer password from another device", async () => {
    calendars("anna");
    state.store.set(mailAccountsKey(VAULT), [mailbox("m1", "anna@example.com")]);
    state.slots.set(mailSecretKey(VAULT, "m1"), { pass: "M1" });
    const first = await port().exportBundle();
    state.slots.set(pimSecretKey(VAULT, "c1"), retiredServiceSignIn({ kind: "caldav", url: CAL, user: "anna", pass: "anna-pw" }));
    state.slots.set(mailSecretKey(VAULT, "m1"), retiredServiceSignIn({ pass: "M1" }));
    const newer: SecretsBundle = {
      ...first,
      entries: Object.fromEntries(
        Object.entries(first.entries).map(([id, entry]) => [id, { ...entry, entryRev: entry.entryRev + 1, updatedAt: "2026-11-25T12:00:00.000Z", deviceId: "laptop", secret: { pass: "changed" } }]),
      ),
    };
    const result = await port().importBundle(newer);
    expect(state.slots.get(pimSecretKey(VAULT, "c1"))).toMatchObject({ pass: "", signedOutHere: true });
    expect(state.slots.get(mailSecretKey(VAULT, "m1"))).toMatchObject({ pass: "", signedOutHere: true });
    expect(result.entries.map((entry) => entry.reason)).toEqual(["signed-out-here", "signed-out-here"]);
  });
});
