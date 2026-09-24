import type { MailAccountConfig } from "./mailAccounts";
import { mailAccountKind, markMailAccountFetched } from "./mailAccounts";
import { mailTransport } from "./transport";
import { mailCredentials as creds, withMailCredentials } from "./mailCredentials";
import type {
  MailboxInfo,
  MailEnvelope,
  MailEnvelopePage,
  MailMessage,
  RawImapEnvelope,
} from "./types";
import { threadFields } from "./threading";
import { MAIL_BULK_LIMIT, type MailBulkAction, type MailBulkResult } from "./bulkActions";
import { readVacation, vacationSupport, writeVacation, type VacationState } from "./vacation";
import type { VacationSettings } from "./sieveScript";
import { writeSieveRules, type SieveWriteResult } from "./sieveSync";
import type { RuleMailboxes } from "./sieveRules";
import type { MailRule } from "./rules";
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
  graphSetRules,
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

export async function checkMailLogin(account: Omit<MailAccountConfig, "id" | "label">, pass: string): Promise<MailboxInfo[]> {
  return mailTransport().checkLogin({ host: account.host, port: account.port, user: account.user, pass });
}

/** Mailbox list of a STORED account (folder rail + the draft dialog's picker). */
export async function listMailboxesFor(vaultPath: string, account: MailAccountConfig): Promise<MailboxInfo[]> {
  if (mailAccountKind(account) === "microsoft") return graphListFolders(vaultPath, account);
  return withMailCredentials(vaultPath, account, credential => mailTransport().checkLogin(credential));
}

export async function listEnvelopes(
  vaultPath: string,
  account: MailAccountConfig,
  mailbox: string,
  offset: number,
  limit: number,
  beforeId?: string
): Promise<MailEnvelopePage> {
  const page: MailEnvelopePage = mailAccountKind(account) === "microsoft"
    ? await graphListEnvelopes(vaultPath, account, mailbox, offset, limit)
    : await withMailCredentials(vaultPath, account, credential => mailTransport().listEnvelopes(credential, {
      mailbox,
      offset,
      limit,
      beforeUid: beforeId ? Number(beforeId) : undefined,
    })).then(raw => ({ total: raw.total, unseen: raw.unseen, messages: raw.messages.map(toEnvelope) }));
  // The mailbox answered: from now on it is a working account on every device,
  // never an entry a failed setup left behind (finding 2026-09-24).
  void markMailAccountFetched(vaultPath, account);
  return page;
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
  const m = await withMailCredentials(vaultPath, account, credential => mailTransport().fetchMessage(credential, { mailbox, uid: Number(id) }));
  return { ...m, id: String(m.uid) };
}

/** Raw RFC822 bytes, base64 (the ".eml beilegen" capture). */
export async function fetchRawMessage(vaultPath: string, account: MailAccountConfig, mailbox: string, id: string): Promise<string> {
  if (mailAccountKind(account) === "microsoft") return graphFetchRaw(vaultPath, account, mailbox, id);
  return withMailCredentials(vaultPath, account, credential => mailTransport().fetchRaw(credential, { mailbox, uid: Number(id) }));
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
  return withMailCredentials(vaultPath, account, credential => mailTransport().fetchAttachment(credential, { mailbox, uid: Number(id), index }));
}

// ---- Mailbox actions (mail-client E4) -------------------------------------

/** IMAP chunks preserve the displayed mailbox epoch. Graph remains sequential
 * to respect provider throttling. A cancelled/uncertain run is not replayed. */
export async function applyMailBulk(vaultPath: string, account: MailAccountConfig, mailbox: string, messages: readonly Pick<MailEnvelope, "id" | "uidValidity">[], action: MailBulkAction, signal?: AbortSignal): Promise<MailBulkResult[]> {
  const result: MailBulkResult[] = [];
  const graph = mailAccountKind(account) === "microsoft";
  const transport = mailTransport();
  let uncertain = false;
  for (let offset = 0; offset < messages.length;) {
    const next = messages[offset];
    if (signal?.aborted || uncertain) {
      result.push(...messages.slice(offset).map(m => ({ id: m.id, status: "skipped" as const, reason: signal?.aborted ? "cancelled" as const : "connection" as const }))); break;
    }
    if (!graph && (!Number.isInteger(next.uidValidity) || !next.uidValidity)) {
      result.push({ id: next.id, status: "failed", reason: "changed" }); offset++; continue;
    }
    const chunk: typeof next[] = [];
    const size = !graph && transport.bulkAction ? MAIL_BULK_LIMIT : 1;
    while (offset < messages.length && chunk.length < size && messages[offset].uidValidity === next.uidValidity) chunk.push(messages[offset++]);
    try {
      if (!graph && transport.bulkAction) {
        const done = await withMailCredentials(vaultPath, account, credential => transport.bulkAction!(credential, { mailbox, uids: chunk.map(m => Number(m.id)), uidValidity: next.uidValidity, action }));
        for (const m of chunk) {
          const found = done.find(r => r.uid === Number(m.id));
          result.push(found ? { id: m.id, status: found.status, reason: found.reason } : { id: m.id, status: "uncertain", reason: "connection" });
        }
      } else {
        if (action.kind === "seen") await setMessageSeen(vaultPath, account, mailbox, next.id, action.value);
        else if (action.kind === "flagged") await setMessageFlagged(vaultPath, account, mailbox, next.id, action.value);
        else if (action.kind === "move") await moveMessage(vaultPath, account, mailbox, next.id, action.target);
        else await deleteMessagePermanently(vaultPath, account, mailbox, next.id);
        result.push({ id: next.id, status: "done" });
      }
    } catch {
      // The write may have reached the provider even when its reply was lost.
      result.push(...chunk.map(m => ({ id: m.id, status: "uncertain" as const, reason: "connection" as const })));
    }
    uncertain = result.some(r => r.status === "uncertain");
  }
  return result;
}

