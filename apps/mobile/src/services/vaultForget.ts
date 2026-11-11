import { forgetProfileNotice } from "./profileNoticeStore";
import { barLayoutKey, getPlatformServices, taskViewStateKey, forgetTaskViewState, reportBackground } from "@plainva/ui";
import { mailAccountsKey, mailSecretKey } from "@plainva/ui/mail";

import { accountSecretKey } from "./accountBroker";
import { pimSecretKey } from "./pim/pimCredentials";
import { mobileWorkspaceSecretKeys } from "./mobileWorkspaceSecurity";
import { profileJournalPath } from "./profileImportJournal";
import { removeDataFile, removeDataFolder } from "../platform/dataFiles";
import { queueLedgerPath } from "./queueLedgerStore";

/**
 * Everything a forgotten vault leaves behind (finding 2026-08-19).
 *
 * `deleteVault` removed the container, the index database, the sync state, the
 * cloud registry and the FILE credentials — and left the rest on the device:
 * the per-service secret slots of every account, the drafts, the repair and
 * import journals, the per-vault settings record and the bar arrangement. On a
 * phone that is not tidiness: those are refresh tokens and app passwords for
 * accounts the user believes they just removed.
 *
 * Two ways of finding keys, because one is not enough:
 *
 * 1. A SUFFIX SWEEP over the settings store catches every key that ends in the
 *    vault id — including ones added later, which is the point. A list alone
 *    goes stale the first time somebody adds a key and forgets this file.
 * 2. An explicit list for the builders that DON'T end in the vault id:
 *    `mailAccounts_<base64(vault)>` and `barLayout_<bar>_<base64(vault)>`
 *    encode it. The sweep cannot see them; the completeness test pins that both
 *    are covered by building the keys with the real builders.
 *
 * Secrets are collected BEFORE the stores that name them are cleared — an
 * account id that is already gone cannot have its slot removed.
 */

const BARS = ["mobileBar"] as const;

/** Slots to remove, gathered while the registries that name them still exist. */
export async function collectVaultSecretKeys(
  vaultId: string,
  accountIds: { cloud: string[]; pim: string[]; mail: string[]; publications?: string[] },
): Promise<string[]> {
  return [
    ...accountIds.cloud.map((id) => accountSecretKey(vaultId, id)),
    ...accountIds.pim.map((id) => pimSecretKey(vaultId, id)),
    ...accountIds.mail.map((id) => mailSecretKey(vaultId, id)),
    // The cached master key of the encrypted profile. It is a CREDENTIAL, not a
    // store key, so the sweep never sees it — and it is the one secret here
    // that opens all the others.
    mobileKeyringCacheKey(vaultId),
    // The encrypted workspace's own device key, plus the admin key of every
    // publication (finding 2026-08-30). The same reasoning one family further
    // down: keys for a vault the user believes they just removed. The names
    // come from the workspace module rather than being spelled again here --
    // a second copy of a slot name is how one gets left behind later.
    ...mobileWorkspaceSecretKeys(vaultId, accountIds.publications ?? []),
  ];
}

/** Mirrors `cacheKey` in mobileSettingsSync — the profile's master-key cache. */
export const mobileKeyringCacheKey = (vaultId: string) => `mkcache_mobile_${vaultId}`;

/** Store keys that carry the vault id in an encoded form the sweep cannot see. */
export function encodedVaultKeys(vaultId: string): string[] {
  return [mailAccountsKey(vaultId), ...BARS.map((bar) => barLayoutKey(bar, vaultId))];
}

export async function forgetVaultStoreKeys(vaultId: string): Promise<void> {
  const store = await getPlatformServices().loadSettings();
  const suffixes = [`_${vaultId}`, `-${vaultId}`];
  const keys = await store.keys();
  for (const key of keys) {
    if (suffixes.some((s) => key.endsWith(s))) await store.delete(key);
  }
  for (const key of encodedVaultKeys(vaultId)) await store.delete(key);
  await store.save();
}

/** Drafts, the import journal and the queue ledger — all live outside the container. */
export async function forgetVaultFiles(vaultId: string): Promise<void> {
  // Absent is fine (no drafts were ever written, no import was interrupted).
  // Drafts hold note text: a folder that stays behind fails, after the
  // journal had its turn (stability plan R4).
  const drafts = removeDataFolder(`drafts/${vaultId}`).then(() => null, (error: unknown) => error);
  const journal = removeDataFile(profileJournalPath(vaultId)).then(() => null, (error: unknown) => error);
  // The sync entries kept while the index database was closed (R5): another
  // vault given this id later must not inherit them.
  const ledger = removeDataFile(queueLedgerPath(vaultId)).then(() => null, (error: unknown) => error);
  const failed = (await drafts) ?? (await journal) ?? (await ledger);
  if (failed) throw failed;
}

export async function forgetVaultSecrets(secretKeys: string[]): Promise<void> {
  const { credentials } = getPlatformServices();
  for (const key of secretKeys) {
    await credentials.removeSecret(key).catch((error: unknown) => {
      // Best effort: one unreachable slot must not stop the others.
      reportBackground("credentials:forget", error);
    });
  }
}

/**
 * The device-local memories the feedback round (2026-09-01, P7) keyed by
 * vault in localStorage: scroll position per file, the last open note, and
 * which profile change was already announced. They are not settings and not
 * files, so neither of the two sweeps above ever saw them — a vault forgotten
 * and re-added at the same id would have opened its notes where a previous
 * life left them.
 */
export function forgetVaultMemories(vaultId: string): void {
  forgetTaskViewState(vaultId);
  // The profile-notice memory moved into the settings store (2026-09-04); the
  // localStorage key below is cleared for installations that still carry it.
  void forgetProfileNotice(vaultId);
  if (typeof localStorage === "undefined") return;
  for (const key of [
    `plainva-scroll-${vaultId}`,
    `plainva-last-open-${vaultId}`,
    `plainva-profile-announced-${vaultId}`,
    // The session, the database views and the conflict cards (Build-91 feedback, P1/P6).
    `plainva-nav-${vaultId}`,
    `plainva-base-active-view-${vaultId}`,
    taskViewStateKey(vaultId),
    `plainva-prop-types::${vaultId}`,
    `plainva-conflicts-${vaultId}`,
  ]) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* storage unavailable: nothing to forget */
    }
  }
}
