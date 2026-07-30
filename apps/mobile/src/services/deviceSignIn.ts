import { getPlatformServices, needsReauthorisation } from "@plainva/ui";
import { mailSecretKey } from "@plainva/ui/mail";

/**
 * "Is this account signed in ON THIS DEVICE?" (plan P7).
 *
 * Account METADATA travels with the settings sync; sign-ins deliberately never
 * do (the secrets allowlist of the settings-sync plan is a security decision
 * and stays). The consequence used to be silent: a synced Google/Microsoft
 * account showed up on the phone, the calendar stayed empty, and nothing on
 * screen explained why.
 *
 * Deliberately built ONE level up from calendars: the mobile mail client
 * follows directly after this plan and has the exact same situation (static
 * IMAP/CalDAV passwords sync, OAuth does not), so it inherits this helper and
 * the shared state row instead of rebuilding them (E8).
 */

/** Which kind of account a row describes — decides where the credential lives. */
export type DeviceAccountKind = "pim" | "mail";

export type DeviceSignInState =
  /** A credential slot exists on this device — the account works here. */
  | "active"
  /** Known account, but no credential on this device: it has to sign in once. */
  | "signin"
  /**
   * A credential exists but the provider no longer accepts it (revoked,
   * expired, password changed). Looks identical to "active" from the slot
   * alone — only a real failure can tell them apart, which is why this state
   * needs `accountRowState` below rather than `deviceSignInState`.
   */
  | "expired";

/**
 * Credential slot key per account kind. PIM mirrors `pimCredentials.ts`; mail
 * delegates to the SHARED builder rather than restating it — this helper was
 * written before the mail client existed and guessed a different shape
 * (`mail_<vault>_<account>`), which would have reported every working mailbox
 * as "not signed in". One builder, no drift.
 */
export function deviceCredentialKey(kind: DeviceAccountKind, vaultId: string, accountId: string): string {
  return kind === "pim" ? `pim_${vaultId}_${accountId}` : mailSecretKey(vaultId, accountId);
}

/**
 * Reads the sign-in state of one account. A missing/unreadable slot counts as
 * "signin" — never as an error: the point of the state is to offer the fix,
 * and a broken slot needs the same fix as an absent one.
 */
export async function deviceSignInState(
  kind: DeviceAccountKind,
  vaultId: string,
  accountId: string
): Promise<DeviceSignInState> {
  try {
    const secret = await getPlatformServices().credentials.readSecret<unknown>(
      deviceCredentialKey(kind, vaultId, accountId)
    );
    return secret ? "active" : "signin";
  } catch {
    return "signin";
  }
}

/** Sign-in state for a list of accounts, keyed by account id. */
export async function deviceSignInStates(
  kind: DeviceAccountKind,
  vaultId: string,
  accountIds: string[]
): Promise<Map<string, DeviceSignInState>> {
  const out = new Map<string, DeviceSignInState>();
  for (const id of accountIds) out.set(id, await deviceSignInState(kind, vaultId, id));
  return out;
}

/**
 * The state ONE account row shows, from the two things that are actually known
 * about it: whether a credential exists on this device, and what the last real
 * sync attempt said.
 *
 * Why both: the slot alone can only answer "is there a credential", never "does
 * it still work". A Google refresh token whose consent screen sits in "testing"
 * expires after seven days — the slot stays full, every sync fails, and the row
 * cheerfully read "aktiv" (finding §2.9). The failure text is the only witness.
 *
 * Deliberately narrow: ONLY a failure that re-authorising actually fixes turns
 * the row red. A network hiccup or a wrong client id must not read as "sign in
 * again" — the first fixes itself, the second is a trip to the provider console,
 * and offering the wrong action is worse than offering none. Pure.
 */
export function accountRowState(signIn: DeviceSignInState, lastError?: string | null): DeviceSignInState {
  // No credential at all wins: signing in is the fix either way, and it is the
  // more precise statement of the two.
  if (signIn !== "active") return signIn;
  return needsReauthorisation(lastError) ? "expired" : "active";
}

/**
 * True when this provider signs in through OAuth — those are the accounts that
 * genuinely cannot travel. Static IMAP/CalDAV credentials CAN travel with the
 * secrets sync, so a missing slot there means "secrets sync is off or locked",
 * not "this can never be synced". The distinction matters for the wording.
 */
export function isOAuthProvider(provider: string): boolean {
  return provider === "google" || provider === "microsoft";
}
