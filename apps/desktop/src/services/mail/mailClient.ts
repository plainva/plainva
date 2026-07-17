import { invoke } from "@tauri-apps/api/core";
import type { MailAccountConfig } from "./mailAccounts";
import { getMailPassword } from "./mailAccounts";

/**
 * Typed wrappers around the read-only Rust IMAP commands (stage 5). Every
 * call carries the credentials explicitly — the Rust side keeps no state and
 * opens a fresh connection (EXAMINE + BODY.PEEK => the mailbox is never
 * mutated, not even \Seen flags).
 */

export interface MailboxInfo {
  name: string;
}

export interface MailEnvelope {
  uid: number;
  subject: string;
  from: string;
  dateTs: number;
  seen: boolean;
}

export interface MailEnvelopePage {
  total: number;
  messages: MailEnvelope[];
}

export interface MailAttachmentInfo {
  index: number;
  name: string;
  mime: string;
  size: number;
}

export interface MailMessage {
  uid: number;
  subject: string;
  from: string;
  to: string;
  dateTs: number;
  text: string | null;
  html: string | null;
  attachments: MailAttachmentInfo[];
}

async function creds(vaultPath: string, account: MailAccountConfig) {
  const pass = await getMailPassword(vaultPath, account.id);
  if (!pass) throw new Error("missing mail credentials");
  return { host: account.host, port: account.port, user: account.user, pass };
}

export async function checkMailLogin(account: Omit<MailAccountConfig, "id" | "label">, pass: string): Promise<MailboxInfo[]> {
  return invoke<MailboxInfo[]>("mail_check_login", {
    host: account.host,
    port: account.port,
    user: account.user,
    pass,
  });
}

export async function listEnvelopes(
  vaultPath: string,
  account: MailAccountConfig,
  mailbox: string,
  offset: number,
  limit: number
): Promise<MailEnvelopePage> {
  return invoke<MailEnvelopePage>("mail_list_envelopes", { ...(await creds(vaultPath, account)), mailbox, offset, limit });
}

export async function fetchMessage(vaultPath: string, account: MailAccountConfig, mailbox: string, uid: number): Promise<MailMessage> {
  return invoke<MailMessage>("mail_fetch_message", { ...(await creds(vaultPath, account)), mailbox, uid });
}

/** Raw RFC822 bytes, base64 (the ".eml beilegen" capture). */
export async function fetchRawMessage(vaultPath: string, account: MailAccountConfig, mailbox: string, uid: number): Promise<string> {
  return invoke<string>("mail_fetch_raw", { ...(await creds(vaultPath, account)), mailbox, uid });
}
