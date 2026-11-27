import { canonicalSecretId, type PimCacheRepository, type SecretsPort } from "@plainva/core";
import {
  calDavSecretBinding,
  createSecretsPort,
  imapSecretBinding,
  familyOfCalDavUrl,
  familyOfImapHost,
  getPlatformServices,
  isSignedOutSlot,
  migrateSecretsMetaToCanonicalIds,
  noteSecretLeftWithProfile,
  pimAccountListWhole,
  retireSecret,
  mergeLegacySecretsMeta,
  sealSecretsMetaInStore,
  secretImportedFor,
  storeHoldsSecretsMarks,
  type LocalSecretCandidate,
  type SecretsPortMeta,
} from "@plainva/ui";
import { listMailAccounts, mailAccountKind, mailSecretKey } from "@plainva/ui/mail";
import { getPimCache, listPimAccounts } from "./pim/pimService";
import { getPimCredentials, pimSecretKey, type PimStoredCredentials } from "./pim/pimCredentials";

/**
 * The phone's side of the encrypted secrets sideband (H2c).
 *
 * All the dangerous judgement — binding checks, tombstones, the refusal to
 * overwrite a local credential, the rollback — lives in the SHARED
 * `createSecretsPort`; this file only says where the phone keeps its accounts
 * and its keychain. That was the condition the plan set: half a port is worse
 * than none, and two hand-written copies of that logic would be exactly that.
 *
 * What travels: CalDAV and IMAP passwords. OAuth client registrations and
 * refresh tokens stay installation-local.
 *
 * Until this existed, an IMAP mailbox had to be signed in again on every
 * device; the bundle has always carried `imap-password`, there was simply
 * nothing on the phone to receive it.
 *
 * A candidate is named by `canonicalSecretId` (P4c), so it no longer waits for
 * the profile import to hand it a logical id. That wait was a real gap: a phone
 * that had its mailbox but not yet the profile mapping contributed NOTHING to
 * the bundle and could receive nothing either — silently, because a skipped
 * candidate leaves no trace. The name now comes from the credential itself.
 */

/**
 * The record of a vault's secrets sync, under this version's name. The name
 * 0.8.7 reads (`LEGACY_META_PREFIX`) is left empty once sealed, so a phone
 * that goes back to 0.8.7 starts like a new one (`secretsMark.ts`, F67).
 */
const META_PREFIX = "settingsSyncSecretMarksMobile_";
const LEGACY_META_PREFIX = "settingsSyncSecretMetaMobile_";
const metaKey = (vaultId: string) => `${META_PREFIX}${vaultId}`;
const legacyMetaKey = (vaultId: string) => `${LEGACY_META_PREFIX}${vaultId}`;
/**
 * What "Remove account" asked to be tombstoned, under a name of its own: only
 * bindings, never a mark, so a removal before the marks are sealed writes no
 * password anywhere (round eleven).
 */
const retiredKey = (vaultId: string) => `settingsSyncSecretRetiredMobile_${vaultId}`;
const META_STORAGE = {
  current: (legacyKey: string) => META_PREFIX + legacyKey.slice(LEGACY_META_PREFIX.length),
  isLegacy: (key: string) => key.startsWith(LEGACY_META_PREFIX),
};
/** The key of the marks, from the keychain, which throws when it does not answer. */
const markKeySlots = {
  readSlot: (slot: string) => getPlatformServices().credentials.readSecret(slot),
  writeSlot: (slot: string, value: unknown) => getPlatformServices().credentials.writeSecret(slot, value),
  // One key for the phone: the records of every vault count (round twelve).
  marksOnDevice: async () => storeHoldsSecretsMarks(await settingsStore(), (key) => key.startsWith(META_PREFIX) || key.startsWith(LEGACY_META_PREFIX)),
};
const deviceKey = "settingsSyncDeviceIdMobile";

async function settingsStore() {
  return getPlatformServices().loadSettings();
}

async function deviceId(): Promise<string> {
  const store = await settingsStore();
  let value = await store.get<string>(deviceKey);
  if (!value) {
    value = crypto.randomUUID();
    await store.set(deviceKey, value);
    await store.save();
  }
  return value;
}

