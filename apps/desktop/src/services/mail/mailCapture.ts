import { upsertFrontmatterKeys, readFrontmatterPath } from "@plainva/core";
import { buildNewNoteContent } from "../newNote";
import { taskDbFileStem } from "../taskDatabase";
import type { MailMessage } from "./mailClient";

/**
 * Mail capture (PIM stage 5): turns a fetched message into vault content.
 * A captured mail is a NORMAL note (type Email) that rides the existing
 * file sync; the anchor in `plainva.pim` records where it came from
 * (account/mailbox/uid) and keeps a second capture of the SAME message
 * idempotent — same anchor-first resolution as the meeting notes.
 */

const MAX_TITLE_STEM = 80;

export interface MailCaptureAdapter {
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, content: string): Promise<void>;
  writeBinaryFile?(path: string, data: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  createDir(path: string): Promise<void>;
}

export function mailNoteStem(dayKey: string, subject: string): string {
  const clean = taskDbFileStem(subject) ?? "";
  const capped = clean.length > MAX_TITLE_STEM ? clean.slice(0, MAX_TITLE_STEM).trim() : clean;
  return capped ? `${dayKey} ${capped}` : dayKey;
}

export function mailDayKey(message: Pick<MailMessage, "dateTs">): string {
  const d = message.dateTs > 0 ? new Date(message.dateTs) : new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Fresh e-mail note: OKF frontmatter (type Email), sender/date fields, the
 * pim anchor and the plain-text body under the subject H1. */
export function buildEmailNoteContent(message: MailMessage, accountId: string, mailbox: string, dayKey: string): string {
  const title = message.subject.trim() || "E-Mail";
  let content = buildNewNoteContent("Email", title);
  try {
    content = upsertFrontmatterKeys(content, {
      from: message.from || undefined,
      date: dayKey,
      // `uid` holds the message identifier (IMAP UID as string, or the opaque
      // Graph id) — the idempotency anchor for a second capture.
      plainva: { pim: { kind: "email", account: accountId, mailbox, uid: message.id } },
    });
  } catch {
    /* anchor best-effort */
  }
  const body = (message.text ?? "").trim();
  if (body) content = content.replace(/\s*$/, "\n\n") + body + "\n";
  return content;
}

export interface CaptureMailOptions {
  adapter: MailCaptureAdapter;
  message: MailMessage;
  accountId: string;
  mailbox: string;
  /** Vault-relative folder (default "Mail"). */
  folder: string;
}

export interface CaptureMailResult {
  path: string;
  created: boolean;
}

/** Anchor-first resolution: capturing the same message twice opens the
 * existing note; a same-named foreign note is never touched. */
export async function captureMailAsNote(opts: CaptureMailOptions): Promise<CaptureMailResult> {
  const { adapter, message, accountId, mailbox } = opts;
  const dir = opts.folder.replace(/^\/+|\/+$/g, "");
  const prefix = dir ? dir + "/" : "";
  const dayKey = mailDayKey(message);
  const stem = mailNoteStem(dayKey, message.subject || "E-Mail");

  for (let n = 1; n < 50; n++) {
    const path = prefix + (n === 1 ? stem : `${stem} ${n}`) + ".md";
    if (!(await adapter.exists(path))) {
      if (dir) await adapter.createDir(dir).catch(() => undefined);
      await adapter.writeTextFile(path, buildEmailNoteContent(message, accountId, mailbox, dayKey));
      return { path, created: true };
    }
    try {
      const existing = await adapter.readTextFile(path);
      if (
        String(readFrontmatterPath(existing, ["plainva", "pim", "uid"]) ?? "") === message.id &&
        readFrontmatterPath(existing, ["plainva", "pim", "mailbox"]) === mailbox &&
        readFrontmatterPath(existing, ["plainva", "pim", "account"]) === accountId
      ) {
        return { path, created: false };
      }
    } catch {
      /* unreadable sibling — probe the next slot */
    }
  }
  // Rare fallback after 50 same-named notes: append a filesystem-safe slice of
  // the message id (Graph ids carry "/" and "=").
  const safeId = message.id.replace(/[^A-Za-z0-9._-]/g, "").slice(-16) || "0";
  const path = prefix + `${stem} ${safeId}.md`;
  if (!(await adapter.exists(path))) {
    if (dir) await adapter.createDir(dir).catch(() => undefined);
    await adapter.writeTextFile(path, buildEmailNoteContent(message, accountId, mailbox, dayKey));
    return { path, created: true };
  }
  return { path, created: false };
}

/** Saves the raw RFC822 message as a `.eml` next to the notes (binary write
 * through the adapter chain -> synced + backed up like any attachment). */
export async function saveEmlFile(
  adapter: MailCaptureAdapter,
  message: Pick<MailMessage, "subject" | "dateTs">,
  rawBase64: string,
  folder: string
): Promise<string> {
  if (!adapter.writeBinaryFile) throw new Error("binary writes unsupported");
  const dir = folder.replace(/^\/+|\/+$/g, "");
  const prefix = dir ? dir + "/" : "";
  const stem = mailNoteStem(mailDayKey(message), message.subject || "E-Mail");
  let path = prefix + stem + ".eml";
  for (let n = 2; await adapter.exists(path); n++) path = prefix + `${stem} ${n}.eml`;
  if (dir) await adapter.createDir(dir).catch(() => undefined);
  const binary = Uint8Array.from(atob(rawBase64), (c) => c.charCodeAt(0));
  await adapter.writeBinaryFile(path, binary);
  return path;
}
