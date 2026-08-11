import { getPlatformServices } from "../platform/services";
import { needsReauthorisation } from "./authErrors";
import { readSlot } from "./keychainSlots";

/**
 * "Is this account signed in ON THIS DEVICE?" (plan P7, lifted to shared in P2).
 *
 * Account METADATA travels with the settings sync; sign-ins deliberately never
 * do (the secrets allowlist of the settings-sync plan is a security decision
 * and stays). The consequence used to be silent: a synced Google/Microsoft
 * account showed up on the phone, the calendar stayed empty, and nothing on
 * screen explained why.
 *
 * Deliberately built ONE level up from calendars: the mail client has the exact
 * same situation (static IMAP/CalDAV passwords sync, OAuth does not), so it
 * inherits this helper and the shared state row instead of rebuilding them (E8).
 *
 * Shared since P2 because the DESKTOP had the same hole and answered it with a
 * raw `missing mail credentials` exception — a mailbox that simply has not been
 * signed in here read as a defect. The rule is one rule; only the slot NAMES
 * differ per shell (mobile keys by vault id, desktop by vault path), so those
 * are injected rather than restated.
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
 * Where each shell keeps its credential slots. Mobile keys by vault id, the
 * desktop by (base64) vault path — a single builder here would report every
 * working account of one shell as "not signed in", which is exactly the bug
 * this module was written to prevent.
 */
export interface DeviceSlotBuilders {
  pim(vault: string, accountId: string): string;
  mail(vault: string, accountId: string): string;
  /**
   * The names a shell used BEFORE the P6 rename. Optional: a shell that never
   * renamed passes none. Without this a credential whose rename could not
   * finish would read as "not signed in" although it is intact under its old
   * name — the fix would be offered for a problem that does not exist.
   */
  legacy?: { pim(vault: string, accountId: string): string; mail(vault: string, accountId: string): string };
}

export interface DeviceSignIn {
  credentialKey(kind: DeviceAccountKind, vault: string, accountId: string): string;
  state(kind: DeviceAccountKind, vault: string, accountId: string): Promise<DeviceSignInState>;
  states(kind: DeviceAccountKind, vault: string, accountIds: string[]): Promise<Map<string, DeviceSignInState>>;
}

/** Binds the rule to one shell's slot names. */
export function createDeviceSignIn(slots: DeviceSlotBuilders): DeviceSignIn {
  const credentialKey = (kind: DeviceAccountKind, vault: string, accountId: string): string =>
    kind === "pim" ? slots.pim(vault, accountId) : slots.mail(vault, accountId);

  /**
   * Reads the sign-in state of one account. A missing/unreadable slot counts as
   * "signin" — never as an error: the point of the state is to offer the fix,
   * and a broken slot needs the same fix as an absent one.
   */
  const state = async (
    kind: DeviceAccountKind,
    vault: string,
    accountId: string
  ): Promise<DeviceSignInState> => {
    const legacyKey = slots.legacy
      ? kind === "pim"
        ? slots.legacy.pim(vault, accountId)
        : slots.legacy.mail(vault, accountId)
      : credentialKey(kind, vault, accountId);
    try {
      const secret = await readSlot<unknown>(
        getPlatformServices().credentials,
        credentialKey(kind, vault, accountId),
        legacyKey,
      );
      return secret ? "active" : "signin";
    } catch {
      return "signin";
    }
  };

  const states = async (
    kind: DeviceAccountKind,
    vault: string,
    accountIds: string[]
  ): Promise<Map<string, DeviceSignInState>> => {
    const out = new Map<string, DeviceSignInState>();
    for (const id of accountIds) out.set(id, await state(kind, vault, id));
    return out;
  };

  return { credentialKey, state, states };
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
