import { createDeviceSignIn, type CloudAccountRecord } from "@plainva/ui";
import { mailSecretKey } from "@plainva/ui/mail";
import { pimSecretKey } from "./pim/pimCredentials";
import { accountSecretKey } from "./accountBroker";
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
const desktop = createDeviceSignIn({ pim: pimSecretKey, mail: mailSecretKey });

export const deviceCredentialKey = desktop.credentialKey;
export const deviceSignInState = desktop.state;
export const deviceSignInStates = desktop.states;

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
  const read = async (slot: string): Promise<boolean> => {
    try {
      return !!(await credentialManager.readSecret<unknown>(slot));
    } catch {
      // An unreadable slot is not proof of absence — a locked keychain would
      // otherwise mark every working account as "not signed in".
      return false;
    }
  };

  if (await read(accountSecretKey(vaultPath, record.id))) return true;

  const calendar = record.services.calendar?.pimAccountId;
  const mail = record.services.mail?.mailAccountId;
  if (calendar && (await read(pimSecretKey(vaultPath, calendar)))) return true;
  if (mail && (await read(mailSecretKey(vaultPath, mail)))) return true;

  // Nothing found — but only say so for an account whose credential we know
  // where to look for.
  return calendar || mail ? false : null;
}
