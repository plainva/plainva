import { invoke } from "@tauri-apps/api/core";
import { markdownToHtml, markdownToPlainText } from "@plainva/ui";
import { upsertFrontmatterKeys } from "@plainva/core";
import { buildNewNoteContent } from "../newNote";
import type { MailAccountConfig } from "./mailAccounts";
import { getMailPassword, mailAccountKind } from "./mailAccounts";
import type { MailMessage } from "./mailClient";
import { graphSendMail, graphAppendDraft } from "./graphMail";

/**
 * "Mail-raus" without ever sending (PIM stage 6): Plainva deliberately never
 * speaks SMTP — no sender reputation, no deliverability surface. The three
 * ways OUT are: rich-text copy (paste into any composer), a DRAFT appended
 * into the user's own mailbox via IMAP (the mail program sends it), and a
 * mailto: handoff for short texts. Replies start as vault notes.
 */

/** mailto: URLs break in the multi-KB range — keep well under it. */
const MAILTO_BODY_LIMIT = 1800;

export interface MailtoResult {
  url: string;
  truncated: boolean;
}

export function buildMailtoUrl(subject: string, body: string, to = ""): MailtoResult {
  const truncated = body.length > MAILTO_BODY_LIMIT;
  const clipped = truncated ? body.slice(0, MAILTO_BODY_LIMIT) + "…" : body;
  const params = new URLSearchParams();
  if (subject) params.set("subject", subject);
  if (clipped) params.set("body", clipped);
  // URLSearchParams encodes spaces as "+", which mail clients show literally.
  const query = params.toString().replace(/\+/g, "%20");
  return { url: `mailto:${encodeURIComponent(to)}${query ? "?" + query : ""}`, truncated };
}

/** Note content -> both clipboard flavors (composers keep the formatting,
 * plain-text targets stay clean). */
export function noteToClipboardFlavors(markdown: string): { html: string; text: string } {
  return { html: markdownToHtml(markdown), text: markdownToPlainText(markdown) };
}

/** Decodes an IMAP mailbox name from modified UTF-7 (RFC 3501): "&" opens a
 * modified-base64 run of UTF-16BE code units and "-" closes it; "&-" is a
 * literal "&". So "Entw&APw-rfe" -> "Entwürfe". Non-encoded names pass through.
 * Used for DISPLAY and folder-role matching only — IMAP commands keep the raw
 * (encoded) name. Pure. */
export function decodeImapUtf7(name: string): string {
  return name.replace(/&([^-]*)-/g, (_m, run: string) => {
    if (run === "") return "&";
    const std = run.replace(/,/g, "/");
    const pad = (4 - (std.length % 4)) % 4;
    let bin: string;
    try {
      bin = atob(std + "=".repeat(pad));
    } catch {
      return _m; // not valid base64 — leave the run untouched
    }
    let out = "";
    for (let i = 0; i + 1 < bin.length; i += 2) {
      out += String.fromCharCode((bin.charCodeAt(i) << 8) | bin.charCodeAt(i + 1));
    }
    return out;
  });
}

/** Best-guess Trash mailbox for "delete" (a reversible move), or null when the
 * account has no recognizable Trash folder (delete then falls back to a flag).
 * Matches on the DECODED name but returns the raw (IMAP) name. */
export function guessTrashMailbox(names: string[]): string | null {
  const byName = names.find((n) => /trash|papierkorb|corbeille|papelera|lixeira|cestino|prullenbac|kosz|已删除|ゴミ箱|deleted/i.test(decodeImapUtf7(n)));
  if (byName) return byName;
  const gmail = names.find((n) => n.toLowerCase() === "[gmail]/trash" || n.toLowerCase() === "[gmail]/bin");
  return gmail ?? null;
}

/** Best-guess drafts mailbox: localized "draft"/"entwurf" names first, then
 * the Gmail special-use folder, then a literal fallback. Matches on the DECODED
 * name but returns the raw (IMAP) name. */
export function guessDraftsMailbox(names: string[]): string {
  const byName = names.find((n) => /draft|entw[uü]rf|brouillon|borrador|rascunho|bozze|concept|szkic|下書き|草稿/i.test(decodeImapUtf7(n)));
  if (byName) return byName;
  const gmail = names.find((n) => n.toLowerCase() === "[gmail]/drafts");
  return gmail ?? "Drafts";
}

/** Reply note: a NORMAL vault note addressed at the sender, with the
 * original quoted below — written in Plainva, sent later via draft/mailto. */
export function buildReplyNoteContent(message: Pick<MailMessage, "subject" | "from" | "text">, dayKey: string): string {
  const subject = message.subject.trim().replace(/^(re|aw|antw):\s*/i, "");
  const title = `Re: ${subject || "E-Mail"}`;
  let content = buildNewNoteContent("Email", title);
  try {
    content = upsertFrontmatterKeys(content, { to: message.from || undefined, date: dayKey });
  } catch {
    /* best effort */
  }
  const quoted = (message.text ?? "")
    .trim()
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  content = content.replace(/\s*$/, "\n\n") + (quoted ? `\n${quoted}\n` : "");
  return content;
}

/** Reply body: a blank area for the user's text, then the quoted original with
 * an attribution line — ready to drop into a real reply compose (SMTP send),
 * NOT a vault note. Pure. */
export function buildReplyBody(message: Pick<MailMessage, "from" | "text" | "dateTs">): string {
  const when = message.dateTs > 0 ? new Date(message.dateTs).toISOString() : "";
  const attribution = message.from ? `${[when, message.from].filter(Boolean).join(" — ")}:` : "";
  const quoted = (message.text ?? "")
    .trim()
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return `\n\n${attribution ? attribution + "\n" : ""}${quoted}\n`;
}

