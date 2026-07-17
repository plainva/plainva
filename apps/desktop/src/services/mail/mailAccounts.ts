import { getSettingsStore } from "../settingsStore";
import { credentialManager } from "../CredentialManager";

/**
 * IMAP mail accounts (PIM stage 5): the non-secret account list lives in the
 * settings store per vault, the app password in the OS keychain (ADR 0005).
 * Deliberately NOT in the pim_accounts cache table — mail is read-only
 * capture with no reconcile state, and the credential shape (host/port/user)
 * is its own thing.
 */

export interface MailAccountConfig {
  id: string;
  label: string;
  host: string;
  port: number;
  user: string;
}

const accountsKey = (vaultPath: string) => `mailAccounts_${btoa(unescape(encodeURIComponent(vaultPath)))}`;
const secretKey = (vaultPath: string, accountId: string) =>
  `mail_${accountId}_${btoa(unescape(encodeURIComponent(vaultPath)))}`;

export async function listMailAccounts(vaultPath: string): Promise<MailAccountConfig[]> {
  const store = await getSettingsStore();
  const raw = await store.get<MailAccountConfig[]>(accountsKey(vaultPath));
  return Array.isArray(raw) ? raw.filter((a) => a && typeof a.id === "string") : [];
}

export async function saveMailAccount(vaultPath: string, account: MailAccountConfig, password: string): Promise<void> {
  const store = await getSettingsStore();
  const list = await listMailAccounts(vaultPath);
  const next = [...list.filter((a) => a.id !== account.id), account];
  await store.set(accountsKey(vaultPath), next);
  await store.save();
  await credentialManager.writeSecret(secretKey(vaultPath, account.id), { pass: password });
}

export async function removeMailAccount(vaultPath: string, accountId: string): Promise<void> {
  const store = await getSettingsStore();
  const list = await listMailAccounts(vaultPath);
  await store.set(accountsKey(vaultPath), list.filter((a) => a.id !== accountId));
  await store.save();
  await credentialManager.removeSecret(secretKey(vaultPath, accountId)).catch(() => undefined);
}

export async function getMailPassword(vaultPath: string, accountId: string): Promise<string | null> {
  const secret = await credentialManager.readSecret<{ pass: string }>(secretKey(vaultPath, accountId));
  return secret?.pass ?? null;
}
