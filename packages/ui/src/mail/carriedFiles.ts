import { mailAccountKind, type MailAccountConfig } from "./mailAccounts";
import { GRAPH_FILE_LIMIT } from "./graphMail";
import { guessAttachmentMime, type MailAttachment } from "./mailOut";
import type { AttachmentFetchFailure, AttachmentFetchResult, MailAttachmentInfo, MailMessage } from "./types";

/**
 * The files a forward carries: the one rule both composers read.
 *
 * Until 2026-10 a forward took the text of the original and none of its files,
 * on either shell, while the handbook said otherwise. Bringing them along is
 * more than a fetch: the composer opens at once and the files arrive later, a
 * mailbox does not take every file, and a file that could not come must not
 * go missing without a word. Two shells answering those questions each in
 * their own way is how they would come apart, so the answers live here:
 *
 *  - WHAT comes along: exactly the files the reader listed under the message,
 *    in its order (`ForwardSource`). One list in two places.
 *  - WHERE they are while the draft is open: as a reference to the message
 *    plus, per file, how far it is (`CarriedFile`). The bytes are fetched by
 *    the composer, not handed to it — on the phone a draft travels as its nav
 *    path, and megabytes do not belong in one.
 *  - WHAT goes and what stays behind (`planFiles`): decided for every file on
 *    the draft against what the SENDING mailbox takes, so switching the sender
 *    switches the answer. What stays behind keeps its name and says why.
 *
 * Pure: no network, no React. `useCarriedFiles` is the part that loads.
 */

/**
 * What Plainva loads for a forward ON ITS OWN, per message, in bytes.
 *
 * A file a person attaches by hand is their decision; a forward attaches
 * whatever the original happened to carry, and that may be a video. 18 MB of
 * files is about 25 MB once packed for the wire — the size commonly allowed
 * for a whole message — and it bounds what the composer holds in memory, which
 * on a phone is held several times over until the message has left.
 */
export const CARRIED_TOTAL_LIMIT = 18 * 1024 * 1024;

/** Where a forward's files come from: the reader's own list, by reference. */
export interface ForwardSource {
  /** The mailbox the MESSAGE lies in — not necessarily the one that sends. */
  accountId: string;
  mailbox: string;
  messageId: string;
  /** IMAP mailbox epoch the message was read under (see `fetchAttachments`). */
  uidValidity?: number;
  /** The attachments as the reader listed them. */
  files: MailAttachmentInfo[];
}

/**
 * The reference a reader hands to the composer — or nothing, when the message
 * has no files and a forward is its text alone.
 *
 * EVERY file the reader lists, however many: a list cut here would be files
 * that are neither drawn nor asked about before the message leaves — gone
 * without a word, which is the one thing a forward must not do.
 */
export function forwardSource(
  accountId: string,
  mailbox: string,
  message: Pick<MailMessage, "id" | "attachments" | "uidValidity">
): ForwardSource | undefined {
  if (message.attachments.length === 0) return undefined;
  return {
    accountId,
    mailbox,
    messageId: message.id,
    ...(message.uidValidity ? { uidValidity: message.uidValidity } : {}),
    files: message.attachments.map(({ index, name, mime, size }) => ({ index, name, mime, size })),
  };
}

const isFileInfo = (value: unknown): value is MailAttachmentInfo => {
  const file = value as MailAttachmentInfo | null;
  return (
    !!file &&
    typeof file === "object" &&
    Number.isInteger(file.index) &&
    file.index >= 0 &&
    typeof file.name === "string" &&
    typeof file.mime === "string" &&
    typeof file.size === "number" &&
    Number.isFinite(file.size) &&
    file.size >= 0
  );
};

/**
 * Reads a reference that crossed a boundary no type checks — the phone's nav
 * path, the desktop's window event. Total: anything that is not a well-formed
 * reference is no reference, and only well-formed entries are files. What
 * arrives here decides which mailbox is asked for whose bytes.
 */