/** The accounts this device holds, in the shape the shared port expects. */
/** Public for logical-addressing contract tests; production consumes it below. */
export async function mobileCandidates(vaultId: string): Promise<LocalSecretCandidate[]> {
  const out: LocalSecretCandidate[] = [];

  for (const account of await listPimAccounts()) {
    const creds = await getPimCredentials(vaultId, account.id);
    const slot = pimSecretKey(vaultId, account.id);
    if (account.provider === "caldav") {
      const url = creds?.kind === "caldav" ? creds.url : typeof account.config.url === "string" ? account.config.url : "";
      const user = creds?.kind === "caldav" ? creds.user : typeof account.config.user === "string" ? account.config.user : "";
      if (!url || !user) continue;
      // The family is guessed from the address here, where the desktop takes
      // the card's: it is a catalog label only. The secret's name and the
      // matching leave it out (`canonicalSecretId`, `bindingMatchesExceptFamily`),
      // so the SAME account has the same name on both platforms; only the
      // published `binding.family` may differ.
      const binding = calDavSecretBinding(familyOfCalDavUrl(url) ?? "webdav", url, user);
      out.push({
        logicalId: canonicalSecretId(binding),
        slot,
        binding,
        secret: creds?.kind === "caldav" && creds.pass ? { pass: creds.pass } : null,
        signedOutHere: isSignedOutSlot(creds),
        apply: (secret) => ({ kind: "caldav", url, user, pass: secret.pass ?? "" } satisfies PimStoredCredentials),
      });
    }
  }

  for (const account of await listMailAccounts(vaultId)) {
    if (mailAccountKind(account) !== "imap") continue; // Microsoft = OAuth, never synced
    const slot = mailSecretKey(vaultId, account.id);
    const stored = await getPlatformServices().credentials.readSecret<{ pass?: string; refreshToken?: string }>(slot);
    const binding = imapSecretBinding(familyOfImapHost(account.host) ?? "imap", account.host, account.port, account.user);
    out.push({
      logicalId: canonicalSecretId(binding),
      slot,
      binding,
      secret: stored?.pass ? { pass: stored.pass } : null,
      signedOutHere: isSignedOutSlot(stored),
      apply: (secret) => ({ ...(stored ?? {}), pass: secret.pass ?? "" }),
    });
  }

  return out;
}

/**
 * Whether a calendar's or a mailbox's password came through the settings sync
 * from another device (`meta.imported`) — not typed here. The one-time
 * switch-over of F57 (`endpointConfirmationSettle.ts`) takes every other one
 * as this phone's own. Works without the calendar runtime, from what the
 * caller read.
 */
export async function importedSecretOf(vaultId: string): Promise<{ caldav(url: string, user: string): boolean; imap(account: { host: string; port: number; user: string }): boolean }> {
  // Unreadable is no "nothing imported": the caller proves nothing then (F57).
  const meta = await metaStore(vaultId).readMeta();
  // Under either name: 0.8.7 marked it under the old one (review of F57, O-1).
  const imported = (binding: Parameters<typeof secretImportedFor>[1]) => secretImportedFor(meta, binding);
  return {
    caldav: (url, user) => imported(calDavSecretBinding(familyOfCalDavUrl(url) ?? "webdav", url, user)),
    imap: (account) => imported(imapSecretBinding(familyOfImapHost(account.host) ?? "imap", account.host, account.port, account.user)),
  };
}

function metaStore(vaultId: string): { readMeta(): Promise<SecretsPortMeta | null>; writeMeta(meta: SecretsPortMeta): Promise<void> } {
  return {
    readMeta: async () => {
      const store = await settingsStore();
      const current = (await store.get<SecretsPortMeta>(metaKey(vaultId))) ?? null;
      const legacy = (await store.get<SecretsPortMeta>(legacyMetaKey(vaultId))) ?? null;
      const retired = (await store.get<SecretsPortMeta["retired"]>(retiredKey(vaultId))) ?? null;
      const meta = mergeLegacySecretsMeta(current, legacy) ?? (retired ? { entries: {}, imported: {}, quarantine: {} } : null);
      if (meta && retired) meta.retired = { ...(meta.retired ?? {}), ...retired };
      return migrateSecretsMetaToCanonicalIds(meta);
    },
    writeMeta: async (meta) => {
      const store = await settingsStore();
      const { retired, ...marks } = meta;
      await store.set(metaKey(vaultId), marks);
      if (retired && Object.keys(retired).length > 0) await store.set(retiredKey(vaultId), retired);
      else await store.delete(retiredKey(vaultId));
      // Taken in by this write: under the old name, nothing stays.
      await store.delete(legacyMetaKey(vaultId));
      await store.save();
    },
  };
}

