import { invoke } from "@tauri-apps/api/core";
import { markdownToHtml, markdownToPlainText } from "@plainva/ui";
import { upsertFrontmatterKeys } from "@plainva/core";
import { buildNewNoteContent } from "../newNote";
import type { MailAccountConfig } from "./mailAccounts";
import { getMailPassword } from "./mailAccounts";
import type { MailMessage } from "./mailClient";

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

/** Best-guess drafts mailbox: localized "draft"/"entwurf" names first, then
 * the Gmail special-use folder, then a literal fallback. */
export function guessDraftsMailbox(names: string[]): string {
  const byName = names.find((n) => /draft|entw[uü]rf|brouillon|borrador|rascunho|bozze|concept|szkic|下書き|草稿/i.test(n));
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

/** Appends a \Draft message into the account's mailbox (IMAP APPEND). */
export async function appendDraft(
  vaultPath: string,
  account: MailAccountConfig,
  mailbox: string,
  to: string,
  subject: string,
  markdown: string
): Promise<void> {
  const pass = await getMailPassword(vaultPath, account.id);
  if (!pass) throw new Error("missing mail credentials");
  const { html, text } = noteToClipboardFlavors(markdown);
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
  });
}
