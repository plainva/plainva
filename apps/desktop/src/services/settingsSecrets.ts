import { canonicalSecretId, type SecretsPort } from "@plainva/core";
import {
  calDavSecretBinding,
  createSecretsPort,
  imapSecretBinding,
  familyOfCalDavUrl,
  familyOfImapHost,
  migrateSecretsMetaToCanonicalIds,
  retireSecret,
  type CloudAccountRecord,
  type LocalSecretCandidate,
  type SecretsPortMeta,
} from "@plainva/ui";
import { credentialManager } from "./CredentialManager";
import { loadCloudAccounts } from "./cloudAccounts";
import { getSettingsStore } from "./settingsStore";
import { SECRETS_MARK_KEY_SLOT, mergeLegacySecretsMeta, sealSecretsMetaInStore, storeHoldsSecretsMarks } from "@plainva/ui";
import { listMailAccounts, mailAccountKind, mailSecretKey } from "@plainva/ui/mail";
import { getPimCredentials, pimSecretKey, type PimStoredCredentials } from "./pim/pimCredentials";
import type { PimRuntime } from "./pim/pimRuntime";

const b64 = (p: string) => btoa(unescape(encodeURIComponent(p)));
/**
 * The record of a vault's secrets sync, under this version's name. The name
 * 0.8.7 reads (`LEGACY_META_PREFIX`) is left empty once sealed, so a device
 * that goes back to 0.8.7 starts like a new one (`secretsMark.ts`, F67).
 */
const META_PREFIX = "settingsSyncSecretMarks_";
const LEGACY_META_PREFIX = "settingsSyncSecretMeta_";
const metaKey = (vaultPath: string) => `${META_PREFIX}${b64(vaultPath)}`;
const legacyMetaKey = (vaultPath: string) => `${LEGACY_META_PREFIX}${b64(vaultPath)}`;
/**
 * What "Remove account" asked to be tombstoned, under a name of its own: only
 * bindings, never a mark, so a removal before the marks are sealed writes no
 * password anywhere (round eleven).
 */
const retiredKey = (vaultPath: string) => `settingsSyncSecretRetired_${b64(vaultPath)}`;
const META_STORAGE = {
  current: (legacyKey: string) => META_PREFIX + legacyKey.slice(LEGACY_META_PREFIX.length),
  isLegacy: (key: string) => key.startsWith(LEGACY_META_PREFIX),
};

async function deviceId(): Promise<string> {
  const store = await getSettingsStore();
  let value = await store.get<string>("deviceId");
  if (!value) {
    value = globalThis.crypto.randomUUID();
    await store.set("deviceId", value);
    await store.save();
  }
  return value;
}

function familyFor(records: CloudAccountRecord[], service: "calendar" | "mail", localId: string, fallback: string): string {
  const record = records.find((r) =>
    service === "calendar" ? r.services.calendar?.pimAccountId === localId : r.services.mail?.mailAccountId === localId
  );
  return record?.family ?? fallback;
}

/**
 * A MAIL credential has nothing to do with the calendar runtime, yet demanding
 * one here (and in `secrets()`) meant a vault without a running PIM runtime
 * never transported a mail password at all — silently, with nothing in the
 * diagnostics to show for it. The phone never had that coupling
 * (`createMobileSecretsPort(vaultId)` asks for nothing else); the desktop was
 * the outlier. Without a runtime the mail candidates are still built, only the
 * calendar ones are skipped.
 */
