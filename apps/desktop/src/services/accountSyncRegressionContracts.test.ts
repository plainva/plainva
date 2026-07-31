// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  canonicalizeEndpoint,
  SecretsSyncStep,
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
  type CloudAccountRecord,
  type ISettingsStore,
  type LocalSecretCandidate,
  type ProfileAccountMap,
  type SecretsPortMeta,
} from "@plainva/ui";
import { mailAccountsKey, mailSecretKey, type MailAccountConfig } from "@plainva/ui/mail";
import {
  V060_FIXTURE_KEY,
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
import { mobileCandidates } from "../../../mobile/src/services/mobileSecretsPort";
import type { MobileVault } from "../../../mobile/src/services/vaultService";
import { createDesktopProfilePort } from "./settingsProfile";
import { cloudAccountsRegistryKey } from "./cloudAccounts";
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

  it("T1/B3/B4/I1: desktop -> mobile -> desktop needs no corrective mobile upload", async () => {
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

  it("T3: mobile -> desktop -> mobile converges on the same canonical projection", async () => {
    const mobileStore = fakeStore();
    await mobileStore.set("mobile-vault-fixture-mobile-vault", { dailyFolder: "Journal" });
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

  it("T8/S3/I1: equivalent logical accounts with different local ids stay at a fixed point", async () => {
    const desktopPath = "C:/fixture-vault";
    const mobileId = "fixture-mobile-vault";
    const desktopMailA: MailAccountConfig = {
      id: "desktop-mail-a",
      label: "A",
      host: "imap.a.invalid",
      port: 993,
      user: "a@example.invalid",
    };
    const desktopMailZ: MailAccountConfig = {
      id: "desktop-mail-z",
      label: "Z",
      host: "imap.z.invalid",
      port: 993,
      user: "z@example.invalid",
    };
    const mobileMailA = { ...desktopMailA, id: "mobile-mail-a" };
    const mobileMailZ = { ...desktopMailZ, id: "mobile-mail-z" };
    const desktopCloudA: CloudAccountRecord = {
      id: "desktop-cloud-a",
      family: "google",
      label: "A",
      services: { mail: { mailAccountId: desktopMailA.id } },
    };
    const desktopCloudZ: CloudAccountRecord = {
      id: "desktop-cloud-z",
      family: "webdav",
      label: "Z",
      services: {},
    };
    const mobileCloudA: CloudAccountRecord = {
      ...desktopCloudA,
      id: "mobile-cloud-a",
      services: { mail: { mailAccountId: mobileMailA.id } },
    };
    const mobileCloudZ: CloudAccountRecord = {
      ...desktopCloudZ,
      id: "mobile-cloud-z",
    };
    const logicalIds = {
      mailA: "mail-logical-a",
      mailZ: "mail-logical-z",
      cloudA: "cloud-logical-a",
      cloudZ: "cloud-logical-z",
    };
    const desktopStore = fakeStore();
    await desktopStore.set(mailAccountsKey(desktopPath), [desktopMailZ, desktopMailA]);
    await desktopStore.set(cloudAccountsRegistryKey(desktopPath), [
      desktopCloudZ,
      desktopCloudA,
    ]);
    await desktopStore.set(
      `settingsSyncAccountMap_${btoa(unescape(encodeURIComponent(desktopPath)))}`,
      {
        ...emptyAccountMap(),
        mailLocalToLogical: {
          [desktopMailA.id]: logicalIds.mailA,
          [desktopMailZ.id]: logicalIds.mailZ,
        },
        cloudLocalToLogical: {
          [desktopCloudA.id]: logicalIds.cloudA,
          [desktopCloudZ.id]: logicalIds.cloudZ,
        },
        secretLocalToLogical: {
          [mailSecretKey(desktopPath, desktopMailA.id)]: logicalIds.mailA,
          [mailSecretKey(desktopPath, desktopMailZ.id)]: logicalIds.mailZ,
        },
      } satisfies ProfileAccountMap,
    );
    const mobileStore = fakeStore();
    await mobileStore.set(mailAccountsKey(mobileId), [mobileMailA, mobileMailZ]);
    await mobileStore.set(`cloudAccounts_${mobileId}`, [mobileCloudA, mobileCloudZ]);
    await mobileStore.set(`settingsSyncAccountMapMobile_${mobileId}`, {
      ...emptyAccountMap(),
      mailLocalToLogical: {
        [mobileMailA.id]: logicalIds.mailA,
        [mobileMailZ.id]: logicalIds.mailZ,
      },
      cloudLocalToLogical: {
        [mobileCloudA.id]: logicalIds.cloudA,
        [mobileCloudZ.id]: logicalIds.cloudZ,
      },
      secretLocalToLogical: {
        [mailSecretKey(mobileId, mobileMailA.id)]: logicalIds.mailA,
        [mailSecretKey(mobileId, mobileMailZ.id)]: logicalIds.mailZ,
      },
    } satisfies ProfileAccountMap);
    const target = new CountingSyncTarget();

    selectStore(desktopStore);
    const desktop = profileHarnessDevice("fixture-desktop", createDesktopProfilePort(desktopPath));
    expect((await runProfileCycle(target, desktop)).profileUploads).toBe(1);

    selectStore(mobileStore);
    const phone = profileHarnessDevice(
      "fixture-phone",
      createMobileProfilePort(mobileVault(mobileId, new MemoryProfileVault())),
    );
    expect((await runProfileCycle(target, phone)).profileUploads).toBe(0);

    for (let cycle = 0; cycle < 3; cycle += 1) {
      selectStore(desktopStore);
      expect((await runProfileCycle(target, desktop)).profileUploads).toBe(0);
      selectStore(mobileStore);
      expect((await runProfileCycle(target, phone)).profileUploads).toBe(0);
    }
    expect(target.profileUploads).toBe(1);

    selectStore(mobileStore);
    expect(
      (await mobileCandidates(mobileId)).map(({ logicalId, slot }) => ({
        logicalId,
        slot,
      })),
    ).toEqual([
      {
        logicalId: logicalIds.mailA,
        slot: mailSecretKey(mobileId, mobileMailA.id),
      },
      {
        logicalId: logicalIds.mailZ,
        slot: mailSecretKey(mobileId, mobileMailZ.id),
      },
    ]);
  });

  it("T7/T8/T14: a logical password crosses physical slots once, then produces zero uploads", async () => {
    const target = new CountingSyncTarget();
    const desktopSlots = new CountingSecretSlots();
    const phoneSlots = new CountingSecretSlots();
    const logicalId = "logical-imap-fixed-point";
    const binding = {
      family: "imap",
      service: "mail",
      secretType: "imap-password",
      user: "person@example.invalid",
      endpoint: canonicalizeEndpoint("imaps://imap.example.invalid:993"),
    } as const;
    const fixturePassword = ["fixture", "only", "password"].join("-");
    desktopSlots.values.set("desktop-mail-slot", { pass: fixturePassword });

    const makePort = (
      deviceId: string,
      slot: string,
      slots: CountingSecretSlots,
    ) => {
      let meta: SecretsPortMeta | null = null;
      return createSecretsPort({
        deviceId: async () => deviceId,
        readMeta: async () => meta,
        writeMeta: async (value) => {
          meta = structuredClone(value);
        },
        candidates: async () => [{
          logicalId,
          slot,
          binding,
          secret: (slots.values.get(slot) as Record<string, string> | undefined) ?? null,
          apply: (secret) => secret,
        }],
        readSlot: (physicalSlot) => slots.read(physicalSlot),
        writeSlot: (physicalSlot, value) => slots.write(physicalSlot, value),
        removeSlot: (physicalSlot) => slots.remove(physicalSlot),
        now: () => "2026-07-31T12:00:00.000Z",
      });
    };
    const desktopPort = makePort("fixture-desktop", "desktop-mail-slot", desktopSlots);
    const phonePort = makePort("fixture-phone", "phone-mail-slot", phoneSlots);
    const vault = new MemoryProfileVault();
    const runSecrets = async (port: ReturnType<typeof makePort>) => {
      const before = target.secretUploads;
      await new SecretsSyncStep({
        port,
        masterKey: V060_FIXTURE_KEY,
        now: () => "2026-07-31T12:00:00.000Z",
      }).run(target, vault as unknown as IVaultAdapter);
      return target.secretUploads - before;
    };

    expect(await runSecrets(desktopPort)).toBe(1);
    expect(await runSecrets(phonePort)).toBe(0);
    expect(phoneSlots.values.get("phone-mail-slot")).toEqual({ pass: fixturePassword });

    for (let cycle = 0; cycle < 3; cycle += 1) {
      expect(await runSecrets(desktopPort)).toBe(0);
      expect(await runSecrets(phonePort)).toBe(0);
    }
    expect(target.secretUploads).toBe(1);
    expect(desktopSlots.writes).toBe(0);
    expect(phoneSlots.writes).toBe(1);
  });

  it("B6/I3: no Google client registration appears in any new shared channel", async () => {
    const map = emptyAccountMap();
    const pim = pimAccountsForProfile([googleRow("desktop-client.invalid")], map);
    const cloud = cloudRegistryToLogical(
      V060_PROFILE_VALUES.cloudAccounts as CloudAccountRecord[],
      map,
    );
    const legacy = createV060SecretsBundleFixture().entries[V060_LOGICAL_IDS.pim];
    let meta: SecretsPortMeta | null = null;
    const port = createSecretsPort({
      deviceId: async () => "fixture-desktop",
      readMeta: async () => meta,
      writeMeta: async (value) => {
        meta = structuredClone(value);
      },
      candidates: async () => [{
        logicalId: V060_LOGICAL_IDS.pim,
        slot: "fixture-google-slot",
        binding: legacy.binding,
        secret: legacy.secret ?? null,
        apply: (secret) => secret,
      }],
      readSlot: async () => null,
      writeSlot: async () => {},
      removeSlot: async () => {},
    });
    const secrets = await port.exportBundle();

    expect(JSON.stringify({ pim, cloud, secrets })).not.toMatch(/clientId|clientSecret|byoClientId/);
  });

  it("B7/I2: Google identity is independent of the installation's client id", () => {
    expect(pimIdentity(googleRow("desktop-client.invalid"))).toBe(
      pimIdentity(googleRow("android-client.invalid")),
    );
  });

  it("B8/I2: the cloud card id maps from local to logical on export", () => {
    const map = {
      ...emptyAccountMap(),
      cloudLocalToLogical: { "local-cloud-card": V060_LOGICAL_IDS.cloud },
    } satisfies ProfileAccountMap;
    const projected = cloudRegistryToLogical(
      [{ id: "local-cloud-card", family: "google", label: "person@example.invalid", services: {} }],
      map,
    );

    expect(projected[0].id).toBe(V060_LOGICAL_IDS.cloud);
  });

  it("T7/B10/I6: a legacy Google client does not block an independent IMAP write", async () => {
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

    const result = await port.importBundle(bundle);
    expect(slots.writes).toBe(1);
    expect(slots.values.has("fixture-mail-slot")).toBe(true);
    expect(slots.values.has("fixture-google-slot")).toBe(false);
    expect(result.legacyEntries).toEqual([V060_LOGICAL_IDS.pim]);
  });

  it("T14: unchanged cycles report checks and downloads without additional uploads", async () => {
    const target = new CountingSyncTarget();
    const vault = new MemoryProfileVault();
    const values = { ...V060_PROFILE_VALUES };
    const port = {
      exportValues: async () => values,
      applyValues: async (incoming: Record<string, unknown>) => {
        Object.assign(values, incoming);
      },
    };
    const exchanges: Array<{ checked: number; uploaded: boolean }> = [];
    const step = new SettingsSyncStep({
      port,
      deviceId: "fixture-device",
      now: () => "2026-07-31T12:00:00.000Z",
      onExchange: (info) => {
        exchanges.push({
          checked: info.checked.fields,
          uploaded: !!info.uploaded,
        });
      },
    });

    await step.run(target, vault as unknown as IVaultAdapter);
    await step.run(target, vault as unknown as IVaultAdapter);

    expect(exchanges).toEqual([
      { checked: Object.keys(values).length, uploaded: true },
      { checked: Object.keys(values).length, uploaded: false },
    ]);
    expect(target.profileUploads).toBe(1);
    expect(target.profileDownloads).toBe(1);
    expect(target.successfulDownloads).toBe(1);
  });
});
