import { trimChars } from "@plainva/core";
import { parse as parseYaml } from "yaml";
import { frontmatterBlockOf } from "../services/docMeta";
import { mailDayKey, mailNoteStem } from "./mailCapture";
import { normalizeSenderAddress, senderOptions, type MailAccountConfig } from "./mailAccounts";
import { buildReplyNoteContent, REPLY_NOTE_MAILBOX } from "./mailOut";
import type { MailMessage } from "./types";

/**
 * "Reply as note", one building block for both shells (Sammelplan § 3.171
 * Nr. 6: it was the desktop's only, written into its mail view).
 *
 * A reply note is a normal vault note addressed at the sender, the original
 * quoted below, written in Plainva and sent later. It names the mailbox the
 * message is in (`mailbox:`, decision E6): sent by mail later, the note leaves
 * from there, not from whichever mailbox is stored first.
 */

export interface ReplyNoteFiles {
  exists(path: string): Promise<boolean>;
  createDir(path: string): Promise<void>;
  writeTextFile(path: string, content: string): Promise<void>;
}

/** Writes the reply note into `folder` under a name of its own; returns its path. */
export async function writeReplyNote(opts: {
  files: ReplyNoteFiles;
  message: Pick<MailMessage, "subject" | "from" | "text" | "html">;
  /** Vault-relative folder, where captured mail lands. */
  folder: string;
  /** The mailbox the message is in: its address is what the note leaves from. */
  account?: MailAccountConfig | null;
  /** The day the note is written on; today by default. */
  dayKey?: string;
}): Promise<string> {
  const { files, message } = opts;
  const dir = trimChars(opts.folder, "/");
  const prefix = dir ? dir + "/" : "";
  const dayKey = opts.dayKey ?? mailDayKey({ dateTs: Date.now() });
  const stem = mailNoteStem(dayKey, `Re ${message.subject.trim().replace(/^(re|aw|antw):\s*/i, "") || "E-Mail"}`);
  let path = prefix + stem + ".md";
  for (let n = 2; await files.exists(path); n++) path = prefix + `${stem} ${n}.md`;
  if (dir) await files.createDir(dir).catch(() => undefined);
  const mailbox = opts.account ? senderOptions(opts.account)[0] : undefined;
  await files.writeTextFile(path, buildReplyNoteContent(message, dayKey, mailbox));
  return path;
}

/**
 * What a note brings to a mail composer from its properties: the recipient a
 * reply note stores in `to:` and the mailbox it names in `mailbox:`. Both
 * shells ask this when a note is sent by mail; the phone took neither (it
 * opened an empty "To"), the desktop only the recipient. Never throws.
 */
export function noteMailPrefill(content: string): { to?: string; from?: string } {
  const block = frontmatterBlockOf(content);
  if (!block) return {};
  try {
    const parsed = parseYaml(block) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const read = (key: string) => {
      const value = (parsed as Record<string, unknown>)[key];
      return typeof value === "string" && value.trim() ? value.trim() : undefined;
    };
    const to = read("to");
    const from = read(REPLY_NOTE_MAILBOX);
    return { ...(to ? { to } : {}), ...(from ? { from } : {}) };
  } catch {
    return {};
  }
}

/**
 * The mailbox and address that send as `address`: the account one of whose
 * sender addresses it is ("Name <a@b>" and case do not matter), or null where
 * none is.
 */
export function senderForAddress(accounts: readonly MailAccountConfig[], address: string | undefined): { accountId: string; address: string } | null {
  if (!address) return null;
  const wanted = normalizeSenderAddress(address);
  if (!wanted) return null;
  for (const account of accounts) {
    const match = senderOptions(account).find((option) => normalizeSenderAddress(option) === wanted);
    if (match) return { accountId: account.id, address: match };
  }
  return null;
}
