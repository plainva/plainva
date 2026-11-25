import { assertEndpointConfirmedIn, mailboxEndpoints } from "../lib/endpointConfirmation";
import { checkMailLogin } from "./mailClient";
import { setMailPassword, type MailAccountConfig } from "./mailAccounts";

/**
 * Signs a mailbox in on this device with a password typed for it: verified
 * before it is stored, so a wrong one never looks like a working one.
 *
 * The servers came with the mailbox (from the account, perhaps from another
 * device) and were not typed with the password: none of them is confirmed by
 * it, and the password goes to none this device has not confirmed — the
 * surface asks **Confirm address** first (review of F57, O3).
 */
export async function signInMailboxHere(vaultPath: string, account: MailAccountConfig, pass: string): Promise<void> {
  await assertEndpointConfirmedIn(vaultPath, ...mailboxEndpoints(account));
  await checkMailLogin(
    { kind: account.kind, host: account.host, port: account.port, user: account.user, smtpHost: account.smtpHost, smtpPort: account.smtpPort },
    pass,
  );
  await setMailPassword(vaultPath, account.id, pass);
}
