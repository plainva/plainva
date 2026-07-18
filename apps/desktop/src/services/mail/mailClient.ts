import { invoke } from "@tauri-apps/api/core";
import type { MailAccountConfig } from "./mailAccounts";
import { getMailPassword, mailAccountKind } from "./mailAccounts";
import {
  graphListFolders,
  graphListEnvelopes,
  graphFetchMessage,
  graphFetchRaw,
  graphSetSeen,
  graphMove,
  graphSearch,
} from "./graphMail";

/**
 * Backend-agnostic mail client. Two backends share one surface:
 *   - IMAP: the read-only Rust commands (EXAMINE + BODY.PEEK, the mailbox is
 *     never mutated — not even \Seen). Numeric IMAP UIDs.
 *   - Microsoft Graph (graphMail.ts): direct-login OAuth, opaque string ids.
 * The public message identifier is therefore a STRING; for IMAP it is the
 * stringified numeric UID (mapped at this boundary), for Graph the opaque id.
 */

export interface MailboxInfo {
  name: string;
}

export interface MailEnvelope {
  id: string;
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
  id: string;
  subject: string;
  from: string;
  to: string;
  dateTs: number;
  text: string | null;
  html: string | null;
  attachments: MailAttachmentInfo[];
}

// ---- IMAP wire shapes (numeric uid) mapped to the string-id surface -------

interface RawImapEnvelope {
  uid: number;
  subject: string;
  from: string;
  dateTs: number;
  seen: boolean;
}
interface RawImapEnvelopePage {
  total: number;
  messages: RawImapEnvelope[];
}
interface RawImapMessage {
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

/** Mailbox list of a STORED account (folder rail + the draft dialog's picker). */
export async function listMailboxesFor(vaultPath: string, account: MailAccountConfig): Promise<MailboxInfo[]> {
  if (mailAccountKind(account) === "microsoft") return graphListFolders(vaultPath, account);
  return invoke<MailboxInfo[]>("mail_check_login", await creds(vaultPath, account));
}

export async function listEnvelopes(
  vaultPath: string,
  account: MailAccountConfig,
  mailbox: string,
  offset: number,
  limit: number
): Promise<MailEnvelopePage> {
  if (mailAccountKind(account) === "microsoft") return graphListEnvelopes(vaultPath, account, mailbox, offset, limit);
  const page = await invoke<RawImapEnvelopePage>("mail_list_envelopes", { ...(await creds(vaultPath, account)), mailbox, offset, limit });
  return { total: page.total, messages: page.messages.map((m) => ({ ...m, id: String(m.uid) })) };
}

export async function fetchMessage(vaultPath: string, account: MailAccountConfig, mailbox: string, id: string): Promise<MailMessage> {
  if (mailAccountKind(account) === "microsoft") return graphFetchMessage(vaultPath, account, mailbox, id);
  const m = await invoke<RawImapMessage>("mail_fetch_message", { ...(await creds(vaultPath, account)), mailbox, uid: Number(id) });
  return { ...m, id: String(m.uid) };
}

/** Raw RFC822 bytes, base64 (the ".eml beilegen" capture). */
export async function fetchRawMessage(vaultPath: string, account: MailAccountConfig, mailbox: string, id: string): Promise<string> {
  if (mailAccountKind(account) === "microsoft") return graphFetchRaw(vaultPath, account, mailbox, id);
  return invoke<string>("mail_fetch_raw", { ...(await creds(vaultPath, account)), mailbox, uid: Number(id) });
}

// ---- Mailbox actions (mail-client E4) -------------------------------------

/** Marks a message read/unread. */
export async function setMessageSeen(vaultPath: string, account: MailAccountConfig, mailbox: string, id: string, seen: boolean): Promise<void> {
  if (mailAccountKind(account) === "microsoft") return graphSetSeen(vaultPath, account, mailbox, id, seen);
  await invoke("mail_set_seen", { ...(await creds(vaultPath, account)), mailbox, uid: Number(id), seen });
}

/** Moves a message to another mailbox (move, or delete = move to Trash). */
export async function moveMessage(vaultPath: string, account: MailAccountConfig, mailbox: string, id: string, target: string): Promise<void> {
  if (mailAccountKind(account) === "microsoft") return graphMove(vaultPath, account, mailbox, id, target);
  await invoke("mail_move_message", { ...(await creds(vaultPath, account)), mailbox, uid: Number(id), target });
}

/** Full-text search in a mailbox; returns matching ids, newest first. */
export async function searchMessages(vaultPath: string, account: MailAccountConfig, mailbox: string, query: string): Promise<string[]> {
  if (mailAccountKind(account) === "microsoft") return graphSearch(vaultPath, account, mailbox, query);
  const uids = await invoke<number[]>("mail_search", { ...(await creds(vaultPath, account)), mailbox, query });
  return uids.map((u) => String(u));
}
