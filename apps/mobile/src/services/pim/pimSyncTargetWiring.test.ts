// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPlatformServices, pendingEventWrites, setPlatformServices } from "@plainva/ui";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PimAccountRow } from "@plainva/core";
import type { MobileVault } from "../vaultService";

/**
 * The calendar sync on the phone is told why an unconfirmed CalDAV account
 * waits (F57; review of F57, round four): the builder `startPim` hands the
 * runtime as `syncTarget` refuses such an account with its address. The
 * builder itself is tested in pimTargetCredentials.test.ts; this pins the one
 * line of `pimService` that puts it in place. It runs the module's own
 * `startPim` and runtime; the device, the provider and the cache are doubles,
 * as in seriesDeleteOverlay.test.ts.
 */

const state = vi.hoisted(() => ({ secrets: new Map<string, string>(), settings: new Map<string, unknown>() }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => "android" }, registerPlugin: () => ({
  get: async ({ key }: { key: string }) => ({ value: state.secrets.get(key) ?? null }),
  set: async ({ key, value }: { key: string; value: string }) => void state.secrets.set(key, value),
  remove: async ({ key }: { key: string }) => void state.secrets.delete(key),
}) }));
vi.mock("@capacitor/preferences", () => ({ Preferences: { get: async () => ({ value: null }), remove: async () => {} } }));
vi.mock("../../platform/capacitorPlatform", () => ({ capacitorCredentialStore: {} }));
vi.mock("../reminderScheduler", () => ({ rescheduleReminders: vi.fn() }));
vi.mock("../vaultService", () => ({ getMobileVault: () => null }));
vi.mock("../mobileSettingsSync", () => ({ noteAccountRemovedLocally: vi.fn(), mobileSyncDeviceId: async () => "phone" }));
vi.mock("./taskSyncRuntime", () => ({ startTaskSyncRuntime: vi.fn(), stopTaskSyncRuntime: vi.fn(), runMobileTaskSync: vi.fn(), runMobileEntryEventSync: vi.fn() }));
vi.mock("../../platform/devicePim", () => ({ isDevicePimSupported: () => false }));
vi.mock("../../adapters/webdavHttp", () => ({ allowHttpOrigin: async () => {}, webdavFetch: async () => new Response("{}") }));
vi.mock("@plainva/core", async (original) => {
  const actual = await original<typeof import("@plainva/core")>();
  return {
    ...actual,
    PimCacheRepository: class {
      async listAccounts() { return [] as PimAccountRow[]; }
      async upsertAccount() {}
      async setScopeState() {}
      async getScopeState() { return null; }
      async getEventByUid() { return null; }
      async findEventsByUid() { return []; }
      async listCalendars() { return []; }
    },
    PimWorker: class { start() {} stop() {} async triggerImmediate() {} },
  };
});

import * as pim from "./pimService";
import * as runtimeModule from "./pimRuntime";
import { secureCredentialStore } from "../../platform/secureStore";
import { pimSecretKey } from "./pimCredentials";

let previousPlatform: ReturnType<typeof getPlatformServices> | undefined;
beforeEach(async () => {
  try { previousPlatform = getPlatformServices(); } catch { previousPlatform = undefined; }
  setPlatformServices({
    ...previousPlatform,
    credentials: secureCredentialStore,
    loadSettings: async () => ({
      keys: async () => [...state.settings.keys()],
      get: async (k: string) => structuredClone(state.settings.get(k)),
      set: async (k: string, v: unknown) => void state.settings.set(k, structuredClone(v)),
      delete: async (k: string) => state.settings.delete(k),
      save: async () => {},
    }),
  } as Parameters<typeof setPlatformServices>[0]);
  state.secrets.clear();
  state.settings.clear();
  pim.stopPim();
  await pim.startPim({ vaultId: "v", db: { name: "v" } } as unknown as MobileVault);
});
afterEach(() => { pim.stopPim(); if (previousPlatform) setPlatformServices(previousPlatform); });

describe("the phone's calendar sync is told why an unconfirmed account waits", () => {
  it("the runtime's sync builder refuses a CalDAV account in the local network with its address", async () => {
    state.secrets.set(pimSecretKey("v", "cal"), JSON.stringify({ kind: "caldav", url: "http://192.168.1.6/caldav", user: "anna", pass: "pw" }));
    const account = { id: "cal", provider: "caldav", label: "NAS", config: {}, enabled: true } as PimAccountRow;
    expect(runtimeModule.runtime).not.toBeNull();
    await expect(runtimeModule.runtime!.syncTarget(account)).rejects.toMatchObject({ name: "EndpointNotConfirmedError", endpoint: "http://192.168.1.6:80" });
    // The plain builder keeps "no target" for every other caller.
    await expect(runtimeModule.runtime!.buildTarget(account)).resolves.toBeNull();
  });
});

describe("the events drawn from the overlay belong to the vault, not to the runtime (issue 119)", () => {
  const row = { accountId: "cal", calendarId: "c", uid: "plainva-x", title: "Team sync", start: { ts: 1 }, end: { ts: 2 }, allDay: false } as never;

  it("a restart of the runtime in the same vault (accounts imported through the settings sync) keeps them; leaving the vault empties them", async () => {
    expect.hasAssertions();
    pendingEventWrites.settle(pendingEventWrites.begin({ kind: "create", row }), undefined, 0);
    await pim.restartPimAfterImport({ vaultId: "v", db: { name: "v" } } as unknown as MobileVault);
    expect(pendingEventWrites.snapshot()).toHaveLength(1);
    pim.leavePimVault();
    expect(pendingEventWrites.snapshot()).toEqual([]);
  });

  it("the runtime runs the shared watch, and the vault switch leaves through `leavePimVault`", () => {
    expect.hasAssertions();
    const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
    expect(read("pimService.ts")).toContain("watchCreatedEvents: (cache, targetFor) => watchCreatedEvents(pendingEventWrites, { cache, targetFor })");
    expect(read("pimRuntime.ts")).toMatch(/stopCreatedEventWatch =\s*wiring\.watchCreatedEvents\?\.\(cache/);
    expect(read("../../hooks/useVaultBoot.ts")).toContain("leavePimVault();");
  });
});
