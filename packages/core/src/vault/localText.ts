import type { IVaultAdapter } from "./IVaultAdapter.js";
import { isTextFile } from "../sync/fileType.js";
import { textOfFileBytes, utf8TextOf } from "../textFileShape.js";

/** A file on this device as the index, the sync state and the conflict detection see it. */
export interface LocalText {
  /**
   * SHA-256 of the file's BYTES — the one hash `files.sha256`, the markers in
   * `sync_state` and the pushed content are compared by.
   */
  sha256: string;
  /**
   * The file's text where its bytes are UTF-8. Where they are not, a reading
   * with replacement characters: enough to search a note in another encoding,
   * never to be merged, kept as a merge base or written back.
   */
  text: string;
  /** Whether `text` IS the file: its bytes are UTF-8 (see `mergeableText`). */
  exact: boolean;
}

/** What a file of this device holds, read the cheap way first (`readLocalFile`). */
export interface LocalFile {
  /** As in `LocalText`: the file where `exact`, a reading of it where not. */
  text: string;
  exact: boolean;
  /**
   * The file's bytes, where they had to be read to tell — always there for a
   * file that is no text, so that whoever goes on with it byte for byte does
   * not read it a second time.
   */
  bytes: Uint8Array | null;
}

/**
 * What every refusal says. The message is the one thing that is left of an
 * error where it loses its class — the desktop's window bus hands a failed
 * write of another window on as its message —, so it is what a refusal is
 * recognised by there (`isNotTextFileError`).
 */
export const NOT_TEXT_FILE_MESSAGE = "The file is not text";

/**
 * A file's name says text and its bytes are not UTF-8: a `.csv` that Excel
 * saved in Windows-1252, a `.txt` in UTF-16, a note from an old tool.
 *
 * Thrown wherever the app would otherwise take a decoder's word for such a
 * file — by the read that hands a file's text to an editor, a table or a
 * writer of properties (`readExactText`), and by the app's adapter chain
 * before it writes a text over a file it cannot read as one. What an editor
 * would hold is a lossy reading; saved once, it is the file.
 */
export class NotTextFileError extends Error {
  readonly code = "NOT_TEXT_FILE";
  /**
   * The file's bytes, where the refusal had to read them — handed on to
   * whoever goes on with the file byte for byte (`readLocalFile` over a chain
   * that refused), so that a large file is not read a second and third time.
   * Not enumerable: an error gets logged, and a file has no place there.
   */
  declare readonly bytes?: Uint8Array;
  constructor(readonly path: string, bytes?: Uint8Array) {
    super(NOT_TEXT_FILE_MESSAGE);
    this.name = "NotTextFileError";
    if (bytes) Object.defineProperty(this, "bytes", { value: bytes, enumerable: false });
  }
}

/** Whether `error` is that refusal — by its class where it still has one, by its name, code or message where not. */
export function isNotTextFileError(error: unknown): boolean {
  const known = error as { name?: unknown; code?: unknown; message?: unknown } | null | undefined;
  return !!known && typeof known === "object"
    && (known.name === "NotTextFileError" || known.code === "NOT_TEXT_FILE" || known.message === NOT_TEXT_FILE_MESSAGE);
}

const REPLACEMENT_CHARACTER = String.fromCharCode(0xfffd);

const hex = (digest: ArrayBuffer): string =>
  Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");

const sha256OfBytes = async (bytes: Uint8Array): Promise<string> =>
  hex(await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource));

type Reader = Pick<IVaultAdapter, "readTextFile" | "readBinaryFile">;

/**
 * Reads a file of this device and says whether what came back IS the file.
 *
 * A text reader is taken at its word only where it can be: for a file whose
 * bytes are not UTF-8 the string it hands out is not the file, and what a
 * platform makes of it differs. One kind of reader replaces every such byte
 * (Node, Android, the phone's folder adapter, which decodes in JavaScript),
 * the other refuses the file (Rust, through which the desktop reads; iOS).
 *
 * The text read stays the first step — it is the cheap one, and for a UTF-8
 * file it is exact. Only where it failed, or came back with a replacement
 * character in it, are the bytes read, and then they alone decide. A missing
 * file stays a missing file.
 */
export async function readLocalFile(adapter: Reader, path: string): Promise<LocalFile> {
  const file = await readExact(adapter, path);
  return file.text !== null
    ? { text: file.text, exact: true, bytes: file.bytes }
    : { text: textOfFileBytes(file.bytes), exact: false, bytes: file.bytes };
}

/** The file's text where it is text, its bytes where it is not — read as `readLocalFile` says. */
async function readExact(adapter: Reader, path: string): Promise<{ text: string; bytes: Uint8Array | null } | { text: null; bytes: Uint8Array }> {
  let text: string | null = null;
  let carried: Uint8Array | undefined;
  try {
    text = await adapter.readTextFile(path);
  } catch (error) {
    const known = error as { name?: string; code?: string } | null;
    if (known?.name === "VaultFileNotFoundError" || known?.code === "FILE_NOT_FOUND") throw error;
    // A reader that refuses bytes that are not UTF-8: the bytes answer below.
    // Where the text read failed for another reason, the byte read says which
    // — its failure is the one the caller gets, a file that vanished between
    // the two reads included. A chain that refused the file read its bytes
    // for that, and hands them on.
    if (isNotTextFileError(error)) carried = (error as NotTextFileError).bytes;
  }
  if (typeof text === "string" && !text.includes(REPLACEMENT_CHARACTER)) return { text, bytes: null };
  const bytes = carried ?? await adapter.readBinaryFile(path);
  const exactText = utf8TextOf(bytes);
  return exactText !== null ? { text: exactText, bytes } : { text: null, bytes };
}

