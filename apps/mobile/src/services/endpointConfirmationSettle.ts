import { PimCacheRepository, confirmedAccessOf } from "@plainva/core";
import { confirmationEndpoint, mailboxEndpoints, settleEndpointConfirmationsIn } from "@plainva/ui";
import { hasCachedMail, listMailAccounts, mailAccountKind } from "@plainva/ui/mail";
import type { MobileVault } from "./vaultService";
import { getStoredProvider } from "./syncService";
import { storedProviderEndpoint } from "./fileSyncAccess";
import { getPimCredentials } from "./pim/pimCredentials";
import { importedSecretOf } from "./mobileSecretsPort";
import { mobileSyncDeviceId } from "./mobileSettingsSync";

/**
 * The one-time switch-over of a vault to F57 on the phone (maintainer,
 * 2026-11-18), the same proof as the desktop's
 * (`apps/desktop/src/services/endpointConfirmationSettle.ts`): what already
 * worked on this phone, or was typed here, counts as confirmed — a phone that
 * syncs a Nextcloud over `http` at home asks nothing after the update.
 *
 * - **Files (WebDAV, S3):** the stored sign-in — it never travels with the
 *   settings, so it was entered on this phone.
 * - **Calendar (CalDAV):** this phone's own entry in the row's confirmed
 *   accesses, calendars in its cache, or a password that did not come through
 *   the settings sync.
 * - **Mail:** messages in its cache, or a password that did not come through
 *   the settings sync.
 */
export async function provenEndpoints(v: Pick<MobileVault, "vaultId" | "db">): Promise<Array<string | null>> {
  const proven: Array<string | null> = [storedProviderEndpoint(await getStoredProvider(v.vaultId).catch(() => null))];
  const imported = await importedSecretOf(v.vaultId).catch(() => null);
  const device = await Promise.resolve().then(() => mobileSyncDeviceId()).catch(() => null);
  const cache = v.db ? new PimCacheRepository(v.db) : null;

  for (const account of cache ? await cache.listAccounts().catch(() => []) : []) {
    if (account.provider !== "caldav") continue;
    const creds = await getPimCredentials(v.vaultId, account.id).catch(() => null);
    if (creds?.kind !== "caldav" || !creds.url) continue;
    const ownEntry = !!device && !!confirmedAccessOf(account.config)[device];
    const hasCalendars = (await cache!.listCalendars(account.id).catch(() => [])).length > 0;
    if (ownEntry || hasCalendars || !imported?.caldav(creds.url, creds.user)) proven.push(confirmationEndpoint(creds.url));
  }

  for (const account of await listMailAccounts(v.vaultId).catch(() => [])) {
    if (mailAccountKind(account) !== "imap") continue;
    const cached = (await hasCachedMail(v.db, account.id).catch(() => null)) === true;
    if (cached || !imported?.imap(account)) proven.push(...mailboxEndpoints(account));
  }
  return proven;
}

/** At vault open, before mail, the sync and the calendar start; every check waits for it. */
export function settleVaultEndpointConfirmations(v: Pick<MobileVault, "vaultId" | "db">): Promise<void> {
  return settleEndpointConfirmationsIn(v.vaultId, () => provenEndpoints(v));
}
