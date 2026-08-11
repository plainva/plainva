// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  canonicalSecretId,
  PROFILE_SYNC_PATH,
  serializeProfile,
  type IVaultAdapter,
  type PimAccountRow,
} from "@plainva/core";
import { setPlatformServices, type ISettingsStore } from "@plainva/ui";
import {
  V060_PROFILE_DOC,
  V060_LOGICAL_IDS,
} from "../../../packages/core/test/fixtures/account-sync-v0.6.0";
import {
  CountingSyncTarget,
  profileHarnessDevice,
  runProfileCycle,
} from "../../../packages/core/test/support/settingsSyncHarness";

const pimMock = vi.hoisted(() => ({
  rows: [] as PimAccountRow[],
  credentials: new Map<string, unknown>(),
}));

vi.mock("./services/pim/pimService", () => ({
  isPimRuntimeReady: () => true,
  listPimAccounts: async () => pimMock.rows,
}));

vi.mock("./services/pim/pimCredentials", () => ({
  getPimCredentials: async (_vaultId: string, accountId: string) => pimMock.credentials.get(accountId) ?? null,
  pimSecretKey: (vaultId: string, accountId: string) => `pim_${vaultId}_${accountId}`,
}));

import { createMobileProfilePort } from "./services/mobileSettingsSync";
import { mobileCandidates } from "./services/mobileSecretsPort";
import { loadCloudAccounts } from "./services/cloudAccountsStore";
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

