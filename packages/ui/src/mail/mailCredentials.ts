import { getMailPassword, type MailAccountConfig } from "./mailAccounts";
import { mailAccessTokenFor } from "./graphMail";
import { MailCredentialsMissingError, MailEndpointNotConfirmedError } from "./credentialsError";
import type { ImapCreds } from "./transport";
import { isMailOAuthRejection } from "./net/xoauth2";
import { isEndpointConfirmedIn, mailboxEndpoints } from "../lib/endpointConfirmation";

export async function mailCredentials(vaultPath: string, account: MailAccountConfig, force = false): Promise<ImapCreds> {
  if (account.kind === "gmail") {
    // OAuth tokens are never sent to an imported or edited arbitrary server.
    if (account.host !== "imap.gmail.com" || account.port !== 993 || (account.smtpHost && account.smtpHost !== "smtp.gmail.com")
      || (account.smtpPort && account.smtpPort !== 465 && account.smtpPort !== 587)) throw new Error("Invalid Gmail server configuration");
    return { host: account.host, port: account.port, user: account.user, auth: "xoauth2", pass: await mailAccessTokenFor(vaultPath, account.id, force) };
  }
  const pass = await getMailPassword(vaultPath, account.id);
  if (!pass) throw new MailCredentialsMissingError();
  // A stored password goes to a mail server in a private network only once this
  // device confirmed it (F57): IMAP, SMTP and Sieve all take it from here. Until
  // then nothing is sent and the mailbox says **Confirm address** with the
  // address, never "sign in": a password typed here confirms no server it came
  // with (review of F57, O3).
  for (const endpoint of mailboxEndpoints(account)) {
    if (endpoint && !(await isEndpointConfirmedIn(vaultPath, endpoint))) throw new MailEndpointNotConfirmedError(endpoint);
  }
  return { host: account.host, port: account.port, user: account.user, pass };
}

/** Retry only rejection during authentication, before any mailbox command or
 * SMTP submission. A disconnect after sending is never replayed automatically. */
export async function withMailCredentials<T>(vaultPath: string, account: MailAccountConfig, operation: (creds: ImapCreds) => Promise<T>): Promise<T> {
  try { return await operation(await mailCredentials(vaultPath, account)); }
  catch (error) {
    if (account.kind !== "gmail" || !isMailOAuthRejection(error)) throw error;
    return operation(await mailCredentials(vaultPath, account, true));
  }
}
