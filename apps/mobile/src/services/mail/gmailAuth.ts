import { classifyAuthError } from "@plainva/ui";
import { mailTransport, saveBrokerMailAccount, type MailAccountConfig } from "@plainva/ui/mail";
import { loadCloudAccounts } from "../cloudAccountsStore";
import { getAccountBroker, getAccountToken } from "../accountBroker";
import { notifyMailChanged } from "./mailRuntime";
import { connectionContextFor, recordConnectOutcome } from "../connectQueue";
import { bindMailToConnection } from "../cloudAccountConnections";
import { getActiveVaultEntry } from "../vaultRegistry";
import { beginMobileSignIn } from "../accountSignIn";

/**
 * Gmail on the phone, through the card's one sign-in (account sign-in plan K4).
 *
 * The mailbox has no sign-in of its own: when the card's grant covers mail,
 * the mailbox is checked over IMAP with XOAUTH2 and bound to the card. When it
 * does not, the one sign-in asks for everything the card carries plus mail.
 * This replaces the Gmail button that only worked with the build's test client.
 */
async function stableGmailId(subject: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`gmail:${subject}`));
  return "gmail-" + [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function connectGmailFromCard(): Promise<void> {
  const context = await connectionContextFor("mail") ?? { vaultId: (await getActiveVaultEntry()).id };
  const record = context.cloudAccountId ? (await loadCloudAccounts(context.vaultId)).find((row) => row.id === context.cloudAccountId) : undefined;
  if (record && record.family !== "google") throw new Error("accountChanged");
  const token = record ? await getAccountToken(context.vaultId, record.id, "mail", "google") : null;
  if (record && token?.providerIdentity) {
    let access: string | undefined;
    try { access = await getAccountBroker(context.vaultId, record.id, "google").getAccessToken("mail", token); }
    catch (failure) { if (classifyAuthError(failure instanceof Error ? failure.message : String(failure)) !== "expired") throw failure; }
    if (access) {
      const email = token.nativeGoogle?.email ?? record.label;
      await mailTransport().checkLogin({ host: "imap.gmail.com", port: 993, user: email, pass: access, auth: "xoauth2" });
      const id = await stableGmailId(token.providerIdentity.subject);
      const account: MailAccountConfig = { id, label: email, kind: "gmail", host: "imap.gmail.com", port: 993, user: email, smtpHost: "smtp.gmail.com", smtpPort: 465 };
      await saveBrokerMailAccount(context.vaultId, account);
      await bindMailToConnection(context, id, token.providerIdentity);
      await recordConnectOutcome(context, "mail", { state: "connected", bindingId: id });
      notifyMailChanged();
      return;
    }
  }
  await beginMobileSignIn(context.vaultId, { family: "google", ...(record ? { cardId: record.id } : {}), add: ["mail"] });
}
