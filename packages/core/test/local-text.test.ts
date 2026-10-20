import { describe, expect, it } from "vitest";
import { isHashWithoutMark, isMarkerTakenWithoutMark, readLocalText } from "../src/vault/localText.js";
import { VaultFileNotFoundError } from "../src/vault/IVaultAdapter.js";
import { utf8TextOf } from "../src/textFileShape.js";

/**
 * How the index, the sync and the conflict detection read a file of this
 * device. The platforms disagree about a file whose bytes are not UTF-8 — one
 * kind of reader replaces such bytes, the other refuses the file — and the
 * answer here must be the same for both: the hash of the BYTES, and whether
 * the text IS the file.
 */

const REPLACEMENT = String.fromCharCode(0xfffd);
// The byte order mark is built at run time, never typed into this file.
const MARK = String.fromCharCode(0xfeff);

const sha256 = async (bytes: Uint8Array) => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};
const utf8 = (text: string) => new TextEncoder().encode(text);
const windows1252 = (text: string) => new Uint8Array([...text].map((char) => char.charCodeAt(0)));

/** One file, read by one of the two kinds of platform reader; counts what was asked. */
function disk(bytes: Uint8Array | null, reader: "replaces" | "refuses") {
  const asked = { text: 0, bytes: 0 };
  return {
    asked,
    async readTextFile(path: string) {
      asked.text++;
      if (!bytes) throw new VaultFileNotFoundError(path);
      if (reader === "replaces") return new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
      try {
        return new TextDecoder("utf-8", { ignoreBOM: true, fatal: true }).decode(bytes);
      } catch {
        throw new Error("cannot read text file: stream did not contain valid UTF-8");
      }
    },
    async readBinaryFile(path: string) {
      asked.bytes++;
      if (!bytes) throw new VaultFileNotFoundError(path);
      return bytes;
    },
  };
}

for (const reader of ["replaces", "refuses"] as const) {
  describe(`reading a local file — a text reader that ${reader} what is not UTF-8`, () => {
    it("takes a UTF-8 file from the text read alone: its text, the hash of its bytes", async () => {
      const bytes = utf8("# Grüße\r\n\r\neins\r\n");
      const file = disk(bytes, reader);
      expect(await readLocalText(file, "Note.md")).toEqual({ sha256: await sha256(bytes), text: "# Grüße\r\n\r\neins\r\n", exact: true });
      expect(file.asked).toEqual({ text: 1, bytes: 0 });
    });

    it("keeps the byte order mark in text and hash", async () => {
      const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("id;name\r\n")]);
      const file = disk(bytes, reader);
      expect(await readLocalText(file, "Data.csv")).toEqual({ sha256: await sha256(bytes), text: `${MARK}id;name\r\n`, exact: true });
      expect(file.asked.bytes).toBe(0);
    });

    it("answers for a file in Windows-1252 from its bytes: their hash, and a reading that is not the file", async () => {
      const bytes = windows1252("id;name\r\n1;Grün\r\n");
      const file = disk(bytes, reader);
      const read = await readLocalText(file, "Data.csv");
      expect(read.exact).toBe(false);
      expect(read.sha256).toBe(await sha256(bytes));
      // Not the hash of what a decoder made of it — that is the hash of no file.
      expect(read.sha256).not.toBe(await sha256(utf8(read.text)));
      expect(read.text).toBe(`id;name\r\n1;Gr${REPLACEMENT}n\r\n`);
      expect(file.asked).toEqual({ text: 1, bytes: 1 });
    });

    it("answers for a file in UTF-16 the same way", async () => {
      const bytes = new Uint8Array([0xff, 0xfe, 0x47, 0x00, 0x72, 0x00, 0xfc, 0x00, 0x6e, 0x00]);
      const read = await readLocalText(disk(bytes, reader), "Liste.txt");
      expect(read.exact).toBe(false);
      expect(read.sha256).toBe(await sha256(bytes));
    });

    it("takes a replacement character that is IN a UTF-8 file for what it is: text", async () => {
      const bytes = utf8(`The character ${REPLACEMENT} marks a byte that could not be read.\n`);
      const file = disk(bytes, reader);
      expect(await readLocalText(file, "Note.md")).toEqual({
        sha256: await sha256(bytes), text: `The character ${REPLACEMENT} marks a byte that could not be read.\n`, exact: true,
      });
      // The one case that costs a second read of a UTF-8 file.
      expect(file.asked).toEqual({ text: 1, bytes: 1 });
    });

    it("leaves a missing file missing, without asking twice", async () => {
      const file = disk(null, reader);
      await expect(readLocalText(file, "Gone.md")).rejects.toBeInstanceOf(VaultFileNotFoundError);
      expect(file.asked).toEqual({ text: 1, bytes: 0 });
    });
  });
}

