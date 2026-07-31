// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SettingsSyncStep,
  type IVaultAdapter,
  type PimAccountRow,
} from "@plainva/core";
import {
  cloudRegistryToLogical,
  createSecretsPort,
  emptyAccountMap,
  pimAccountsForProfile,
  pimIdentity,
  setPlatformServices,
  type ISettingsStore,
  type LocalSecretCandidate,
  type ProfileAccountMap,
  type SecretsPortMeta,
} from "@plainva/ui";
import {
  V060_LOGICAL_IDS,
  V060_PROFILE_VALUES,
  createV060SecretsBundleFixture,
} from "../../../../packages/core/test/fixtures/account-sync-v0.6.0";
import {
  CountingSyncTarget,
  CountingSecretSlots,
  MemoryProfileVault,
  profileHarnessDevice,
  runProfileCycle,
} from "../../../../packages/core/test/support/settingsSyncHarness";
import { createMobileProfilePort } from "../../../mobile/src/services/mobileSettingsSync";
import type { MobileVault } from "../../../mobile/src/services/vaultService";
import { createDesktopProfilePort } from "./settingsProfile";
import { dailyNotesFolderKey } from "../contexts/VaultContext";

let activeStore: ReturnType<typeof fakeStore>;
vi.mock("./settingsStore", () => ({
  STORE_KEY: "account-sync-contracts.json",
  getSettingsStore: async () => activeStore,
}));

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

function selectStore(store: ReturnType<typeof fakeStore>): void {
  activeStore = store;
  setPlatformServices({
    loadSettings: async () => activeStore,
    credentials: {
      readSecret: async () => null,
      writeSecret: async () => {},
      removeSecret: async () => {},
    },
    openExternal: async () => {},
  });
}

function mobileVault(vaultId: string, files: MemoryProfileVault): MobileVault {
  return { vaultId, adapter: files, db: null } as unknown as MobileVault;
}

const googleRow = (clientId: string): PimAccountRow => ({
  id: "local-google",
  provider: "google",
  label: "person@example.invalid",
  config: { user: "person@example.invalid", clientId },
  enabled: true,
});

