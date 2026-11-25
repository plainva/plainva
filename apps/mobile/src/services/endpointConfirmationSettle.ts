import { PimCacheRepository } from "@plainva/core";
import { adoptEndpointConfirmationsIn, confirmationEndpoint, getPlatformServices, mailboxEndpoints, readSlot, settleEndpointConfirmationsIn } from "@plainva/ui";
import { legacyMailSecretKey, listMailAccounts, mailAccountKind, mailSecretKey } from "@plainva/ui/mail";
import type { MobileVault } from "./vaultService";
import { getStoredProvider } from "./syncService";
import { storedProviderEndpoint } from "./fileSyncAccess";
import { getPimCredentials } from "./pim/pimCredentials";
import { importedSecretOf } from "./mobileSecretsPort";

/**
 * The one-time switch-over of a vault to F57 on the phone (maintainer,
 * 2026-11-18; review of F57, O1/O2), the same proof as the desktop's
 * (`apps/desktop/src/services/endpointConfirmationSettle.ts`): a password
 * this phone holds and that was typed here — not taken through the settings
 * sync (`importedSecretOf`) — confirms its address.
 *
 * - **Files (WebDAV, S3):** the stored sign-in; it never travels with the
 *   settings.
 * - **Calendar (CalDAV), Mail (IMAP, SMTP, Sieve):** the stored password,
 *   not marked as imported.
 * No password, no proof. Every read is strict — the secure store throws when
 * it does not answer — so what cannot be read makes the switch-over throw:
 * nothing is confirmed, the vault stays unsettled, the next start runs it again.
 */
export async function provenEndpoints(v: Pick<MobileVault, "vaultId" | "db">): Promise<Array<string | null>> {
  const proven: Array<string | null> = [storedProviderEndpoint(await getStoredProvider(v.vaultId))];
  const imported = await importedSecretOf(v.vaultId);
  const cache = v.db ? new PimCacheRepository(v.db) : null;

  for (const account of cache ? await cache.listAccounts() : []) {
    if (account.provider !== "caldav") continue;
    const creds = await getPimCredentials(v.vaultId, account.id);
    if (creds?.kind !== "caldav" || !creds.url || !creds.pass) continue;
    if (!imported.caldav(creds.url, creds.user)) proven.push(confirmationEndpoint(creds.url));
  }

  const credentials = getPlatformServices().credentials;
  for (const account of await listMailAccounts(v.vaultId)) {
    if (mailAccountKind(account) !== "imap") continue;
    const stored = await readSlot<{ pass?: string }>(credentials, mailSecretKey(v.vaultId, account.id), legacyMailSecretKey(v.vaultId, account.id));
    if (!stored?.pass) continue;
    if (!imported.imap(account)) proven.push(...mailboxEndpoints(account));
  }
  return proven;
}

/** At vault open, before mail, the sync and the calendar start; every check waits for it. */
export function settleVaultEndpointConfirmations(v: Pick<MobileVault, "vaultId" | "db">): Promise<void> {
  return settleEndpointConfirmationsIn(v.vaultId, () => provenEndpoints(v));
}

/**
 * Before the account transfer puts anything into a vault (review of F57,
 * A-1): the vault is switched over first, so nothing it is handed is ever
 * taken as typed there. A vault that existed proves what it holds of its own
 * now; a new one has nothing and counts as switched over. What the transfer
 * carries along is confirmed by the transfer itself, exactly what this phone
 * had confirmed for it.
 */
export async function settleBeforeTransfer(target: Pick<MobileVault, "vaultId" | "db">, existing: boolean): Promise<void> {
  if (existing) await settleVaultEndpointConfirmations(target);
  else await adoptEndpointConfirmationsIn(target.vaultId, []);
}
