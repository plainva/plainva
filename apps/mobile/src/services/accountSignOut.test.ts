import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudAccountRecord } from "@plainva/ui";

const state = vi.hoisted(() => ({
  slots: new Map<string, string>(),
  saved: [] as unknown[],
  cleared: [] as string[],
  disconnected: [] as string[],
  paused: [] as string[],
}));
vi.mock("./accountCredentialStore", () => ({
  accountCredentialStore: {
    read: async (key: string) => state.slots.get(key) ?? null,
    compareAndSet: async (key: string, expected: string | null, value: string | null) => {
      if ((state.slots.get(key) ?? null) !== expected) return false;
      if (value === null) state.slots.delete(key); else state.slots.set(key, value);
      return true;
    },
  },
}));
vi.mock("./accountBroker", () => ({ clearAccountToken: async (_vault: string, id: string) => { state.cleared.push(id); } }));
vi.mock("./cloudAccountsStore", () => ({ loadCloudAccounts: async () => [], saveCloudAccounts: async (_vault: string, records: unknown[]) => { state.saved.push(records); } }));
vi.mock("./googleNativeAuthorization", () => ({ clearNativeGoogleTokens: async () => undefined }));
vi.mock("./pim/pimCredentials", () => ({ pimSecretKey: (vault: string, id: string) => `pim_${vault}_${id}` }));
vi.mock("./pim/pimService", () => ({ pimSyncNow: () => undefined, removePimAccount: async () => undefined }));
vi.mock("./mail/mailRuntime", () => ({ removeMobileMailAccount: async () => undefined }));
vi.mock("./syncSlot", () => ({ syncProviderSlot: (vault: string) => `sync_${vault}` }));
vi.mock("./vaultRegistry", () => ({ getActiveVaultEntry: async () => ({ id: "other" }) }));
vi.mock("./syncService", () => ({
  disconnectFiles: async (vault: string) => { state.disconnected.push(vault); state.slots.delete(`sync_${vault}`); },
  pauseProvider: async (vault: string) => { state.paused.push(vault); },
  restartSyncIfActive: async () => undefined,
}));

import { removeMobileAccount, signOutMobileAccountHere } from "./accountSignOut";

beforeEach(() => {
  state.slots.clear();
  state.saved.length = 0;
  state.cleared.length = 0;
  state.disconnected.length = 0;
  state.paused.length = 0;
});

describe("signing out on this phone (review finding 6)", () => {
  it("writes no record for a card that has none - a device-only act stays on the device", async () => {
    state.slots.set("pim_v_cal", JSON.stringify({ kind: "caldav", url: "https://dav", user: "anna", pass: "secret" }));
    await signOutMobileAccountHere("v", undefined, { services: ["calendar"], pimAccountId: "cal" });
    expect(state.saved).toEqual([]);
    expect(state.cleared).toEqual([]);
    expect(JSON.parse(state.slots.get("pim_v_cal")!)).toMatchObject({ pass: "", signedOutHere: true });
  });

  it("clears the card's own grant when it has a record", async () => {
    await signOutMobileAccountHere("v", "card-a", { services: [] });
    expect(state.cleared).toEqual(["card-a"]);
    expect(state.saved).toEqual([]);
  });
});

describe("removing an account on this phone (review finding 5a)", () => {
  it("takes the vault's stored sign-in out, as the desktop does, instead of only pausing", async () => {
    state.slots.set("sync_files-vault", JSON.stringify({ provider: "webdav", creds: { url: "https://dav", user: "anna", pass: "secret" } }));
    const record: CloudAccountRecord = { id: "card-a", family: "webdav", label: "anna", services: { files: { provider: "webdav" } } };
    await removeMobileAccount("v", record, { services: ["files"], vaultId: "files-vault" });
    expect(state.disconnected).toEqual(["files-vault"]);
    expect(state.paused).toEqual([]);
    expect(state.slots.has("sync_files-vault")).toBe(false);
  });
});
