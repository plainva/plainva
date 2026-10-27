import { listMailAccounts, removeMailAccount, updateMailAccount, type MailAccountConfig } from "./mailAccounts";
import { readStoredVacation, saveStoredVacation } from "./sieveSync";

/**
 * When Google refuses Gmail, the account page connects it with an app password
 * instead (plan "Verbinden", E7): a new IMAP mailbox takes the place of the
 * refused one on the same card. Everything the person set on the old mailbox
 * goes with it - its name, its signature and the signatures per address, its
 * sender addresses, its server-side filter host and its out-of-office notice -
 * so the switch loses nothing (review of plan "Verbinden", finding 1). The
 * server, port, user and backend are the new mailbox's own.
 */
export function carriedMailboxSettings(previous: MailAccountConfig): Partial<Omit<MailAccountConfig, "id">> {
  const carried: Partial<Omit<MailAccountConfig, "id">> = {};
  if (previous.label?.trim()) carried.label = previous.label;
  if (previous.signature !== undefined) carried.signature = previous.signature;
  if (previous.signatures && Object.keys(previous.signatures).length) carried.signatures = { ...previous.signatures };
  if (previous.senders?.length) carried.senders = [...previous.senders];
  if (previous.sieveHost) carried.sieveHost = previous.sieveHost;
  if (previous.sievePort) carried.sievePort = previous.sievePort;
  return carried;
}

/**
 * Moves what the person set from the refused mailbox to its replacement, then
 * removes the refused one - with its tombstone, so another device does not
 * bring it back through the settings profile (`removeMailAccount`). Filed
 * mails stay notes; nothing is deleted at the provider.
 */
export async function replaceMailbox(vaultPath: string, replacedId: string, replacementId: string): Promise<void> {
  if (replacedId === replacementId) return;
  const previous = (await listMailAccounts(vaultPath)).find((entry) => entry.id === replacedId);
  if (previous) {
    await updateMailAccount(vaultPath, replacementId, carriedMailboxSettings(previous));
    const vacation = await readStoredVacation(vaultPath, replacedId);
    if (vacation.enabled || vacation.message) await saveStoredVacation(vaultPath, replacementId, vacation);
  }
  await removeMailAccount(vaultPath, replacedId);
}

/**
 * The address the app-password mailbox signs in with: the refused mailbox's
 * own (its IMAP user), never the card's label - a card can carry a name the
 * person gave it, or another address of the same account (review finding 1).
 * Only a card without a mailbox yet falls back to its label, which for Google
 * is the account's address.
 */
export function replacementMailAddress(
  record: { label: string; services: { mail?: { mailAccountId: string } } },
  mailboxes: readonly Pick<MailAccountConfig, "id" | "user">[],
): string {
  const mailbox = record.services.mail ? mailboxes.find((entry) => entry.id === record.services.mail!.mailAccountId) : undefined;
  return mailbox?.user?.trim() || record.label.trim();
}
