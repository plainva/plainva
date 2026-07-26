import { getPlatformServices } from "@plainva/ui";

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
  | "signin";

/** Credential slot key per account kind (mirrors the desktop keychain slots). */
export function deviceCredentialKey(kind: DeviceAccountKind, vaultId: string, accountId: string): string {
  return kind === "pim" ? `pim_${vaultId}_${accountId}` : `mail_${vaultId}_${accountId}`;
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
 * True when this provider signs in through OAuth — those are the accounts that
 * genuinely cannot travel. Static IMAP/CalDAV credentials CAN travel with the
 * secrets sync, so a missing slot there means "secrets sync is off or locked",
 * not "this can never be synced". The distinction matters for the wording.
 */
export function isOAuthProvider(provider: string): boolean {
  return provider === "google" || provider === "microsoft";
}
