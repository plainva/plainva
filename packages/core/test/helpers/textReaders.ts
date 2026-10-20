import { LocalVaultAdapter } from "../../src/vault/LocalVaultAdapter.js";

/**
 * The two kinds of text reader the platforms have, for a file whose bytes are
 * not UTF-8, and the bytes such a file is made of.
 *
 * One kind replaces every byte that is not UTF-8 by the replacement character:
 * Node (`LocalVaultAdapter` as it is) and both phone adapters, which decode in
 * JavaScript. The other refuses the file: Rust's `read_to_string`, through
 * which the desktop reads (and the iPhone's own reader, which the app's
 * storage asked until 2026-10-20). The core must not depend on which one it is
 * given, so a test of such a file runs with both.
 */
export type Reader = "replaces" | "refuses";

/** The desktop's reader: Rust's `read_to_string` gives no text for bytes that are not UTF-8. */
export class RefusingVaultAdapter extends LocalVaultAdapter {
  override async readTextFile(vaultPath: string): Promise<string> {
    const bytes = await this.readBinaryFile(vaultPath);
    try {
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      throw new Error("cannot read text file: stream did not contain valid UTF-8");
    }
  }
}

/** A vault folder read with the given kind of text reader. */
export const vaultWith = (reader: Reader, root: string): LocalVaultAdapter =>
  reader === "refuses" ? new RefusingVaultAdapter(root) : new LocalVaultAdapter(root);

export const utf8 = (text: string): number[] => [...new TextEncoder().encode(text)];
/** Windows-1252, for the characters used in these tests (they sit where Latin-1 has them). */
export const windows1252 = (text: string): number[] => [...text].map((char) => char.charCodeAt(0));
/** UTF-16 little endian with its byte order mark — what Windows tools call "Unicode". */
export const utf16 = (text: string): number[] => [0xff, 0xfe, ...[...text].flatMap((char) => [char.charCodeAt(0) & 0xff, char.charCodeAt(0) >> 8])];
/** What a UTF-8 decoder makes of bytes that are not UTF-8 — the text an editor would have held. */
export const lossyText = (bytes: number[]): string => new TextDecoder("utf-8", { ignoreBOM: true }).decode(new Uint8Array(bytes));
/** …and that text written back as a file. */
export const lossy = (bytes: number[]): number[] => utf8(lossyText(bytes));
export const REPLACEMENT_BYTES = [0xef, 0xbf, 0xbd];
export const contains = (bytes: number[], part: number[]): boolean => bytes.some((_, at) => part.every((byte, i) => bytes[at + i] === byte));

export const sha256 = async (bytes: number[]): Promise<string> => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

/** Text-named files whose content is not UTF-8: what Excel saves with German settings, what Windows tools call "Unicode", a note from an old program. */
export const FILES_IN_ANOTHER_ENCODING = [
  {
    what: "a .csv in Windows-1252",
    path: "Data.csv",
    first: windows1252("id;name\r\n1;Grün\r\n2;Blau\r\n3;Rot\r\n"),
    other: windows1252("id;name\r\n1;Grün\r\n2;Blau\r\n3;Rot\r\n4;Weiß\r\n"),
    asUtf8: utf8("id;name\r\n1;Grün\r\n2;Blau\r\n3;Rot\r\n"),
  },
  {
    what: "a .txt in UTF-16",
    path: "Liste.txt",
    first: utf16("Grün\r\nBlau\r\nRot\r\n"),
    other: utf16("Grün\r\nBlau\r\nRot\r\nWeiß\r\n"),
    asUtf8: utf8("Grün\r\nBlau\r\nRot\r\n"),
  },
  {
    what: "a note in Windows-1252",
    path: "Alt.md",
    first: windows1252("---\nstatus: offen\n---\n# Grüße\r\n\r\neins\r\nzwei\r\n"),
    other: windows1252("---\nstatus: offen\n---\n# Grüße\r\n\r\neins\r\nzwei\r\ndrei für später\r\n"),
    asUtf8: utf8("---\nstatus: offen\n---\n# Grüße\r\n\r\neins\r\nzwei\r\n"),
  },
] as const;