export function readForwardSource(value: unknown): ForwardSource | undefined {
  const source = value as Partial<ForwardSource> | null;
  if (!source || typeof source !== "object") return undefined;
  if (typeof source.accountId !== "string" || typeof source.mailbox !== "string" || typeof source.messageId !== "string") return undefined;
  if (!source.accountId || !source.messageId || !Array.isArray(source.files)) return undefined;
  const seen = new Set<number>();
  const files = source.files
    .filter(isFileInfo)
    .filter((file) => (seen.has(file.index) ? false : (seen.add(file.index), true)))
    .map(({ index, name, mime, size }) => ({ index, name, mime, size }));
  if (files.length === 0) return undefined;
  const epoch = source.uidValidity;
  return {
    accountId: source.accountId,
    mailbox: source.mailbox,
    messageId: source.messageId,
    ...(typeof epoch === "number" && Number.isInteger(epoch) && epoch > 0 ? { uidValidity: epoch } : {}),
    files,
  };
}

// ---- One file of the original, as the composer holds it ---------------------

/**
 * Why a file is not there:
 *  - what the backend said about that one file (`AttachmentFetchFailure`);
 *  - `changed`: the mailbox was renumbered since the message was read, so the
 *    reference no longer names this message;
 *  - `account`: the mailbox the message lies in is not connected (any more).
 */
export type CarriedFailure = AttachmentFetchFailure | "changed" | "account";

export interface CarriedFile {
  index: number;
  /** Name, type and size as the reader listed them. */
  name: string;
  mime: string;
  size: number;
  /** `idle`: not asked for yet. `failed` carries `failure`. */
  load: "idle" | "loading" | "ready" | "failed";
  /** The file as it will be sent — present exactly when `load` is `ready`. */
  attachment?: MailAttachment;
  failure?: CarriedFailure;
  /** The backend's own words for a failure, where it had any. */
  detail?: string;
}

/** The files of a reference, none asked for yet. */
export function carriedFilesOf(source: ForwardSource | undefined): CarriedFile[] {
  return (source?.files ?? []).map(({ index, name, mime, size }) => ({ index, name, mime, size, load: "idle" }));
}

// ---- A file from someone else's message, made fit to send -------------------

const MIME_TOKEN = /^[a-z0-9!#$%&'*+.^_`|~-]+\/[a-z0-9!#$%&'*+.^_`|~-]+$/;

/**
 * The type a transport will take: `kind/subtype` and nothing else.
 *
 * Both MIME builders (`buildMimeMessage`, and `validate_attachment` in the
 * desktop's Rust) refuse an attachment whose type is anything but two tokens —
 * with "Invalid attachment header", after the undo window, when the composer
 * is long closed. A type read out of somebody else's message is not promised
 * to have that form. Parameters are dropped on purpose, `method=` included: a
 * calendar file from a forwarded mail is a FILE, and must not travel as an
 * invitation in the forwarder's name.
 */
export function cleanAttachmentMime(mime: string, name: string): string {
  // Total: a type that is no text at all (a file that crossed a window or a
  // nav path in a form nobody checks) is guessed from the name like any other
  // type no transport would take.
  const bare = typeof mime === "string" ? mime.split(";")[0].trim().toLowerCase() : "";
  if (MIME_TOKEN.test(bare)) return bare;
  return guessAttachmentMime(typeof name === "string" ? name : "");
}

/** What a file WITHOUT a name of its own is called after its type, so that
 *  whoever receives it can open it. */
const EXTENSION_BY_TYPE: Readonly<Record<string, string>> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "text/calendar": "ics",
  "text/csv": "csv",
  "text/html": "html",
  "text/plain": "txt",
};

/**
 * The name a transport will take, and a recipient can use: no control
 * characters (a line break in a file name ends the header it stands in), no
 * path separators, never empty. An attached mail without a name of its own is
 * called what it is — and so is a part that has no name at all: a picture
 * embedded in the original, which the desktop's reader lists as "attachment",
 * leaves as `attachment.png` rather than as a file nothing opens. A name
 * somebody gave is left as it is, with or without an extension.
 */