/** The pending removals alone, for `retireSecret`: it never reads or writes a mark. */
function retiredStore(vaultId: string): { readMeta(): Promise<SecretsPortMeta | null>; writeMeta(meta: SecretsPortMeta): Promise<void> } {
  return {
    readMeta: async () => ({ entries: {}, imported: {}, quarantine: {}, retired: (await (await settingsStore()).get<SecretsPortMeta["retired"]>(retiredKey(vaultId))) ?? {} }),
    writeMeta: async (meta) => {
      const store = await settingsStore();
      await store.set(retiredKey(vaultId), meta.retired ?? {});
      await store.save();
    },
  };
}

/**
 * At start, before any vault opens: the secrets metadata of every vault on
 * this phone, open or not, loses the plain marks that up to now carried each
 * password in the app's settings — which the system backup also copies (F67,
 * `secretsMark.ts`). The key of the new marks lives in the keychain.
 */
export async function sealSecretsMetaAtStart(): Promise<number> {
  return sealSecretsMetaInStore(await settingsStore(), META_STORAGE, markKeySlots);
}

/**
 * "Remove account" takes this calendar account out: its secrets entry is
 * tombstoned from that act (`retireSecret`); `remove` takes the account out
 * in the same line as the secrets rounds, as on the desktop.
 */
export async function retireCalDavSecret(vaultId: string, url: string, user: string, remove: () => Promise<void>): Promise<void> {
  await retireSecret(retiredStore(vaultId), calDavSecretBinding(familyOfCalDavUrl(url) ?? "webdav", url, user), remove);
}

/**
 * The settings profile took this calendar account or IMAP mailbox away (it was
 * removed elsewhere): said to the secrets sync, never read from a missing row
 * (`noteSecretLeftWithProfile`), as on the desktop.
 */
export async function noteCalDavSecretLeftWithProfile(vaultId: string, url: string, user: string): Promise<void> {
  await noteSecretLeftWithProfile(retiredStore(vaultId), calDavSecretBinding(familyOfCalDavUrl(url) ?? "webdav", url, user));
}
export async function noteImapSecretLeftWithProfile(vaultId: string, mailbox: { host: string; port: number; user: string }): Promise<void> {
  await noteSecretLeftWithProfile(retiredStore(vaultId), imapSecretBinding(familyOfImapHost(mailbox.host) ?? "imap", mailbox.host, mailbox.port, mailbox.user));
}

/** "Remove account" takes this IMAP mailbox out: the same act for its password (`retireSecret`), as on the desktop. */
export async function retireImapSecret(vaultId: string, mailbox: { host: string; port: number; user: string }, remove: () => Promise<void>): Promise<void> {
  await retireSecret(retiredStore(vaultId), imapSecretBinding(familyOfImapHost(mailbox.host) ?? "imap", mailbox.host, mailbox.port, mailbox.user), remove);
}

/** Mobile keychain bridge for the secrets sideband. */
export function createMobileSecretsPort(vaultId: string): SecretsPort {
  // The runtime the last read of the calendar accounts went through — null
  // where there was none, or it was replaced during the read.
  let listedBy: PimCacheRepository | null | undefined;
  return createSecretsPort({
    deviceId,
    // The PIM runtime boots in PARALLEL with the sync worker (App.tsx starts
    // both without ordering) and starts again after a profile import
    // (`restartPimAfterImport`), so a cycle can catch `listPimAccounts()`
    // empty. A calendar list is whole only when the runtime that read it is
    // the one that is up now and no rebuilt index holds its accounts back
    // (`pimAccountListWhole`, the answer of the account cards; review
    // 2026-11-26, fifth round, L2). A removal of a calendar account waits for
    // that (`retireSecret`); the mailboxes are always complete.
    accountsReady: async (service) => {
      if (service === "mail") return true;
      const cache = getPimCache();
      return (listedBy === undefined || listedBy === cache) && (await pimAccountListWhole(cache));
    },
    // See the desktop port: pre-P4c metadata is keyed by the old per-device
    // names, the candidates above by the canonical one.
    ...metaStore(vaultId),
    candidates: async () => {
      const at = getPimCache();
      const listed = await mobileCandidates(vaultId);
      listedBy = at !== null && at === getPimCache() ? at : null;
      return listed;
    },
    readSlot: (slot) => getPlatformServices().credentials.readSecret(slot),
    writeSlot: (slot, value) => getPlatformServices().credentials.writeSecret(slot, value),
    removeSlot: (slot) => getPlatformServices().credentials.removeSecret(slot),
    marksOnDevice: markKeySlots.marksOnDevice,
  });
}
