import type { CloudServiceId } from "./cloudAccounts";
import type { ProtectedSecretStore } from "./passwordChangeJournal";
import { replaceProtectedCredential } from "./protectedCredentialUpdate";

/**
 * "Sign out on this device" and "Remove account" (plan "Verbinden", V0 and E2)
 * - two different acts, one rule each, for both shells.
 *
 * Signing out deletes what THIS device holds to sign the card in: the card's
 * own grant and any sign-in a service still kept for itself from before the
 * one sign-in (K2). The account, its services, its settings and every other
 * device stay as they are; the card then reads "sign-in needed" and its
 * button signs it in again. Removing takes the account out of the vault.
 *
 * Neither shell could sign out: the phone had only "reset shared sign-in",
 * which left the services' own sign-ins in place (and was missing for the
 * Android system sign-in, which holds no refresh token), the desktop only
 * "remove account".
 */

/** Where a service slot keeps its grant: at the top, or under `creds` (the phone's file slot). */
export interface ServiceSignInSlot {
  /** The slot's names, current first, then any it was known by before. */
  keys: readonly string[];
  nested?: "creds";
}

/** The fields of a slot that ARE a sign-in: a password, an app password, an S3 secret key. */
export const SECRET_FIELDS = ["pass", "password", "secretAccessKey"] as const;

/**
 * The slot value without a sign-in of its own: the refresh token emptied, the
 * marker of Android's system sign-in dropped, and a password or secret key
 * emptied - everything else (client, server, user, folder) stays, so signing
 * in again only asks for what was dropped. `null` when there is nothing to
 * retire.
 *
 * Tokens have to go because the vault-open migration (K2) hands any refresh
 * token or system sign-in it finds in a service slot back to the card. A
 * password has to go because it IS the sign-in of a password account: an
 * account signed out on this device that still held it would keep syncing
 * (plan "Verbinden", V2 - "deletes the stored app password here").
 */
export function retiredServiceSignIn(value: Record<string, unknown>, nested?: "creds"): Record<string, unknown> | null {
  const inner = nested ? value[nested] : value;
  if (!inner || typeof inner !== "object" || Array.isArray(inner)) return null;
  const grant = inner as Record<string, unknown>;
  const token = (typeof grant.refreshToken === "string" && grant.refreshToken !== "") || grant.nativeGoogle !== undefined;
  const secrets = SECRET_FIELDS.filter((field) => typeof grant[field] === "string" && grant[field] !== "");
  if (!token && !secrets.length) return null;
  const retired: Record<string, unknown> = { ...grant };
  if (token) {
    retired.refreshToken = "";
    delete retired.nativeGoogle;
  }
  for (const field of secrets) retired[field] = "";
  return nested ? { ...value, [nested]: retired } : retired;
}

/** Whether a slot value lost its sign-in to "Sign out on this device": a secret field is there, and empty. */
export function isSignedOutSlot(value: unknown, nested?: "creds"): boolean {
  const inner = value && typeof value === "object" ? (nested ? (value as Record<string, unknown>)[nested] : value) : null;
  if (!inner || typeof inner !== "object") return false;
  return SECRET_FIELDS.some((field) => (inner as Record<string, unknown>)[field] === "");
}

export interface DeviceSignOutPorts {
  store: ProtectedSecretStore;
  /** The service slots of the card on this device. */
  serviceSlots: readonly ServiceSignInSlot[];
  /** Deletes the card's own grant (and forgets what was minted from it). */
  clearCardGrant(): Promise<void>;
}

/**
 * Signs the card out on this device. The services' leftovers first, the
 * card's grant last: interrupted half way, the card is still signed in and
 * the next tap finishes the job, rather than a card that reads "signed out"
 * while a service still renews on its own.
 */
export async function signOutAccountHere(ports: DeviceSignOutPorts): Promise<void> {
  for (const slot of ports.serviceSlots) {
    for (const key of [...new Set(slot.keys)]) {
      const raw = await ports.store.read(key);
      if (raw === null) continue;
      const value: unknown = JSON.parse(raw);
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const next = retiredServiceSignIn(value as Record<string, unknown>, slot.nested);
        if (next) await replaceProtectedCredential(ports.store, key, value, next);
      }
      break;
    }
  }
  await ports.clearCardGrant();
}

export interface AccountRemovalPorts {
  services: readonly CloudServiceId[];
  /** Turns one service of the card off in this vault. */
  disable(service: CloudServiceId): Promise<void>;
  clearCardGrant(): Promise<void>;
  /** Takes the card out of the vault's registry. */
  dropRecord(): Promise<void>;
}

/**
 * Removes the account from the vault: every service, then the card's grant
 * (it outlives its services otherwise, E9.2), then the card. Nothing is
 * deleted at the provider.
 */
export async function removeAccountCard(ports: AccountRemovalPorts): Promise<void> {
  for (const service of ["files", "calendar", "mail"] as const) {
    if (ports.services.includes(service)) await ports.disable(service);
  }
  await ports.clearCardGrant().catch(() => undefined);
  await ports.dropRecord();
}
