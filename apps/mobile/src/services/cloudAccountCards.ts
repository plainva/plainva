import type { CloudAccountRecord, CloudProviderFamily, CloudServiceId } from "@plainva/ui";
import {
  familyOfCalDavUrl,
  familyOfMailAccount,
  familyOfPimProvider,
  familyOfSyncProvider,
  identityKey,
  type SyncProviderId,
  verifiedProviderIdentityKey,
  verifiedProviderIdentityOf,
  type VerifiedProviderIdentity,
} from "@plainva/ui";
import { mailAccountKind } from "@plainva/ui/mail";
import { getActiveVaultEntry } from "./vaultRegistry";
import { listPimAccounts } from "./pim/pimService";
import { listMobileMailAccounts } from "./mail/mailRuntime";
import { loadCloudAccounts } from "./cloudAccountsStore";
import { accountRowState, deviceSignInStates, type DeviceSignInState } from "./deviceSignIn";
import { filesViaBrokerToken, readStoredProvider, resolveMobileFileAccess } from "./fileSyncAccess";

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
  /** The identity as the user knows it: the e-mail, or a fallback name. */
  label: string;
  /** Secondary line — for the files card, the vault it belongs to. */
  subtitle?: string;
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
 * verified identity — the rule the desktop registry has merged on since stage A.
 *
 * The comment said "verified" long before the code was: the key was built from
 * the LABEL, so two entries of one account whose labels differed stayed apart,
 * and the phone listed accounts the desktop had joined (finding 2026-08-19).
 * The provider-attested identity decides first; an e-mail-shaped label is the
 * fallback for entries that have none yet, and anything else stays its own.
 */
export async function loadAccountCards(): Promise<{ cards: AccountCard[]; records: CloudAccountRecord[] }> {
  const entry = await getActiveVaultEntry();
  const [pim, mail, records] = await Promise.all([
    listPimAccounts(),
    listMobileMailAccounts(),
    loadCloudAccounts(entry.id),
  ]);
  const [pimStates, mailStates] = await Promise.all([
    // The device account has no credential slot: its state is the permission, read where the card is shown.
    deviceSignInStates("pim", entry.id, pim.filter((a) => a.provider !== "device").map((a) => a.id)),
    deviceSignInStates("mail", entry.id, mail.map((a) => a.id)),
  ]);

  const cards: AccountCard[] = [];
  const byKey = new Map<string, AccountCard>();
  const keyOf = (
    family: CloudProviderFamily,
    label: string,
    fallback: string,
    verified?: VerifiedProviderIdentity,
  ) =>
    verified
      ? `${family}|verified:${verifiedProviderIdentityKey(verified)}`
      : `${family}|${identityKey(label) ?? `#${fallback}`}`;
  const recordFor = (family: CloudProviderFamily, label: string, verified?: VerifiedProviderIdentity) => {
    if (verified) {
      const key = verifiedProviderIdentityKey(verified);
      const byIdentity = records.find(
        (r) => r.family === family
          && r.verifiedProviderIdentity
          && verifiedProviderIdentityKey(r.verifiedProviderIdentity) === key,
      );
      if (byIdentity) return byIdentity;
    }
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
    // The card names the ACCOUNT, not the vault: a files connection labelled
    // "wiki" can never be recognised as the same account as a calendar labelled
    // with an address, so the two stayed apart forever. The vault name is what
    // it always was — a second line (E3).
    // Found by the SERVICE, not by the label: this vault's files connection is
    // exactly the record that carries it, and matching a vault name against an
    // e-mail address never succeeded.
    const stored = records.find((r) => r.services.files?.provider === entry.provider)
      ?? recordFor(family, entry.name ?? "");
    const label = identityKey(stored?.label ?? "") ? stored!.label : entry.name ?? "";
    // A files connection can be configured and still unreachable here — a
    // broker account leaves its own token blank on purpose, and a slot this
    // device never received simply is not there. Saying nothing made the card
    // claim a connection while nothing came through (finding 2026-08-19).
    const access = resolveMobileFileAccess(
      entry.provider,
      await readStoredProvider(entry.id),
      await filesViaBrokerToken(entry.id, entry.provider),
    );
    add({
      key: keyOf(family, label, entry.id, stored?.verifiedProviderIdentity),
      family,
      label,
      ...(entry.name && entry.name !== label ? { subtitle: entry.name } : {}),
      services: ["files"],
      vaultId: entry.id,
      ...(access.blocked ? { signIn: "expired" as DeviceSignInState } : {}),
      record: stored,
    });
  }
  for (const a of pim) {
    // Catalog suite providers (Apple/Fastmail/…) are CalDAV accounts whose
    // server URL names the family — same detection as the desktop registry.
    const catalogFamily =
      a.provider === "caldav" && typeof a.config?.url === "string" ? familyOfCalDavUrl(a.config.url) : null;
    const family = catalogFamily ?? familyOfPimProvider(a.provider as "caldav" | "google" | "microsoft" | "device");
    const verified = verifiedProviderIdentityOf(a) ?? undefined;
    add({
      key: keyOf(family, a.label, a.id, verified),
      family,
      label: a.label,
      services: ["calendar"],
      signIn: a.provider === "device" ? "active" : accountRowState(pimStates.get(a.id) ?? "signin"),
      record: recordFor(family, a.label, verified),
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
