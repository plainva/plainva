import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { PimCacheRepository, type PimAccountRow } from "@plainva/core";
import {
  cloudRegistryToLogical,
  deviceLocalPimConfig,
  emptyAccountMap,
  mailAccountsForProfile,
  normalizeAccountMap,
  parseBookmarksFile,
  pimAccountsForProfile,
  serializeBookmarksFile,
  barLayoutIsInherited,
  loadBarLayout,
  saveBarLayout,
  getPlatformServices,
  type AreaOrder,
  type CloudAccountRecord,
  type ProfileAccountMap,
} from "@plainva/ui";
import { listMailAccounts, replaceMailAccounts, type MailAccountConfig } from "@plainva/ui/mail";
import { atomicWriteText } from "../platform/atomicFile";
import { loadCloudAccounts, saveCloudAccounts } from "./cloudAccountsStore";
import { applyVaultSettings, getVaultSettings, type VaultSettings } from "./mobileSettings";
import type { MobileVault } from "./vaultService";

/**
 * A way back out of a half-finished settings import (finding 2026-08-19).
 *
 * The import writes vault fields, the account map, the cloud registry, PIM rows
 * with their secret slots, mail accounts, bookmarks and the bar arrangement —
 * and until now it did all of that with no snapshot and no rollback. The
 * comment in `applyValues` said so itself. On a phone that matters more than on
 * the desktop: being killed out of the background mid-apply is the normal case,
 * not the exception, and what stays behind is half overwritten with nothing to
 * undo it.
 *
 * Two properties make this a journal rather than a variable:
 *
 * 1. It is written to disk BEFORE the first change, so a process that dies mid-
 *    apply leaves the way back on the device. That is also why it is a file and
 *    not a preference: Capacitor's Preferences write through `apply()`, which
 *    is asynchronous — the same reason the secure store was moved to `commit()`.
 *    `atomicWriteText` goes through the native plugin (fsync on Android,
 *    F_FULLFSYNC on iOS) and renames into place, so the journal is never torn.
 * 2. It lives OUTSIDE the vault container, next to the drafts. Inside it would
 *    be synchronised — and a half state travelling to other devices is exactly
 *    what this prevents.
 *
 * The snapshot deliberately carries NO credentials. Accounts are projected
 * through an empty account map, which strips `clientId`, `byoClientId` and the
 * device-local PIM fields, exactly as the desktop does: a journal sits on disk
 * for as long as the import runs, and a refresh token in it would be a new leak
 * rather than a safeguard. The restore merges those fields back in from the
 * CURRENT local state — the same move the import itself makes.
 */

export interface ProfileImportSnapshot {
  /** The complete per-vault settings record, not a patch. */
  settings: VaultSettings;
  /** Fields this shell does not understand, kept verbatim for the next export. */
  unknown: Record<string, unknown> | null;
  accountMap: ProfileAccountMap | null;
  /** Projected: no `clientId`. */
  mailAccounts: MailAccountConfig[] | null;
  /** Projected: no `byoClientId`. */
  cloudAccounts: CloudAccountRecord[] | null;
  /** Projected: no device-local config keys. Absent when the vault has no index. */
  pimAccounts?: PimAccountRow[];
  pimSelections?: {
    calendars: Array<{ accountId: string; id: string; selected: boolean }>;
    taskLists: Array<{ accountId: string; id: string; selected: boolean }>;
  };
  bookmarks: { existed: boolean; paths?: string[] };
  /** `null` means the vault inherited the global arrangement. */
  barLayout: AreaOrder | null;
}

interface ProfileImportJournal {
  startedAt: string;
  snapshot: ProfileImportSnapshot;
}

/** Beside `drafts/`, outside every vault container — a journal must not sync. */
export const profileJournalPath = (vaultId: string) => `profile-journal/${vaultId}.json`;

const accountMapKey = (vaultId: string) => `settingsSyncAccountMapMobile_${vaultId}`;
const unknownKey = (vaultId: string) => `settingsSyncUnknownMobile_${vaultId}`;

async function settingsStore() {
  return getPlatformServices().loadSettings();
}

/**
 * The state to return to, read from the LOCAL stores.
 *
 * Reading is deliberately unguarded: this runs before the journal is written
 * and before anything is touched, so a read that throws simply means the import
 * does not happen — which is the safe outcome, not a lost rollback.
 */
export async function captureProfileSnapshot(vault: MobileVault): Promise<ProfileImportSnapshot> {
  const vaultId = vault.vaultId;
  const store = await settingsStore();
  const map = emptyAccountMap();
  const cache = vault.db ? new PimCacheRepository(vault.db) : null;

  const snapshot: ProfileImportSnapshot = {
    settings: await getVaultSettings(vaultId),
    unknown: (await store.get<Record<string, unknown>>(unknownKey(vaultId))) ?? null,
    accountMap: (await store.get<ProfileAccountMap>(accountMapKey(vaultId))) ?? null,
    mailAccounts: mailAccountsForProfile(await listMailAccounts(vaultId), map) as MailAccountConfig[],
    cloudAccounts: cloudRegistryToLogical(await loadCloudAccounts(vaultId), map) as CloudAccountRecord[],
    bookmarks: { existed: false },
    barLayout: (await barLayoutIsInherited("mobileBar", vaultId))
      ? null
      : await loadBarLayout("mobileBar", vaultId),
  };

  if (cache) {
    snapshot.pimAccounts = pimAccountsForProfile(await cache.listAccounts(), map);
    snapshot.pimSelections = {
      calendars: (await cache.listCalendars()).map((c) => ({ accountId: c.accountId, id: c.id, selected: c.selected })),
      taskLists: (await cache.listTaskLists()).map((l) => ({ accountId: l.accountId, id: l.id, selected: l.selected })),
    };
  }

  try {
    const parsed = parseBookmarksFile(await vault.adapter.readTextFile(".plainva/bookmarks.json"));
    if (parsed.existed) snapshot.bookmarks = { existed: true, paths: parsed.paths };
  } catch {
    // No bookmarks file: "did not exist" is the state to restore to.
  }
  return snapshot;
}

