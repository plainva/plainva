import { createDeviceSignIn } from "@plainva/ui";
import { mailSecretKey } from "@plainva/ui/mail";

/**
 * The mobile binding of the shared "signed in on this device?" rule (P2). The
 * rule itself lives in `@plainva/ui`; only the slot NAMES are ours.
 *
 * Kept as a module with the original signatures on purpose: every mobile caller
 * and every existing test keeps working untouched, which is what makes them the
 * proof that lifting the rule changed no behaviour here.
 *
 * PIM mirrors `pimCredentials.ts`; mail delegates to the SHARED builder rather
 * than restating it — this helper was written before the mail client existed
 * and guessed a different shape (`mail_<vault>_<account>`), which would have
 * reported every working mailbox as "not signed in". One builder, no drift.
 */
const mobile = createDeviceSignIn({
  pim: (vaultId, accountId) => `pim_${vaultId}_${accountId}`,
  mail: mailSecretKey,
});

export const deviceCredentialKey = mobile.credentialKey;
export const deviceSignInState = mobile.state;
export const deviceSignInStates = mobile.states;

export { accountRowState, isOAuthProvider } from "@plainva/ui";
export type { DeviceAccountKind, DeviceSignInState } from "@plainva/ui";
