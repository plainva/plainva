import { getSettingsStore } from "../settingsStore";
import { credentialManager } from "../CredentialManager";

/**
 * Mail accounts (PIM stage 5+): the non-secret account list lives in the
 * settings store per vault, the secret in the OS keychain (ADR 0005).
 * Deliberately NOT in the pim_accounts cache table — mail has no reconcile
 * state, and the credential shape is its own thing.
 *
 * Two kinds share one shape:
 *   - "imap" (default): host/port/user + app password, read via Rust IMAP.
 *   - "microsoft": Graph OAuth (direct login, no app password) — host/user
 *     hold the address for display, the secret is the OAuth refresh token,
 *     and all mailbox operations go over Microsoft Graph (graphMail.ts).
 */

export interface MailAccountConfig {
  id: string;
  label: string;
  host: string;
  port: number;
  user: string;
  /** SMTP submission host (mail-client E3 sending); absent = send disabled. */
  smtpHost?: string;
  /** SMTP submission port (587 STARTTLS by default, 465 implicit TLS). */
  smtpPort?: number;
  /** Backend. Absent = "imap" (backward-compatible with stored accounts). */
  kind?: "imap" | "microsoft";
  /** OAuth client id used for the Microsoft (Graph) login. */
  clientId?: string;
}

/** Backend selector: stored accounts without a kind are IMAP. */
export function mailAccountKind(account: MailAccountConfig): "imap" | "microsoft" {
  return account.kind ?? "imap";
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

/** Persists a Microsoft (Graph) mail account + its OAuth refresh token. */
export async function saveMicrosoftMailAccount(vaultPath: string, account: MailAccountConfig, refreshToken: string): Promise<void> {
  const store = await getSettingsStore();
  const list = await listMailAccounts(vaultPath);
  const next = [...list.filter((a) => a.id !== account.id), account];
  await store.set(accountsKey(vaultPath), next);
  await store.save();
  await credentialManager.writeSecret(secretKey(vaultPath, account.id), { refreshToken });
}

export async function getMailRefreshToken(vaultPath: string, accountId: string): Promise<string | null> {
  const secret = await credentialManager.readSecret<{ refreshToken: string }>(secretKey(vaultPath, accountId));
  return secret?.refreshToken ?? null;
}

/** Persists a rotated refresh token (Microsoft rotates on every refresh — a
 * dropped rotation kills the account; see the sync flow's hard-won lesson). */
export async function saveMailRefreshToken(vaultPath: string, accountId: string, refreshToken: string): Promise<void> {
  await credentialManager.writeSecret(secretKey(vaultPath, accountId), { refreshToken });
}