async function localCandidates(vaultPath: string, pimRuntime: PimRuntime | null): Promise<LocalSecretCandidate[]> {
  const [cloud, pimAccounts, mailAccounts] = await Promise.all([
    loadCloudAccounts(vaultPath),
    pimRuntime ? pimRuntime.cache.listAccounts() : Promise.resolve([]),
    listMailAccounts(vaultPath),
  ]);
  const candidates: LocalSecretCandidate[] = [];

  for (const account of pimAccounts) {
    const creds = await getPimCredentials(vaultPath, account.id);
    const slot = pimSecretKey(vaultPath, account.id);
    if (account.provider === "caldav") {
      const url = creds?.kind === "caldav" ? creds.url : typeof account.config.url === "string" ? account.config.url : "";
      const user = creds?.kind === "caldav" ? creds.user : typeof account.config.user === "string" ? account.config.user : "";
      if (!url || !user) continue;
      const binding = calDavSecretBinding(familyFor(cloud, "calendar", account.id, familyOfCalDavUrl(url) ?? "webdav"), url, user);
      candidates.push({
        logicalId: canonicalSecretId(binding),
        slot,
        binding,
        secret: creds?.kind === "caldav" && creds.pass ? { pass: creds.pass } : null,
        apply: (secret) => ({ kind: "caldav", url, user, pass: secret.pass ?? "" } satisfies PimStoredCredentials),
      });
    }
  }

  for (const account of mailAccounts) {
    if (mailAccountKind(account) !== "imap") continue;
    const stored = await credentialManager.readSecret<{ pass?: string; refreshToken?: string }>(mailSecretKey(vaultPath, account.id));
    const slot = mailSecretKey(vaultPath, account.id);
    const binding = imapSecretBinding(familyFor(cloud, "mail", account.id, familyOfImapHost(account.host) ?? "imap"), account.host, account.port, account.user);
    candidates.push({
      logicalId: canonicalSecretId(binding),
      slot,
      binding,
      secret: stored?.pass ? { pass: stored.pass } : null,
      apply: (secret) => ({ ...(stored ?? {}), pass: secret.pass ?? "" }),
    });
  }
  return candidates;
}

/**
 * The keychain slots whose password came through the settings sync from
 * another device (`meta.imported`) — not typed here. The one-time switch-over
 * of F57 (`endpointConfirmationSettle.ts`) takes every other one as this
 * device's own.
 */
export async function importedSecretSlots(vaultPath: string, cache: Pick<PimRuntime["cache"], "listAccounts"> | null): Promise<Set<string>> {
  const meta = await metaStore(vaultPath).readMeta().catch(() => null);
  const candidates = await localCandidates(vaultPath, cache ? ({ cache } as PimRuntime) : null);
  return new Set(candidates.filter((candidate) => meta?.imported[candidate.logicalId]).map((candidate) => candidate.slot));
}

function metaStore(vaultPath: string): { readMeta(): Promise<SecretsPortMeta | null>; writeMeta(meta: SecretsPortMeta): Promise<void> } {
  return {
    readMeta: async () => {
      const store = await getSettingsStore();
      const current = (await store.get<SecretsPortMeta>(metaKey(vaultPath))) ?? null;
      const legacy = (await store.get<SecretsPortMeta>(legacyMetaKey(vaultPath))) ?? null;
      const retired = (await store.get<SecretsPortMeta["retired"]>(retiredKey(vaultPath))) ?? null;
      const meta = mergeLegacySecretsMeta(current, legacy) ?? (retired ? { entries: {}, imported: {}, quarantine: {} } : null);
      if (meta && retired) meta.retired = { ...(meta.retired ?? {}), ...retired };
      return migrateSecretsMetaToCanonicalIds(meta);
    },
    writeMeta: async (meta) => {
      const store = await getSettingsStore();
      const { retired, ...marks } = meta;
      await store.set(metaKey(vaultPath), marks);
      if (retired && Object.keys(retired).length > 0) await store.set(retiredKey(vaultPath), retired);
      else await store.delete(retiredKey(vaultPath));
      // Taken in by this write: under the old name, nothing stays.
      await store.delete(legacyMetaKey(vaultPath));
      await store.save();
    },
  };
}