/** Marks a message read/unread. */
export async function setMessageSeen(vaultPath: string, account: MailAccountConfig, mailbox: string, id: string, seen: boolean): Promise<void> {
  if (mailAccountKind(account) === "microsoft") return graphSetSeen(vaultPath, account, mailbox, id, seen);
  await withMailCredentials(vaultPath, account, credential => mailTransport().setSeen(credential, { mailbox, uid: Number(id), seen }));
}

/** Sets or clears the message's flagged/starred marker. */
export async function setMessageFlagged(vaultPath: string, account: MailAccountConfig, mailbox: string, id: string, flagged: boolean): Promise<void> {
  if (mailAccountKind(account) === "microsoft") return graphSetFlagged(vaultPath, account, mailbox, id, flagged);
  await withMailCredentials(vaultPath, account, credential => mailTransport().setFlagged(credential, { mailbox, uid: Number(id), flagged }));
}

/** Irreversible delete, exposed by the UI only while the Trash folder is open. */
export async function deleteMessagePermanently(vaultPath: string, account: MailAccountConfig, mailbox: string, id: string): Promise<void> {
  if (mailAccountKind(account) === "microsoft") return graphDeleteMessage(vaultPath, account, mailbox, id);
  await withMailCredentials(vaultPath, account, credential => mailTransport().deleteMessage(credential, { mailbox, uid: Number(id) }));
}

/**
 * Marks a message as junk (or not) with the `$Junk` keyword, where the server
 * takes it (S12). Throws when it does not — the caller reports "moved" instead
 * of "trained" rather than presenting a failure. Microsoft Graph has no such
 * keyword: there the move into the junk folder IS the signal.
 */
export async function setMessageJunk(vaultPath: string, account: MailAccountConfig, mailbox: string, id: string, junk: boolean): Promise<void> {
  if (mailAccountKind(account) === "microsoft") return;
  const transport = mailTransport();
  if (!transport.setJunk) return;
  await withMailCredentials(vaultPath, account, credential => transport.setJunk!(credential, { mailbox, uid: Number(id), junk }));
}

/** Creates a mailbox on the server — offered when an account has no junk
 * folder. Returns false when the backend cannot create folders at all. */
export async function createMailbox(vaultPath: string, account: MailAccountConfig, name: string): Promise<boolean> {
  const transport = mailTransport();
  if (mailAccountKind(account) === "microsoft" || !transport.createMailbox) return false;
  await withMailCredentials(vaultPath, account, credential => transport.createMailbox!(credential, { name }));
  return true;
}

/**
 * The out-of-office notice (S13). Builds the credentials the Sieve path needs
 * and hands the rest to the shared logic — a Microsoft account never touches
 * them, because Graph carries its own token.
 */
export async function getVacation(vaultPath: string, account: MailAccountConfig): Promise<VacationState> {
  const support = vacationSupport(account);
  const c = support.kind === "sieve" ? await creds(vaultPath, account) : { host: "", port: 0, user: "", pass: "" };
  return readVacation(vaultPath, account, c);
}

/** Returns false when the script must not be touched (a section Plainva did
 * not write and cannot parse) — the caller reports that instead of a success. */
export async function setVacation(vaultPath: string, account: MailAccountConfig, settings: VacationSettings): Promise<boolean> {
  const support = vacationSupport(account);
  const c = support.kind === "sieve" ? await creds(vaultPath, account) : { host: "", port: 0, user: "", pass: "" };
  return writeVacation(vaultPath, account, c, settings);
}

/**
 * Puts the rules on the server, where the account has a Sieve host (S15).
 *
 * Returns which rules stayed local and why — a rule the server cannot express
 * must not be uploaded, because a script with an unsupported `require` is
 * rejected in FULL, taking the out-of-office notice with it.
 */
export async function setMailRules(
  vaultPath: string,
  account: MailAccountConfig,
  rules: readonly MailRule[],
  mailboxes?: RuleMailboxes
): Promise<SieveWriteResult> {
  // Microsoft carries its own rule store; there is no script and nothing of
  // anyone else's to damage beyond the rules Plainva itself named.
  if (mailAccountKind(account) === "microsoft") return graphSetRules(vaultPath, account, rules, mailboxes);

  const support = vacationSupport(account);
  if (support.kind !== "sieve") return { ok: false, skipped: [] };
  return writeSieveRules(
    vaultPath,
    account.id,
    { host: support.host, port: support.port },
    await creds(vaultPath, account),
    rules,
    mailboxes
  );
}

/** Server-side flagged filter (not limited to the currently loaded page). */
export async function listFlaggedEnvelopes(vaultPath: string, account: MailAccountConfig, mailbox: string): Promise<MailEnvelope[]> {
  if (mailAccountKind(account) === "microsoft") return graphListFlaggedEnvelopes(vaultPath, account, mailbox);
  const page = await withMailCredentials(vaultPath, account, credential => mailTransport().listFlaggedEnvelopes(credential, { mailbox, limit: 200 }));
  return page.map(toEnvelope);
}

/** Moves a message to another mailbox (move, or delete = move to Trash). */
export async function moveMessage(vaultPath: string, account: MailAccountConfig, mailbox: string, id: string, target: string): Promise<void> {
  if (mailAccountKind(account) === "microsoft") return graphMove(vaultPath, account, mailbox, id, target);
  await withMailCredentials(vaultPath, account, credential => mailTransport().moveMessage(credential, { mailbox, uid: Number(id), target }));
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
  const page = await withMailCredentials(vaultPath, account, credential => mailTransport().searchEnvelopes(credential, { mailbox, query, limit: 200 }));
  return page.map(toEnvelope);
}