/** Reply-all recipients: the sender plus the original To recipients, minus the
 * account's own address, deduped (case-insensitive). Addresses are unwrapped
 * from "Name <addr>". Pure. */
export function replyAllRecipients(message: Pick<MailMessage, "from" | "to">, selfEmail: string): string {
  const addr = (s: string): string => {
    const m = s.match(/<([^>]+)>/);
    return (m ? m[1] : s).trim();
  };
  const self = selfEmail.trim().toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [message.from, ...(message.to ?? "").split(/[,;]/)]) {
    const a = addr((raw ?? "").trim());
    const key = a.toLowerCase();
    if (a && key !== self && !seen.has(key)) {
      seen.add(key);
      out.push(a);
    }
  }
  return out.join(", ");
}

/** Uint8Array -> base64 (chunked so a large attachment doesn't blow the stack). */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/** Forwarded-message body (mail-client E1): the quoted original with a header
 * block, ready to drop into a compose draft. Pure. */
export function buildForwardBody(message: Pick<MailMessage, "subject" | "from" | "text" | "dateTs">): string {
  const header = ["---------- Forwarded message ----------"];
  if (message.from) header.push(`From: ${message.from}`);
  if (message.dateTs > 0) header.push(`Date: ${new Date(message.dateTs).toISOString()}`);
  if (message.subject) header.push(`Subject: ${message.subject}`);
  return `\n\n${header.join("\n")}\n\n${(message.text ?? "").trim()}\n`;
}

/** Display label for an IMAP mailbox name: drop a leading "[Gmail]/" special-use
 * container and show the last hierarchy segment (separator-agnostic). Pure. */
export function mailFolderLabel(name: string): string {
  const decoded = decodeImapUtf7(name);
  const stripped = decoded.replace(/^\[Gmail\]\//i, "");
  const segs = stripped.split(/[/.]/).filter(Boolean);
  return segs.length ? segs[segs.length - 1] : decoded;
}

const FOLDER_ORDER = ["inbox", "sent", "draft", "archive", "junk", "spam", "trash"];

/** Orders mailbox names for the folder column: INBOX first, then the usual
 * special-use folders, then the rest alphabetically (by display label). Pure. */
export function sortMailFolders(names: string[]): string[] {
  const rank = (n: string): number => {
    const label = mailFolderLabel(n).toLowerCase();
    const i = FOLDER_ORDER.findIndex((k) => label.includes(k) || n.toLowerCase().includes(k));
    return i < 0 ? FOLDER_ORDER.length : i;
  };
  return [...names].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    return mailFolderLabel(a).localeCompare(mailFolderLabel(b));
  });
}

/** An outgoing attachment (mail-client E5): base64 payload decoded natively. */
export interface MailAttachment {
  name: string;
  mime: string;
  contentBase64: string;
}

/** UTF-8 string -> base64 (chunked so large notes don't blow the call stack). */
export function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/** Sends an outgoing message via the account's SMTP submission host
 * (mail-client E3). Requires smtpHost/smtpPort on the account; the sender is
 * the account user. Never relays — this only submits the user's own mail. */
export async function sendMail(
  vaultPath: string,
  account: MailAccountConfig,
  to: string,
  subject: string,
  markdown: string,
  attachments: MailAttachment[] = [],
  /** When set, the message carries this iCalendar text as an inline
   * `text/calendar; method=…` invitation (iMIP) so Gmail renders it as an
   * event. The SMTP path builds a proper multipart/alternative + .ics copy. */
  calendar?: { ics: string; method?: string },
  /** Comma-separated Cc / Bcc recipients. */
  cc = "",
  bcc = ""
): Promise<void> {
  if (!to.trim()) throw new Error("no recipient");
  const { html, text } = noteToClipboardFlavors(markdown);
  if (mailAccountKind(account) === "microsoft") {
    // Microsoft Graph sends directly (no SMTP) via /me/sendMail. Outlook/Graph
    // renders the .ics attachment as an invite, so the calendar rides along as
    // an attachment there.
    await graphSendMail(vaultPath, account, to, subject, html, attachments, cc, bcc);
    return;
  }
  if (!account.smtpHost) throw new Error("no SMTP host configured for this account");
  const pass = await getMailPassword(vaultPath, account.id);
  if (!pass) throw new Error("missing mail credentials");
  await invoke("mail_send", {
    host: account.smtpHost,
    port: account.smtpPort ?? 587,
    user: account.user,
    pass,
    from: account.user,
    to,
    subject,
    text,
    html,
    attachments: attachments.length ? attachments : null,
    calendar: calendar?.ics ?? null,
    calendarMethod: calendar?.method ?? null,
    cc: cc.trim() || null,
    bcc: bcc.trim() || null,
  });
}

/** Appends a \Draft message into the account's mailbox (IMAP APPEND). */
export async function appendDraft(
  vaultPath: string,
  account: MailAccountConfig,
  mailbox: string,
  to: string,
  subject: string,
  markdown: string,
  attachments: MailAttachment[] = [],
  cc = "",
  bcc = ""
): Promise<void> {
  const { html, text } = noteToClipboardFlavors(markdown);
  if (mailAccountKind(account) === "microsoft") {
    await graphAppendDraft(vaultPath, account, to, subject, html, attachments, cc, bcc);
    return;
  }
  const pass = await getMailPassword(vaultPath, account.id);
  if (!pass) throw new Error("missing mail credentials");
  await invoke("mail_append_draft", {
    host: account.host,
    port: account.port,
    user: account.user,
    pass,
    mailbox,
    to,
    subject,
    text,
    html,
    attachments: attachments.length ? attachments : null,
    cc: cc.trim() || null,
    bcc: bcc.trim() || null,
  });
}
