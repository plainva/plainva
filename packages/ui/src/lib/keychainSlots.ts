/**
 * Readable names for the entries Plainva puts in the OS keychain (plan P6, E1).
 *
 * What the user used to see in Seahorse / Keychain Access / Credential Manager:
 *
 *   mail_fcb8f9ff-eabc-4785-a6e1-5671a2ab90ef_L2hvbWUvbWFyY28vS0ktUHJvamVrdGUv…
 *
 * — from which nothing can be told: not which account, not which vault, and
 * therefore not whether it is safe to delete. The base64 tail is not even
 * protective; it is the vault path in plain sight for anyone who decodes it.
 *
 * The new shape says what it is:
 *
 *   plainva · wiki · Mail · fcb8f9ff · #3f7a91c2
 *
 * The trailing hash is what makes it UNIQUE — two vaults may legitimately carry
 * the same folder name, and the readable parts alone would then collide. It is
 * a fingerprint, never a secret: it identifies, it does not protect.
 *
 * ## Why the account part is an id and not the address
 *
 * The plan (E1) asked for the account in the user's terms — `marco@example.org`
 * rather than `fcb8f9ff`. Measured against the code, that cannot hold: a key
 * IS the identity of an entry, and the account label is not stable.
 * `backfillCalendarIdentity` writes `label: email` onto an existing card the
 * moment an identity can finally be fetched — which is a feature built in this
 * same round. With the label in the key, that backfill would rename the slot
 * and leave the password under a name nothing looks for any more, and the
 * migration could not even find it: it would no longer know the old label.
 *
 * Cards with NO label at all have the same problem from the other side (P8's
 * whole subject). So the key carries the id, which never changes, and the vault
 * and service — which is already the difference between "I can see what this
 * is" and the base64 wall we had. A truly human name belongs in the platform's
 * LABEL field, which is a separate, per-OS piece of work.
 *
 * ## Why a rename is safe to ship on its own
 *
 * A slot name is device-local and always has been. `ProfileAccountMap` says so
 * in its own doc comment ("device-local id ↔ the id used in the shared
 * document"), and since P4c the id under which a credential travels is derived
 * from its BINDING — service, type, user, endpoint — not from any local name.
 * So one installation renaming its own entries cannot confuse another, and a
 * phone that has not been updated keeps using its own keychain unchanged.
 *
 * ## The one rule migration must obey
 *
 * Never delete the old entry before the new one has been READ BACK. A keychain
 * write can fail quietly (locked keyring, denied prompt, full store); deleting
 * first would turn a failed write into a lost password. Failing the other way
 * leaves a duplicate, which costs a line in the "stored credentials" list and
 * nothing else.
 */

import { getPlatformServices, hasPlatformServices } from "../platform/services";
import type { ICredentialStore } from "../platform/credentials";

/** The services a keychain entry can belong to, in the words the user sees. */
export type KeychainSlotService =
  | "files"
  | "calendar"
  | "mail"
  | "account"
  | "encryption"
  | "repair";

const SERVICE_LABEL: Record<KeychainSlotService, string> = {
  files: "Files",
  calendar: "Calendar",
  mail: "Mail",
  account: "Account",
  encryption: "Encryption",
  repair: "Repair backup",
};

/**
 * 32-bit FNV-1a over the canonical vault path, as eight lowercase hex digits.
 *
 * Deliberately not a cryptographic hash: this runs on the synchronous path that
 * builds a key, and `crypto.subtle` is async — threading a promise through
 * every slot builder would be a large change in exchange for a property nobody
 * needs here. The hash disambiguates two vaults of the same name; it guards
 * nothing, and the doc comment above says so.
 */
export function vaultFingerprint(vaultKey: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < vaultKey.length; i++) {
    hash ^= vaultKey.charCodeAt(i);
    // FNV prime 16777619, kept in 32-bit range via Math.imul.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** The last path segment, which is what a person calls their vault. */
export function vaultDisplayName(vaultKey: string): string {
  const trimmed = vaultKey.replace(/[/\\]+$/, "");
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const name = cut >= 0 ? trimmed.slice(cut + 1) : trimmed;
  return name || vaultKey;
}

/**
 * Keeps one field from swallowing the separator or the line. A label is what a
 * provider handed us (an address, a display name) and is not under our control.
 */
function field(value: string, max = 64): string {
  const flat = value.replace(/[\r\n·]+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * The readable slot name. `vaultKey` is whatever the shell uses to identify a
 * vault (the desktop passes the absolute path, mobile its vault id) — the same
 * value that used to be base64-encoded into the old name, so the fingerprint
 * stays stable across the rename.
 */
export interface KeychainSlotInput {
  vaultKey: string;
  service: KeychainSlotService;
  /** The account's STABLE id (see the note above on why not its address).
   * Omitted for vault-wide entries such as the encryption key cache. */
  account?: string;
}

export function keychainSlotName(input: KeychainSlotInput): string {
  const parts = ["plainva", field(vaultDisplayName(input.vaultKey), 40), SERVICE_LABEL[input.service]];
  if (input.account) parts.push(field(input.account));
  parts.push(`#${vaultFingerprint(input.vaultKey)}`);
  return parts.join(" · ");
}

/** True for a name in the readable shape — used to tell migrated entries from
 * the ones still to migrate, without reading them. */
export function isReadableSlotName(name: string): boolean {
  return name.startsWith("plainva · ");
}

/**
 * The name for a slot in code that BOTH shells share (mail, today).
 *
 * The shell decides: one that registered a namer gets the readable form, one
 * that did not keeps `legacy` byte for byte. That keeps the rename a desktop
 * change without forking the shared mail module — and it fails safe, because
 * a missing registry means "leave it as it was".
 */
export function shellSlotName(input: KeychainSlotInput, legacy: string): string {
  if (!hasPlatformServices()) return legacy;
  return getPlatformServices().keychainSlotName?.(input) ?? legacy;
}

/**
 * Reads a credential under its readable name, falling back to the legacy one.
 *
 * This is what makes the rename non-breaking rather than merely careful. The
 * migration can decline to finish — a locked keyring, a denied prompt — and it
 * then leaves the credential intact under its old name. Without this fallback
 * the app would look only at the new name, find nothing, and ask the user to
 * sign in again for a password that is sitting right there. With it the
 * migration is housekeeping: it tidies the keychain, and nothing depends on it
 * having succeeded.
 *
 * A throw is "cannot say", not "absent", so both names get a try before the
 * first error is passed on.
 */
export async function readSlot<T>(
  credentials: ICredentialStore,
  readable: string,
  legacy: string,
): Promise<T | null> {
  let firstError: unknown;
  try {
    const hit = await credentials.readSecret<T>(readable);
    if (hit !== null && hit !== undefined) return hit;
  } catch (e) {
    firstError = e;
  }
  if (legacy === readable) {
    if (firstError) throw firstError;
    return null;
  }
  try {
    return await credentials.readSecret<T>(legacy);
  } catch (e) {
    throw firstError ?? e;
  }
}
