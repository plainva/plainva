import { assertConnectionIdentity, parseMicrosoftMe, toast, type ServiceConnectionContext } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import {
  forgetGraphMailRuntime,
  GRAPH_MAIL_SCOPES,
  getMailRefreshToken,
  listMailAccounts,
  removeMailAccount,
  saveMicrosoftMailAccount,
} from "@plainva/ui/mail";
import type { MailAccountConfig } from "@plainva/ui/mail";
import type { MobileVault } from "../vaultService";
import { beginPimOAuth, setOAuthPurposeHandler } from "../pim/pimOAuth";
import { webdavFetch } from "../../adapters/webdavHttp";
import { loadCloudAccounts } from "../cloudAccountsStore";
import { bindMailToConnection } from "../cloudAccountConnections";
import { connectionContextFor, recordConnectOutcome } from "../connectQueue";

/**
 * The mobile mail runtime (mail feinplan G1). Unlike the PIM runtime there is
 * no worker and no cache: stage one is online-only, so a screen asks Graph
 * directly. What this module owns is the account lifecycle — which vault mail
 * belongs to, and what happens when a Microsoft consent comes back.
 *
 * Accounts live where the desktop keeps them (settings store + credential
 * store, `@plainva/ui/mail`), keyed by the mobile vault id.
 */

let vaultId: string | null = null;

/** Fired after the account list changes, so open screens re-query. */
export const MAIL_CHANGED_EVENT = "m-mail-changed";

export function notifyMailChanged(): void {
  window.dispatchEvent(new CustomEvent(MAIL_CHANGED_EVENT));
}

export function mailVaultId(): string | null {
  return vaultId;
}

export async function listMobileMailAccounts(): Promise<MailAccountConfig[]> {
  if (!vaultId) return [];
  return listMailAccounts(vaultId);
}

export async function removeMobileMailAccount(accountId: string): Promise<void> {
  if (!vaultId) return;
  forgetGraphMailRuntime(vaultId, accountId);
  await removeMailAccount(vaultId, accountId);
  notifyMailChanged();
}

/**
 * Binds mail to a vault and claims the "mail" OAuth purpose, so the single
 * redirect handler (G0.2) hands a mail token here instead of creating a
 * calendar account. Called on boot and on every vault switch.
 */
export function startMobileMail(vault: MobileVault): void {
  vaultId = vault.vaultId;
  setOAuthPurposeHandler("mail", async ({ provider, clientId, refreshToken, accessToken, serviceContext }) => {
    if (provider !== "microsoft") throw new Error("only Microsoft mail is available on mobile");
    const boundVault = serviceContext?.vaultId;
    if (!boundVault) throw new Error("no vault open");
    if (!accessToken) throw new Error("needsConsent");
    await bindMicrosoftMailAccount(boundVault, clientId, refreshToken, accessToken, serviceContext);
  });
}

export function stopMobileMail(): void {
  vaultId = null;
}

/**
 * Persists the account, then names it after the mailbox it can actually read.
 * A token that cannot read the mailbox leaves no half-connected account behind
 * — same guarantee the desktop gives (`cloudAccountsActions`).
 */
export async function bindMicrosoftMailAccount(vault: string, clientId: string, refreshToken: string, accessToken: string, context?: ServiceConnectionContext): Promise<void> {
  const record = context?.cloudAccountId ? (await loadCloudAccounts(vault)).find(r => r.id === context.cloudAccountId) : undefined;
  if (context?.cloudAccountId && !record) throw new Error("accountChanged");
  const headers = { Authorization: `Bearer ${accessToken}` };
  const me = await webdavFetch("https://graph.microsoft.com/v1.0/me", { headers });
  if (!me.ok) throw new Error("identityUnavailable");
  const profile = parseMicrosoftMe(await me.json());
  assertConnectionIdentity(context?.expectedIdentity ?? record?.verifiedProviderIdentity, profile?.identity ?? null);
  const address = profile?.label;
  if (!address) throw new Error("identityUnavailable");
  if (!record?.verifiedProviderIdentity && record?.label.includes("@") && record.label.trim().toLowerCase() !== address.trim().toLowerCase()) throw new Error("wrongAccount");
  const probe = await webdavFetch("https://graph.microsoft.com/v1.0/me/mailFolders?$top=1", { headers });
  if (!probe.ok) throw new Error("needsConsent");
  const accounts = await listMailAccounts(vault);
  const previous = accounts.find(a => a.id === record?.services.mail?.mailAccountId) ?? accounts.find(a => a.kind === "microsoft" && a.user.toLowerCase() === address.toLowerCase());
  const id = previous?.id ?? crypto.randomUUID();
  const account: MailAccountConfig = { ...previous, id, label: previous?.label || address, host: "", port: 0, user: address, kind: "microsoft", clientId };
  const oldToken = previous ? await getMailRefreshToken(vault, id) : null;
  try {
    await saveMicrosoftMailAccount(vault, account, refreshToken);
    await bindMailToConnection(context, id, profile!.identity);
    await recordConnectOutcome(context, "mail", { state: previous ? "alreadyConnected" : "connected", bindingId: id });
    } catch (err) {
      forgetGraphMailRuntime(vault, id);
      const bound = context?.cloudAccountId && (await loadCloudAccounts(vault)).find(r => r.id === context.cloudAccountId)?.services.mail?.mailAccountId === id;
      const ownRow = (await listMailAccounts(vault)).find(a => a.id === id);
      if (!bound && JSON.stringify(ownRow) === JSON.stringify(account) && await getMailRefreshToken(vault, id) === refreshToken) {
      if (previous) await saveMicrosoftMailAccount(vault, previous, oldToken ?? "");
      else await removeMailAccount(vault, id);
    }
    throw err;
  }
  toast.success(i18n.t("mail.accountAdded", { defaultValue: "Postfach verbunden" }));
  notifyMailChanged();
}

/** Opens the Microsoft consent page for a mailbox (Mail.ReadWrite + Mail.Send). */
export async function connectMicrosoftMail(clientId?: string): Promise<void> {
  const context = await connectionContextFor("mail") ?? (vaultId ? { vaultId } : undefined);
  if (!context) throw new Error("no vault open");
  await beginPimOAuth("microsoft", {
    clientId: clientId ?? "",
    label: "Microsoft",
    purpose: "mail",
    scope: GRAPH_MAIL_SCOPES,
    serviceContext: context,
  });
}
