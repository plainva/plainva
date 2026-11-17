import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudAccountRecord, StoredAccountToken } from "@plainva/ui";

/**
 * "Remove account" whose sign-in could not be deleted (maintainer,
 * 2026-11-17): the deletion is owed, made up for when the vault opens and
 * before every new sign-in, and while it is owed the card is not signed in on
 * this device — also when the same card comes back through another device's
 * settings. The shared rule is `owedSignInDeletions.ts`; this is the desktop
 * broker that honours it (`apps/mobile/src/services/owedSignIns.test.ts` is
 * the phone's).
 */

const state = vi.hoisted(() => ({
  secrets: new Map<string, unknown>(),
  settings: new Map<string, unknown>(),
  records: [] as CloudAccountRecord[],
  failRemove: false,
}));

vi.mock("./CredentialManager", () => ({
  credentialManager: {
    readSecret: async (key: string) => state.secrets.get(key) ?? null,
    writeSecret: async (key: string, value: unknown) => void state.secrets.set(key, structuredClone(value)),
    removeSecret: async (key: string) => {
      if (state.failRemove) throw new Error("keychain refused");
      state.secrets.delete(key);
    },
  },
}));
vi.mock("./cloudAccounts", () => ({ loadCloudAccounts: async () => state.records }));
vi.mock("./settingsStore", () => ({
  getSettingsStore: async () => ({
    get: async (key: string) => state.settings.get(key),
    set: async (key: string, value: unknown) => void state.settings.set(key, structuredClone(value)),
    delete: async (key: string) => state.settings.delete(key),
    keys: async () => [...state.settings.keys()],
    save: async () => undefined,
  }),
}));
vi.mock("./authFetch", () => ({ microsoftAuthFetch: vi.fn() }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));

import { oweSignInDeletion, removeAccountCard, resetOwedSignInReports } from "@plainva/ui";
import { accountSecretKey, clearAccountToken, getAccountToken, owedSignInResources, saveAccountToken, settleOwedAccountSignIns } from "./accountBroker";
import { legacySlot } from "./keychainSlots";

const VAULT = "/vault";
const CARD: CloudAccountRecord = { id: "card-a", family: "google", label: "anna@gmail.com", services: {} };
const OLD: StoredAccountToken = { clientId: "client", refreshToken: "old-refresh" };

/** "Remove account" as the desktop wires it (`removeCloudAccount`). */
async function removeCard(): Promise<void> {
  await removeAccountCard({
    services: [],
    disable: async () => undefined,
    clearCardGrant: () => clearAccountToken(VAULT, CARD.id),
    oweCardGrant: (error) => oweSignInDeletion(owedSignInResources(VAULT), CARD.id, error),
    dropRecord: async () => {
      state.records = state.records.filter((record) => record.id !== CARD.id);
    },
  });
}

beforeEach(() => {
  state.secrets.clear();
  state.settings.clear();
  state.records = [CARD];
  state.failRemove = false;
  resetOwedSignInReports();
  state.secrets.set(accountSecretKey(VAULT, CARD.id), OLD);
  state.secrets.set(legacySlot.account(VAULT, CARD.id), OLD);
});

describe("a sign-in \"Remove account\" could not delete (desktop)", () => {
  it("is owed: the card goes, and while the card is back through the settings it is not signed in (red before: it came back signed in)", async () => {
    state.failRemove = true;
    await removeCard();
    expect(state.records).toEqual([]);
    expect(state.secrets.has(accountSecretKey(VAULT, CARD.id))).toBe(true);

    // Another device that had not seen the removal brings the card back.
    state.records = [CARD];
    expect(await getAccountToken(VAULT, CARD.id)).toBeNull();
  });

  it("is made up for once the keychain lets go, in both names, without a word", async () => {
    state.failRemove = true;
    await removeCard();
    // Still failing: it stays owed (that it is said once per session is the
    // shared rule's, held by the phone's test of the same module).
    expect(await settleOwedAccountSignIns(VAULT)).toEqual([CARD.id]);
    expect(await settleOwedAccountSignIns(VAULT)).toEqual([CARD.id]);

    state.failRemove = false;
    expect(await settleOwedAccountSignIns(VAULT)).toEqual([]);
    expect(state.secrets.has(accountSecretKey(VAULT, CARD.id))).toBe(false);
    expect(state.secrets.has(legacySlot.account(VAULT, CARD.id))).toBe(false);
    expect([...state.settings.keys()].filter((key) => key.startsWith("owedSignInDeletions_"))).toEqual([]);
  });

  it("a new sign-in of the card here is kept: nothing of the old one is merged into it, and the debt never takes it", async () => {
    state.failRemove = true;
    await removeCard();
    state.records = [CARD];
    state.failRemove = false;
    await saveAccountToken(VAULT, CARD.id, { clientId: "client", refreshToken: "new-refresh" });
    expect(await getAccountToken(VAULT, CARD.id)).toMatchObject({ refreshToken: "new-refresh" });
    expect(JSON.stringify(state.secrets.get(accountSecretKey(VAULT, CARD.id)))).not.toContain("old-refresh");

    expect(await settleOwedAccountSignIns(VAULT)).toEqual([]);
    expect(await getAccountToken(VAULT, CARD.id)).toMatchObject({ refreshToken: "new-refresh" });
  });
});
