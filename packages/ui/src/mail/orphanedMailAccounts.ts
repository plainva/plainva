import type { IDatabaseAdapter } from "@plainva/core";
import { getPlatformServices } from "../platform/services";
import { readSlot } from "../lib/keychainSlots";
import { hasCachedMail } from "./mailCache";
import { forgetGraphMailRuntime } from "./graphMail";
import { legacyMailSecretKey, listMailAccounts, mailAccountKind, mailSecretKey, removeMailAccount, type MailAccountConfig } from "./mailAccounts";

/**
 * Mail accounts a failed setup left behind (finding 2026-09-24, E4).
 *
 * Until the storage check compared content, every new mail account on the
 * desktop ended in "storageFailed" — and the rollback, broken the same way,
 * removed the password but kept the entry. Each attempt left one more mailbox
 * in the list that has no password and never fetched a single message, and the
 * settings sync carried those entries to every other device.
 *
 * The rule is deliberately STRICT. An entry counts only when all three hold:
 *   - no credential of any kind on this device (an unreadable keychain is NOT
 *     proof of absence — a locked keychain would otherwise offer every working
 *     account for removal);
 *   - no record of a successful fetch, anywhere: `firstFetchAt` is written on
 *     the first fetch that works and travels with the account;
 *   - no cached mail on this device (accounts from before the marker existed:
 *     a mailbox that ever showed a message list has cached envelopes). Without
 *     a writable mail cache nothing can be proven, and nothing is offered.
 *
 * Nothing here removes anything by itself: the shells show a notice, and each
 * removal is one confirmed click that re-checks the rule first.
 */

export interface MailAccountEvidence {
  /** A credential exists on this device; null = the keychain could not say. */
  hasCredential: boolean | null;
  /** The account has fetched successfully at least once (on any device). */
  fetchedOnce: boolean;
  /** Cached envelopes exist on this device; null = no cache to ask. */
  hasCachedMail: boolean | null;
}

/** The rule itself. Pure: `null` (unknown) never counts as "absent". */
export function isOrphanedMailAccount(evidence: MailAccountEvidence): boolean {
  return evidence.hasCredential === false && !evidence.fetchedOnce && evidence.hasCachedMail === false;
}

async function credentialPresent(vaultKey: string, accountId: string): Promise<boolean | null> {
  try {
    const secret = await readSlot<unknown>(
      getPlatformServices().credentials,
      mailSecretKey(vaultKey, accountId),
      legacyMailSecretKey(vaultKey, accountId),
    );
    return secret !== null && secret !== undefined;
  } catch {
    return null;
  }
}

/** The evidence for one account, from this device's keychain and mail cache. */
export async function mailAccountEvidence(
  vaultKey: string,
  account: MailAccountConfig,
  db: IDatabaseAdapter | null | undefined,
): Promise<MailAccountEvidence> {
  return {
    hasCredential: await credentialPresent(vaultKey, account.id),
    fetchedOnce: typeof account.firstFetchAt === "string" && account.firstFetchAt.length > 0,
    hasCachedMail: await hasCachedMail(db, account.id),
  };
}

/** Every account of the vault that the strict rule calls orphaned. */
export async function findOrphanedMailAccounts(
  vaultKey: string,
  db: IDatabaseAdapter | null | undefined,
): Promise<MailAccountConfig[]> {
  const out: MailAccountConfig[] = [];
  for (const account of await listMailAccounts(vaultKey)) {
    if (isOrphanedMailAccount(await mailAccountEvidence(vaultKey, account, db))) out.push(account);
  }
  return out;
}

/**
 * Removes ONE orphaned entry — only the account entry and its (empty)
 * credential slot, never cached mail, never files. The rule is checked again
 * right before: an account signed in since the list was shown is kept, and the
 * result says so.
 */
export async function removeOrphanedMailAccount(
  vaultKey: string,
  accountId: string,
  db: IDatabaseAdapter | null | undefined,
): Promise<"removed" | "kept"> {
  const account = (await listMailAccounts(vaultKey)).find((a) => a.id === accountId);
  if (!account) return "removed";
  if (!isOrphanedMailAccount(await mailAccountEvidence(vaultKey, account, db))) return "kept";
  forgetGraphMailRuntime(vaultKey, accountId);
  await removeMailAccount(vaultKey, accountId);
  return "removed";
}

/** What a listed entry's second line names: its server, or its backend. */
export function orphanedMailServer(account: MailAccountConfig): string {
  const kind = mailAccountKind(account);
  return kind === "gmail" ? "Gmail" : kind === "microsoft" ? "Microsoft" : account.host || account.user;
}

/** Device-local: which orphans the notice was dismissed for ("Later"). */
export const mailOrphanNoticeKey = (vaultKey: string) =>
  `mailOrphanNoticeDismissed_${btoa(unescape(encodeURIComponent(vaultKey)))}`;

/** True when the notice was dismissed for every one of these accounts. */
export async function mailOrphanNoticeDismissed(vaultKey: string, accountIds: readonly string[]): Promise<boolean> {
  if (accountIds.length === 0) return true;
  const store = await getPlatformServices().loadSettings();
  const dismissed = await store.get<string[]>(mailOrphanNoticeKey(vaultKey));
  const known = new Set(Array.isArray(dismissed) ? dismissed : []);
  return accountIds.every((id) => known.has(id));
}

/**
 * "Later": the notice stays away for exactly these entries. A NEW orphan brings
 * it back, which is the point — it is one notice per finding, not a switch.
 */
export async function dismissMailOrphanNotice(vaultKey: string, accountIds: readonly string[]): Promise<void> {
  const store = await getPlatformServices().loadSettings();
  const dismissed = await store.get<string[]>(mailOrphanNoticeKey(vaultKey));
  const next = [...new Set([...(Array.isArray(dismissed) ? dismissed : []), ...accountIds])];
  await store.set(mailOrphanNoticeKey(vaultKey), next);
  await store.save();
}
