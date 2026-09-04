// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROFILE_SYNC_PATH, stableStringify, type IVaultAdapter, type PimAccountRow } from "@plainva/core";
import { canonicalizeProfileValues, setPlatformServices, shouldAnnounceProfileImport, storeBackedFields, type ISettingsStore } from "@plainva/ui";
import { CountingSyncTarget, profileHarnessDevice, runProfileCycle } from "../../../packages/core/test/support/settingsSyncHarness";

/**
 * The phone's profile port must be a ROUND TRIP (finding 2026-09-04): what
 * `applyValues` takes, `exportValues` must publish back unchanged. A field that
 * comes out different from how it went in is a field this device re-publishes
 * on every cycle — and every other device then "adopts" it again, which is the
 * shape behind "settings adopted from another device" firing with nothing
 * changed. The desktop has had this contract since the July fix for accounts;
 * the phone had it for scalars only, and the fields added since were never
 * walked.
 */

const pimMock = vi.hoisted(() => ({
  rows: [] as PimAccountRow[],
  credentials: new Map<string, unknown>(),
}));

vi.mock("./services/pim/pimService", () => ({
  isPimRuntimeReady: () => true,
  listPimAccounts: async () => pimMock.rows,
}));

const journalFiles = new Map<string, string>();
vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA" },
  Encoding: { UTF8: "utf8" },
  Filesystem: {
    writeFile: vi.fn(async ({ path, data }: { path: string; data: string }) => {
      journalFiles.set(path, data);
    }),
    readFile: vi.fn(async ({ path }: { path: string }) => {
      if (!journalFiles.has(path)) throw new Error("not found");
      return { data: journalFiles.get(path)! };
    }),
    deleteFile: vi.fn(async ({ path }: { path: string }) => {
      journalFiles.delete(path);
    }),
    readdir: vi.fn(async () => ({ files: [] })),
  },
}));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false },
  registerPlugin: () => ({}),
}));
vi.mock("./services/pim/pimCredentials", () => ({
  getPimCredentials: async (_vaultId: string, accountId: string) => pimMock.credentials.get(accountId) ?? null,
  pimSecretKey: (vaultId: string, accountId: string) => `pim_${vaultId}_${accountId}`,
}));

import { createMobileProfilePort } from "./services/mobileSettingsSync";
import { profileNoticeStorage } from "./services/profileNoticeStore";
import type { MobileVault } from "./services/vaultService";

function fakeStore(): ISettingsStore & { map: Map<string, unknown> } {
  const map = new Map<string, unknown>();
  return {
    map,
    async get<T>(key: string) {
      return map.get(key) as T | undefined;
    },
    async set(key: string, value: unknown) {
      map.set(key, structuredClone(value));
    },
    async delete(key: string) {
      return map.delete(key);
    },
    async keys() {
      return [...map.keys()];
    },
    async save() {},
  };
}

function install(store: ISettingsStore): void {
  setPlatformServices({
    loadSettings: async () => store,
    credentials: {
      readSecret: async () => null,
      writeSecret: async () => {},
      removeSecret: async () => {},
    },
    openExternal: async () => {},
  });
}

function mobileVault(vaultId = "fixture-vault"): MobileVault {
  const files = new Map<string, string>();
  const adapter = {
    async exists(path: string) {
      return files.has(path);
    },
    async readTextFile(path: string) {
      const value = files.get(path);
      if (value === undefined) throw new Error(`missing fixture file: ${path}`);
      return value;
    },
    async writeTextFile(path: string, value: string) {
      files.set(path, value);
    },
    async deleteItem(path: string) {
      files.delete(path);
    },
  } as unknown as IVaultAdapter;
  return { vaultId, adapter, db: null } as unknown as MobileVault;
}

const sampleFor = (kind: string): unknown =>
  kind === "vaultPath" ? "Journal/Daily" : kind === "text" ? "Meeting" : kind === "number" ? 42 : true;

/** One value per field the phone carries — scalars from the catalog, the
 * json fields in the shape their importers accept. */