describe("mobile account-sync regression contracts", () => {
  beforeEach(() => {
    pimMock.rows = [];
    pimMock.credentials.clear();
  });

  it("B3/I1/T9: a sparse v0.6.0 profile gets one capability migration, then stays quiet", async () => {
    const store = fakeStore();
    install(store);
    const vault = mobileVault();
    const target = new CountingSyncTarget();
    target.remote.set(PROFILE_SYNC_PATH, new TextEncoder().encode(serializeProfile({
      ...V060_PROFILE_DOC,
      values: { dailyNotesFolder: "Journal" },
      entries: {
        dailyNotesFolder: V060_PROFILE_DOC.entries!.dailyNotesFolder,
      },
    })));
    const device = profileHarnessDevice("fixture-phone", createMobileProfilePort(vault));

    const adoption = await runProfileCycle(target, device);
    const unchanged = await runProfileCycle(target, device);

    expect(adoption.downloads).toBe(1);
    expect(adoption.profileUploads).toBe(1);
    expect(unchanged.profileUploads).toBe(0);
  });

  it("T2/B4/I5: absent remote fields reset stale mobile values instead of being re-exported", async () => {
    const store = fakeStore();
    await store.set("mobile-vault-fixture-vault", {
      dailyFolder: "Local stale value",
      syncIntervalSeconds: 30,
    });
    install(store);
    const port = createMobileProfilePort(mobileVault());

    await port.applyValues({ syncIntervalSeconds: 30 });
    const exported = await port.exportValues();

    expect(exported.dailyNotesFolder).toBeUndefined();
  });

  it("S10: a bar arranged on the desktop reaches the phone, and only a real change travels back", async () => {
    // The point of making the phone's bar the model's fifth: it can be arranged
    // on the big screen. That only works if the port carries the field in BOTH
    // directions — and it must not publish the default, or "this device never
    // touched its bar" would arrive elsewhere as a decision.
    const store = fakeStore();
    install(store);
    const port = createMobileProfilePort(mobileVault());

    expect((await port.exportValues()).barLayoutMobileBar).toBeUndefined();

    await port.applyValues({ barLayoutMobileBar: { order: ["mail", "notes", "today"], visibleCount: 2 } });
    const exported = await port.exportValues();
    // Notes leads because the bar model pins it — the value is sanitized on the
    // way in, so an arrangement from a newer Plainva cannot produce a bar this
    // phone has no screens for.
    expect(exported.barLayoutMobileBar).toMatchObject({ order: expect.arrayContaining(["notes"]), visibleCount: 2 });
    expect((exported.barLayoutMobileBar as { order: string[] }).order[0]).toBe("notes");
  });

  it("B5/I2: mobile merges an imported cloud card instead of replacing local-only cards", async () => {
    const store = fakeStore();
    await store.set("cloudAccounts_fixture-vault", [
      {
        id: "local-files-card",
        family: "webdav",
        label: "Files",
        services: { files: { provider: "webdav" } },
      },
    ]);
    install(store);
    const port = createMobileProfilePort(mobileVault());

    await port.applyValues({
      cloudAccounts: [
        {
          id: V060_LOGICAL_IDS.cloud,
          family: "google",
          label: "person@example.invalid",
          services: {},
        },
      ],
    });

    expect((await loadCloudAccounts("fixture-vault")).map((account) => account.id).sort()).toEqual(
      [V060_LOGICAL_IDS.cloud, "local-files-card"].sort(),
    );
  });

  /**
   * B9/I6 originally guarded ONE thing: an installation-local id must never end
   * up in the shared bundle, because it means nothing on any other device. The
   * mechanism used to be the profile mapping — no mapping, no candidate.
   *
   * Since P4c the name comes from the binding itself (`canonicalSecretId`), so
   * the concern is met without that wait. These two pin the CONCERN, not the
   * old mechanism: the physical id never appears, and the name is the one every
   * device derives for the same credential.
   */
  const CALDAV_CANONICAL = canonicalSecretId({
    service: "calendar",
    secretType: "caldav-password",
    user: "person@example.invalid",
    endpoint: "https://calendar.example.invalid/dav",
  });

  const seedCalDavAccount = () => {
    pimMock.rows = [
      {
        id: "local-caldav",
        provider: "caldav",
        label: "person@example.invalid",
        config: {},
        enabled: true,
      },
    ];
    pimMock.credentials.set("local-caldav", {
      kind: "caldav",
      url: "https://calendar.example.invalid/dav",
      user: "person@example.invalid",
      pass: ["fixture", "only"].join("-"),
    });
  };

  it("B9/I6: the mobile secret candidate is named after the credential, not the local account", async () => {
    const store = fakeStore();
    // A stale profile mapping must not win over the canonical name — two
    // devices that mapped the same mailbox differently would be back to two ids.
    await store.set("settingsSyncAccountMapMobile_fixture-vault", {
      pimLocalToLogical: { "local-caldav": V060_LOGICAL_IDS.pim },
      mailLocalToLogical: {},
    });
    install(store);
    seedCalDavAccount();

    const candidate = (await mobileCandidates("fixture-vault"))[0];
    expect(candidate?.logicalId).toBe(CALDAV_CANONICAL);
    expect(candidate?.logicalId).not.toBe("local-caldav");
  });

  it("B9/I6: mobile contributes without a profile mapping, and never under a physical id", async () => {
    const store = fakeStore();
    install(store);
    seedCalDavAccount();

    // Before P4c this returned nothing at all: a phone holding its password but
    // not yet the profile mapping contributed nothing to the bundle — silently,
    // because a skipped candidate leaves no trace anywhere.
    const candidates = await mobileCandidates("fixture-vault");
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.logicalId).toBe(CALDAV_CANONICAL);
    expect(candidates[0]?.logicalId).not.toBe("local-caldav");
    expect(candidates[0]?.slot).toContain("local-caldav"); // the SLOT stays local
  });

  it("B6/I3: mobile never exposes a Google OAuth registration as a sync candidate", async () => {
    const store = fakeStore();
    install(store);
    pimMock.rows = [{
      id: "local-google",
      provider: "google",
      label: "person@example.invalid",
      config: { clientId: "mobile-client.invalid" },
      enabled: true,
    }];
    pimMock.credentials.set("local-google", {
      kind: "google",
      clientId: "mobile-client.invalid",
      clientSecret: ["fixture", "only"].join("-"),
      refreshToken: ["local", "only"].join("-"),
    });

    expect(await mobileCandidates("fixture-vault")).toEqual([]);
  });

  it("keeps a future field through mobile apply -> export while defaults stay sparse", async () => {
    const store = fakeStore();
    install(store);
    const port = createMobileProfilePort(mobileVault());

    await port.applyValues({ somethingFromTheFuture: { z: 2, a: 1 } });

    expect(await port.exportValues()).toEqual({
      somethingFromTheFuture: { a: 1, z: 2 },
    });
  });

  it("resets a stale bookmark list when the complete profile omits it", async () => {
    const store = fakeStore();
    install(store);
    const vault = mobileVault();
    await vault.adapter.writeTextFile(".plainva/bookmarks.json", JSON.stringify({
      items: ["Notes/Old.md"],
    }));
    const port = createMobileProfilePort(vault);

    await port.applyValues({});

    expect(await vault.adapter.exists(".plainva/bookmarks.json")).toBe(false);
    expect(await port.exportValues()).not.toHaveProperty("bookmarks");
  });

  it("projects the stored cloud registry without refreshing it during export", async () => {
    const stored = [{
      id: "stored-card",
      family: "webdav",
      label: "Files",
      services: { files: { provider: "webdav" } },
    }];
    const store = fakeStore();
    await store.set("cloudAccounts_fixture-vault", stored);
    install(store);
    pimMock.rows = [{
      id: "observed-only",
      provider: "google",
      label: "person@example.invalid",
      config: {},
      enabled: true,
    }];

    const exported = await createMobileProfilePort(mobileVault()).exportValues();

    expect(exported.cloudAccounts).toEqual(stored);
    expect(store.map.get("cloudAccounts_fixture-vault")).toEqual(stored);
  });
});