/**
 * Reads a file of this device for the two that look at every file and keep a
 * hash of it: the indexer and the conflict-aware adapter's markers. (The sync
 * worker reads the bytes outright — it looks at the files a cycle touches,
 * and what it decides must not hang on a text reader at all.)
 *
 * Both used to take `readTextFile` at its word and hash the string. So the
 * same `.csv` in Windows-1252 carried a hash that never matched its bytes
 * with the one kind of reader, and stopped the whole index scan with the
 * other (finding 2026-10-09). The hash here is the one of the bytes, whatever
 * the reader made of them (`readLocalFile`): for a UTF-8 file the hash of the
 * text IS that hash.
 */
export async function readLocalText(adapter: Reader, path: string): Promise<LocalText> {
  const file = await readLocalFile(adapter, path);
  return {
    sha256: await sha256OfBytes(file.bytes ?? new TextEncoder().encode(file.text)),
    text: file.text,
    exact: file.exact,
  };
}

/**
 * A file's text for whoever shows it, changes it or writes it back — or the
 * refusal, where its bytes are not UTF-8 (`NotTextFileError`).
 *
 * This is the read of the app: the adapter chain both shells hand out answers
 * `readTextFile` with it. The app used to take the text a reader handed out
 * (finding 2026-10-11). Where the reader replaces what is not UTF-8, an editor
 * opened a `.csv` in Windows-1252 with replacement characters, its first save
 * wrote that reading over the file, and a property set on such a note, a link
 * rewritten in it, a line appended to it did the same from wherever they
 * were. Where the reader refuses, each of those surfaces showed a raw error —
 * the desktop's editor the words "This file no longer exists" for a file that
 * lay there untouched.
 *
 * So nothing above this read holds a reading of a file that is not the file,
 * and there is nothing lossy to write back.
 */
export async function readExactText(adapter: Reader, path: string): Promise<string> {
  const file = await readExact(adapter, path);
  if (file.text === null) throw new NotTextFileError(path, file.bytes);
  return file.text;
}

/**
 * Puts a version of a file in its place — a restored snapshot, the copy of a
 * conflict that is taken, the copy of a file under a new name.
 *
 * A version that is text (its name says so AND its bytes are UTF-8, the one
 * question `mergeableText` asks) is written as text: that keeps the hash the
 * app's adapter chain remembers of what it wrote. Everything else goes byte
 * for byte, an image and a `.csv` in Windows-1252 just the same.
 *
 * Where the version is text and what lies at `path` is not — another program
 * saved the file in another encoding since —, the chain refuses the text
 * (`NotTextFileError`). Whoever calls this means to replace the file, so the
 * version then takes its place byte for byte.
 */
export async function writeFileVersion(
  adapter: Pick<IVaultAdapter, "writeTextFile" | "writeBinaryFile">,
  path: string,
  version: LocalFile,
): Promise<void> {
  if (version.exact && isTextFile(path)) {
    try {
      await adapter.writeTextFile(path, version.text);
      return;
    } catch (error) {
      if (!isNotTextFileError(error)) throw error;
    }
  }
  await adapter.writeBinaryFile(path, version.bytes ?? new TextEncoder().encode(version.text));
}

/** The bytes of a file's version as `writeFileVersion` takes it — read once, asked once. */
export function fileVersionOfBytes(bytes: Uint8Array): LocalFile {
  const text = utf8TextOf(bytes);
  return { text: text ?? "", exact: text !== null, bytes };
}

/**
 * SHA-256 of the bytes a file holds, or null where no file lies there — what
 * "the file is still the one that was compared" is asked by where the two
 * sides of a comparison are no text (`settleConflictCopy`).
 */
export async function fileSha256(adapter: Pick<IVaultAdapter, "exists" | "readBinaryFile">, path: string): Promise<string | null> {
  if (!await adapter.exists(path)) return null;
  return sha256OfBytes(await adapter.readBinaryFile(path));
}

/**
 * Lays down at `to` what `from` holds: its text where it is text — written as
 * text, so that an adapter that remembers what the app wrote remembers the
 * copy —, its bytes for everything else, a text-named file in another
 * encoding included.
 *
 * "Duplicate" went by the name alone in both shells (finding 2026-10-11): the
 * copy of a note in Windows-1252 was its decoded text where the reader
 * replaces, and no copy at all where it refuses.
 */
export async function copyFileContent(
  adapter: Reader & Pick<IVaultAdapter, "writeTextFile" | "writeBinaryFile">,
  from: string,
  to: string,
): Promise<void> {
  // A file that is no text by its name is not put through a text reader at all.
  await writeFileVersion(adapter, to, isTextFile(from) ? await readLocalFile(adapter, from) : { text: "", exact: false, bytes: await adapter.readBinaryFile(from) });
}