describe("cross-shell account-sync regression contracts", () => {
  beforeEach(() => {
    selectStore(fakeStore());
  });

  it.fails("B3/B4/I1: desktop -> mobile -> desktop needs no corrective mobile upload", async () => {
    const desktopStore = fakeStore();
    await desktopStore.set(dailyNotesFolderKey("C:/fixture-vault"), "Journal");
    const mobileStore = fakeStore();
    const target = new CountingSyncTarget();
    const desktopVault = new MemoryProfileVault();
    const phoneVault = new MemoryProfileVault();

    selectStore(desktopStore);
    const desktop = profileHarnessDevice(
      "fixture-desktop",
      createDesktopProfilePort("C:/fixture-vault", {
        rawVault: desktopVault as unknown as IVaultAdapter,
        onSkipped: () => {},
      }),
    );
    expect((await runProfileCycle(target, desktop)).profileUploads).toBe(1);

    selectStore(mobileStore);
    const phone = profileHarnessDevice(
      "fixture-phone",
      createMobileProfilePort(mobileVault("fixture-mobile-vault", phoneVault)),
    );
    expect((await runProfileCycle(target, phone)).profileUploads).toBe(0);
    expect((await runProfileCycle(target, phone)).profileUploads).toBe(0);

    selectStore(desktopStore);
    expect((await runProfileCycle(target, desktop)).profileUploads).toBe(0);
  });

  it("covers mobile -> desktop -> mobile with the same counted target", async () => {
    const mobileStore = fakeStore();
    const desktopStore = fakeStore();
    const target = new CountingSyncTarget();
    const phoneVault = new MemoryProfileVault();
    const desktopVault = new MemoryProfileVault();

    selectStore(mobileStore);
    const phone = profileHarnessDevice(
      "fixture-phone",
      createMobileProfilePort(mobileVault("fixture-mobile-vault", phoneVault)),
    );
    expect((await runProfileCycle(target, phone)).profileUploads).toBe(1);

    selectStore(desktopStore);
    const desktop = profileHarnessDevice(
      "fixture-desktop",
      createDesktopProfilePort("C:/fixture-vault", {
        rawVault: desktopVault as unknown as IVaultAdapter,
        onSkipped: () => {},
      }),
    );
    expect((await runProfileCycle(target, desktop)).profileUploads).toBe(0);

    selectStore(mobileStore);
    expect((await runProfileCycle(target, phone)).profileUploads).toBe(0);
  });

  it.fails("B6/I3: no Google client registration appears in any shared channel", () => {
    const map = emptyAccountMap();
    const pim = pimAccountsForProfile([googleRow("desktop-client.invalid")], map);
    const cloud = V060_PROFILE_VALUES.cloudAccounts;
    const secrets = createV060SecretsBundleFixture();

    expect(JSON.stringify({ pim, cloud, secrets })).not.toMatch(/clientId|clientSecret|byoClientId/);
  });

  it.fails("B7/I2: Google identity is independent of the installation's client id", () => {
    expect(pimIdentity(googleRow("desktop-client.invalid"))).toBe(
      pimIdentity(googleRow("android-client.invalid")),
    );
  });

  it.fails("B8/I2: the cloud card id maps from local to logical on export", () => {
    const map = {
      ...emptyAccountMap(),
      cloudLocalToLogical: { "local-cloud-card": V060_LOGICAL_IDS.cloud },
    } as ProfileAccountMap & { cloudLocalToLogical: Record<string, string> };
    const projected = cloudRegistryToLogical(
      [{ id: "local-cloud-card", family: "google", label: "person@example.invalid", services: {} }],
      map,
    );

    expect(projected[0].id).toBe(V060_LOGICAL_IDS.cloud);
  });

  it.fails("B10/I6: a Google policy conflict does not block an independent IMAP write", async () => {
    const bundle = createV060SecretsBundleFixture();
    const slots = new CountingSecretSlots();
    let meta: SecretsPortMeta | null = null;
    const candidates: LocalSecretCandidate[] = [
      {
        logicalId: V060_LOGICAL_IDS.pim,
        slot: "fixture-google-slot",
        binding: bundle.entries[V060_LOGICAL_IDS.pim].binding,
        secret: {
          clientId: ["local", "client", "id"].join("-"),
          clientSecret: ["local", "fixture"].join("-"),
        },
        apply: (secret) => secret,
      },
      {
        logicalId: V060_LOGICAL_IDS.mail,
        slot: "fixture-mail-slot",
        binding: bundle.entries[V060_LOGICAL_IDS.mail].binding,
        secret: null,
        apply: (secret) => secret,
      },
    ];
    const port = createSecretsPort({
      deviceId: async () => "fixture-target",
      readMeta: async () => meta,
      writeMeta: async (value) => {
        meta = structuredClone(value);
      },
      candidates: async () => candidates,
      readSlot: (slot) => slots.read(slot),
      writeSlot: (slot, value) => slots.write(slot, value),
      removeSlot: (slot) => slots.remove(slot),
    });

    await port.importBundle(bundle);
    expect(slots.writes).toBe(1);
    expect(slots.values.has("fixture-mail-slot")).toBe(true);
    expect(slots.values.has("fixture-google-slot")).toBe(false);
  });

  it("the write counter distinguishes exported fields from target uploads", async () => {
    const target = new CountingSyncTarget();
    const vault = new MemoryProfileVault();
    const values = { ...V060_PROFILE_VALUES };
    const port = {
      exportValues: async () => values,
      applyValues: async (incoming: Record<string, unknown>) => {
        Object.assign(values, incoming);
      },
    };
    const exchanges: number[] = [];
    const step = new SettingsSyncStep({
      port,
      deviceId: "fixture-device",
      now: () => "2026-07-31T12:00:00.000Z",
      onExchange: (info) => exchanges.push(info.exported),
    });

    await step.run(target, vault as unknown as IVaultAdapter);
    await step.run(target, vault as unknown as IVaultAdapter);

    expect(exchanges).toEqual([Object.keys(values).length, Object.keys(values).length]);
    expect(target.profileUploads).toBe(1);
    expect(target.profileDownloads).toBe(1);
    expect(target.successfulDownloads).toBe(1);
  });
});
