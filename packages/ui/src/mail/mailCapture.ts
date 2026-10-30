import { trimChars } from "@plainva/core";
import { applyTextShape, noteBodyOf, readTextShape, updateVaultText, upsertFrontmatterKeys, readFrontmatterPath, type OkfSource, type TextUpdateFiles } from "@plainva/core";
import { buildNewNoteContent } from "../lib/newNoteContent";
import { safeFileStem } from "../lib/fileStem";
import { generatedStamp } from "../lib/okfProvenance";
import { mailMessageText } from "./messageText";
import type { MailMessage } from "./types";

/**
 * Mail capture (PIM stage 5): turns a fetched message into vault content.
 * A captured mail is a NORMAL note (type Email) that rides the existing
 * file sync; the anchor in `plainva.pim` records where it came from
 * (account/mailbox/uid) and keeps a second capture of the SAME message
 * idempotent — same anchor-first resolution as the meeting notes. A second
 * capture asked for by hand fills that note with the message's text where it
 * holds none of it (`fillEmpty`).
 */

const MAX_TITLE_STEM = 80;

/**
 * The vault's files as a capture needs them. A change of a note that exists
 * goes through the chain's one entry (`updateVaultText`), so the files hand on
 * that entry where they have it.
 */
export interface MailCaptureAdapter extends TextUpdateFiles {
  writeBinaryFile?(path: string, data: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  createDir(path: string): Promise<void>;
}

export function mailNoteStem(dayKey: string, subject: string): string {
  const clean = safeFileStem(subject) ?? "";
  const capped = clean.length > MAX_TITLE_STEM ? clean.slice(0, MAX_TITLE_STEM).trim() : clean;
  return capped ? `${dayKey} ${capped}` : dayKey;
}

export function mailDayKey(message: Pick<MailMessage, "dateTs">): string {
  const d = message.dateTs > 0 ? new Date(message.dateTs) : new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Provenance a capture may write (OKF 0.2, plan P3b). */
export interface MailCaptureStampOptions {
  /**
   * Actor for `generated.by` — `plainva-mail-capture/<version>`, set by the
   * shells. Omitted = no `generated`/`sources` stamp: the capture is still a
   * complete note, it just does not name its producer.
   */
  generatedBy?: string;
}

/**
 * The message's stable identity as an OKF source (`mid:<Message-ID>`, RFC
 * 2392 form). Only the RFC Message-ID qualifies: an IMAP UID is mailbox-local
 * and a Graph id is account-local — neither would mean anything to a reader
 * of the note outside this one client.
 */
function mailSource(message: MailMessage): OkfSource | null {
  const mid = (message.providerMessageId ?? "").trim().replace(/^<|>$/g, "");
  if (!mid) return null;
  const title = message.subject.trim();
  return title ? { resource: `mid:${mid}`, title } : { resource: `mid:${mid}` };
}

/** Fresh e-mail note: OKF frontmatter (type Email), sender/date fields, the
 * pim anchor and the message's text (`mailMessageText`) under the subject H1. */
export function buildEmailNoteContent(
  message: MailMessage,
  accountId: string,
  mailbox: string,
  dayKey: string,
  stamp: MailCaptureStampOptions = {},
): string {
  const title = message.subject.trim() || "E-Mail";
  let content = buildNewNoteContent("Email", title);
  try {
    content = upsertFrontmatterKeys(content, {
      from: message.from || undefined,
      date: dayKey,
      // `uid` holds the message identifier (IMAP UID as string, or the opaque
      // Graph id) — the idempotency anchor for a second capture.
      plainva: { pim: {
        kind: "email",
        account: accountId,
        mailbox,
        uid: message.id,
        uidValidity: message.uidValidity,
        messageId: message.providerMessageId,
      } },
    });
  } catch {
    /* anchor best-effort */
  }
  if (stamp.generatedBy) {
    // OKF 0.2 provenance: the capture is a machine-written note and says so
    // (`generated`); the message itself is its source where it has a stable
    // Message-ID. Best-effort like the anchor — a stamp never blocks a capture.
    try {
      const source = mailSource(message);
      content = upsertFrontmatterKeys(content, {
        generated: generatedStamp(stamp.generatedBy),
        ...(source ? { sources: [source] } : {}),
      });
    } catch {
      /* stamp best-effort */
    }
  }
  const body = mailMessageText(message).trim();
  if (body) content = (content.trimEnd() + "\n\n") + body + "\n";
  return content;
}

export interface CaptureMailOptions extends MailCaptureStampOptions {
  adapter: MailCaptureAdapter;
  message: MailMessage;
  accountId: string;
  mailbox: string;
  /** Vault-relative folder (default "Mail"). */
  folder: string;
  /**
   * Whether the note this message was filed in before gets the message's text
   * now where it holds none of it (`isEmptyMailNote`). Only the explicit
   * "File as note" of the reader asks for it — never a rule's action and never
   * a run over many messages: it is a write to a note that exists, and the user
   * asked for exactly this one (decision on finding 2026-10-09, option b).
   */
  fillEmpty?: boolean;
}

export interface CaptureMailResult {
  path: string;
  created: boolean;
  /** The note was there and held no text of the message; it holds it now (`fillEmpty`). */
  filled: boolean;
}

/** A line that is nothing but a link to the raw copy of a message (`[[… .eml]]`), as a capture with the .eml writes it. */
const EML_LINK_LINE = /^\[\[[^[\]]+\.eml(\|[^[\]]*)?\]\]$/i;

/**
 * Whether a filed mail note holds no text of its message: under its title — the
 * first heading, `# …` — there is nothing but blank lines and at most the link
 * to the raw copy. Its properties do not count. That is the note a capture
 * wrote while the text of a message without a plain-text part was empty
 * (finding 2026-10-09: every message of a Microsoft mailbox, on the phone
 * every HTML-only message over IMAP, since July). A note with anything else
 * under its title — a line typed into it, another heading, a task — is the
 * user's and is left as it is.
 */
export function isEmptyMailNote(content: string): boolean {
  let titled = false;
  for (const raw of noteBodyOf(readTextShape(content).text).split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (!titled && /^# /.test(line)) {
      titled = true;
      continue;
    }
    if (EML_LINK_LINE.test(line)) continue;
    return false;
  }
  return true;
}

/**
 * The empty mail note `content` with `text` under its title — where a fresh
 * capture puts it: in front of the link to the raw copy, which a capture
 * writes behind the text. Line ends and a byte order mark stay the file's.
 */
function withMailText(content: string, text: string): string {
  const { text: lf, shape } = readTextShape(content);
  const lines = lf.split("\n");
  const body = lf.length - noteBodyOf(lf).length;
  // The first line of the body that links the raw copy, counted in lines of the whole text.
  const bodyStart = lf.slice(0, body).split("\n").length - 1;
  const eml = lines.findIndex((line, at) => at >= bodyStart && EML_LINK_LINE.test(line.trim()));
  const next =
    eml < 0
      ? `${lf.trimEnd()}\n\n${text}\n`
      : `${lines.slice(0, eml).join("\n").trimEnd()}\n\n${text}\n\n${lines.slice(eml).join("\n")}`;
  return applyTextShape(next, shape);
}

/** Anchor-first resolution: capturing the same message twice opens the
 * existing note; a same-named foreign note is never touched. Asked to
 * (`fillEmpty`), an existing note of this message that holds no text of it
 * gets the text. */
export async function captureMailAsNote(opts: CaptureMailOptions): Promise<CaptureMailResult> {
  const { adapter, message, accountId, mailbox } = opts;
  const stamp: MailCaptureStampOptions = { generatedBy: opts.generatedBy };
  const dir = trimChars(opts.folder, "/");
  const prefix = dir ? dir + "/" : "";
  const dayKey = mailDayKey(message);
  const stem = mailNoteStem(dayKey, message.subject || "E-Mail");

  for (let n = 1; n < 50; n++) {
    const path = prefix + (n === 1 ? stem : `${stem} ${n}`) + ".md";
    if (!(await adapter.exists(path))) {
      if (dir) await adapter.createDir(dir).catch(() => undefined);
      await adapter.writeTextFile(path, buildEmailNoteContent(message, accountId, mailbox, dayKey, stamp));
      return { path, created: true, filled: false };
    }
    try {
      const existing = await adapter.readTextFile(path);
      const messageId = String(readFrontmatterPath(existing, ["plainva", "pim", "messageId"]) ?? "");
      const sameStableMessage = !!message.providerMessageId && messageId === message.providerMessageId;
      const sameUidEpoch =
        String(readFrontmatterPath(existing, ["plainva", "pim", "uid"]) ?? "") === message.id &&
        Number(readFrontmatterPath(existing, ["plainva", "pim", "uidValidity"]) ?? 0) === (message.uidValidity ?? 0) &&
        readFrontmatterPath(existing, ["plainva", "pim", "mailbox"]) === mailbox;
      if (
        !(sameStableMessage || sameUidEpoch) ||
        readFrontmatterPath(existing, ["plainva", "pim", "account"]) !== accountId
      ) {
        continue;
      }
    } catch {
      /* unreadable sibling — probe the next slot */
      continue;
    }
    return { path, created: false, filled: opts.fillEmpty ? await fillEmptyMailNote(adapter, path, message) : false };
  }
  // Rare fallback after 50 same-named notes: append a filesystem-safe slice of
  // the message id (Graph ids carry "/" and "=").
  const safeId = message.id.replace(/[^A-Za-z0-9._-]/g, "").slice(-16) || "0";
  const path = prefix + `${stem} ${safeId}.md`;
  if (!(await adapter.exists(path))) {
    if (dir) await adapter.createDir(dir).catch(() => undefined);
    await adapter.writeTextFile(path, buildEmailNoteContent(message, accountId, mailbox, dayKey, stamp));
    return { path, created: true, filled: false };
  }
  return { path, created: false, filled: false };
}

/**
 * Puts the message's text into its note where the note holds none of it.
 *
 * Through the chain's one entry for a change: the emptiness is asked of the
 * note as it lies there when it is written, so a line typed into it meanwhile
 * is never written over. At a note with an open conflict the change is asked
 * of both versions, and each is filled only where it is empty — the user's own
 * version with a line in it stays as it is. Nothing is written where the
 * message has no text either.
 */
async function fillEmptyMailNote(adapter: MailCaptureAdapter, path: string, message: MailMessage): Promise<boolean> {
  const text = mailMessageText(message).trim();
  if (!text) return false;
  const update = await updateVaultText(adapter, path, (current) => (isEmptyMailNote(current) ? withMailText(current, text) : null));
  return update.changed || !!update.conflict?.changed;
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
  const dir = trimChars(folder, "/");
  const prefix = dir ? dir + "/" : "";
  const stem = mailNoteStem(mailDayKey(message), message.subject || "E-Mail");
  let path = prefix + stem + ".eml";
  for (let n = 2; await adapter.exists(path); n++) path = prefix + `${stem} ${n}.eml`;
  if (dir) await adapter.createDir(dir).catch(() => undefined);
  const binary = Uint8Array.from(atob(rawBase64), (c) => c.charCodeAt(0));
  await adapter.writeBinaryFile(path, binary);
  return path;
}
