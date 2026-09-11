import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPlatformServices, setPlatformServices, VERIFIED_PROVIDER_IDENTITY_KEY, type CloudAccountRecord } from "@plainva/ui";
import type { PimAccountRow } from "@plainva/core";
import type { MobileVault } from "../vaultService";

const state = vi.hoisted(() => ({
  secrets: new Map<string, string>(), rows: new Map<string, PimAccountRow[]>(),
  started: vi.fn(), triggered: vi.fn(),
  probe: async () => {}, afterWrite: async () => {}, afterRead: async () => {}, failProbe: false,
  settings: new Map<string, unknown>(), failSettingsSave: false, subject: "verified-subject", refreshes: [] as string[],
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => "android" }, registerPlugin: () => ({
  get: async ({key}: {key: string}) => ({ value: state.secrets.get(key) ?? null }),
  set: async ({key,value}: {key: string; value: string}) => { state.secrets.set(key,value); await state.afterWrite(); },
  remove: async ({key}: {key: string}) => { state.secrets.delete(key); },
}) }));
vi.mock("@capacitor/preferences", () => ({ Preferences: { get: async () => ({ value: null }), remove: async () => {} } }));
vi.mock("../../platform/capacitorPlatform", () => ({ capacitorCredentialStore: {} }));
vi.mock("../reminderScheduler", () => ({ rescheduleReminders: vi.fn() }));
vi.mock("../vaultService", () => ({ getMobileVault: () => null }));
vi.mock("../mobileSettingsSync", () => ({ noteAccountRemovedLocally: vi.fn() }));
vi.mock("./taskSyncRuntime", () => ({ startTaskSyncRuntime: vi.fn(), stopTaskSyncRuntime: vi.fn(), runMobileTaskSync: vi.fn() }));
vi.mock("../../platform/devicePim", () => ({ isDevicePimSupported: () => false }));
vi.mock("../../adapters/webdavHttp", () => ({
  allowHttpOrigin: async () => {},
  webdavFetch: async () => new Response(JSON.stringify({ id: state.subject, sub: state.subject, email: "user@example.invalid", mail: "user@example.invalid" })),
}));
vi.mock("@plainva/core", async (original) => {
  const actual = await original<typeof import("@plainva/core")>();
  return { ...actual,
    refreshOneDriveAccessToken: async () => ({ accessToken: "access", refreshToken: "rotated", expiresIn: 3600 }),
    refreshDriveAccessToken: async (creds: { refreshToken: string }) => { state.refreshes.push(creds.refreshToken); return { accessToken: "google-access", expiresIn: 3600 }; },
    GooglePimTarget: class {
      constructor(private auth: { getAccessToken(): Promise<string> }) {}
      async listCalendars() { await this.auth.getAccessToken(); await state.probe(); if (state.failProbe) throw Error("calendar unavailable"); return []; }
      async listTaskLists() { return []; }
    },
    GraphPimTarget: class {
      async listCalendars() { await state.probe(); if (state.failProbe) throw Error("calendar unavailable"); return []; }
      async listTaskLists() { return []; }
    },
    PimCacheRepository: class {
      constructor(private db: { name: string }) {}
      async listAccounts() { const rows = state.rows.get(this.db.name) ?? []; await state.afterRead(); return rows; }
      async upsertAccount(row: PimAccountRow) { state.rows.set(this.db.name, [...(state.rows.get(this.db.name) ?? []).filter(r => r.id !== row.id), row]); }
      async setScopeState() {}
      async replaceCalendars() {}
      async replaceTaskLists() {}
      async reassignAccountRows() {}
      async deleteAccount() {}
    },
    PimWorker: class { start() { state.started(); } stop() {} async triggerImmediate() { state.triggered(); } },
  };
});

import { secureCredentialStore } from "../../platform/secureStore";
import { pimSecretKey } from "./pimCredentials";
import { accountSecretKey, forgetAccountBroker } from "../accountBroker";
import * as pim from "./pimService";

const vault = (id: string) => ({ vaultId: id, db: { name: id } }) as unknown as MobileVault;
const creds = { kind: "microsoft" as const, clientId: "client", refreshToken: "initial" };
let previousPlatform: ReturnType<typeof getPlatformServices> | undefined;
beforeEach(async () => {
  try { previousPlatform = getPlatformServices(); } catch { previousPlatform = undefined; }
  state.secrets.clear(); state.rows.clear(); state.failProbe = false;
  state.settings.clear(); state.failSettingsSave = false; state.subject = "verified-subject"; state.refreshes = [];
  for (const id of ["selected", "other"]) forgetAccountBroker("original", id);
  state.probe = async () => {}; state.afterWrite = async () => {}; state.afterRead = async () => {};
  state.started.mockClear(); state.triggered.mockClear();
  setPlatformServices({ ...previousPlatform, credentials: secureCredentialStore, loadSettings: async () => ({
    keys: async () => [...state.settings.keys()], get: async <T>(key: string) => state.settings.get(key) as T ?? null, set: async (key: string, value: unknown) => { state.settings.set(key, value); },
    delete: async (key: string) => state.settings.delete(key), save: async () => { if (state.failSettingsSave) { state.failSettingsSave = false; throw new Error("settings unavailable"); } },
  }) } as Parameters<typeof setPlatformServices>[0]);
  pim.stopPim(); await pim.startPim(vault("original"));
});
afterEach(() => { pim.stopPim(); if (previousPlatform) setPlatformServices(previousPlatform); });
async function switchVault() { pim.stopPim(); await pim.startPim(vault("other")); }

