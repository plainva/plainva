import { mailIdentity } from "../lib/accountProfile";
import type { CloudAccountRecord } from "../lib/cloudAccounts";
import { getPlatformServices } from "../platform/services";
import { readSlot } from "../lib/keychainSlots";
import { withAccountCredentialLock } from "../lib/tokenRefreshCoordinator";
import { legacyMailSecretKey, listMailAccounts, mailAccountsKey, mailSecretKey, removeMailAccount, updateMailAccount, type MailAccountConfig } from "./mailAccounts";
import { mergeMailAccountRows } from "./mailAccountRows";

export { resolveMailAccountAlias, sameMailAccount } from "./mailAccountRows";
import { readStoredVacation, saveStoredVacation } from "./sieveSync";
import { parseSnoozeState, repointSnoozes, type SnoozeEntry } from "./snooze";

/**
 * One mailbox stored under several ids (finding 2026-11-06, M2; decision E2).
 *
 * Rows with the SAME id fold silently (`collapseMailAccountRows`). Rows with
 * different ids and the same address - same backend, server, port and user,
 * `mailIdentity` - are most likely one mailbox connected twice, but each id
 * carries its own sign-in on this device, so they go before the person: the
 * guided account repair shows each group, the person keeps one, and this module
 * folds the others into it.
 */

/** One address stored more than once, in list order. */
export interface MailboxDuplicateGroup {
  identity: string;
  accountIds: string[];
}

/** Every address the list holds under more than one id. Pure. */
export function duplicateMailboxGroups(rows: readonly MailAccountConfig[]): MailboxDuplicateGroup[] {
  const byIdentity = new Map<string, string[]>();
  for (const row of rows) {
    const identity = mailIdentity(row);
    const ids = byIdentity.get(identity) ?? [];
    if (!ids.includes(row.id)) ids.push(row.id);
    byIdentity.set(identity, ids);
  }
  return [...byIdentity.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([identity, accountIds]) => ({ identity, accountIds }));
}

/** The cards with every mail binding of `dropIds` pointed at `keepId`. Pure. */
export function repointMailBindings(
  cards: readonly CloudAccountRecord[],
  keepId: string,
  dropIds: readonly string[],
): CloudAccountRecord[] {
  const dropped = new Set(dropIds);
  return cards.map((card) => card.services.mail && dropped.has(card.services.mail.mailAccountId)
    ? { ...card, services: { ...card.services, mail: { ...card.services.mail, mailAccountId: keepId } } }
    : card);
}

export interface MailboxFoldPorts {
  listCards(): Promise<CloudAccountRecord[]>;
  replaceCards(cards: CloudAccountRecord[]): Promise<void>;
  /** The vault's default mailbox (device-local id): a default on a folded entry moves to the kept one. */
  defaultMailAccount?: { read(): Promise<string>; write(id: string): Promise<void> };
  /** Where this shell keeps the messages put aside (S22): their entries move to the kept one. */
  snoozes?: { read(): Promise<unknown>; write(next: SnoozeEntry[]): Promise<void> };
  /** The mailbox the phone's list last had open (device report B1): a folded one moves to the kept one. */
  rememberedMailbox?: { read(): Promise<string>; write(id: string): Promise<void> };
}

/**
 * Removed ids of folded mailboxes → the id they were folded into, per vault
 * (finding 2026-11-06, M2). What still names a removed id after the fold - a
 * note filed from it (`plainva.pim.account`), a message held for sending -
 * resolves through this to the mailbox that is left. Device-local, like the
 * ids it maps.
 */
export const mailAccountAliasesKey = (vaultPath: string) => `mailAccountAliases_${btoa(unescape(encodeURIComponent(vaultPath)))}`;

