import { cardSignInState, createDeviceSignIn, hasStoredAccountGrant, isSignedOutSlot, type CloudAccountRecord, type DeviceSignInState } from "@plainva/ui";
import { mailSecretKey } from "@plainva/ui/mail";
import { pimSecretKey } from "./pim/pimCredentials";
import { accountSecretKey, getAccountToken } from "./accountBroker";
import { legacySlot, slot } from "./keychainSlots";
import { readSlot } from "@plainva/ui";
import { credentialManager } from "./CredentialManager";

/**
 * The desktop binding of the shared "signed in on this device?" rule (P2).
 *
 * Until now only the phone could say this sentence. The desktop answered the
 * same situation with a raw `missing mail credentials` exception — a mailbox
 * whose metadata arrived over the settings sync, but whose password
 * deliberately did not, read as a defect instead of as one missing step.
 *
 * Slot names are the desktop's own: keyed by (base64) vault PATH, where mobile
 * keys by vault id. Same rule, different names — which is precisely why the
 * builders are injected instead of restated inside the rule.
 */
let cached: ReturnType<typeof createDeviceSignIn> | null = null;

/**
 * Built on first use, not while this module LOADS (C20). The factory itself is
 * cheap, but calling anything across a package boundary at module-init time is
 * the shape that shipped a white window twice: the bundler may evaluate this
 * chunk before the one that holds `createDeviceSignIn`, and then the whole app
 * dies before it mounts. Memoised, so callers still see one instance.
 */
function desktop(): ReturnType<typeof createDeviceSignIn> {
  return (cached ??= createDeviceSignIn({
    pim: pimSecretKey,
    mail: mailSecretKey,
    // P6: a rename that could not finish leaves the credential under its old
    // name — reading only the new one would call a working account "not signed in".
    legacy: { pim: legacySlot.calendar, mail: legacySlot.mail },
  }));
}

export const deviceCredentialKey: ReturnType<typeof createDeviceSignIn>["credentialKey"] = (...a) =>
  desktop().credentialKey(...a);
export const deviceSignInState: ReturnType<typeof createDeviceSignIn>["state"] = (...a) =>
  desktop().state(...a);
export const deviceSignInStates: ReturnType<typeof createDeviceSignIn>["states"] = (...a) =>
  desktop().states(...a);

export { accountRowState, isOAuthProvider } from "@plainva/ui";
export type { DeviceAccountKind, DeviceSignInState } from "@plainva/ui";

/**
 * Does this cloud account hold ANY credential on this device (P2)?
 *
 * An account arrives over the settings sync as metadata; its sign-in never
 * does. On a second device the card therefore looks complete while nothing
 * behind it works, and the only hint used to be whichever service failed first.
 *
 * Checked in the order the credential is actually looked up: the broker token
 * that covers the whole account since cloud-accounts stage B, then the
 * per-service slots that predate it.
 *
 * `null` means "cannot say", and the surface then says NOTHING rather than
 * guessing: a files-only account keeps its credential in the provider's own
 * slot, whose shape depends on the provider, and the sync status answers that
 * question better than a chip could.
 */
export async function accountSignedInHere(
  vaultPath: string,
  record: CloudAccountRecord
): Promise<boolean | null> {
  // Both names (P6): a rename that could not finish leaves the credential
  // intact under its old one, and reading only the new name would report a
  // working account as "not signed in".
  const read = async (readable: string, legacy: string): Promise<boolean> => {
    try {
      // A slot whose password "Sign out on this device" emptied is no sign-in.
      const value = await readSlot<unknown>(credentialManager, readable, legacy);
      return !!value && !isSignedOutSlot(value);
    } catch {
      // An unreadable slot is not proof of absence — a locked keychain would
      // otherwise mark every working account as "not signed in".
      return false;
    }
  };

  if (await read(accountSecretKey(vaultPath, record.id), legacySlot.account(vaultPath, record.id))) return true;

  const calendar = record.services.calendar?.pimAccountId;
  const mail = record.services.mail?.mailAccountId;
  // A file account of its own (WebDAV, S3, Dropbox) signs in through the vault's
  // files slot (plan "Verbinden", V2: its head shows the same one state as every
  // other card). Dropbox was missing, so its card had no state and no "Sign out
  // on this device" on the desktop while the phone showed both (settings plan
  // 2026-10-29, § 1.4).
  const provider = record.services.files?.provider;
  const files = provider === "webdav" || provider === "s3" || provider === "dropbox" ? provider : null;
  if (calendar && (await read(pimSecretKey(vaultPath, calendar), legacySlot.calendar(vaultPath, calendar)))) return true;
  if (mail && (await read(mailSecretKey(vaultPath, mail), legacySlot.mail(vaultPath, mail)))) return true;
  if (files && (await read(slot.files(vaultPath, files), legacySlot.files(vaultPath, files)))) return true;

  // Nothing found — but only say so for an account whose credential we know
  // where to look for.
  return calendar || mail || files ? false : null;
}

/**
 * The ONE state of an account card on the desktop (plan "Verbinden", V0) -
 * the shared rule (`cardSignInState`) over the desktop's slots, the same the
 * phone's cards follow. A Google or Microsoft card is its own sign-in: the
 * service slots the one sign-in emptied must not keep a card "signed in"
 * that was signed out here. `files` is the vault's file access (the
 * page reads it once for the files card).
 */
export async function accountSignInStateHere(
  vaultPath: string,
  record: CloudAccountRecord,
  files: "blocked" | "signedOut" | null = null,
): Promise<DeviceSignInState | undefined> {
  const broker = record.family === "google" || record.family === "microsoft";
  const cardGrant = broker ? hasStoredAccountGrant(await getAccountToken(vaultPath, record.id).catch(() => null)) : null;
  const serviceStates: DeviceSignInState[] = [];
  if (!broker) {
    const here = await accountSignedInHere(vaultPath, record);
    if (here !== null) serviceStates.push(here ? "active" : "signin");
  }
  if (record.services.files && files) serviceStates.push(files === "signedOut" ? "signin" : "expired");
  return cardSignInState({ family: record.family, cardGrant, serviceStates });
}