describe("whether bytes ARE a text", () => {
  const bytes = (...parts: Array<number[] | string>) => new Uint8Array(parts.flatMap((part) => typeof part === "string" ? [...utf8(part)] : part));

  it("gives the text for UTF-8, with its mark, and for the empty file", () => {
    expect(utf8TextOf(bytes("Grün\r\n"))).toBe("Grün\r\n");
    expect(utf8TextOf(bytes([0xef, 0xbb, 0xbf], "Grün"))).toBe(`${MARK}Grün`);
    expect(utf8TextOf(new Uint8Array())).toBe("");
    // A replacement character that is IN the file is text like any other.
    expect(utf8TextOf(bytes("a", [0xef, 0xbf, 0xbd], "b"))).toBe(`a${REPLACEMENT}b`);
  });

  it("gives null for anything a decoder could only replace", () => {
    // Windows-1252: "Grün" with FC for the umlaut.
    expect(utf8TextOf(bytes("Gr", [0xfc], "n"))).toBeNull();
    // UTF-16, little and big endian, with their marks.
    expect(utf8TextOf(bytes([0xff, 0xfe, 0x47, 0x00, 0x72, 0x00]))).toBeNull();
    expect(utf8TextOf(bytes([0xfe, 0xff, 0x00, 0x47, 0x00, 0x72]))).toBeNull();
    // A sequence cut off at the end of the file, and the first bytes of an image.
    expect(utf8TextOf(bytes("Gr", [0xc3]))).toBeNull();
    expect(utf8TextOf(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBeNull();
  });
});

describe("reading a local file that cannot be read at all", () => {
  it("fails with the byte read's reason when the text read was refused: a refusal says nothing about why", async () => {
    const file = {
      async readTextFile(): Promise<string> { throw new Error("cannot read text file: stream did not contain valid UTF-8"); },
      async readBinaryFile(): Promise<Uint8Array> { throw new Error("access denied"); },
    };
    await expect(readLocalText(file, "Locked.csv")).rejects.toThrow("access denied");
  });

  it("reports a file that vanished between the two reads as missing", async () => {
    const file = {
      async readTextFile(): Promise<string> { throw new Error("cannot read text file: stream did not contain valid UTF-8"); },
      async readBinaryFile(path: string): Promise<Uint8Array> { throw new VaultFileNotFoundError(path); },
    };
    await expect(readLocalText(file, "Gone.csv")).rejects.toBeInstanceOf(VaultFileNotFoundError);
  });

  it("fails with the byte read's reason when the text came back and could not be checked", async () => {
    const file = {
      async readTextFile(): Promise<string> { return `Gr${REPLACEMENT}n`; },
      async readBinaryFile(): Promise<Uint8Array> { throw new Error("device not ready"); },
    };
    await expect(readLocalText(file, "Data.csv")).rejects.toThrow("device not ready");
  });
});

describe("a marker a reader took without the file's byte order mark", () => {
  // Two readers handed a file out without its mark: the adapter for a folder
  // the user picked until 2026-10-09, the phone's container adapter on iOS
  // until 2026-10-20. What the index and the open of a note recorded there is
  // the hash of the text behind the mark; what a sync recorded, the hash of the
  // bytes.
  const body = "- [ ] first\r\n- [ ] second\r\n";

  it("is the hash of the text behind the mark, and of nothing else", async () => {
    const recorded = await sha256(utf8(body));
    expect(await isHashWithoutMark(MARK + body, recorded)).toBe(true);
    // A file without a mark has nothing a reader could have left out.
    expect(await isHashWithoutMark(body, recorded)).toBe(false);
    // The marker that is right is not this one, and neither is one of another text.
    expect(await isHashWithoutMark(MARK + body, await sha256(utf8(MARK + body)))).toBe(false);
    expect(await isHashWithoutMark(MARK + body.replace("first", "changed elsewhere"), recorded)).toBe(false);
    // Only one mark was ever left out.
    expect(await isHashWithoutMark(MARK + MARK + body, recorded)).toBe(false);
    expect(await isHashWithoutMark(MARK + body, null)).toBe(false);
    expect(await isHashWithoutMark(MARK + body, undefined)).toBe(false);
  });

  it("names the file that is there only where the base the sync recorded is that file, mark and all", async () => {
    const file = { text: MARK + body, sha256: await sha256(utf8(MARK + body)) };
    const withoutMark = await sha256(utf8(body));
    // The row such a reader left beside a pull: the marker without the mark, the base with it.
    expect(await isMarkerTakenWithoutMark(file, { local_sha256: withoutMark, base_sha256: file.sha256 })).toBe(true);
    // A mark another program added to a file that had none: the marker and the
    // base are both the hash of the text behind it. That is a change.
    expect(await isMarkerTakenWithoutMark(file, { local_sha256: withoutMark, base_sha256: withoutMark })).toBe(false);
    // No base yet (nothing synced): the two cannot be told apart, and the merge with the base on record decides.
    expect(await isMarkerTakenWithoutMark(file, { local_sha256: withoutMark, base_sha256: null })).toBe(false);
    // A marker that matches has nothing to explain; no row, no marker, nothing either.
    expect(await isMarkerTakenWithoutMark(file, { local_sha256: file.sha256, base_sha256: file.sha256 })).toBe(false);
    expect(await isMarkerTakenWithoutMark(file, { local_sha256: null, base_sha256: file.sha256 })).toBe(false);
    expect(await isMarkerTakenWithoutMark(file, null)).toBe(false);
  });
});