export function cleanAttachmentName(name: string, mime: string, index: number): string {
  const cleaned = Array.from(typeof name === "string" ? name : "")
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      if (code < 0x20 || code === 0x7f || ch === "/" || ch === "\\") return " ";
      return ch;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  const base = cleaned || `attachment-${index + 1}`;
  const kind = typeof mime === "string" ? mime.split(";")[0].trim().toLowerCase() : "";
  if (/\.[a-z0-9]{1,8}$/i.test(base)) return base;
  if (kind === "message/rfc822") return `${base}.eml`;
  // "attachment" is the stand-in the desktop's parser lists a nameless part
  // under. An entry of the table itself, never one every object inherits.
  const nameless = cleaned === "" || cleaned === "attachment";
  if (nameless && Object.prototype.hasOwnProperty.call(EXTENSION_BY_TYPE, kind)) return `${base}.${EXTENSION_BY_TYPE[kind]}`;
  return base;
}

/** A listed file plus its bytes, as the attachment that goes out. */
export function carriedAttachment(file: Pick<MailAttachmentInfo, "index" | "name" | "mime">, contentBase64: string): MailAttachment {
  return {
    name: cleanAttachmentName(file.name, file.mime, file.index),
    mime: cleanAttachmentMime(file.mime, file.name),
    contentBase64,
  };
}

/**
 * Any other file on a draft, in the form a transport takes: its type without
 * parameters. The desktop's "send event by mail" hands the composer an
 * invitation typed `text/calendar; method=REQUEST; charset=UTF-8`; sent, the
 * composer lifts it into the message itself, but filed as a draft it went to
 * the MIME builder as it was and was refused there ("Invalid attachment
 * header", finding 2026-10-11). A draft holds it as the calendar file it is.
 */
export function sendableAttachment(file: MailAttachment): MailAttachment {
  const mime = cleanAttachmentMime(file.mime, file.name);
  return mime === file.mime ? file : { ...file, mime };
}

/** A batch answer applied to the files it was asked for: bytes become `ready`,
 *  everything else says why not. Files the answer does not mention stay. */
export function applyFetched(files: readonly CarriedFile[], answers: readonly AttachmentFetchResult[]): CarriedFile[] {
  return files.map((file) => {
    const answer = answers.find((a) => a.index === file.index);
    if (!answer) return file;
    if (typeof answer.contentBase64 === "string") {
      return { index: file.index, name: file.name, mime: file.mime, size: file.size, load: "ready", attachment: carriedAttachment(file, answer.contentBase64) };
    }
    return {
      index: file.index,
      name: file.name,
      mime: file.mime,
      size: file.size,
      load: "failed",
      failure: answer.failure ?? "failed",
      ...(answer.detail ? { detail: answer.detail } : {}),
    };
  });
}

/** The same failure for every file that was asked for — a call that could not
 *  be made at all (no connection, no sign-in, a renumbered mailbox). */
export function failAll(files: readonly CarriedFile[], asked: readonly number[], failure: CarriedFailure, detail?: string): CarriedFile[] {
  return files.map((file) =>
    asked.includes(file.index)
      ? { index: file.index, name: file.name, mime: file.mime, size: file.size, load: "failed", failure, ...(detail ? { detail } : {}) }
      : file
  );
}

// ---- What goes, what stays behind -------------------------------------------

/** The bytes a standard base64 string stands for (no line breaks in it). */
export function base64Size(contentBase64: string): number {
  const length = contentBase64.length;
  if (length === 0) return 0;
  const padding = contentBase64.endsWith("==") ? 2 : contentBase64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((length * 3) / 4) - padding);
}

export interface AttachmentLimits {
  /** The largest single file the sending mailbox takes; null = no bound of Plainva's. */
  perFile: number | null;
  /** How much a forward loads on its own, for the whole message. */
  carriedTotal: number;
}

