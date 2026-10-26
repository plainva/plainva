import type { FetchFn } from "@plainva/core";
import { GOOGLE_MAIL_SCOPES, oauthScopesCover } from "../lib/oauthScopes";
import { accountLoginBinding } from "../lib/accountLoginGrant";
import { parseGoogleUserInfo, verifiedProviderIdentityKey } from "../lib/accountProfile";
import { accountCredentialGrants } from "../lib/accountCredentials";
import type { CloudAccountRecord } from "../lib/cloudAccounts";
import type { StoredAccountToken } from "../lib/tokenBroker";
import { withAccountCredentialLock } from "../lib/tokenRefreshCoordinator";
import { listMailAccounts, saveBrokerMailAccount } from "./mailAccounts";
import { mailTransport } from "./transport";

export interface GmailAccountPorts {
  fetch: FetchFn;
  read(): Promise<CloudAccountRecord[]>;
  write(records: CloudAccountRecord[]): Promise<void>;
  saveGrant(accountId: string, token: StoredAccountToken): Promise<void>;
}

/** Confirm the provider subject, actual mail scope and IMAP access before any
 * service is rebound. Adding Gmail never consumes an existing app password. */
export async function completeGmailSignIn(vault: string, token: StoredAccountToken, accessToken: string, ports: GmailAccountPorts, expected?: CloudAccountRecord): Promise<CloudAccountRecord> {
  if (!accessToken || !oauthScopesCover(token.scopes, GOOGLE_MAIL_SCOPES, "google")) throw new Error("Google did not grant Gmail access");
  const response = await ports.fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${accessToken}` } });
  const profile = response.ok ? parseGoogleUserInfo(await response.json()) : null;
  if (!profile?.label || !profile.label.includes("@")) throw new Error("Google account identity could not be verified");
  if (expected && (expected.family !== "google" || (expected.verifiedProviderIdentity
    ? verifiedProviderIdentityKey(expected.verifiedProviderIdentity) !== verifiedProviderIdentityKey(profile.identity)
    : expected.label.trim().toLowerCase() !== profile.label.toLowerCase()))) throw new Error("A different provider account was selected. Existing sign-ins were kept.");
  if (token.nativeGoogle && token.nativeGoogle.email.toLowerCase() !== profile.label.toLowerCase()) throw new Error("Native Google account identity changed");
  const confirmed: StoredAccountToken = { ...token, providerIdentity: profile.identity, verifiedAt: Date.now() };
  accountCredentialGrants(confirmed); // Validate the exact secure-store shape.
  // Stable identifiers let a received grant resume after the mailbox was saved
  // but the registry write was interrupted, without creating orphan accounts.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`gmail:${profile.identity.subject}`));
  const stableId = "gmail-" + [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  await mailTransport().checkLogin({ host: "imap.gmail.com", port: 993, user: profile.label, pass: accessToken, auth: "xoauth2" });
  return withAccountCredentialLock(`gmail-connect:${vault}`, async () => {
    const records = await ports.read();
    const mailboxes = await listMailAccounts(vault);
    const source = expected ? records.find(record => record.id === expected.id) : records.find(record => record.family === "google"
      && record.verifiedProviderIdentity && verifiedProviderIdentityKey(record.verifiedProviderIdentity) === verifiedProviderIdentityKey(profile.identity)
      && (!record.services.mail || mailboxes.find(mail => mail.id === record.services.mail?.mailAccountId)?.kind === "gmail"));
    const bound = mailboxes.find(mail => mail.id === source?.services.mail?.mailAccountId);
    const resumed = source && expected && !expected.services.mail && bound?.id === stableId && bound.kind === "gmail"
      && bound.user.toLowerCase() === profile.label!.toLowerCase()
      && accountLoginBinding({ ...source, verifiedProviderIdentity: expected.verifiedProviderIdentity, services: { ...source.services, mail: undefined } }) === accountLoginBinding(expected);
    if (expected && (!source || (!resumed && accountLoginBinding(source) !== accountLoginBinding(expected)))) throw new Error("The account changed during sign-in");
    if (bound && bound.kind !== "gmail") throw new Error("This account already has a mailbox with its own sign-in");
    const mailbox = bound ?? mailboxes.find(mail => mail.kind === "gmail" && mail.user.toLowerCase() === profile.label!.toLowerCase());
    const id = source?.id ?? stableId;
    const mailId = mailbox?.id ?? stableId;
    const record: CloudAccountRecord = { ...source, id, family: "google", label: source?.label || profile.label!, verifiedProviderIdentity: profile.identity, services: { ...source?.services, mail: { mailAccountId: mailId } } };
    await ports.saveGrant(id, confirmed);
    const current = await ports.read();
    const latest = current.find(item => item.id === id);
    if (source && (!latest || accountLoginBinding(latest) !== accountLoginBinding(source))) throw new Error("The account changed during sign-in");
    await saveBrokerMailAccount(vault, { ...mailbox, id: mailId, label: mailbox?.label || profile.label!, kind: "gmail", host: "imap.gmail.com", port: 993, user: profile.label!, smtpHost: "smtp.gmail.com", smtpPort: 465 }, "connect");
    const updated = latest ? { ...latest, verifiedProviderIdentity: profile.identity, services: record.services } : record;
    await ports.write([...current.filter(item => item.id !== id), updated]);
    const saved = (await ports.read()).find(item => item.id === id);
    if (!saved || accountLoginBinding(saved) !== accountLoginBinding(updated)) throw new Error("Gmail account storage could not be confirmed");
    return updated;
  });
}