/** The pending removals alone, for `retireSecret`: it never reads or writes a mark. */
function retiredStore(vaultPath: string): { readMeta(): Promise<SecretsPortMeta | null>; writeMeta(meta: SecretsPortMeta): Promise<void> } {
  return {
    readMeta: async () => ({ entries: {}, imported: {}, quarantine: {}, retired: (await (await getSettingsStore()).get<SecretsPortMeta["retired"]>(retiredKey(vaultPath))) ?? {} }),
    writeMeta: async (meta) => {
      const store = await getSettingsStore();
      await store.set(retiredKey(vaultPath), meta.retired ?? {});
      await store.save();
    },
  };
}

/**
 * The key of the marks: the app process owns it, at its one place (`secretsMark.ts`,
 * rounds twelve to fourteen). No window reads or writes its slot itself.
 */
const notThroughSlots = async (): Promise<never> => {
  throw new Error(`${SECRETS_MARK_KEY_SLOT} belongs to the app process`);
};
const markKeySlots = {
  readSlot: notThroughSlots,
  writeSlot: notThroughSlots,
  // One owner for every window: the app process (round fourteen).
  ownedKey: (fresh: string, marksOnDevice: boolean) => credentialManager.secretsMarkKey(fresh, marksOnDevice),
  // One key for the device: the records of every vault count (round twelve).
  marksOnDevice: async () => storeHoldsSecretsMarks(await getSettingsStore(), (key) => key.startsWith(META_PREFIX) || key.startsWith(LEGACY_META_PREFIX)),
};

/**
 * At start, before any vault opens: the secrets metadata of every vault on
 * this device, open or not, loses the plain marks that up to now carried each
 * password in `plainva-settings.json` (F67, `secretsMark.ts`). The key of the
 * new marks lives with the passwords, in the credentials store.
 */
export async function sealSecretsMetaAtStart(): Promise<number> {
  return sealSecretsMetaInStore(await getSettingsStore(), META_STORAGE, markKeySlots);
}

/** "Remove account" took this calendar account out: its secrets entry is tombstoned from that act (`retireSecret`). */
export async function retireCalDavSecret(vaultPath: string, url: string, user: string): Promise<void> {
  await retireSecret(retiredStore(vaultPath), calDavSecretBinding(familyOfCalDavUrl(url) ?? "webdav", url, user));
}

/**
 * Desktop OS-keychain bridge for the encrypted secrets sideband.
 *
 * The decision logic - binding checks, tombstones, per-entry revisions, the
 * conflict rule and the rollback - lives in @plainva/ui createSecretsPort, so
 * the phone runs the SAME code rather than a second, subtly different copy
 * (H2c). This function supplies only what is desktop-specific.
 */
export function createDesktopSecretsPort(vaultPath: string, pimRuntime: PimRuntime | null): SecretsPort {
  return createSecretsPort({
    deviceId,
    // Metadata written before P4c is keyed by the old per-device names; the
    // candidates above are now named canonically. Migrating on read keeps the
    // two in step (the port persists the result on its next export).
    ...metaStore(vaultPath),
    candidates: () => localCandidates(vaultPath, pimRuntime),
    // Without the PIM runtime this device does NOT know its full account
    // picture: the mail candidates are complete, the calendar ones are missing.
    // The candidate list is therefore not empty and `looksUnavailable` would not
    // fire — a CalDAV credential would be declared deleted and removed on every
    // other device. Saying so plainly suppresses tombstoning for those runs;
    // everything else (publishing and receiving secrets) keeps working. This is
    // the same answer the phone gives while its runtime boots.
    accountsReady: async () => pimRuntime !== null,
    readSlot: (slot) => credentialManager.readSecret(slot),
    writeSlot: (slot, value) => credentialManager.writeSecret(slot, value),
    ownedKey: markKeySlots.ownedKey,
    marksOnDevice: markKeySlots.marksOnDevice,
    removeSlot: (slot) => credentialManager.removeSecret(slot),
  });
}
