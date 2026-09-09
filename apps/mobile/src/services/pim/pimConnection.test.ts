import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPlatformServices, setPlatformServices, VERIFIED_PROVIDER_IDENTITY_KEY } from "@plainva/ui";
import type { PimAccountRow } from "@plainva/core";
import type { MobileVault } from "../vaultService";

const state = vi.hoisted(() => ({
  secrets: new Map<string, string>(), rows: new Map<string, PimAccountRow[]>(),
  started: vi.fn(), triggered: vi.fn(),
  probe: async () => {}, afterWrite: async () => {}, afterRead: async () => {}, failProbe: false,
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
vi.mock("../accountBroker", () => ({ brokerTokenProvider: async () => undefined }));
vi.mock("../../adapters/webdavHttp", () => ({
  allowHttpOrigin: async () => {},
  webdavFetch: async () => new Response(JSON.stringify({ id: "verified-subject", mail: "user@example.invalid" })),
}));
vi.mock("@plainva/core", async (original) => {
  const actual = await original<typeof import("@plainva/core")>();
  return { ...actual,
    refreshOneDriveAccessToken: async () => ({ accessToken: "access", refreshToken: "rotated", expiresIn: 3600 }),
    GraphPimTarget: class {
      async listCalendars() { await state.probe(); if (state.failProbe) throw Error("calendar unavailable"); return []; }
    },
    PimCacheRepository: class {
      constructor(private db: { name: string }) {}
      async listAccounts() { const rows = state.rows.get(this.db.name) ?? []; await state.afterRead(); return rows; }
      async upsertAccount(row: PimAccountRow) { state.rows.set(this.db.name, [...(state.rows.get(this.db.name) ?? []).filter(r => r.id !== row.id), row]); }
      async setScopeState() {}
      async reassignAccountRows() {}
      async deleteAccount() {}
    },
    PimWorker: class { start() { state.started(); } stop() {} async triggerImmediate() { state.triggered(); } },
  };
});

import { secureCredentialStore } from "../../platform/secureStore";
import { pimSecretKey } from "./pimCredentials";
import * as pim from "./pimService";

const vault = (id: string) => ({ vaultId: id, db: { name: id } }) as unknown as MobileVault;
const creds = { kind: "microsoft" as const, clientId: "client", refreshToken: "initial" };
let previousPlatform: ReturnType<typeof getPlatformServices> | undefined;
beforeEach(async () => {
  try { previousPlatform = getPlatformServices(); } catch { previousPlatform = undefined; }
  state.secrets.clear(); state.rows.clear(); state.failProbe = false;
  state.probe = async () => {}; state.afterWrite = async () => {}; state.afterRead = async () => {};
  state.started.mockClear(); state.triggered.mockClear();
  setPlatformServices({ ...previousPlatform, credentials: secureCredentialStore } as Parameters<typeof setPlatformServices>[0]);
  pim.stopPim(); await pim.startPim(vault("original"));
});
afterEach(() => { pim.stopPim(); if (previousPlatform) setPlatformServices(previousPlatform); });
async function switchVault() { pim.stopPim(); await pim.startPim(vault("other")); }

describe("actual mobile calendar connection lifecycle", () => {
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
