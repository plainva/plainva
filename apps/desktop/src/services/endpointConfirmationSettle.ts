import { PimCacheRepository, type IDatabaseAdapter, type S3Credentials, type WebDavCredentials } from "@plainva/core";
import { afterSecretsSeal, confirmationEndpoint, mailboxEndpoints, readSlot, settleEndpointConfirmationsIn, type ICredentialStore } from "@plainva/ui";
import { legacySlot, slot } from "./keychainSlots";
import { legacyMailSecretKey, listMailAccounts, mailAccountKind, mailSecretKey } from "@plainva/ui/mail";
import { credentialManager } from "./CredentialManager";
import type { PimStoredCredentials } from "./pim/pimCredentials";
import { pimSecretKey } from "./pim/pimCredentials";
import { ensureMarkKeyHome, importedSecretSlots } from "./settingsSecrets";

/**
 * The one-time switch-over of a vault to F57 on the desktop (maintainer,
 * 2026-11-18; review of F57, O1/O2): a password this device holds and that
 * was typed here confirms its address, so nobody is asked about their own
 * server after the update. Runs at vault open before anything sends;
 * `isEndpointConfirmedIn` waits for it.
 *
 * Proof is positive only — this device holds the password, and it did not
 * come through the settings sync (`importedSecretSlots`):
 * - **Files (WebDAV, S3):** the stored sign-in; it never travels with the
 *   settings.
 * - **Calendar (CalDAV), Mail (IMAP, SMTP, Sieve):** the stored password,
 *   not marked as imported.
 * An account without a password here proves nothing, whatever the profile
 * brought (its password may come later, through the sync). Every read is
 * strict: a keychain that does not answer, a record or a list that cannot be
 * read makes the switch-over throw — nothing is confirmed, the vault stays
 * unsettled, and the next start runs it again.
 */
const strict: ICredentialStore = {
  readSecret: (key) => credentialManager.readSecretStrict(key),
  writeSecret: () => Promise.reject(new Error("the switch-over only reads")),
  removeSecret: () => Promise.reject(new Error("the switch-over only reads")),
};

export async function provenEndpoints(vaultPath: string, db: IDatabaseAdapter | null): Promise<Array<string | null>> {
  const proven: Array<string | null> = [];
  const webdav = await readSlot<WebDavCredentials>(strict, slot.files(vaultPath, "webdav"), legacySlot.files(vaultPath, "webdav"));
  const s3 = await readSlot<S3Credentials>(strict, slot.files(vaultPath, "s3"), legacySlot.files(vaultPath, "s3"));
  if (webdav?.url && webdav.pass) proven.push(confirmationEndpoint(webdav.url));
  if (s3?.endpoint && s3.secretAccessKey) proven.push(confirmationEndpoint(s3.endpoint));

  const cache = db ? new PimCacheRepository(db) : null;
  const imported = await importedSecretSlots(vaultPath, cache);

  for (const account of cache ? await cache.listAccounts() : []) {
    if (account.provider !== "caldav") continue;
    const creds = await readSlot<PimStoredCredentials>(strict, slot.calendar(vaultPath, account.id), legacySlot.calendar(vaultPath, account.id));
    if (creds?.kind !== "caldav" || !creds.url || !creds.pass) continue;
    if (!imported.has(pimSecretKey(vaultPath, account.id))) proven.push(confirmationEndpoint(creds.url));
  }

  for (const account of await listMailAccounts(vaultPath)) {
    if (mailAccountKind(account) !== "imap") continue;
    const stored = await readSlot<{ pass?: string }>(strict, mailSecretKey(vaultPath, account.id), legacyMailSecretKey(vaultPath, account.id));
    if (!stored?.pass) continue;
    if (!imported.has(mailSecretKey(vaultPath, account.id))) proven.push(...mailboxEndpoints(account));
  }
  return proven;
}

/**
 * At vault open, before the sync, the calendar and mail start. It runs behind
 * the sealing at start (`afterSecretsSeal`) and only once the home of the key
 * of the marks is decided (`ensureMarkKeyHome`): without it this start does
 * not switch over, and the next one tries again (review of F57, round three,
 * O-C). A second window seals nothing; it asks the app process for the same
 * home.
 */
export function settleVaultEndpointConfirmations(vaultPath: string, db: IDatabaseAdapter | null): Promise<void> {
  return settleEndpointConfirmationsIn(vaultPath, () =>
    afterSecretsSeal(async () => {
      await ensureMarkKeyHome();
      return provenEndpoints(vaultPath, db);
    }),
  );
}
