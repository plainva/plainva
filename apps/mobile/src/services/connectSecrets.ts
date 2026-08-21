import { looksLikeNextcloud, nextcloudEndpoints } from "@plainva/ui";

/**
 * What one connect run already asked the user for — held ONLY in memory
 * (finding 2026-08-21, decision E4).
 *
 * A run walks three screens (files → calendar → mail), and for a suite or a
 * Nextcloud the three ask for the same thing: server, user, password, or
 * address plus app password. Asking three times is the part the maintainer
 * hit; carrying it is the fix.
 *
 * Carrying it in the persisted `ConnectQueue` would have been the obvious
 * place and is exactly what must not happen: the queue survives an app kill
 * (that is its whole point, the OAuth round trip), and an app password that
 * outlives the run has no business on the disk. So this module is a plain
 * module variable — it dies with the process, and a run resumed after a cold
 * start simply asks again, which is the safe direction.
 */
export interface ConnectRunSecrets {
  /** The file/WebDAV URL from step 1 — the base every other endpoint derives from. */
  baseUrl?: string;
  /** Account name for WebDAV/CalDAV (suites use `email`). */
  user?: string;
  /** App password or account password. Never persisted, never logged. */
  password?: string;
  /** Suite address; the mail step asks for exactly this. */
  email?: string;
}

let secrets: ConnectRunSecrets = {};

/** Merges what a step collected. Empty values never overwrite a known one. */
export function rememberConnectSecrets(patch: ConnectRunSecrets): void {
  const next = { ...secrets };
  for (const [key, value] of Object.entries(patch) as Array<[keyof ConnectRunSecrets, string | undefined]>) {
    if (value && value.trim()) next[key] = value.trim();
  }
  secrets = next;
}

export function getConnectSecrets(): ConnectRunSecrets {
  return secrets;
}

/** Called when a run ends or is abandoned — nothing outlives the run. */
export function clearConnectSecrets(): void {
  secrets = {};
}

/**
 * The CalDAV endpoint that belongs to a file URL of the same server (P4c).
 *
 * Nextcloud is the case the maintainer meets: step 1 takes
 * `…/remote.php/dav/files/<user>/`, and the calendar lives at `…/remote.php/dav`
 * on the same instance. `nextcloudEndpoints` already derives both from one base
 * — the desktop wizard has asked it since Cloud accounts stage A; mobile never
 * did. A URL that is not a Nextcloud file root returns null rather than a
 * guessed path: a wrong prefilled server is worse than an empty field, because
 * it looks answered.
 */
export function caldavUrlFromFiles(baseUrl: string | undefined, user: string | undefined): string | null {
  if (!baseUrl || !user || !looksLikeNextcloud(baseUrl)) return null;
  return nextcloudEndpoints(baseUrl, user)?.caldav ?? null;
}