/**
 * What the mailbox a message is SENT from takes.
 *
 * A Microsoft mailbox has a hard bound per file: Plainva attaches through
 * Graph, one file per request at most, and has no upload session for more
 * (`GRAPH_FILE_LIMIT`). It holds for every file on the draft, one attached by
 * hand included — that one used to fail after the composer had closed.
 *
 * Over IMAP/SMTP the provider sets the bound and only says so by refusing, so
 * Plainva sets none for a file a person chose. What a forward loads on its own
 * is bounded for every mailbox (`CARRIED_TOTAL_LIMIT`).
 */
export function attachmentLimits(account: MailAccountConfig | null | undefined): AttachmentLimits {
  return {
    perFile: account && mailAccountKind(account) === "microsoft" ? GRAPH_FILE_LIMIT : null,
    carriedTotal: CARRIED_TOTAL_LIMIT,
  };
}

/** Why a file stays behind although nothing went wrong with it. */
export type LeftReason = "tooLarge" | "overTotal" | "notAFile";

export interface CarriedRow {
  file: CarriedFile;
  /**
   * What the composer draws:
   *  - `loading`: wanted, bytes not here yet (asked for or about to be);
   *  - `ready`: here, goes with the message;
   *  - `failed`: wanted, did not come — asking again may bring it;
   *  - `left`: stays behind by rule (`why`), whatever its bytes are doing.
   */
  state: "loading" | "ready" | "failed" | "left";
  why?: LeftReason;
}

export interface FilePlan {
  rows: CarriedRow[];
  /** Files whose bytes should be asked for now. */
  wanted: number[];
  /** For each other file on the draft (arrived with it, attached by hand), in
   *  order: whether the sending mailbox takes it. */
  others: boolean[];
}

/** The size the rule reckons with: the real one once the bytes are here, the
 *  listed one until then (a backend may list a little more than the file is). */
function sizeOf(file: CarriedFile): number {
  return file.attachment ? base64Size(file.attachment.contentBase64) : file.size;
}

/**
 * The verdict for every file on the draft.
 *
 * The files of the original are taken in the reader's order: each goes when
 * the sending mailbox takes a file of its size and it still fits into what a
 * forward loads on its own; otherwise it stays behind, and the next smaller
 * one may still go. A file that stays behind is not asked for — and when the
 * sender changes and it fits after all, it is.
 *
 * The other files are a person's own: only the mailbox's bound per file
 * applies to them, never Plainva's.
 */
export function planFiles(carried: readonly CarriedFile[], others: readonly MailAttachment[], limits: AttachmentLimits): FilePlan {
  const rows: CarriedRow[] = [];
  const wanted: number[] = [];
  let used = 0;
  for (const file of carried) {
    if (file.failure === "notAFile") {
      rows.push({ file, state: "left", why: "notAFile" });
      continue;
    }
    const size = sizeOf(file);
    if (limits.perFile !== null && size > limits.perFile) {
      rows.push({ file, state: "left", why: "tooLarge" });
      continue;
    }
    if (used + size > limits.carriedTotal) {
      rows.push({ file, state: "left", why: "overTotal" });
      continue;
    }
    used += size;
    if (file.load === "ready") rows.push({ file, state: "ready" });
    else if (file.load === "failed") rows.push({ file, state: "failed" });
    else {
      rows.push({ file, state: "loading" });
      if (file.load === "idle") wanted.push(file.index);
    }
  }
  return {
    rows,
    wanted,
    others: others.map((file) => limits.perFile === null || base64Size(file.contentBase64) <= limits.perFile),
  };
}

/** The files of the original that go out with the message, as attachments. */
export function carriedToSend(plan: FilePlan): MailAttachment[] {
  return plan.rows.flatMap((row) => (row.state === "ready" && row.file.attachment ? [row.file.attachment] : []));
}

/** A file that would not go out, for the question asked before sending. */
export interface LeftBehind {
  name: string;
  size: number;
  /** `failed`: it did not come. Otherwise the rule that keeps it back. */
  why: LeftReason | "failed";
}

