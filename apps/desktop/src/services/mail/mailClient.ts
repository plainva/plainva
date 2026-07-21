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
  graphSearchEnvelopes,
  graphSetFlagged,
  graphDeleteMessage,
  graphListFlaggedEnvelopes,
} from "./graphMail";

/**
 * Backend-agnostic mail client. Two backends share one surface:
 *   - IMAP: Rust commands use EXAMINE + BODY.PEEK for non-mutating reads and
 *     explicit STORE/COPY/EXPUNGE operations for user-requested changes.
 *     Numeric IMAP UIDs.
 *   - Microsoft Graph (graphMail.ts): direct-login OAuth, opaque string ids.
 * The public message identifier is therefore a STRING; for IMAP it is the
 * stringified numeric UID (mapped at this boundary), for Graph the opaque id.
 */

/** Special-use role of a mailbox, where the backend states it authoritatively
 * (Graph well-known folders). IMAP leaves it unset — there the role is guessed
 * from the name, which only works for English/known conventions. */
export type MailFolderRole = "inbox" | "drafts" | "sent" | "trash" | "junk" | "archive";

export interface MailboxInfo {
  name: string;
  role?: MailFolderRole;
  /** Server-stated IMAP hierarchy delimiter (Graph folders use "/"). Lets the
   * UI split nested names at the real separator instead of guessing. */
  delimiter?: string;
}

export interface MailEnvelope {
  id: string;
  subject: string;
  from: string;
  dateTs: number;
  seen: boolean;
  flagged: boolean;
}

export interface MailEnvelopePage {
  total: number;
  /** Unread (\Unseen) count for the mailbox — the folder badge/status use this. */
  unseen: number;
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
  /** IMAP mailbox epoch; paired with UID for a safe fallback identity. */
  uidValidity?: number;
  /** RFC Message-ID for cross-folder identity (notably Gmail All Mail). */
  providerMessageId?: string;
}

// ---- IMAP wire shapes (numeric uid) mapped to the string-id surface -------

interface RawImapEnvelope {
  uid: number;
  subject: string;
  from: string;
  dateTs: number;
  seen: boolean;
  flagged: boolean;
}
interface RawImapEnvelopePage {
  total: number;
  unseen: number;
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
  uidValidity?: number;
  providerMessageId?: string;
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
  limit: number,
  beforeId?: string
): Promise<MailEnvelopePage> {
  if (mailAccountKind(account) === "microsoft") return graphListEnvelopes(vaultPath, account, mailbox, offset, limit);
  const page = await invoke<RawImapEnvelopePage>("mail_list_envelopes", {
    ...(await creds(vaultPath, account)),
    mailbox,
    offset,
    limit,
    beforeUid: beforeId ? Number(beforeId) : undefined,
  });
  return { total: page.total, unseen: page.unseen, messages: page.messages.map((m) => ({ ...m, id: String(m.uid) })) };
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

/** Sets or clears the message's flagged/starred marker. */
export async function setMessageFlagged(vaultPath: string, account: MailAccountConfig, mailbox: string, id: string, flagged: boolean): Promise<void> {
  if (mailAccountKind(account) === "microsoft") return graphSetFlagged(vaultPath, account, mailbox, id, flagged);
  await invoke("mail_set_flagged", { ...(await creds(vaultPath, account)), mailbox, uid: Number(id), flagged });
}

/** Irreversible delete, exposed by the UI only while the Trash folder is open. */
export async function deleteMessagePermanently(vaultPath: string, account: MailAccountConfig, mailbox: string, id: string): Promise<void> {
  if (mailAccountKind(account) === "microsoft") return graphDeleteMessage(vaultPath, account, mailbox, id);
  await invoke("mail_delete_message", { ...(await creds(vaultPath, account)), mailbox, uid: Number(id) });
}

/** Server-side flagged filter (not limited to the currently loaded page). */
export async function listFlaggedEnvelopes(vaultPath: string, account: MailAccountConfig, mailbox: string): Promise<MailEnvelope[]> {
  if (mailAccountKind(account) === "microsoft") return graphListFlaggedEnvelopes(vaultPath, account, mailbox);
  const page = await invoke<RawImapEnvelope[]>("mail_list_flagged_envelopes", {
    ...(await creds(vaultPath, account)),
    mailbox,
    limit: 200,
  });
  return page.map((m) => ({ ...m, id: String(m.uid) }));
}

/** Moves a message to another mailbox (move, or delete = move to Trash). */
export async function moveMessage(vaultPath: string, account: MailAccountConfig, mailbox: string, id: string, target: string): Promise<void> {
  if (mailAccountKind(account) === "microsoft") return graphMove(vaultPath, account, mailbox, id, target);
  await invoke("mail_move_message", { ...(await creds(vaultPath, account)), mailbox, uid: Number(id), target });
}

/** Full-text search in a mailbox; returns matching ENVELOPES, newest first —
 * server hits, not a filter over the loaded page. */
export async function searchEnvelopes(
  vaultPath: string,
  account: MailAccountConfig,
  mailbox: string,
  query: string
): Promise<MailEnvelope[]> {
  if (mailAccountKind(account) === "microsoft") return graphSearchEnvelopes(vaultPath, account, mailbox, query);
  const page = await invoke<RawImapEnvelope[]>("mail_search_envelopes", {
    ...(await creds(vaultPath, account)),
    mailbox,
    query,
    limit: 200,
  });
  return page.map((m) => ({ ...m, id: String(m.uid) }));
}
