import { mailAccountKind, type MailAccountConfig } from "./mailAccounts";
import { graphMailAddress } from "./graphMail";
import { withMailCredentials } from "./mailCredentials";
import { mailTransport } from "./transport";

/**
 * Reads a mailbox the cheapest way it can be read, with what this device holds
 * ("Check connection", account sign-in plan E6): a Microsoft mailbox asks Graph
 * for its address, every other mailbox logs in over IMAP. Throws when that
 * fails; the caller turns the error into the row's state.
 */
export async function checkMailbox(vaultPath: string, account: MailAccountConfig): Promise<void> {
  if (mailAccountKind(account) === "microsoft") {
    await graphMailAddress(vaultPath, account);
    return;
  }
  await withMailCredentials(vaultPath, account, (creds) => mailTransport().checkLogin(creds));
}
