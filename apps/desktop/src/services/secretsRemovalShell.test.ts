import { beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalSecretId, type PimAccountRow, type SecretsBundle } from "@plainva/core";
import { calDavSecretBinding, imapSecretBinding, retiredServiceSignIn, setPlatformServices } from "@plainva/ui";

/**
 * What takes a calendar account or a mailbox away on the desktop, run through
 * the desktop's own secrets port (review 2026-11-25): only "Remove account"
 * writes a tombstone, and it does so even when a secrets round starts while
 * the account is being removed; every other way an account goes writes none;
 * a slot signed out here is not signed in again from elsewhere. The phone
 * holds the same in `apps/mobile/src/services/secretsRemovalShell.test.ts`;
 * the fleets in `secretsRemovalFleet.test.ts`.
 */

const state = vi.hoisted(() => ({ store: new Map<string, unknown>(), slots: new Map<string, unknown>(), refuseRetired: false }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("./settingsProfile", () => ({ noteAccountRemovedLocally: vi.fn(async () => undefined), getDeviceId: async () => "laptop" }));
vi.mock("./pim/pimAuth", () => ({ authorizeGooglePim: vi.fn(), authorizeMicrosoftPim: vi.fn(), buildPimAuthProvider: vi.fn() }));
vi.mock("./cloudAccounts", () => ({ loadCloudAccounts: vi.fn(async () => []) }));
vi.mock("./settingsStore", () => ({
  getSettingsStore: vi.fn(async () => ({
    get: async (key: string) => structuredClone(state.store.get(key) ?? null),
    set: async (key: string, value: unknown) => {
      if (state.refuseRetired && key.startsWith("settingsSyncSecretRetired_")) throw new Error("store refused");
      state.store.set(key, structuredClone(value));
    },
    delete: async (key: string) => state.store.delete(key),
    keys: async () => [...state.store.keys()],
    save: async () => undefined,
  })),
}));
vi.mock("./CredentialManager", () => ({
  credentialManager: {
    readSecret: vi.fn(async (key: string) => structuredClone(state.slots.get(key) ?? null)),
    secretsMarkKey: vi.fn(async (fresh: string) => {
      const held = state.slots.get("settingsSyncSecretsMarkKey");
      if (typeof held === "string") return held;
      state.slots.set("settingsSyncSecretsMarkKey", fresh);
      return fresh;
    }),
    writeSecret: vi.fn(async (key: string, value: unknown) => void state.slots.set(key, structuredClone(value))),
    removeSecret: vi.fn(async (key: string) => void state.slots.delete(key)),
  },
}));

import { createDesktopSecretsPort, retireImapSecret } from "./settingsSecrets";
import { removePimAccount } from "./pim/pimAccounts";
import { pimSecretKey } from "./pim/pimCredentials";
import type { PimRuntime } from "./pim/pimRuntime";
import { mailAccountsKey, mailSecretKey, removeMailAccount, removeMailAccountOnPurpose, type MailAccountConfig } from "@plainva/ui/mail";

const VAULT = "/vaults/wiki";
const CAL = "https://cloud.example.com/remote.php/dav";
let tick = 0;

beforeEach(() => {
  state.store.clear();
  state.slots.clear();
  state.refuseRetired = false;
  tick = 0;
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

function calendar(rows: PimAccountRow[], onDelete?: () => Promise<void>) {
  const runtime = {
    cache: {
      listAccounts: async () => rows.map((row) => ({ ...row })),
      deleteAccount: async (id: string) => {
        await onDelete?.();
        rows.splice(0, rows.length, ...rows.filter((row) => row.id !== id));
      },
    },
  } as unknown as PimRuntime;
  return runtime;
}
const calRow = (id: string, user: string): PimAccountRow => ({ id, provider: "caldav", label: user, config: { url: CAL, user }, enabled: true });
const calId = (user: string) => canonicalSecretId(calDavSecretBinding("webdav", CAL, user));
const mailbox = (id: string, user: string): MailAccountConfig => ({ id, label: user, host: "imap.example.com", port: 993, user });
const mailId = (user: string) => canonicalSecretId(imapSecretBinding("imap", "imap.example.com", 993, user));
const now = () => new Date(Date.parse("2026-11-25T00:00:00.000Z") + 1000 * tick++).toISOString();
const portFor = (runtime: PimRuntime | null) => {
  const port = createDesktopSecretsPort(VAULT, runtime);
  return { exportBundle: () => port.exportBundle(), importBundle: (bundle: SecretsBundle) => port.importBundle(bundle) };
};

describe("desktop: what takes an account away, and what writes a tombstone", () => {
  it("\"Remove account\" of a calendar: a secrets round that starts while the row goes still writes its tombstone", async () => {
    const rows = [calRow("c1", "anna"), calRow("c2", "bert")];
    state.slots.set(pimSecretKey(VAULT, "c1"), { kind: "caldav", url: CAL, user: "anna", pass: "A1" });
    state.slots.set(pimSecretKey(VAULT, "c2"), { kind: "caldav", url: CAL, user: "bert", pass: "B1" });
    let during: Promise<SecretsBundle> | null = null;
    const runtime = calendar(rows, async () => {
      // The sync worker's round, between the mark and the row's removal.
      during = portFor(runtime).exportBundle();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    await portFor(runtime).exportBundle();
    await removePimAccount(runtime, VAULT, "c1");
    const raced = await during!;
    expect(raced.entries[calId("anna")]?.tombstone).toBe(true);
    expect(raced.entries[calId("bert")]?.secret).toEqual({ pass: "B1" });
    expect(state.slots.has(pimSecretKey(VAULT, "c1"))).toBe(false);
  });

  it("a calendar account the profile takes away, or folds into another, writes no tombstone", async () => {
    const rows = [calRow("c1", "anna"), calRow("c2", "bert")];
    state.slots.set(pimSecretKey(VAULT, "c1"), { kind: "caldav", url: CAL, user: "anna", pass: "A1" });
    state.slots.set(pimSecretKey(VAULT, "c2"), { kind: "caldav", url: CAL, user: "bert", pass: "B1" });
    const runtime = calendar(rows);
    await portFor(runtime).exportBundle();
    // What the profile import does (`deletePimAccount` of the settings port): the row and its slot.
    await runtime.cache.deleteAccount("c1");
    state.slots.delete(pimSecretKey(VAULT, "c1"));
    const after = await portFor(runtime).exportBundle();
    expect(Object.values(after.entries).filter((entry) => entry.tombstone)).toEqual([]);
  });

  it("an IMAP mailbox: \"Remove account\" writes its tombstone, folding, replacing or undoing a connect writes none", async () => {
    state.store.set(mailAccountsKey(VAULT), [mailbox("m1", "anna@example.com"), mailbox("m2", "bert@example.com"), mailbox("m3", "carl@example.com")]);
    for (const [id, pass] of [["m1", "A1"], ["m2", "B1"], ["m3", "C1"]]) state.slots.set(mailSecretKey(VAULT, id), { pass });
    await portFor(null).exportBundle();
    // A duplicate folded away, a replaced mailbox, an unfinished connect undone: `removeMailAccount` alone.
    await removeMailAccount(VAULT, "m1");
    const folded = await portFor(null).exportBundle();
    expect(folded.entries[mailId("anna@example.com")]).toBeUndefined();
    // "Remove account": an act — and the calendar runtime is not needed for it.
    await removeMailAccountOnPurpose(VAULT, "m2");
    const removed = await portFor(null).exportBundle();
    expect(removed.entries[mailId("bert@example.com")]?.tombstone).toBe(true);
    expect(removed.entries[mailId("anna@example.com")]).toBeUndefined();
    expect(removed.entries[mailId("carl@example.com")]?.secret).toEqual({ pass: "C1" });
    expect(state.slots.has(mailSecretKey(VAULT, "m2"))).toBe(false);
  });

  it("a slot signed out here is not signed in again by a newer password from another device", async () => {
    const rows = [calRow("c1", "anna")];
    const runtime = calendar(rows);
    state.store.set(mailAccountsKey(VAULT), [mailbox("m1", "anna@example.com")]);
    state.slots.set(pimSecretKey(VAULT, "c1"), { kind: "caldav", url: CAL, user: "anna", pass: "A1" });
    state.slots.set(mailSecretKey(VAULT, "m1"), { pass: "M1" });
    const first = await portFor(runtime).exportBundle();
    // "Sign out on this device" (`retiredServiceSignIn`), as both shells write it.
    state.slots.set(pimSecretKey(VAULT, "c1"), retiredServiceSignIn({ kind: "caldav", url: CAL, user: "anna", pass: "A1" }));
    state.slots.set(mailSecretKey(VAULT, "m1"), retiredServiceSignIn({ pass: "M1" }));
    const newer: SecretsBundle = {
      ...first,
      entries: Object.fromEntries(
        Object.entries(first.entries).map(([id, entry]) => [id, { ...entry, entryRev: entry.entryRev + 1, updatedAt: now(), deviceId: "phone", secret: { pass: "changed" } }]),
      ),
    };
    const result = await portFor(runtime).importBundle(newer);
    expect(state.slots.get(pimSecretKey(VAULT, "c1"))).toMatchObject({ pass: "", signedOutHere: true });
    expect(state.slots.get(mailSecretKey(VAULT, "m1"))).toMatchObject({ pass: "", signedOutHere: true });
    expect(result.entries.map((entry) => entry.reason)).toEqual(["signed-out-here", "signed-out-here"]);
  });
});

describe("desktop: a removal whose note for the secrets sync cannot be written does not happen, and says so", () => {
  // Review 2026-11-26, fourth round (M2): the act is the one writer of the
  // tombstone, so the account may only go once its removal is written —
  // whether or not the code that writes it has loaded, whether or not the
  // store takes it.
  it("an IMAP mailbox, while the code that writes the note does not load", async () => {
    state.store.set(mailAccountsKey(VAULT), [mailbox("m2", "bert@example.com")]);
    state.slots.set(mailSecretKey(VAULT, "m2"), { pass: "B1" });
    await portFor(null).exportBundle();
    const services = { ...(await import("@plainva/ui")).getPlatformServices() };
    setPlatformServices({ ...services, retireMailSecret: () => Promise.reject(new TypeError("Failed to fetch dynamically imported module")) });
    await expect(removeMailAccountOnPurpose(VAULT, "m2")).rejects.toThrow("dynamically imported module");
    expect((state.store.get(mailAccountsKey(VAULT)) as MailAccountConfig[]).map((row) => row.id), "the mailbox stays").toEqual(["m2"]);
    expect(state.slots.get(mailSecretKey(VAULT, "m2"))).toEqual({ pass: "B1" });
    // Once it loads, the same act removes the mailbox and writes its tombstone.
    setPlatformServices(services);
    await removeMailAccountOnPurpose(VAULT, "m2");
    expect((await portFor(null).exportBundle()).entries[mailId("bert@example.com")]?.tombstone).toBe(true);
  });

  it("an IMAP mailbox and a calendar account, while the store refuses the note", async () => {
    const rows = [calRow("c1", "anna")];
    const runtime = calendar(rows);
    state.slots.set(pimSecretKey(VAULT, "c1"), { kind: "caldav", url: CAL, user: "anna", pass: "A1" });
    state.store.set(mailAccountsKey(VAULT), [mailbox("m2", "bert@example.com")]);
    state.slots.set(mailSecretKey(VAULT, "m2"), { pass: "B1" });
    await portFor(runtime).exportBundle();
    state.refuseRetired = true;
    await expect(removePimAccount(runtime, VAULT, "c1")).rejects.toThrow("store refused");
    await expect(removeMailAccountOnPurpose(VAULT, "m2")).rejects.toThrow("store refused");
    expect(rows.map((row) => row.id), "the calendar account stays").toEqual(["c1"]);
    expect((state.store.get(mailAccountsKey(VAULT)) as MailAccountConfig[]).map((row) => row.id), "the mailbox stays").toEqual(["m2"]);
    state.refuseRetired = false;
    await removePimAccount(runtime, VAULT, "c1");
    await removeMailAccountOnPurpose(VAULT, "m2");
    const after = await portFor(runtime).exportBundle();
    expect(after.entries[calId("anna")]?.tombstone).toBe(true);
    expect(after.entries[mailId("bert@example.com")]?.tombstone).toBe(true);
  });
});
