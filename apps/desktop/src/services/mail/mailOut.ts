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
/** Special-use folder role an IMAP name looks like (name-based guess for
 * servers that state none). */
export type GuessedFolderRole = "inbox" | "sent" | "drafts" | "trash" | "junk" | "archive" | null;

/**
 * Classifies an IMAP mailbox NAME into a special-use role, across the languages
 * of the provider catalog (de/en/fr/es/pt/it/nl/pl/cz/ru/kr/jp/cn). Matches on
 * the DECODED last hierarchy segment — so "INBOX.Kunden" is NOT an inbox and a
 * "Sentinel"/"Junker" folder is not mistaken for sent/junk. Pure.
 */
export function classifyFolderRole(name: string, delimiter?: string): GuessedFolderRole {
  const seg = mailFolderLabel(name, delimiter).toLowerCase();
  // Whole decoded name too, so "[Gmail]/Bin" style special-use survives.
  const full = decodeImapUtf7(name).toLowerCase();
  const hit = (re: RegExp): boolean => re.test(seg) || re.test(full);
  // ASCII short words carry a word boundary so a user folder like "Sentinel",
  // "Junker", "Koszty" or "Archivierte Projekte" is not miscategorized;
  // non-ASCII tokens (CJK/Cyrillic) are distinctive enough as-is (JS `\b` is
  // ASCII-only and would never match them).
  if (hit(/^(inbox|posteingang|boîte de réception|bandeja de entrada|caixa de entrada|posta in arrivo|postvak in|odebrane|doručená|входящие|받은편지함|受信トレイ|收件箱)$/)) return "inbox";
  if (hit(/\bsent\b|gesendet|envoyé|enviad|inviat|verzonden|wys[łl]ane|odeslan|отправленн|보낸편지함|送信済み|已发送/)) return "sent";
  if (hit(/\bdrafts?\b|entw[uü]rf|brouillon|borrador|rascunho|bozze|concept|\brobocze\b|\bkoncepty?\b|черновик|임시보관함|下書き|草稿/)) return "drafts";
  if (hit(/\btrash\b|papierkorb|corbeille|papelera|lixeira|cestino|prullenbak|\bkosz\b|koš|корзина|удал[её]нн|휴지통|ゴミ箱|已删除|deleted|\bbin\b/)) return "trash";
  if (hit(/\bjunk\b|\bspam\b|pourriel|correo no deseado|posta indesiderata|ongewenst|niechcian|nevyžádan|спам|스팸|迷惑メール|垃圾/)) return "junk";
  if (hit(/\barchives?\b|\barchiv\b|archiwum|archivio|arquivo|архив|보관|アーカイブ|归档/)) return "archive";
  return null;
}

/** Best-guess Trash mailbox for delete (localized), or null so the caller can
 * fall back to a flag. Matches names, returns the raw (IMAP) name. */
export function guessTrashMailbox(names: string[], delimiter?: string): string | null {
  return names.find((n) => classifyFolderRole(n, delimiter) === "trash") ?? null;
}

/** Best-guess drafts mailbox (localized), else a literal fallback. Matches
 * names, returns the raw (IMAP) name. */
export function guessDraftsMailbox(names: string[], delimiter?: string): string {
  return names.find((n) => classifyFolderRole(n, delimiter) === "drafts") ?? "Drafts";
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

/** Escapes a string for use inside a RegExp character class / literal. Pure. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Display label for an IMAP mailbox name: drop a leading "[Gmail]/" special-use
 * container and show the last hierarchy segment. Splits at the server-stated
 * `delimiter` when known (so "mailbox.org Rechnungen" stays whole); otherwise
 * falls back to "/" or "." (the two common conventions). Pure. */
export function mailFolderLabel(name: string, delimiter?: string): string {
  const decoded = decodeImapUtf7(name);
  const stripped = decoded.replace(/^\[Gmail\]\//i, "");
  const splitter = delimiter ? new RegExp(escapeRe(delimiter)) : /[/.]/;
  const segs = stripped.split(splitter).filter(Boolean);
  return segs.length ? segs[segs.length - 1] : decoded;
}

/**
 * Picks the folder to open first: the backend-stated inbox role wins (Graph
 * says so authoritatively and language independently — a German mailbox calls
 * it "Posteingang"), then the English name heuristic, then the first folder.
 * Pure.
 */
export function pickInboxFolder(boxes: readonly { name: string; role?: string }[]): string | null {
  const byRole = boxes.find((b) => b.role === "inbox");
  if (byRole) return byRole.name;
  const byName = boxes.find((b) => /inbox/i.test(b.name));
  if (byName) return byName.name;
  return boxes[0]?.name ?? null;
}

/** Trash folder for delete: backend role first, then the name heuristic. Pure. */
export function pickTrashFolder(boxes: readonly { name: string; role?: string; delimiter?: string }[]): string | null {
  const byRole = boxes.find((b) => b.role === "trash");
  if (byRole) return byRole.name;
  const delimiter = boxes.find((b) => b.delimiter)?.delimiter;
  return guessTrashMailbox(boxes.map((b) => b.name), delimiter);
}

const ROLE_ORDER: GuessedFolderRole[] = ["inbox", "sent", "drafts", "archive", "junk", "trash"];

/** Orders mailbox names for the folder column: inbox first, then the usual
 * special-use folders (by their classified role, so it works across languages
 * and does not rank every "INBOX.x" child as an inbox), then the rest
 * alphabetically by display label. Pure. */
export function sortMailFolders(names: string[], delimiter?: string): string[] {
  const rank = (n: string): number => {
    const i = ROLE_ORDER.indexOf(classifyFolderRole(n, delimiter));
    return i < 0 ? ROLE_ORDER.length : i;
  };
  return [...names].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    return mailFolderLabel(a, delimiter).localeCompare(mailFolderLabel(b, delimiter));
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
    // Microsoft Graph sends directly (no SMTP) via /me/sendMail. The compose flow
    // lifts the invite OUT of `attachments` into `calendar`; re-attach it as a
    // text/calendar file attachment so Outlook renders it as an invite (Graph has
    // no inline-iMIP concept). Without this the invitation was silently dropped.
    const msAttachments = calendar
      ? [...attachments, { name: "invite.ics", mime: `text/calendar; method=${calendar.method ?? "REQUEST"}`, contentBase64: utf8ToBase64(calendar.ics) }]
      : attachments;
    await graphSendMail(vaultPath, account, to, subject, html, msAttachments, cc, bcc);
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
