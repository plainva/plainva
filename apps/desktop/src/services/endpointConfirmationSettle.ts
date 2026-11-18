import { PimCacheRepository, confirmedAccessOf, type IDatabaseAdapter } from "@plainva/core";
import { confirmationEndpoint, mailboxEndpoints, settleEndpointConfirmationsIn } from "@plainva/ui";
import { hasCachedMail, listMailAccounts, mailAccountKind, mailSecretKey } from "@plainva/ui/mail";
import { credentialManager } from "./CredentialManager";
import { getPimCredentials, pimSecretKey } from "./pim/pimCredentials";
import { importedSecretSlots } from "./settingsSecrets";
import { getDeviceId } from "./settingsProfile";

/**
 * The one-time switch-over of a vault to F57 on the desktop (maintainer,
 * 2026-11-18): what already worked on this device, or was typed here, counts
 * as confirmed, so nobody is asked about a server they have been using. Runs
 * at vault open before anything sends; `isEndpointConfirmedIn` waits for it.
 *
 * What counts as proof, per service:
 * - **Files (WebDAV, S3):** every stored sign-in — they never travel with the
 *   settings, so each was typed on this device (or moved here by it).
 * - **Calendar (CalDAV):** this device's own entry in the row's confirmed
 *   accesses (it fetched there), calendars in its cache, or a password that did
 *   not come through the settings sync.
 * - **Mail:** messages in its cache, or a password that did not come through
 *   the settings sync.
 *
 * A device that got an account only through the sync, and never used it,
 * proves nothing and is asked.
 */
export async function provenEndpoints(vaultPath: string, db: IDatabaseAdapter | null): Promise<Array<string | null>> {
  const proven: Array<string | null> = [];
  const [webdav, s3] = await Promise.all([
    credentialManager.getWebDavCredentials(vaultPath).catch(() => null),
    credentialManager.getS3Credentials(vaultPath).catch(() => null),
  ]);
  if (webdav?.url) proven.push(confirmationEndpoint(webdav.url));
  if (s3?.endpoint) proven.push(confirmationEndpoint(s3.endpoint));

  const cache = db ? new PimCacheRepository(db) : null;
  const imported = await importedSecretSlots(vaultPath, cache).catch(() => new Set<string>());
  const device = await getDeviceId().catch(() => null);

  for (const account of cache ? await cache.listAccounts().catch(() => []) : []) {
    if (account.provider !== "caldav") continue;
    const creds = await getPimCredentials(vaultPath, account.id).catch(() => null);
    if (creds?.kind !== "caldav" || !creds.url) continue;
    const ownEntry = !!device && !!confirmedAccessOf(account.config)[device];
    const hasCalendars = (await cache!.listCalendars(account.id).catch(() => [])).length > 0;
    if (ownEntry || hasCalendars || !imported.has(pimSecretKey(vaultPath, account.id))) proven.push(confirmationEndpoint(creds.url));
  }

  for (const account of await listMailAccounts(vaultPath).catch(() => [])) {
    if (mailAccountKind(account) !== "imap") continue;
    const cached = (await hasCachedMail(db, account.id).catch(() => null)) === true;
    if (cached || !imported.has(mailSecretKey(vaultPath, account.id))) proven.push(...mailboxEndpoints(account));
  }
  return proven;
}

/** At vault open, before the sync, the calendar and mail start. */
export function settleVaultEndpointConfirmations(vaultPath: string, db: IDatabaseAdapter | null): Promise<void> {
  return settleEndpointConfirmationsIn(vaultPath, () => provenEndpoints(vaultPath, db));
}
