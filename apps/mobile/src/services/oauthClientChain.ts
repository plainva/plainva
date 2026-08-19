import type { PimStoredCredentials } from "./pim/pimCredentials";

/**
 * Which OAuth client this device signs a Google/Microsoft account in with
 * (finding 2026-08-19).
 *
 * "Erneut anmelden" used to look in exactly two places: this account's own
 * credential slot and the field of the add-account form. A row that arrived
 * through the settings sync has no slot on this device — client ids are
 * device-local by design, they are stripped from the profile on purpose — and
 * the form is not open at that moment. So the answer was "Google needs its own
 * client id (BYO)", pointing at a field the user could not reach, while the id
 * sat on the device in two or three other places.
 *
 * The chain is ordered by how specific the source is, not by how easy it is to
 * read: the slot this account was created with beats the shared one, which
 * beats another service of the same account, which beats a sibling account of
 * the same family. The last step is the one that carries a synced row: whatever
 * registration the user set up for their other Google account is the
 * registration they have.
 *
 * Pure on purpose — the stores are read by the caller, so the order can be
 * asserted without a device.
 */
export interface OAuthClient {
  clientId: string;
  clientSecret?: string;
}

export interface ClientSources {
  /** The credential slot of THIS calendar account, if it survived. */
  own?: PimStoredCredentials | null;
  /** The account-wide token (shared sign-in) of the same cloud account. */
  accountToken?: { clientId?: string; clientSecret?: string } | null;
  /**
   * The file-sync provider of this vault. Its credential shape differs per
   * provider (WebDAV carries a password, not a client id), so it arrives
   * untyped and is read defensively — the same way `accountLogin` reads it.
   */
  syncProvider?: { provider: string; creds: unknown } | null;
  /** Credential slots of other calendar accounts of the same provider. */
  siblings?: readonly PimStoredCredentials[];
}

function fromCredentials(creds: PimStoredCredentials | null | undefined, provider: string): OAuthClient | null {
  if (!creds || creds.kind === "caldav" || creds.kind !== provider) return null;
  if (!creds.clientId) return null;
  const secret = creds.kind === "google" ? creds.clientSecret : undefined;
  return { clientId: creds.clientId, ...(secret ? { clientSecret: secret } : {}) };
}

export function pickOAuthClient(provider: "google" | "microsoft", sources: ClientSources): OAuthClient | null {
  const own = fromCredentials(sources.own, provider);
  if (own) return own;

  const shared = sources.accountToken;
  if (shared?.clientId) {
    return { clientId: shared.clientId, ...(shared.clientSecret ? { clientSecret: shared.clientSecret } : {}) };
  }

  // The file sync of the same account: Drive belongs to Google, OneDrive to
  // Microsoft, so a mismatched provider is not a candidate.
  const sync = sources.syncProvider;
  const syncFamily = sync?.provider === "drive" ? "google" : sync?.provider === "onedrive" ? "microsoft" : null;
  if (sync && syncFamily === provider) {
    const creds = sync.creds as { clientId?: string; clientSecret?: string };
    if (creds.clientId) {
      return { clientId: creds.clientId, ...(creds.clientSecret ? { clientSecret: creds.clientSecret } : {}) };
    }
  }

  for (const sibling of sources.siblings ?? []) {
    const found = fromCredentials(sibling, provider);
    if (found) return found;
  }
  return null;
}