/** Durable, before the first change. Torn journals are worse than none. */
export async function writeProfileJournal(vaultId: string, snapshot: ProfileImportSnapshot): Promise<void> {
  const journal: ProfileImportJournal = { startedAt: new Date().toISOString(), snapshot };
  await atomicWriteText(profileJournalPath(vaultId), JSON.stringify(journal));
}

export async function clearProfileJournal(vaultId: string): Promise<void> {
  await Filesystem.deleteFile({ path: profileJournalPath(vaultId), directory: Directory.Data }).catch(() => {
    // Already gone, or never written — both mean there is nothing to roll back.
  });
}

async function readProfileJournal(vaultId: string): Promise<ProfileImportJournal | null> {
  try {
    const res = await Filesystem.readFile({
      path: profileJournalPath(vaultId),
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });
    const parsed = JSON.parse(String(res.data)) as ProfileImportJournal;
    // A journal without settings cannot restore anything; treat it as absent
    // rather than half-apply it.
    return parsed?.snapshot?.settings ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Puts the vault back the way the snapshot found it.
 *
 * The order mirrors the desktop's. Nothing here is individually guarded: a
 * restore that fails halfway must NOT clear the journal, so the next start
 * tries again with the complete before-state.
 */
export async function restoreProfileSnapshot(vault: MobileVault, snapshot: ProfileImportSnapshot): Promise<void> {
  const vaultId = vault.vaultId;
  const store = await settingsStore();

  await applyVaultSettings(vaultId, snapshot.settings);

  if (snapshot.unknown === null) await store.delete(unknownKey(vaultId));
  else await store.set(unknownKey(vaultId), snapshot.unknown);
  if (snapshot.accountMap === null) await store.delete(accountMapKey(vaultId));
  else await store.set(accountMapKey(vaultId), normalizeAccountMap(snapshot.accountMap));
  await store.save();

  // The projection dropped `clientId`; take it back from the row that is here
  // now, or the rollback would log the mailbox out.
  if (snapshot.mailAccounts) {
    const current = new Map((await listMailAccounts(vaultId)).map((a) => [a.id, a]));
    await replaceMailAccounts(
      vaultId,
      snapshot.mailAccounts.map((a) => {
        const local = current.get(a.id);
        return { ...a, ...(local?.clientId !== undefined ? { clientId: local.clientId } : {}) };
      }),
    );
  }

  // Same for the registry's own BYO client id.
  if (snapshot.cloudAccounts) {
    const current = new Map((await loadCloudAccounts(vaultId)).map((a) => [a.id, a]));
    await saveCloudAccounts(
      vaultId,
      snapshot.cloudAccounts.map((a) => {
        const local = current.get(a.id);
        return { ...a, ...(local?.byoClientId !== undefined ? { byoClientId: local.byoClientId } : {}) };
      }),
    );
  }

  if (vault.db && snapshot.pimAccounts) {
    const cache = new PimCacheRepository(vault.db);
    const currentRows = await cache.listAccounts();
    const currentById = new Map(currentRows.map((r) => [r.id, r]));
    const kept = new Set(snapshot.pimAccounts.map((r) => r.id));
    // Rows the import added are not in the snapshot: they have to go.
    for (const row of currentRows) if (!kept.has(row.id)) await cache.deleteAccount(row.id);
    for (const row of snapshot.pimAccounts) {
      await cache.upsertAccount({
        ...row,
        config: { ...row.config, ...deviceLocalPimConfig(currentById.get(row.id)?.config ?? {}) },
      });
    }
    // The calendar and task-list SELECTION is deliberately NOT rolled back
    // (feedback round 2026-09-01, M1). On a phone an import interrupted in the
    // background is the normal case, and restoring the snapshot's selection
    // here put the old choice back over one the user had made since — the
    // fourth of four ways a task list "would not stay selected". A selection
    // is not import state; it is the user's, and the import journal has no
    // business with it. The snapshot still records it for diagnostics.
  }

  if (snapshot.bookmarks.existed) {
    await vault.adapter.writeTextFile(".plainva/bookmarks.json", serializeBookmarksFile(snapshot.bookmarks.paths ?? []));
  } else if (await vault.adapter.exists(".plainva/bookmarks.json")) {
    await vault.adapter.deleteItem(".plainva/bookmarks.json");
  }

  if (snapshot.barLayout) await saveBarLayout("mobileBar", vaultId, snapshot.barLayout);

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("m-bookmarks-changed"));
    window.dispatchEvent(new CustomEvent("m-accounts-imported"));
  }
}

/**
 * Rolls back an import that was interrupted after its journal hit the disk.
 *
 * Called from the vault start, not only from the sync path: an import that
 * crashed and a user who then pauses the sync would otherwise never see a
 * recovery. Returns whether anything was rolled back.
 */
export async function recoverProfileImportIfNeeded(vault: MobileVault): Promise<boolean> {
  const journal = await readProfileJournal(vault.vaultId);
  if (!journal) return false;
  await restoreProfileSnapshot(vault, journal.snapshot);
  await clearProfileJournal(vault.vaultId);
  return true;
}
