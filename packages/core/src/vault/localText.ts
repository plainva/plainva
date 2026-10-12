import type { IVaultAdapter } from "./IVaultAdapter.js";
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

const REPLACEMENT_CHARACTER = String.fromCharCode(0xfffd);

const hex = (digest: ArrayBuffer): string =>
  Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");

const sha256OfBytes = async (bytes: Uint8Array): Promise<string> =>
  hex(await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource));

/**
 * Reads a file of this device for the two that look at every file and keep a
 * hash of it: the indexer and the conflict-aware adapter's markers. (The sync
 * worker reads the bytes outright — it looks at the files a cycle touches,
 * and what it decides must not hang on a text reader at all.)
 *
 * Both used to take `readTextFile` at its word and hash the string. For a
 * file whose bytes are not UTF-8 that string is not the file, and what a
 * platform makes of it differs: one kind of reader replaces every such byte
 * (Node, and the phone's folder adapter, which decodes in JavaScript), the
 * other refuses the file (Rust, through which the desktop reads). So the same
 * `.csv` in Windows-1252 carried a hash that never matched its bytes with the
 * one, and stopped the whole index scan with the other (finding 2026-10-09).
 *
 * The text read stays the first step — it is the cheap one, and for a UTF-8
 * file it is exact: the hash of that text IS the hash of the bytes. Only where
 * it failed, or came back with a replacement character in it, are the bytes
 * read, and then they alone decide. A missing file stays a missing file.
 */
export async function readLocalText(
  adapter: Pick<IVaultAdapter, "readTextFile" | "readBinaryFile">,
  path: string,
): Promise<LocalText> {
  let text: string | null = null;
  try {
    text = await adapter.readTextFile(path);
  } catch (error) {
    const known = error as { name?: string; code?: string } | null;
    if (known?.name === "VaultFileNotFoundError" || known?.code === "FILE_NOT_FOUND") throw error;
    // A reader that refuses bytes that are not UTF-8: the bytes answer below.
    // Where the text read failed for another reason, the byte read says which
    // — its failure is the one the caller gets, a file that vanished between
    // the two reads included.
  }
  if (typeof text === "string" && !text.includes(REPLACEMENT_CHARACTER)) {
    return { sha256: await sha256OfBytes(new TextEncoder().encode(text)), text, exact: true };
  }
  const bytes = await adapter.readBinaryFile(path);
  const exactText = utf8TextOf(bytes);
  return { sha256: await sha256OfBytes(bytes), text: exactText ?? textOfFileBytes(bytes), exact: exactText !== null };
}
