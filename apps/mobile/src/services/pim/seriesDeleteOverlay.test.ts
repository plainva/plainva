// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPlatformServices, pendingEventWrites, setPlatformServices } from "@plainva/ui";
import type { PimAccountRow, PimEventRow } from "@plainva/core";
import type { MobileVault } from "../vaultService";

/**
 * "Delete all events" of a series on the phone (issue 119, R7).
 *
 * The screens read occurrences; the delete is written against the series. The
 * phone asks the cache, per pending write, whether it still holds what the
 * write is about - and asked for the series' own row, which Google, Microsoft
 * and the device's calendars never cache. The overlay left at the first
 * reconcile and the deleted series stood on screen until a pull removed it.
 * The calendar runtime here is the module's own; the cache is a double.
 */

const events = vi.hoisted(() => ({ rows: [] as PimEventRow[] }));
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
    PimCacheRepository: class {
      constructor(private db: { name: string }) {}
      async listAccounts() { const rows = state.rows.get(this.db.name) ?? []; await state.afterRead(); return rows; }
      async upsertAccount(row: PimAccountRow) { state.rows.set(this.db.name, [...(state.rows.get(this.db.name) ?? []).filter(r => r.id !== row.id), row]); }
      async setScopeState() {}
      async replaceCalendars() {}
      async replaceTaskLists() {}
      async reassignAccountRows() {}
      async deleteAccount() {}
      async listEvents() { return events.rows.filter((r) => !r.recurrence); }
      async getEventByUid(accountId: string, calId: string, uid: string) { return events.rows.find((r) => r.accountId === accountId && r.calendarId === calId && r.uid === uid) ?? null; }
      async findEventsByUid(uid: string) { return events.rows.filter((r) => r.uid === uid || r.seriesMaster === uid); }
    },
    PimWorker: class { start() { state.started(); } stop() {} async triggerImmediate() { state.triggered(); } },
  };
});

import * as pim from "./pimService";

const occurrence = (n: number): PimEventRow =>
  ({ accountId: "g", calendarId: "work", uid: `g1_2026111${n}`, seriesMaster: "g1", title: "Standup", start: { ts: 1_000 + n }, end: { ts: 2_000 + n }, allDay: false }) as PimEventRow;
let previousPlatform: ReturnType<typeof getPlatformServices> | undefined;
beforeEach(async () => {
  try { previousPlatform = getPlatformServices(); } catch { previousPlatform = undefined; }
  setPlatformServices({ ...previousPlatform, loadSettings: async () => ({ keys: async () => [], get: async () => null, set: async () => {}, delete: async () => false, save: async () => {} }) } as Parameters<typeof setPlatformServices>[0]);
  events.rows = [occurrence(0), occurrence(1)];
  pendingEventWrites.clear();
  pim.stopPim();
  await pim.startPim({ vaultId: "v", db: { name: "v" } } as unknown as MobileVault);
});
afterEach(() => { pim.stopPim(); pendingEventWrites.clear(); if (previousPlatform) setPlatformServices(previousPlatform); });

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("deleting a whole series on the phone (issue 119, R7)", () => {
  it("keeps every occurrence off screen while the cache still lists one, though the series' own row is not cached", async () => {
    pendingEventWrites.settle(pendingEventWrites.begin({ kind: "delete", ref: { accountId: "g", calendarId: "work", uid: "g1" } }));
    await settle();
    expect(await pim.listShownPimEvents(0, 10_000)).toEqual([]);
    // A pull that still lists the series: still away.
    window.dispatchEvent(new CustomEvent("m-pim-changed"));
    await settle();
    expect(await pim.listShownPimEvents(0, 10_000)).toEqual([]);
    expect(pendingEventWrites.snapshot()).toHaveLength(1);
    // The pull that no longer lists it: the overlay leaves.
    events.rows = [];
    window.dispatchEvent(new CustomEvent("m-pim-changed"));
    await settle();
    expect(pendingEventWrites.snapshot()).toEqual([]);
  });
});
