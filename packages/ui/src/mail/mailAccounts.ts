import { getPlatformServices } from "../platform/services";

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
  /**
   * Signature in Markdown, appended below what you write (issue #34 round 1).
   * Markdown like the rest of composing, so it renders in the HTML part and
   * still reads correctly in the plain-text part.
   */
  signature?: string;
  /**
   * Additional sender addresses (aliases) offered in the From picker, e.g.
   * "Name <alias@example.org>". The account's own `user` is always the first
   * choice and never has to be listed here. Whether an alias is ACCEPTED is the
   * provider's call — a server that refuses to relay it says so, and Plainva
   * surfaces that error rather than silently sending as someone else.
   */
  senders?: string[];
}

/** Every address this account may send from: its own first, then the configured
 * aliases, trimmed and de-duplicated (case-insensitively on the address). Pure. */
export function senderOptions(account: MailAccountConfig): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [account.user, ...(account.senders ?? [])]) {
    const value = (raw ?? "").trim();
    if (!value) continue;
    const key = (value.match(/<([^>]+)>/)?.[1] ?? value).trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/**
 * Key of one entry in the From picker. Both shells offer ADDRESSES rather than
 * accounts (an account contributes its own address plus its aliases), so the
 * selected value has to carry both parts. "|" separates them: it cannot occur
 * in a uuid and is not valid in an address.
 */
export function senderKey(accountId: string, address: string): string {
  return `${accountId}|${address}`;
}

/** Splits a `senderKey`; an address may itself contain "|" only in a display
 * name, so everything after the FIRST separator is the address. */
export function splitSenderKey(key: string): { accountId: string; address: string } {
  const at = key.indexOf("|");
  return at < 0 ? { accountId: key, address: "" } : { accountId: key.slice(0, at), address: key.slice(at + 1) };
}

/** The signature block as it appears in a body: the conventional "-- " marker
 * (which mail clients recognise and can fold) plus the text. */
function signatureBlock(account: MailAccountConfig | null | undefined): string {
  const signature = (account?.signature ?? "").trim();
  return signature ? `-- \n${signature}` : "";
}

/** Appends the account's signature to a draft body, never twice. Pure. */
export function withSignature(markdown: string, account: MailAccountConfig | null | undefined): string {
  const block = signatureBlock(account);
  if (!block || markdown.includes(block)) return markdown;
  // The signature goes below what you write but ABOVE a quoted original, which
  // is where every mail client puts it and where a reader expects it.
  const quoteAt = markdown.search(/^>/m);
  if (quoteAt < 0) return `${markdown.replace(/\s*$/, "")}\n\n${block}\n`;
  const head = markdown.slice(0, quoteAt).replace(/\s*$/, "");
  return `${head}\n\n${block}\n\n${markdown.slice(quoteAt)}`;
}

/** Removes an account's signature block from a body (used when the sender
 * changes, so two signatures never stack up). Only removes an EXACT block, so
 * text the user typed themselves is never touched. Pure. */
export function withoutSignature(markdown: string, account: MailAccountConfig | null | undefined): string {
  const block = signatureBlock(account);
  if (!block || !markdown.includes(block)) return markdown;
  return markdown.replace(new RegExp(`\\n*${escapeRegExp(block)}\\n*`), "\n\n").replace(/\s*$/, "\n");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Backend selector: stored accounts without a kind are IMAP. */
export function mailAccountKind(account: MailAccountConfig): "imap" | "microsoft" {
  return account.kind ?? "imap";
}

export const mailAccountsKey = (vaultPath: string) => `mailAccounts_${btoa(unescape(encodeURIComponent(vaultPath)))}`;
export const mailSecretKey = (vaultPath: string, accountId: string) =>
  `mail_${accountId}_${btoa(unescape(encodeURIComponent(vaultPath)))}`;

export async function listMailAccounts(vaultPath: string): Promise<MailAccountConfig[]> {
  const store = await getPlatformServices().loadSettings();
  const raw = await store.get<MailAccountConfig[]>(mailAccountsKey(vaultPath));
  return Array.isArray(raw) ? raw.filter((a) => a && typeof a.id === "string") : [];
}

/** Replaces non-secret account metadata during settings-profile import. No
 * credential slot is touched; imported accounts therefore correctly show as
 * needing sign-in until an allowed secret is imported or OAuth is completed. */
export async function replaceMailAccounts(vaultPath: string, accounts: MailAccountConfig[]): Promise<void> {
  const store = await getPlatformServices().loadSettings();
  await store.set(mailAccountsKey(vaultPath), accounts);
  await store.save();
}

export async function saveMailAccount(vaultPath: string, account: MailAccountConfig, password: string): Promise<void> {
  const store = await getPlatformServices().loadSettings();
  const list = await listMailAccounts(vaultPath);
  const next = [...list.filter((a) => a.id !== account.id), account];
  await store.set(mailAccountsKey(vaultPath), next);
  await store.save();
  await getPlatformServices().credentials.writeSecret(mailSecretKey(vaultPath, account.id), { pass: password });
}

/**
 * Patches the non-secret fields of one account (signature, sender addresses,
 * label). Deliberately separate from `saveMailAccount`, which writes the
 * credential slot too — editing a signature must never touch the stored
 * password, and there is no password to re-supply on that surface.
 */
export async function updateMailAccount(
  vaultPath: string,
  accountId: string,
  patch: Partial<Omit<MailAccountConfig, "id">>
): Promise<void> {
  const store = await getPlatformServices().loadSettings();
  const list = await listMailAccounts(vaultPath);
  const next = list.map((a) => (a.id === accountId ? { ...a, ...patch } : a));
  await store.set(mailAccountsKey(vaultPath), next);
  await store.save();
}

export async function removeMailAccount(vaultPath: string, accountId: string): Promise<void> {
  const store = await getPlatformServices().loadSettings();
  const list = await listMailAccounts(vaultPath);
  await store.set(mailAccountsKey(vaultPath), list.filter((a) => a.id !== accountId));
  await store.save();
  await getPlatformServices().credentials.removeSecret(mailSecretKey(vaultPath, accountId)).catch(() => undefined);
}

export async function getMailPassword(vaultPath: string, accountId: string): Promise<string | null> {
  const secret = await getPlatformServices().credentials.readSecret<{ pass: string }>(mailSecretKey(vaultPath, accountId));
  return secret?.pass ?? null;
}

/** Persists a Microsoft (Graph) mail account + its OAuth refresh token. */
export async function saveMicrosoftMailAccount(vaultPath: string, account: MailAccountConfig, refreshToken: string): Promise<void> {
  const store = await getPlatformServices().loadSettings();
  const list = await listMailAccounts(vaultPath);
  const next = [...list.filter((a) => a.id !== account.id), account];
  await store.set(mailAccountsKey(vaultPath), next);
  await store.save();
  await getPlatformServices().credentials.writeSecret(mailSecretKey(vaultPath, account.id), { refreshToken });
}

export async function getMailRefreshToken(vaultPath: string, accountId: string): Promise<string | null> {
  const secret = await getPlatformServices().credentials.readSecret<{ refreshToken: string }>(mailSecretKey(vaultPath, accountId));
  return secret?.refreshToken ?? null;
}

/** Persists a rotated refresh token (Microsoft rotates on every refresh — a
 * dropped rotation kills the account; see the sync flow's hard-won lesson). */
export async function saveMailRefreshToken(vaultPath: string, accountId: string, refreshToken: string): Promise<void> {
  await getPlatformServices().credentials.writeSecret(mailSecretKey(vaultPath, accountId), { refreshToken });
}