describe("actual mobile calendar connection lifecycle", () => {
  const googleCreds = { kind: "google" as const, clientId: "client", clientSecret: "", refreshToken: "" };
  function source(scopes = "openid email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/tasks") {
    const selected: CloudAccountRecord = { id: "selected", family: "google", label: "Selected", verifiedProviderIdentity: { issuer: "google", subject: "verified-subject" }, services: { files: { provider: "drive" }, mail: { mailAccountId: "mail-working" } } };
    state.settings.set("cloudAccounts_original", [{ ...selected, id: "other", verifiedProviderIdentity: { issuer: "google", subject: "another-subject" } }, selected]);
    for (const id of ["other", "selected"]) state.secrets.set(accountSecretKey("original", id), JSON.stringify({ clientId: "client", refreshToken: id + "-token", scopes }));
    return { vaultId: "original", cloudAccountId: "selected", expectedIdentity: selected.verifiedProviderIdentity };
  }
  it("probes the explicitly selected existing grant before a new calendar binding exists", async () => {
    const context = source();
    const id = await pim.addPimAccount("google", "New", googleCreds, context);
    expect(state.refreshes).toEqual(["selected-token"]);
    const records = state.settings.get("cloudAccounts_original") as CloudAccountRecord[];
    expect(records.find(r => r.id === "selected")?.services).toEqual({ files: { provider: "drive" }, mail: { mailAccountId: "mail-working" }, calendar: { pimAccountId: id } });
    expect(records.find(r => r.id === "other")?.services.calendar).toBeUndefined();
    expect(state.started).toHaveBeenCalled();
    expect(JSON.parse(state.secrets.get(pimSecretKey("original", id))!).refreshToken).toBe("");
    expect(await pim.addPimAccount("google", "New", googleCreds, context)).toBe(id);
    expect(state.rows.get("original")).toHaveLength(1);
  });
  it("asks for consent for a Drive-only grant without touching working services", async () => {
    const context = source("https://www.googleapis.com/auth/drive.file");
    const before = [...state.secrets];
    await expect(pim.addPimAccount("google", "New", googleCreds, context)).rejects.toThrow("needsConsent");
    expect([...state.secrets]).toEqual(before); expect(state.rows.size).toBe(0);
  });
  it("refuses a different identity returned by the selected grant", async () => {
    const context = source(); state.subject = "unexpected-person";
    await expect(pim.addPimAccount("google", "New", googleCreds, context)).rejects.toThrow("wrongAccount");
    expect(state.rows.size).toBe(0); expect(state.secrets.size).toBe(2);
  });
  it("rolls back a failed new service binding and keeps file/mail slots", async () => {
    const context = source(); state.failSettingsSave = true;
    await expect(pim.addPimAccount("google", "New", googleCreds, context)).rejects.toThrow("settings unavailable");
    expect(state.rows.size).toBe(0); expect(state.secrets.size).toBe(2);
    expect((state.settings.get("cloudAccounts_original") as CloudAccountRecord[]).find(r => r.id === "selected")?.services.calendar).toBeUndefined();
    expect(state.triggered).not.toHaveBeenCalled();
  });
  it("keeps probe rotations in memory and saves the latest login when adopting", async () => {
    state.rows.set("original", [{ id: "existing", provider: "microsoft", label: "Old", enabled: true,
      config: { [VERIFIED_PROVIDER_IDENTITY_KEY]: { issuer: "microsoft", subject: "verified-subject" } } }]);
    state.probe = async () => { expect(state.secrets.size).toBe(0); };
    await pim.addPimAccount("microsoft", "New", creds);
    expect([...state.secrets.keys()]).toEqual([pimSecretKey("original", "existing")]);
    expect(JSON.parse(state.secrets.get(pimSecretKey("original", "existing"))!)).toMatchObject({ refreshToken: "rotated", loginRevision: expect.any(String) });
    expect(state.rows.get("original")).toHaveLength(1);
    expect(state.triggered).toHaveBeenCalledTimes(1);
  });
  it("a failed validation leaves no credential or account", async () => {
    state.failProbe = true;
    await expect(pim.addPimAccount("microsoft", "New", creds)).rejects.toThrow("calendar unavailable");
    expect(state.secrets.size).toBe(0); expect(state.rows.size).toBe(0);
  });
  it("a vault switch during validation cannot create or remove another vault's login", async () => {
    state.probe = switchVault;
    await expect(pim.addPimAccount("microsoft", "New", creds)).rejects.toThrow("runtime changed");
    expect(state.secrets.size).toBe(0); expect(state.rows.size).toBe(0);
    expect(state.triggered).not.toHaveBeenCalled();
  });
  it("a late credential acknowledgement cannot create an account in the new vault", async () => {
    state.afterWrite = switchVault;
    await expect(pim.addPimAccount("microsoft", "New", creds)).rejects.toThrow("runtime changed");
    expect(state.secrets.size).toBe(1);
    expect([...state.secrets.keys()][0]).toMatch(/^pim_original_/);
    expect(state.rows.size).toBe(0); expect(state.triggered).not.toHaveBeenCalled();
  });
  it("a switch while reading existing accounts stops before adopting", async () => {
    state.afterRead = async () => { state.afterRead = async () => {}; await switchVault(); };
    await expect(pim.addPimAccount("microsoft", "New", creds)).rejects.toThrow("runtime changed");
    expect(state.secrets.size).toBe(0); expect(state.rows.size).toBe(0);
  });
});