/**
 * Everything on the draft that a send would leave behind — the files of the
 * original that stay or did not come, and any other file the sending mailbox
 * does not take. Empty means the message goes out as it is shown.
 */
export function leftBehind(plan: FilePlan, others: readonly MailAttachment[]): LeftBehind[] {
  const left: LeftBehind[] = [];
  for (const row of plan.rows) {
    if (row.state === "left") left.push({ name: row.file.name, size: sizeOf(row.file), why: row.why ?? "tooLarge" });
    else if (row.state === "failed") left.push({ name: row.file.name, size: row.file.size, why: "failed" });
  }
  others.forEach((file, i) => {
    if (plan.others[i] === false) left.push({ name: file.name, size: base64Size(file.contentBase64), why: "tooLarge" });
  });
  return left;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The files a send would leave behind, as the one sentence part both shells put
 * into their question: each name with its reason. The shells own the dialog,
 * the words are the same.
 */
export function leftBehindText(left: readonly LeftBehind[], t: Translate): string {
  return left.map((file) => `${file.name} (${t(`mail.fileLeft.${file.why}`)})`).join("; ");
}

/**
 * Why the first file that did not come did not come, as a sentence for the
 * line under the files — or null when every file is here or on its way.
 * A failure with words of its own (the server's) keeps them.
 */
export function carriedFailureText(rows: readonly CarriedRow[], t: Translate): string | null {
  const failed = rows.find((row) => row.state === "failed");
  if (!failed) return null;
  const failure = failed.file.failure ?? "failed";
  const sentence = t(`mail.fileFailure.${failure}`);
  return failure === "failed" && failed.file.detail ? `${sentence} (${failed.file.detail})` : sentence;
}

/**
 * What stands beside a file's name in a composer: its size, and what is with
 * it. One writer for both shells, and the same reason in the same words as the
 * question before sending gives for it — a file that only stays behind because
 * the forward's own bound is reached is not "too large", and saying so next to
 * a file of the same size that goes would be read as a fault.
 */
export function carriedRowNote(row: CarriedRow, t: Translate, locale?: string): string {
  const size = formatAttachmentSize(row.file.size, locale);
  if (row.state === "loading") return `${size} · ${t("mail.fileState.loading")}`;
  if (row.state === "failed") return t("mail.fileState.failed");
  if (row.state === "left") {
    if (row.why === "notAFile") return t("mail.fileState.notAFile");
    return `${size} · ${t(row.why === "overTotal" ? "mail.fileState.overTotal" : "mail.fileState.tooLarge")}`;
  }
  return size;
}

/**
 * The bounds files were held against, as the line under the files says them
 * once something stays behind for its size — or null when nothing does. The
 * per-file bound of the mailbox comes first: it is the one a person can do
 * something about by choosing another sender. Both are said when both apply:
 * each file's own note names its reason, and each reason has its number here.
 */
export function carriedLimitText(
  rows: readonly CarriedRow[],
  othersGo: readonly boolean[],
  limits: AttachmentLimits,
  t: Translate,
  locale?: string
): string | null {
  const said: string[] = [];
  if (limits.perFile !== null && (rows.some((row) => row.why === "tooLarge") || othersGo.includes(false))) {
    said.push(t("mail.fileLimitMailbox", { size: formatAttachmentSize(limits.perFile, locale) }));
  }
  if (rows.some((row) => row.why === "overTotal")) {
    said.push(t("mail.fileLimitOwn", { size: formatAttachmentSize(limits.carriedTotal, locale) }));
  }
  return said.length > 0 ? said.join(" ") : null;
}

/**
 * A file's size the way the mail surfaces write it: whole bytes and kilobytes,
 * megabytes to one decimal in the reader's own number format. One writer, so
 * the reader, the composer and the bound a file is held against read alike.
 */
export function formatAttachmentSize(bytes: number, locale?: string): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const megabytes = bytes / (1024 * 1024);
  let text: string;
  try {
    text = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(megabytes);
  } catch {
    text = String(Math.round(megabytes * 10) / 10);
  }
  return `${text} MB`;
}