function fullProfile(): Record<string, unknown> {
  const values: Record<string, unknown> = Object.fromEntries(
    storeBackedFields("mobile").map((f) => [f.logical, sampleFor(f.kind)]),
  );
  values.defaultCalendar = "acct-1 work";
  values.folderTemplates = [{ folder: "Projekte", template: "Projekt.md" }];
  values.typeTemplates = [{ type: "Meeting", template: "Besprechung.md" }];
  values.calendarOverlays = ["Plan.base#Termine"];
  values.barLayoutMobileBar = { order: ["notes", "mail", "today"], visibleCount: 3 };
  values.bookmarks = ["Projekte/Plainva.md", "Journal/2026-09-04.md"];
  values.mailAccounts = [];
  values.cloudAccounts = [];
  return values;
}

describe("mobile profile port round trip (2026-09-04)", () => {
  beforeEach(() => {
    pimMock.rows = [];
    pimMock.credentials.clear();
    journalFiles.clear();
  });

  it("publishes back exactly what it applied, for every field the phone carries", async () => {
    install(fakeStore());
    const port = createMobileProfilePort(mobileVault());
    const applied = fullProfile();

    await port.applyValues(applied);
    const first = await port.exportValues();
    await port.applyValues(first);
    const second = await port.exportValues();

    // Idempotent: a second apply of its own export changes nothing.
    expect(stableStringify(second)).toBe(stableStringify(first));
    // Complete: no carried field fell out on the way through. The document
    // omits values equal to their default, so the comparison is against the
    // canonical form of what was applied.
    const canonical = canonicalizeProfileValues(applied);
    for (const field of storeBackedFields("mobile")) {
      expect(first[field.logical], field.logical).toEqual(canonical[field.logical]);
    }
    for (const key of ["folderTemplates", "typeTemplates", "calendarOverlays", "barLayoutMobileBar", "bookmarks"]) {
      expect(first, key).toHaveProperty(key);
    }
  });

  it("converges two phones in two cycles and then stays quiet", async () => {
    // Two installations of the same vault, each with its own store — the
    // platform services are global, so the store is swapped per device.
    const storeA = fakeStore();
    const storeB = fakeStore();
    const target = new CountingSyncTarget();
    const devA = profileHarnessDevice("phone-a", createMobileProfilePort(mobileVault()));
    const devB = profileHarnessDevice("phone-b", createMobileProfilePort(mobileVault()));

    install(storeA);
    await devA.port.applyValues(fullProfile());
    await runProfileCycle(target, devA, "2026-09-04T08:00:00.000Z");
    install(storeB);
    await runProfileCycle(target, devB, "2026-09-04T08:00:30.000Z");
    install(storeA);
    await runProfileCycle(target, devA, "2026-09-04T08:01:00.000Z");
    install(storeB);
    await runProfileCycle(target, devB, "2026-09-04T08:01:30.000Z");

    // The last cycle on each side applied nothing and uploaded nothing.
    const quiet = (exchanges: typeof devA.exchanges) => {
      const last = exchanges[exchanges.length - 1];
      return { applied: last.applied?.names ?? [], uploaded: last.uploaded?.names ?? [] };
    };
    expect(quiet(devA.exchanges)).toEqual({ applied: [], uploaded: [] });
    expect(quiet(devB.exchanges)).toEqual({ applied: [], uploaded: [] });
    expect(target.remote.has(PROFILE_SYNC_PATH)).toBe(true);
  });

  it("keeps the 'already announced' memory in the settings store, across a restart", async () => {
    const store = fakeStore();
    install(store);
    const before = await profileNoticeStorage("v1");
    expect(shouldAnnounceProfileImport("v1", ["dailyNotesFolder"], before, { dailyNotesFolder: "Journal" })).toBe(true);
    await new Promise((r) => setTimeout(r, 0)); // the write-through settles

    // A restart primes a fresh adapter from the store, not from the WebView.
    const after = await profileNoticeStorage("v1");
    expect(shouldAnnounceProfileImport("v1", ["dailyNotesFolder"], after, { dailyNotesFolder: "Journal" })).toBe(false);
    // The same field with a different value IS news.
    expect(shouldAnnounceProfileImport("v1", ["dailyNotesFolder"], after, { dailyNotesFolder: "Tagebuch" })).toBe(true);
    expect([...store.map.keys()]).toContain("profile-announced_v1");
  });
});
