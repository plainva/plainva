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

/** Mailbox list of a STORED account (the draft dialog's folder picker). */
export async function listMailboxesFor(vaultPath: string, account: MailAccountConfig): Promise<MailboxInfo[]> {
  return invoke<MailboxInfo[]>("mail_check_login", await creds(vaultPath, account));
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

// ---- Mailbox actions (mail-client E4) -------------------------------------

/** Marks a message read/unread (\Seen flag). */
export async function setMessageSeen(vaultPath: string, account: MailAccountConfig, mailbox: string, uid: number, seen: boolean): Promise<void> {
  await invoke("mail_set_seen", { ...(await creds(vaultPath, account)), mailbox, uid, seen });
}

/** Moves a message to another mailbox (move, or delete = move to Trash). */
export async function moveMessage(vaultPath: string, account: MailAccountConfig, mailbox: string, uid: number, target: string): Promise<void> {
  await invoke("mail_move_message", { ...(await creds(vaultPath, account)), mailbox, uid, target });
}

/** Full-text search in a mailbox; returns matching UIDs, newest first. */
export async function searchMessages(vaultPath: string, account: MailAccountConfig, mailbox: string, query: string): Promise<number[]> {
  return invoke<number[]>("mail_search", { ...(await creds(vaultPath, account)), mailbox, query });
}
