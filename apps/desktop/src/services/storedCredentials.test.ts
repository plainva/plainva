import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Net for the "stored access" overview (P5b, 2026-08-10).
 *
 * The overview exists because the keychain accumulates and nothing ever listed
 * it. Two things have to hold: a slot belonging to a vault that is no longer in
 * the recent list must still appear (that is the whole point — "forget this
 * vault" can no longer reach it), and no slot may be attributed to the wrong
 * vault, because the user decides what to delete based on that attribution.
 */

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

const slots = new Map<string, unknown>();
vi.mock("./CredentialManager", () => ({
  credentialManager: {
    readSecret: vi.fn(async (key: string) => slots.get(key) ?? null),
    writeSecret: vi.fn(async (key: string, value: unknown) => void slots.set(key, value)),
    removeSecret: vi.fn(async (key: string) => void slots.delete(key)),
  },
}));

import {
  knownVaultPathsFromSettings,
  listStoredCredentials,
  removeStoredCredential,
} from "./storedCredentials";
import { mailSecretKey } from "@plainva/ui/mail";

const b64 = (p: string) => btoa(unescape(encodeURIComponent(p)));
const LIVE = "/home/marco/Vaults/wiki";
const GONE = "/home/marco/KI-Projekte/MiniTestVault";

beforeEach(() => {
  store.clear();
  slots.clear();
});

describe("knownVaultPathsFromSettings", () => {
  it("reads vault paths back out of the per-vault key suffix", async () => {
    store.set(`dailyNotesFolder_${b64(LIVE)}`, "Journal");
    store.set(`mailAccounts_${b64(GONE)}`, []);
    store.set("recentVaults", [LIVE]); // global key, no suffix
    store.set("plainva-something_notbase64!", 1);

    expect(await knownVaultPathsFromSettings()).toEqual([GONE, LIVE].sort());
  });

  it("does not mistake a key that merely ends base64-shaped for a vault", async () => {
    // "abc" decodes, but re-encoding it does not give "abc" back.
    store.set("someSetting_abc", 1);
    expect(await knownVaultPathsFromSettings()).toEqual([]);
  });
});

describe("listStoredCredentials", () => {
  it("finds a leftover from a vault that is no longer in the recent list", async () => {
    // Only the live vault is in the list; the abandoned one left its settings
    // keys behind, which is the only remaining trace of it.
    store.set("recentVaults", [LIVE]);
    store.set(`dailyNotesFolder_${b64(LIVE)}`, "Journal");
    store.set(`dailyNotesFolder_${b64(GONE)}`, "Journal");
    slots.set(`drive_credentials_${b64(GONE)}`, { clientId: "x" });
    slots.set(`mkcache_${b64(LIVE)}`, "cached-key");

    const entries = await listStoredCredentials();

    expect(entries).toHaveLength(2);
    // Leftovers first: they are what the user came to decide about.
    expect(entries[0]).toMatchObject({ vaultPath: GONE, kind: "files", detail: "drive", orphaned: true });
    expect(entries[1]).toMatchObject({ vaultPath: LIVE, kind: "vault", detail: "master-key", orphaned: false });
  });

  it("attributes account, calendar and mail slots to the right vault and account", async () => {
    store.set("recentVaults", [LIVE]);
    store.set(`cloudAccounts_${b64(LIVE)}`, [
      {
        id: "card-1",
        family: "google",
        label: "person@example.invalid",
        services: { calendar: { pimAccountId: "pim-1" }, mail: { mailAccountId: "mail-1" } },
      },
    ]);
    slots.set(`account_card-1_${b64(LIVE)}`, { refreshToken: "t" });
    slots.set(`pim_pim-1_${b64(LIVE)}`, { kind: "caldav" });
    slots.set(mailSecretKey(LIVE, "mail-1"), { pass: "p" });
    // Same account id under ANOTHER vault must not be attributed to this one.
    store.set(`mailAccounts_${b64(GONE)}`, [{ id: "mail-1" }]);
    slots.set(mailSecretKey(GONE, "mail-1"), { pass: "p" });

    const entries = await listStoredCredentials();

    expect(entries.filter((e) => e.vaultPath === LIVE)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "account", detail: "card-1" }),
        expect.objectContaining({ kind: "calendar", detail: "pim-1" }),
        expect.objectContaining({ kind: "mail", detail: "mail-1" }),
      ]),
    );
    const other = entries.filter((e) => e.vaultPath === GONE);
    expect(other).toHaveLength(1);
    expect(other[0]).toMatchObject({ kind: "mail", detail: "mail-1", orphaned: true });
  });

  it("reports nothing for a vault whose slots are empty, and survives an unreadable one", async () => {
    store.set("recentVaults", [LIVE]);
    store.set(`dailyNotesFolder_${b64(LIVE)}`, "Journal");
    const { credentialManager } = await import("./CredentialManager");
    vi.mocked(credentialManager.readSecret).mockRejectedValueOnce(new Error("keychain locked"));

    await expect(listStoredCredentials()).resolves.toEqual([]);
  });

  it("cannot show a slot the settings store knows nothing about — the stated limit", async () => {
    // Deliberate: without a keychain enumeration a slot is only found if
    // Plainva can still DERIVE its name. A mailbox whose account record is gone
    // as well leaves no trace to derive from. Pinned so the limit is a known
    // property rather than a surprise the next time someone reads the list and
    // believes it is complete.
    store.set("recentVaults", []);
    store.set(`dailyNotesFolder_${b64(GONE)}`, "Journal");
    slots.set(mailSecretKey(GONE, "mail-forgotten"), { pass: "p" });

    expect(await listStoredCredentials()).toEqual([]);
  });

  it("removes exactly the one slot it was asked to", async () => {
    slots.set(`mkcache_${b64(LIVE)}`, "cached-key");
    slots.set(`mkcache_${b64(GONE)}`, "cached-key");

    await removeStoredCredential(`mkcache_${b64(GONE)}`);

    expect(slots.has(`mkcache_${b64(LIVE)}`)).toBe(true);
    expect(slots.has(`mkcache_${b64(GONE)}`)).toBe(false);
  });
});
