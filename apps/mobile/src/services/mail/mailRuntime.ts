import { toast } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import {
  forgetGraphMailRuntime,
  graphMailAddress,
  GRAPH_MAIL_SCOPES,
  listMailAccounts,
  removeMailAccount,
  saveMicrosoftMailAccount,
} from "@plainva/ui/mail";
import type { MailAccountConfig } from "@plainva/ui/mail";
import type { MobileVault } from "../vaultService";
import { beginPimOAuth, setOAuthPurposeHandler } from "../pim/pimOAuth";

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
  forgetGraphMailRuntime(accountId);
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
  setOAuthPurposeHandler("mail", async ({ provider, clientId, refreshToken }) => {
    if (provider !== "microsoft") throw new Error("only Microsoft mail is available on mobile");
    const boundVault = vaultId;
    if (!boundVault) throw new Error("no vault open");
    await bindMicrosoftMailAccount(boundVault, clientId, refreshToken);
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
async function bindMicrosoftMailAccount(vault: string, clientId: string, refreshToken: string): Promise<void> {
  const id = crypto.randomUUID();
  const account: MailAccountConfig = { id, label: "Microsoft", host: "", port: 0, user: "", kind: "microsoft", clientId };
  await saveMicrosoftMailAccount(vault, account, refreshToken);
  try {
    const address = await graphMailAddress(vault, account);
    await saveMicrosoftMailAccount(vault, { ...account, label: address, user: address }, refreshToken);
  } catch (err) {
    forgetGraphMailRuntime(id);
    await removeMailAccount(vault, id).catch(() => undefined);
    throw err;
  }
  toast.success(i18n.t("mail.accountAdded", { defaultValue: "Postfach verbunden" }));
  notifyMailChanged();
}

/** Opens the Microsoft consent page for a mailbox (Mail.ReadWrite + Mail.Send). */
export async function connectMicrosoftMail(clientId?: string): Promise<void> {
  await beginPimOAuth("microsoft", {
    clientId: clientId ?? "",
    label: "Microsoft",
    purpose: "mail",
    scope: GRAPH_MAIL_SCOPES,
  });
}
