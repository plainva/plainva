import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPlatformServices, setPlatformServices, VERIFIED_PROVIDER_IDENTITY_KEY, type CloudAccountRecord } from "@plainva/ui";
import type { PimAccountRow } from "@plainva/core";
import type { MobileVault } from "../vaultService";

const state = vi.hoisted(() => ({
  secrets: new Map<string, string>(), rows: new Map<string, PimAccountRow[]>(),
  started: vi.fn(), triggered: vi.fn(),
  probe: async () => {}, afterWrite: async () => {}, afterRead: async () => {}, failProbe: false,
  settings: new Map<string, unknown>(), failSettingsSave: false, subject: "verified-subject", refreshes: [] as string[],
  cached: [] as string[],
  principalOf: (() => undefined) as (creds: { url: string; user: string }) => string | undefined,
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
vi.mock("../mobileSettingsSync", () => ({ noteAccountRemovedLocally: vi.fn(), mobileSyncDeviceId: async () => "phone" }));
vi.mock("./taskSyncRuntime", () => ({ startTaskSyncRuntime: vi.fn(), stopTaskSyncRuntime: vi.fn(), runMobileTaskSync: vi.fn(), runMobileEntryEventSync: vi.fn() }));
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
    CalDavPimTarget: class {
      constructor(private creds: { url: string; user: string }) {}
      async listCalendars() { await state.probe(); return [{ id: "personal", name: "Personal" }]; }
      async listTaskLists() { return []; }
      confirmedAccess() {
        const principal = state.principalOf(this.creds);
        return { url: this.creds.url, user: this.creds.user, ...(principal ? { principal } : {}) };
      }
    },
    PimCacheRepository: class {
      constructor(private db: { name: string }) {}
      async listAccounts() { const rows = state.rows.get(this.db.name) ?? []; await state.afterRead(); return rows; }
      async upsertAccount(row: PimAccountRow) { state.rows.set(this.db.name, [...(state.rows.get(this.db.name) ?? []).filter(r => r.id !== row.id), row]); }
      async setScopeState() {}
      async replaceCalendars() {}
      async replaceTaskLists() {}
      async reassignAccountRows() {}
      async deleteAccount(id: string) { state.rows.set(this.db.name, (state.rows.get(this.db.name) ?? []).filter(r => r.id !== id)); }
      async listCalendars(id?: string) { return state.cached.filter(c => c === id); }
      async listTaskLists() { return []; }
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
  state.settings.clear(); state.failSettingsSave = false; state.subject = "verified-subject"; state.refreshes = []; state.cached = []; state.principalOf = () => undefined;
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
  // The second attempt after a failed Google sign-in read "the target account
  // or vault changed" although neither had. Two ways there, both reproduced:
  it("accounts arriving from another device restart the calendar only after the sign-in in flight is stored", async () => {
    let restart: Promise<void> | undefined;
    // Returning to the app from the provider's dialog is when the settings sync imports.
    state.probe = async () => { state.probe = async () => {}; restart = pim.restartPimAfterImport(vault("original")); await Promise.resolve(); };
    const id = await pim.addPimAccount("microsoft", "New", creds);
    await restart;
    expect(state.rows.get("original")?.map((row) => row.id)).toEqual([id]);
    expect(pim.isPimRuntimeReady()).toBe(true);
    // ...and a connection that starts while the restart is under way waits for the new runtime.
    const again = pim.restartPimAfterImport(vault("original"));
    await expect(pim.reauthorizePimAccount(id, creds)).resolves.toBeUndefined();
    await again;
  });
  it("signs in the account's own calendar row that arrived with the settings of another device", async () => {
    const context = source();
    const records = state.settings.get("cloudAccounts_original") as CloudAccountRecord[];
    state.settings.set("cloudAccounts_original", records.map((r) => r.id === "selected" ? { ...r, services: { ...r.services, calendar: { pimAccountId: "synced" } } } : r));
    // An older row: no verified identity of its own, and no credential on this device.
    state.rows.set("original", [{ id: "synced", provider: "google", label: "Selected", enabled: true, config: {} }]);
    expect(await pim.addPimAccount("google", "New", googleCreds, context)).toBe("synced");
    expect(state.rows.get("original")?.map((row) => row.id)).toEqual(["synced"]);
    expect(state.secrets.has(pimSecretKey("original", "synced"))).toBe(true);
    expect((state.settings.get("cloudAccounts_original") as CloudAccountRecord[]).find((r) => r.id === "selected")?.services.calendar).toEqual({ pimAccountId: "synced" });
  });
  it("still refuses a second row when the bound row is signed in on this device", async () => {
    const context = source();
    const records = state.settings.get("cloudAccounts_original") as CloudAccountRecord[];
    state.settings.set("cloudAccounts_original", records.map((r) => r.id === "selected" ? { ...r, services: { ...r.services, calendar: { pimAccountId: "synced" } } } : r));
    state.rows.set("original", [{ id: "synced", provider: "google", label: "Selected", enabled: true, config: {} }]);
    state.secrets.set(pimSecretKey("original", "synced"), JSON.stringify({ kind: "google", clientId: "client", clientSecret: "", refreshToken: "kept" }));
    await expect(pim.addPimAccount("google", "New", googleCreds, context)).rejects.toThrow("accountChanged");
    expect(JSON.parse(state.secrets.get(pimSecretKey("original", "synced"))!).refreshToken).toBe("kept");
  });
  it("a card still naming a calendar row this device removed takes the new one (Sammelplan § 3.105)", async () => {
    const context = source();
    const records = state.settings.get("cloudAccounts_original") as CloudAccountRecord[];
    state.settings.set("cloudAccounts_original", records.map((r) => r.id === "selected" ? { ...r, services: { ...r.services, calendar: { pimAccountId: "removed" } } } : r));
    state.rows.set("original", []);
    const id = await pim.addPimAccount("google", "New", googleCreds, context);
    expect((state.settings.get("cloudAccounts_original") as CloudAccountRecord[]).find((r) => r.id === "selected")?.services.calendar).toEqual({ pimAccountId: id });
  });
});

describe("a refused event write on the phone (issue 119, R2)", () => {
  // The phone threw before it asked for a cycle: the screen kept the stale
  // etag, and "Try again" was refused the same way until the next scheduled
  // cycle - on a phone, whenever the app next came to the front.
  const event = { accountId: "nowhere", calendarId: "c1", uid: "ev-1", title: "Planning", start: { ts: 1 }, end: { ts: 2 }, allDay: false, etag: '"v1"' };

  it("a delete that is refused still asks for a cycle", async () => {
    state.triggered.mockClear();
    await expect(pim.deletePimEvent(event)).rejects.toThrow();
    expect(state.triggered).toHaveBeenCalledTimes(1);
  });

  it("so does an edit that is refused", async () => {
    state.triggered.mockClear();
    await expect(pim.updatePimEvent(event, { title: "Planning", start: { ts: 1 }, end: { ts: 2 }, allDay: false })).rejects.toThrow();
    expect(state.triggered).toHaveBeenCalledTimes(1);
  });
});

/**
 * GitHub #174 (Fehlerliste C13, C14) on the phone. A CalDAV row was written
 * with `config: {}`: neither a further connect nor the settings of another
 * device could ever find it by its server and user, so each added a row.
 */
describe("a CalDAV account that is already here", () => {
  const nextcloud = { kind: "caldav" as const, url: "https://cloud.example.com/remote.php/dav", user: "anna", pass: "first" };

  it("keeps one row on a further connect and stores its address in the row", async () => {
    const first = await pim.addPimAccount("caldav", "Nextcloud", nextcloud);
    const again = await pim.addPimAccount("caldav", "Nextcloud", { ...nextcloud, url: "https://cloud.example.com:443/remote.php/dav/", user: " anna ", pass: "second" });
    expect(again).toBe(first);
    const rows = state.rows.get("original")!;
    expect(rows.map(r => r.id)).toEqual([first]);
    expect(rows[0].config).toMatchObject({ url: "https://cloud.example.com:443/remote.php/dav/" });
    expect(JSON.parse(state.secrets.get(pimSecretKey("original", first))!)).toMatchObject({ pass: "second" });
  });

  it("keeps \"Anna\" and \"anna\" apart while no server said they are one", async () => {
    const upper = await pim.addPimAccount("caldav", "Nextcloud", { ...nextcloud, user: "Anna" });
    const lower = await pim.addPimAccount("caldav", "Nextcloud", { ...nextcloud, user: "anna", pass: "hers" });
    expect(lower).not.toBe(upper);
    expect(JSON.parse(state.secrets.get(pimSecretKey("original", upper))!)).toMatchObject({ user: "Anna", pass: "first" });
  });

  it("joins them when the server names one principal for both, and records it", async () => {
    state.principalOf = () => "https://cloud.example.com/remote.php/dav/principals/users/anna/";
    const upper = await pim.addPimAccount("caldav", "Nextcloud", { ...nextcloud, user: "Anna" });
    const lower = await pim.addPimAccount("caldav", "Nextcloud", { ...nextcloud, user: "anna" });
    expect(lower).toBe(upper);
    // Recorded as THIS device's confirmed access (GitHub issue 174).
    expect(state.rows.get("original")![0].config.confirmedAccess).toEqual({
      phone: { url: nextcloud.url, user: "anna", principal: "https://cloud.example.com/remote.php/dav/principals/users/anna/", seq: expect.any(Number) },
    });
  });

  it("lands in the row of the card it was started from, as on the desktop (adoptPreferenceForCard)", async () => {
    const row = (id: string): PimAccountRow => ({ id, provider: "caldav", label: "anna", config: { url: nextcloud.url, user: "anna" }, enabled: true });
    state.rows.set("original", [row("r1"), row("r3")]);
    state.settings.set("cloudAccounts_original", [
      { id: "A", family: "webdav", flavor: "nextcloud", label: "anna", services: { calendar: { pimAccountId: "r1" } } },
      { id: "C", family: "webdav", flavor: "nextcloud", label: "anna", services: { calendar: { pimAccountId: "r3" } } },
    ] satisfies CloudAccountRecord[]);
    const id = await pim.addPimAccount("caldav", "Nextcloud", nextcloud, { vaultId: "original", cloudAccountId: "C" });
    expect(id).toBe("r3");
  });

  it("writes the server and the user of a repair into the row (red before: the row kept the old ones)", async () => {
    const id = await pim.addPimAccount("caldav", "Nextcloud", nextcloud);
    await pim.reauthorizePimAccount(id, { ...nextcloud, url: "https://dav.example.com/", user: "bert", pass: "new" });
    expect(state.rows.get("original")!.find(r => r.id === id)!.config).toEqual({
      url: "https://dav.example.com/",
      user: "bert",
      confirmedAccess: { phone: { url: "https://dav.example.com/", user: "bert", seq: expect.any(Number) } },
    });
  });

  it("a repair replaces only this device's confirmed access; another device's stays as it confirmed it", async () => {
    const laptop = { url: "https://cloud.example.com/remote.php/dav", user: "anna", principal: "https://cloud.example.com/remote.php/dav/principals/users/anna/" };
    state.rows.set("original", [{ id: "r1", provider: "caldav", label: "anna", config: { url: nextcloud.url, user: "anna", confirmedAccess: { laptop, phone: { url: nextcloud.url, user: "anna" } } }, enabled: true }]);
    await pim.reauthorizePimAccount("r1", { ...nextcloud, url: "http://192.168.1.5/remote.php/dav", pass: "new" });
    expect(state.rows.get("original")![0].config.confirmedAccess).toEqual({ laptop, phone: { url: "http://192.168.1.5/remote.php/dav", user: "anna", seq: expect.any(Number) } });
  });

  it("does not give a card's row the sign-in of another user whose name differs only in case (red before: the card's label said yes to every row)", async () => {
    state.rows.set("original", [{ id: "r", provider: "caldav", label: "alice@cloud.example.com", config: { url: nextcloud.url, user: "alice" }, enabled: true }]);
    state.settings.set("cloudAccounts_original", [
      { id: "C", family: "webdav", flavor: "nextcloud", label: "alice@cloud.example.com", services: { calendar: { pimAccountId: "r" } } },
    ] satisfies CloudAccountRecord[]);
    await expect(pim.addPimAccount("caldav", "alice@cloud.example.com", { ...nextcloud, user: "Alice", pass: "Alice-pw" }, { vaultId: "original", cloudAccountId: "C" }))
      .rejects.toMatchObject({ reason: "accountChanged" });
    expect(state.rows.get("original")!.find((row) => row.id === "r")!.config).toEqual({ url: nextcloud.url, user: "alice" });
    expect(state.secrets.get(pimSecretKey("original", "r"))).toBeUndefined();
  });

  it("a card's row that names no address yet (a device on 0.8.7 published it) is taken over by the card's sign-in", async () => {
    state.rows.set("original", [{ id: "r", provider: "caldav", label: "Nextcloud", config: {}, enabled: true }]);
    state.settings.set("cloudAccounts_original", [
      { id: "C", family: "webdav", flavor: "nextcloud", label: "Nextcloud", services: { calendar: { pimAccountId: "r" } } },
    ] satisfies CloudAccountRecord[]);
    const id = await pim.addPimAccount("caldav", "Nextcloud", nextcloud, { vaultId: "original", cloudAccountId: "C" });
    expect(id).toBe("r");
  });

  it("adds a row for another server", async () => {
    await pim.addPimAccount("caldav", "Nextcloud", nextcloud);
    await pim.addPimAccount("caldav", "Nextcloud", { ...nextcloud, url: "https://cloud.example.com/nextcloud/remote.php/dav" });
    expect(state.rows.get("original")).toHaveLength(2);
  });

  it("gives a row of an older build its address from its sign-in when the calendar starts", async () => {
    pim.stopPim();
    state.rows.set("original", [{ id: "old", provider: "caldav", label: "Nextcloud", config: {}, enabled: true }]);
    state.secrets.set(pimSecretKey("original", "old"), JSON.stringify(nextcloud));
    await pim.startPim(vault("original"));
    expect(state.rows.get("original")![0].config).toEqual({ url: nextcloud.url, user: "anna" });
  });

  it("leaves a row without a readable sign-in as it is", async () => {
    pim.stopPim();
    state.rows.set("original", [{ id: "old", provider: "caldav", label: "Nextcloud", config: {}, enabled: true }]);
    await pim.startPim(vault("original"));
    expect(state.rows.get("original")![0].config).toEqual({});
  });

  it("removes an empty duplicate when the calendar starts, and only that", async () => {
    pim.stopPim();
    const row = (id: string, url = nextcloud.url): PimAccountRow => ({ id, provider: "caldav", label: "anna@cloud.example.com", config: { url, user: "anna" }, enabled: true });
    state.rows.set("original", [row("signed-in"), row("empty", "https://cloud.example.com/remote.php/dav/calendars/anna/"), row("fetched"), row("other-server", "http://cloud.example.com/remote.php/dav")]);
    state.secrets.set(pimSecretKey("original", "signed-in"), JSON.stringify(nextcloud));
    state.cached = ["fetched"];
    await pim.startPim(vault("original"));
    expect(state.rows.get("original")!.map(r => r.id).sort()).toEqual(["fetched", "other-server", "signed-in"]);
  });
});
