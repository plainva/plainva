import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeAccountMap, rememberRemovedAccount, type CloudAccountRecord } from "@plainva/ui";
import type { PimAccountRow } from "@plainva/core";

/**
 * The account cards while the accounts of a rebuilt index database are held
 * (`restoreAccountsAfterRebuild`): an account not back yet keeps its card's
 * calendar reference, one by one, until the settings sync has applied the
 * document. An account removed on this device is no such account: its row is
 * gone because it was removed, and the card must say so at once — not show the
 * calendar as connected until a settings-sync cycle comes (offline: never).
 */

const stored = new Map<string, unknown>();
vi.mock("./settingsStore", () => ({
  getSettingsStore: async () => ({
    get: async (key: string) => stored.get(key),
    set: async (key: string, value: unknown) => { stored.set(key, structuredClone(value)); },
    save: async () => undefined,
  }),
}));
vi.mock("./CredentialManager", () => ({
  credentialManager: {
    getDriveCredentials: async () => null,
    getOneDriveCredentials: async () => null,
    getDropboxCredentials: async () => null,
    getS3Credentials: async () => null,
    getWebDavCredentials: async () => null,
  },
}));
let mailboxes: { id: string; label: string; user: string; host: string; kind: "microsoft" }[] = [];
vi.mock("@plainva/ui/mail", () => ({
  listMailAccounts: async () => mailboxes,
  mailAccountKind: (account: { kind?: string }) => account.kind ?? "imap",
}));
vi.mock("./pim/pimCredentials", () => ({ getPimCredentials: async () => null }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));

import { cloudAccountsRegistryKey, loadCloudAccounts, refreshCloudAccounts } from "./cloudAccounts";
import { profileAccountMapKey } from "./profileAccountMap";
import type { PimRuntime } from "./pim/pimRuntime";

const VAULT = "/vaults/notes";
const row = (id: string, label: string): PimAccountRow => ({ id, provider: "microsoft", label, config: {}, enabled: true } as PimAccountRow);
const card = (id: string, label: string, services: CloudAccountRecord["services"]): CloudAccountRecord => ({ id, family: "microsoft", label, services });
const heldRuntime = (rows: PimAccountRow[]) =>
  ({
    cache: { listAccounts: async () => rows, accountsAfterRebuild: async () => "held", upsertAccount: async () => undefined },
    isActive: () => false,
  }) as unknown as PimRuntime;

describe("the desktop's account cards while the rebuilt accounts are held", () => {
  beforeEach(() => {
    stored.clear();
    mailboxes = [];
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("CustomEvent", class extends Event { constructor(type: string) { super(type); } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("an account not back yet keeps its card's reference", async () => {
    stored.set(cloudAccountsRegistryKey(VAULT), [card("card-a", "anna@example.com", { calendar: { pimAccountId: "pim-1" } }), card("card-b", "ben@example.com", { calendar: { pimAccountId: "pim-2" } })]);
    await refreshCloudAccounts(VAULT, heldRuntime([row("pim-1", "anna@example.com")]));
    expect((await loadCloudAccounts(VAULT)).map((c) => [c.id, c.services.calendar?.pimAccountId])).toEqual([["card-a", "pim-1"], ["card-b", "pim-2"]]);
  });

  it("an account removed on this device does not keep it: the card stops showing the calendar at once", async () => {
    mailboxes = [{ id: "mail-2", label: "ben@example.com", user: "ben@example.com", host: "", kind: "microsoft" }];
    stored.set(cloudAccountsRegistryKey(VAULT), [card("card-a", "anna@example.com", { calendar: { pimAccountId: "pim-1" } }), card("card-b", "ben@example.com", { calendar: { pimAccountId: "pim-2" }, mail: { mailAccountId: "mail-2" } })]);
    // Removed here in this window: the row is gone and the tombstone is written (`noteAccountRemovedLocally`).
    stored.set(profileAccountMapKey(VAULT), rememberRemovedAccount(normalizeAccountMap(null), "pim", "pim-2"));
    await refreshCloudAccounts(VAULT, heldRuntime([row("pim-1", "anna@example.com")]));
    const cards = await loadCloudAccounts(VAULT);
    expect(cards.find((c) => c.id === "card-a")?.services.calendar).toEqual({ pimAccountId: "pim-1" });
    expect(cards.find((c) => c.id === "card-b")?.services).toEqual({ mail: { mailAccountId: "mail-2" } });
  });
});
