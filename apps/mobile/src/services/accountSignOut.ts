import { removeAccountCard, signOutAccountHere, type CloudAccountRecord, type CloudServiceId, type ServiceSignInSlot } from "@plainva/ui";
import { legacyMailSecretKey, mailSecretKey } from "@plainva/ui/mail";
import { accountCredentialStore } from "./accountCredentialStore";
import { clearAccountToken } from "./accountBroker";
import { loadCloudAccounts, saveCloudAccounts } from "./cloudAccountsStore";
import { clearNativeGoogleTokens } from "./googleNativeAuthorization";
import { pimSecretKey } from "./pim/pimCredentials";
import { pimSyncNow, removePimAccount } from "./pim/pimService";
import { removeMobileMailAccount } from "./mail/mailRuntime";
import { syncProviderSlot } from "./syncSlot";

/**
 * "Sign out on this device" and "Remove account" on the phone (plan
 * "Verbinden", V0) - the shared rules (`@plainva/ui`, accountSignOut) over the
 * phone's slots. The desktop wires the same rules in `cloudAccountsActions.ts`.
 */

/** What the account page shows of the card, where it differs from the record. */
export interface SignOutCard {
  services: readonly CloudServiceId[];
  /** The vault whose files the card carries. */
  vaultId?: string;
  pimAccountId?: string;
  mailAccountId?: string;
}

function serviceSlots(vaultId: string, card: SignOutCard): ServiceSignInSlot[] {
  const slots: ServiceSignInSlot[] = [];
  if (card.services.includes("files") && card.vaultId) slots.push({ keys: [syncProviderSlot(card.vaultId)], nested: "creds" });
  if (card.pimAccountId) slots.push({ keys: [pimSecretKey(vaultId, card.pimAccountId)] });
  if (card.mailAccountId) slots.push({ keys: [mailSecretKey(vaultId, card.mailAccountId), legacyMailSecretKey(vaultId, card.mailAccountId)] });
  return slots;
}

/**
 * Deletes this phone's sign-in for the card: the card's grant, what a service
 * still kept for itself, and - for Android's system sign-in - the tokens Play
 * services cached for Plainva. The account, its services and its settings
 * stay; other devices stay signed in.
 *
 * Deliberately NOT revoked at Google: `AuthorizationClient.revokeAccess`
 * withdraws the consent of the account for the app's client, and every phone
 * signs in with that same client - it would sign out the other phones too.
 */
export async function signOutMobileAccountHere(vaultId: string, recordId: string | undefined, card: SignOutCard): Promise<void> {
  // A device-only act: it reads the card's record, if there is one, and never
  // writes one (review of plan "Verbinden", finding 6). A card without a record
  // holds no grant of its own - only its services' slots sign it in.
  await signOutAccountHere({
    store: accountCredentialStore,
    serviceSlots: serviceSlots(vaultId, card),
    clearCardGrant: async () => { if (recordId) await clearAccountToken(vaultId, recordId); },
  });
  await clearNativeGoogleTokens();
  await restartServices(card);
}

/** The running services read the new state at once, rather than on their next turn. */
async function restartServices(card: SignOutCard): Promise<void> {
  if (card.pimAccountId) pimSyncNow();
  if (card.services.includes("files") && card.vaultId) {
    // Stop and start as one step (third review, finding 4).
    const { restartSyncIfActive } = await import("./syncService");
    await restartSyncIfActive(card.vaultId);
  }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("m-pim-changed"));
}

/**
 * Takes the account out of the vault, on every device: calendar and mailbox
 * are removed here as on their own screens, the vault's files connection is
 * taken out with its stored sign-in (the vault and its notes stay), then the
 * card's grant and the card. Nothing is deleted at the provider.
 */
export async function removeMobileAccount(vaultId: string, record: CloudAccountRecord | undefined, card: SignOutCard): Promise<void> {
  await removeAccountCard({
    services: card.services,
    disable: async (service) => {
      if (service === "files" && card.vaultId) {
        // The sign-in goes with the account, as on the desktop (review finding 5a).
        const { disconnectFiles } = await import("./syncService");
        await disconnectFiles(card.vaultId);
      } else if (service === "calendar" && card.pimAccountId) await removePimAccount(card.pimAccountId);
      else if (service === "mail" && card.mailAccountId) await removeMobileMailAccount(card.mailAccountId);
    },
    clearCardGrant: async () => {
      if (record) await clearAccountToken(vaultId, record.id);
    },
    dropRecord: async () => {
      if (!record) return;
      await saveCloudAccounts(vaultId, (await loadCloudAccounts(vaultId)).filter((entry) => entry.id !== record.id));
    },
  });
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("m-vaults-changed"));
    window.dispatchEvent(new CustomEvent("m-pim-changed"));
  }
}
