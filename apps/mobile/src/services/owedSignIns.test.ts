// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudAccountRecord, StoredAccountToken } from "@plainva/ui";

/**
 * "Remove account" whose sign-in could not be deleted, on the phone
 * (maintainer, 2026-11-17) — the same rule as the desktop
 * (`apps/desktop/src/services/owedSignIns.test.ts`): the deletion is owed and
 * made up for, and while it is owed the card is not signed in here, also when
 * it comes back through another device's settings.
 */

const state = vi.hoisted(() => ({
  secrets: new Map<string, unknown>(),
  settings: new Map<string, unknown>(),
  records: [] as CloudAccountRecord[],
  failRemove: false,
}));

vi.mock("../platform/secureStore", () => ({
  secureCredentialStore: {
    readSecret: async (key: string) => state.secrets.get(key) ?? null,
    writeSecret: async (key: string, value: unknown) => void state.secrets.set(key, structuredClone(value)),
    removeSecret: async (key: string) => {
      if (state.failRemove) throw new Error("keystore refused");
      state.secrets.delete(key);
    },
  },
}));
vi.mock("./cloudAccountsStore", () => ({
  loadCloudAccounts: async () => state.records,
  saveCloudAccounts: async (_vault: string, records: CloudAccountRecord[]) => {
    state.records = records;
  },
}));
vi.mock("./googleNativeAuthorization", () => ({ clearNativeGoogleTokens: async () => undefined, authorizeNativeGoogle: vi.fn(), forgetNativeGoogleTokens: vi.fn() }));
vi.mock("./pim/pimService", () => ({ pimSyncNow: () => undefined, removePimAccount: async () => undefined }));
vi.mock("./mail/mailRuntime", () => ({ removeMobileMailAccount: async () => undefined }));
vi.mock("./syncService", () => ({ disconnectFiles: async () => undefined, restartSyncIfActive: async () => undefined }));

import { getPlatformServices, resetOwedSignInReports, setPlatformServices, toast, toastStore } from "@plainva/ui";
import { accountSecretKey, getAccountToken, saveAccountToken, settleOwedAccountSignIns } from "./accountBroker";
import { removeMobileAccount } from "./accountSignOut";

const VAULT = "v1";
const CARD: CloudAccountRecord = { id: "card-a", family: "google", label: "anna@gmail.com", services: {} };
/** The error notices the person saw. */
const errorToasts = () => toastStore.get().filter((item) => item.kind === "error");
const OLD: StoredAccountToken = { clientId: "client", refreshToken: "old-refresh" };

let previous: ReturnType<typeof getPlatformServices> | undefined;
beforeEach(() => {
  try { previous = getPlatformServices(); } catch { previous = undefined; }
  setPlatformServices({
    ...previous,
    loadSettings: async () => ({
      get: async (key: string) => state.settings.get(key),
      set: async (key: string, value: unknown) => void state.settings.set(key, structuredClone(value)),
      delete: async (key: string) => state.settings.delete(key),
      keys: async () => [...state.settings.keys()],
      save: async () => undefined,
    }),
  } as Parameters<typeof setPlatformServices>[0]);
  state.secrets.clear();
  state.settings.clear();
  state.records = [CARD];
  state.failRemove = false;
  toast.clearAll();
  resetOwedSignInReports();
  state.secrets.set(accountSecretKey(VAULT, CARD.id), OLD);
});

describe("a sign-in \"Remove account\" could not delete (phone)", () => {
  it("is owed: the card goes, and while the card is back through the settings it is not signed in (red before: it came back signed in)", async () => {
    state.failRemove = true;
    await removeMobileAccount(VAULT, CARD, { services: [] });
    expect(state.records).toEqual([]);
    expect(state.secrets.has(accountSecretKey(VAULT, CARD.id))).toBe(true);
    expect(errorToasts()).toHaveLength(1);

    state.records = [CARD];
    expect(await getAccountToken(VAULT, CARD.id)).toBeNull();
  });

  it("is made up for once the store lets go, said once per session while it keeps failing", async () => {
    state.failRemove = true;
    await removeMobileAccount(VAULT, CARD, { services: [] });
    expect(await settleOwedAccountSignIns(VAULT)).toEqual([CARD.id]);
    expect(errorToasts()).toHaveLength(1);
    state.failRemove = false;
    expect(await settleOwedAccountSignIns(VAULT)).toEqual([]);
    expect(state.secrets.has(accountSecretKey(VAULT, CARD.id))).toBe(false);
  });

  it("a new sign-in of the card here is kept, with nothing of the old one in it", async () => {
    state.failRemove = true;
    await removeMobileAccount(VAULT, CARD, { services: [] });
    state.records = [CARD];
    state.failRemove = false;
    await saveAccountToken(VAULT, CARD.id, { clientId: "client", refreshToken: "new-refresh" });
    expect(await getAccountToken(VAULT, CARD.id)).toMatchObject({ refreshToken: "new-refresh" });
    expect(JSON.stringify(state.secrets.get(accountSecretKey(VAULT, CARD.id)))).not.toContain("old-refresh");
    expect(await settleOwedAccountSignIns(VAULT)).toEqual([]);
    expect(await getAccountToken(VAULT, CARD.id)).toMatchObject({ refreshToken: "new-refresh" });
  });
});
