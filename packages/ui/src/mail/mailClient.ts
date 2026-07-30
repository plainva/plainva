import type { MailAccountConfig } from "./mailAccounts";
import { getMailPassword, mailAccountKind } from "./mailAccounts";
import { mailTransport } from "./transport";
import type { ImapCreds } from "./transport";
import type {
  MailboxInfo,
  MailEnvelope,
  MailEnvelopePage,
  MailMessage,
  RawImapEnvelope,
} from "./types";
import { threadFields } from "./threading";
import {
  graphListFolders,
  graphListEnvelopes,
  graphFetchMessage,
  graphFetchAttachment,
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
 *   - IMAP: reached through the injected MailTransport (desktop: the Rust
 *     commands, mobile: the native plugin). EXAMINE + BODY.PEEK for
 *     non-mutating reads, explicit STORE/COPY/EXPUNGE for user-requested
 *     changes. Numeric IMAP UIDs.
 *   - Microsoft Graph (graphMail.ts): direct-login OAuth, opaque string ids.
 * The public message identifier is therefore a STRING; for IMAP it is the
 * stringified numeric UID (mapped at this boundary), for Graph the opaque id.
 */

export type {
  MailFolderRole,
  MailboxInfo,
  MailEnvelope,
  MailEnvelopePage,
  MailAttachmentInfo,
  MailMessage,
} from "./types";

async function creds(vaultPath: string, account: MailAccountConfig): Promise<ImapCreds> {
  const pass = await getMailPassword(vaultPath, account.id);
  if (!pass) throw new Error("missing mail credentials");
  return { host: account.host, port: account.port, user: account.user, pass };
}

export async function checkMailLogin(account: Omit<MailAccountConfig, "id" | "label">, pass: string): Promise<MailboxInfo[]> {
  return mailTransport().checkLogin({ host: account.host, port: account.port, user: account.user, pass });
}

/** Mailbox list of a STORED account (folder rail + the draft dialog's picker). */
export async function listMailboxesFor(vaultPath: string, account: MailAccountConfig): Promise<MailboxInfo[]> {
  if (mailAccountKind(account) === "microsoft") return graphListFolders(vaultPath, account);
  return mailTransport().checkLogin(await creds(vaultPath, account));
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
  const page = await mailTransport().listEnvelopes(await creds(vaultPath, account), {
    mailbox,
    offset,
    limit,
    beforeUid: beforeId ? Number(beforeId) : undefined,
  });
  return { total: page.total, unseen: page.unseen, messages: page.messages.map(toEnvelope) };
}

/**
 * Wire shape -> envelope: the uid becomes the string id, and the raw thread
 * headers go through the ONE shared normaliser (P9.1). Both transports forward
 * header text in whichever form their parser left it, so the normalising has to
 * happen here rather than twice below.
 */
function toEnvelope(m: RawImapEnvelope): MailEnvelope {
  const { messageId, inReplyTo, references, ...rest } = m;
  return { ...rest, id: String(m.uid), ...threadFields({ messageId, inReplyTo, references }) };
}

export async function fetchMessage(vaultPath: string, account: MailAccountConfig, mailbox: string, id: string): Promise<MailMessage> {
  if (mailAccountKind(account) === "microsoft") return graphFetchMessage(vaultPath, account, mailbox, id);
  const m = await mailTransport().fetchMessage(await creds(vaultPath, account), { mailbox, uid: Number(id) });
  return { ...m, id: String(m.uid) };
}

/** Raw RFC822 bytes, base64 (the ".eml beilegen" capture). */
export async function fetchRawMessage(vaultPath: string, account: MailAccountConfig, mailbox: string, id: string): Promise<string> {
  if (mailAccountKind(account) === "microsoft") return graphFetchRaw(vaultPath, account, mailbox, id);
  return mailTransport().fetchRaw(await creds(vaultPath, account), { mailbox, uid: Number(id) });
}

/** One attachment's bytes, base64 (mail feinplan G3 — the first caller of the
 *  transport operation that has existed unused since the desktop client). */
export async function fetchAttachment(
  vaultPath: string,
  account: MailAccountConfig,
  mailbox: string,
  id: string,
  index: number
): Promise<string> {
  if (mailAccountKind(account) === "microsoft") return graphFetchAttachment(vaultPath, account, mailbox, id, index);
  return mailTransport().fetchAttachment(await creds(vaultPath, account), { mailbox, uid: Number(id), index });
}

// ---- Mailbox actions (mail-client E4) -------------------------------------

/** Marks a message read/unread. */
export async function setMessageSeen(vaultPath: string, account: MailAccountConfig, mailbox: string, id: string, seen: boolean): Promise<void> {
  if (mailAccountKind(account) === "microsoft") return graphSetSeen(vaultPath, account, mailbox, id, seen);
  await mailTransport().setSeen(await creds(vaultPath, account), { mailbox, uid: Number(id), seen });
}

/** Sets or clears the message's flagged/starred marker. */
export async function setMessageFlagged(vaultPath: string, account: MailAccountConfig, mailbox: string, id: string, flagged: boolean): Promise<void> {
  if (mailAccountKind(account) === "microsoft") return graphSetFlagged(vaultPath, account, mailbox, id, flagged);
  await mailTransport().setFlagged(await creds(vaultPath, account), { mailbox, uid: Number(id), flagged });
}

/** Irreversible delete, exposed by the UI only while the Trash folder is open. */
export async function deleteMessagePermanently(vaultPath: string, account: MailAccountConfig, mailbox: string, id: string): Promise<void> {
  if (mailAccountKind(account) === "microsoft") return graphDeleteMessage(vaultPath, account, mailbox, id);
  await mailTransport().deleteMessage(await creds(vaultPath, account), { mailbox, uid: Number(id) });
}

/** Server-side flagged filter (not limited to the currently loaded page). */
export async function listFlaggedEnvelopes(vaultPath: string, account: MailAccountConfig, mailbox: string): Promise<MailEnvelope[]> {
  if (mailAccountKind(account) === "microsoft") return graphListFlaggedEnvelopes(vaultPath, account, mailbox);
  const page = await mailTransport().listFlaggedEnvelopes(await creds(vaultPath, account), { mailbox, limit: 200 });
  return page.map(toEnvelope);
}

/** Moves a message to another mailbox (move, or delete = move to Trash). */
export async function moveMessage(vaultPath: string, account: MailAccountConfig, mailbox: string, id: string, target: string): Promise<void> {
  if (mailAccountKind(account) === "microsoft") return graphMove(vaultPath, account, mailbox, id, target);
  await mailTransport().moveMessage(await creds(vaultPath, account), { mailbox, uid: Number(id), target });
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
  const page = await mailTransport().searchEnvelopes(await creds(vaultPath, account), { mailbox, query, limit: 200 });
  return page.map(toEnvelope);
}
