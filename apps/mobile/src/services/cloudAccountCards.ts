import type { CloudAccountRecord, CloudProviderFamily, CloudServiceId } from "@plainva/ui";
import {
  familyOfCalDavUrl,
  familyOfMailAccount,
  familyOfPimProvider,
  familyOfSyncProvider,
  identityKey,
  type SyncProviderId,
} from "@plainva/ui";
import { mailAccountKind } from "@plainva/ui/mail";
import { getActiveVaultEntry } from "./vaultRegistry";
import { listPimAccounts } from "./pim/pimService";
import { listMobileMailAccounts } from "./mail/mailRuntime";
import { loadCloudAccounts } from "./cloudAccountsStore";
import { accountRowState, deviceSignInStates, type DeviceSignInState } from "./deviceSignIn";

/**
 * What the phone calls a cloud ACCOUNT (mobile rework N4.1/N4.2).
 *
 * The three subsystem stores each know one service and none of them knows the
 * account, so the fold lives here — once, for the overview AND the detail. Two
 * copies of it would be worse than the per-service list it replaces: the list
 * and the destination behind its chevron would disagree about what an account
 * is.
 */

export type AccountCard = {
  /** Stable across reloads and safe in a nav path: family + verified e-mail. */
  key: string;
  family: CloudProviderFamily;
  /** The identity as the user knows it: the e-mail, or the vault's name. */
  label: string;
  services: CloudServiceId[];
  /** The files service is a vault container; its detail is the vault detail. */
  vaultId?: string;
  /** Sign-in state ON THIS DEVICE, for the services that can have one. */
  signIn?: DeviceSignInState;
  /** The registry record, when the account has one — the login needs it. */
  record?: CloudAccountRecord;
};

/**
 * Entries fold into one account when they carry the same family AND the same
 * verified e-mail — the rule the desktop registry has merged on since stage A.
 * Anything looser and the phone would list different accounts than the desktop
 * for the same vault. Entries without an e-mail identity stay their own.
 */
export async function loadAccountCards(): Promise<{ cards: AccountCard[]; records: CloudAccountRecord[] }> {
  const entry = await getActiveVaultEntry();
  const [pim, mail, records] = await Promise.all([
    listPimAccounts(),
    listMobileMailAccounts(),
    loadCloudAccounts(entry.id),
  ]);
  const [pimStates, mailStates] = await Promise.all([
    deviceSignInStates("pim", entry.id, pim.map((a) => a.id)),
    deviceSignInStates("mail", entry.id, mail.map((a) => a.id)),
  ]);

  const cards: AccountCard[] = [];
  const byKey = new Map<string, AccountCard>();
  const keyOf = (family: CloudProviderFamily, label: string, fallback: string) =>
    `${family}|${identityKey(label) ?? `#${fallback}`}`;
  const recordFor = (family: CloudProviderFamily, label: string) => {
    const identity = identityKey(label);
    return records.find(
      (r) => r.family === family && (identity ? identityKey(r.label) === identity : r.label === label),
    );
  };
  const add = (card: AccountCard) => {
    const merged = byKey.get(card.key);
    if (!merged) {
      byKey.set(card.key, card);
      cards.push(card);
      return;
    }
    for (const s of card.services) if (!merged.services.includes(s)) merged.services.push(s);
    merged.vaultId = merged.vaultId ?? card.vaultId;
    merged.record = merged.record ?? card.record;
    // An expired sign-in outranks a working one: the card must report the
    // service that stopped, not the one that happens to be listed first.
    if (card.signIn === "expired") merged.signIn = "expired";
    else merged.signIn = merged.signIn ?? card.signIn;
  };

  // Files first: its destination can disconnect and remove, the others cannot.
  if (entry.provider) {
    const family = familyOfSyncProvider(entry.provider as SyncProviderId);
    add({
      key: keyOf(family, entry.name ?? "", entry.id),
      family,
      label: entry.name ?? "",
      services: ["files"],
      vaultId: entry.id,
      record: recordFor(family, entry.name ?? ""),
    });
  }
  for (const a of pim) {
    // Catalog suite providers (Apple/Fastmail/…) are CalDAV accounts whose
    // server URL names the family — same detection as the desktop registry.
    const catalogFamily =
      a.provider === "caldav" && typeof a.config?.url === "string" ? familyOfCalDavUrl(a.config.url) : null;
    const family = catalogFamily ?? familyOfPimProvider(a.provider as "caldav" | "google" | "microsoft");
    add({
      key: keyOf(family, a.label, a.id),
      family,
      label: a.label,
      services: ["calendar"],
      signIn: accountRowState(pimStates.get(a.id) ?? "signin"),
      record: recordFor(family, a.label),
    });
  }
  for (const a of mail) {
    const family = familyOfMailAccount({ kind: mailAccountKind(a), user: a.user, host: a.host });
    add({
      key: keyOf(family, a.label, a.id),
      family,
      label: a.label,
      services: ["mail"],
      signIn: mailStates.get(a.id) ?? "signin",
      record: recordFor(family, a.label),
    });
  }
  return { cards, records };
}