export async function loadMailAccountAliases(vaultPath: string): Promise<Record<string, string>> {
  const raw = await (await getPlatformServices().loadSettings()).get<Record<string, unknown>>(mailAccountAliasesKey(vaultPath));
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

async function recordMailAccountAliases(vaultPath: string, keepId: string, dropIds: readonly string[]): Promise<void> {
  const aliases = await loadMailAccountAliases(vaultPath);
  for (const id of dropIds) aliases[id] = keepId;
  // The kept id is a live mailbox: it stands for nothing else.
  delete aliases[keepId];
  const store = await getPlatformServices().loadSettings();
  await store.set(mailAccountAliasesKey(vaultPath), aliases);
  await store.save();
}

/**
 * Keeps `keepId` and folds the other rows of its group into it, on the
 * person's word (the guided repair confirms first).
 *
 * In an order where every step leaves a working state behind: the kept row
 * first takes what only the others had (fields, the out-of-office notice, the
 * sign-in when it has none of its own), then every card that used one of the
 * others points at the kept row, and only then are the others removed - with
 * their tombstone, so the settings profile does not bring them back on another
 * device, where the same import folds them by address. Nothing is deleted at
 * the provider; filed mails stay notes. Returns the removed ids.
 */
export async function foldDuplicateMailboxes(
  vaultPath: string,
  keepId: string,
  ports: MailboxFoldPorts,
): Promise<string[]> {
  const rows = await listMailAccounts(vaultPath);
  const kept = rows.find((row) => row.id === keepId);
  if (!kept) throw new Error("mailbox-fold-target-missing");
  const identity = mailIdentity(kept);
  const others = rows.filter((row) => row.id !== keepId && mailIdentity(row) === identity);
  if (others.length === 0) return [];
  const credentials = getPlatformServices().credentials;
  await withAccountCredentialLock(mailAccountsKey(vaultPath), async () => {
    const keptSlot = mailSecretKey(vaultPath, keepId);
    let keptSecret = await readSlot<unknown>(credentials, keptSlot, legacyMailSecretKey(vaultPath, keepId));
    for (const other of others) {
      if (keptSecret) break;
      const secret = await readSlot<unknown>(credentials, mailSecretKey(vaultPath, other.id), legacyMailSecretKey(vaultPath, other.id));
      if (secret) {
        await credentials.writeSecret(keptSlot, secret);
        keptSecret = secret;
      }
    }
  });
  const merged = others.reduce((row, other) => mergeMailAccountRows(row, other), kept);
  const { id: _id, ...fields } = merged;
  await updateMailAccount(vaultPath, keepId, fields);
  const keptVacation = await readStoredVacation(vaultPath, keepId);
  if (!keptVacation.enabled && !keptVacation.message) {
    for (const other of others) {
      const vacation = await readStoredVacation(vaultPath, other.id);
      if (vacation.enabled || vacation.message) { await saveStoredVacation(vaultPath, keepId, vacation); break; }
    }
  }
  const dropIds = others.map((row) => row.id);
  await ports.replaceCards(repointMailBindings(await ports.listCards(), keepId, dropIds));
  if (ports.defaultMailAccount && dropIds.includes(await ports.defaultMailAccount.read())) await ports.defaultMailAccount.write(keepId);
  if (ports.rememberedMailbox && dropIds.includes(await ports.rememberedMailbox.read())) await ports.rememberedMailbox.write(keepId);
  if (ports.snoozes) {
    const before = parseSnoozeState(await ports.snoozes.read());
    const after = repointSnoozes(before, keepId, dropIds);
    if (after !== before) await ports.snoozes.write(after);
  }
  await recordMailAccountAliases(vaultPath, keepId, dropIds);
  for (const id of dropIds) await removeMailAccount(vaultPath, id);
  return dropIds;
}

/** One entry of a duplicate group, as the guided repair shows it. */
export interface MailboxDuplicateEntry {
  account: MailAccountConfig;
  /** A sign-in for this entry on this device; null = the keychain could not say. */
  signedIn: boolean | null;
  /** The account card whose mail is this entry, if any. */
  card: CloudAccountRecord | null;
}

/**
 * Every duplicate group of the vault with what tells its entries apart: the
 * sign-in on this device and the card that uses each. Presence only - no
 * secret leaves the keychain.
 */
export async function mailboxDuplicateEntries(
  vaultPath: string,
  cards: readonly CloudAccountRecord[],
): Promise<MailboxDuplicateEntry[][]> {
  const rows = await listMailAccounts(vaultPath);
  const groups = duplicateMailboxGroups(rows);
  if (groups.length === 0) return [];
  const credentials = getPlatformServices().credentials;
  const out: MailboxDuplicateEntry[][] = [];
  for (const group of groups) {
    const entries: MailboxDuplicateEntry[] = [];
    for (const id of group.accountIds) {
      const account = rows.find((row) => row.id === id)!;
      let signedIn: boolean | null;
      try {
        const secret = await readSlot<unknown>(credentials, mailSecretKey(vaultPath, id), legacyMailSecretKey(vaultPath, id));
        signedIn = secret !== null && secret !== undefined;
      } catch {
        signedIn = null;
      }
      entries.push({ account, signedIn, card: cards.find((card) => card.services.mail?.mailAccountId === id) ?? null });
    }
    out.push(entries);
  }
  return out;
}
