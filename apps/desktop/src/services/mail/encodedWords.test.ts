import { describe, expect, it } from "vitest";
import { decodeWords, readHead } from "@plainva/ui/mail";

/**
 * Encoded words (RFC 2047) read as one text, as section 6.2 asks and as the
 * desktop's parser did before C7 (Fehlerliste 0.9.0, review of 2026-11-16).
 * Both shells read a subject and a sender name with `decodeWords`: the phone
 * from the wire, the desktop from the head lines the Rust client hands on.
 */

const head = (lines: string) => Buffer.from(lines, "latin1").toString("base64");

const SUBJECTS: Array<[string, string, string]> = [
  ["two neighbouring words", "=?ISO-8859-1?Q?a?= =?ISO-8859-1?Q?b?=", "ab"],
  ["a long UTF-8 subject folded between two words", "=?UTF-8?B?R3LDvMOfZSBhdXMgZGVyIEZpcm1h?=\r\n =?UTF-8?B?IE3DvGxsZXI=?=", "Grüße aus der Firma Müller"],
  ["a character split between two words", "=?utf-8?q?caf=C3?= =?UTF-8?q?=A9?=", "café"],
  ["a Japanese subject in two ISO-2022-JP words", "=?ISO-2022-JP?B?GyRCJUYlOSVIGyhC?=\r\n =?ISO-2022-JP?B?GyRCJWEhPCVrGyhC?=", "テストメール"],
];

describe("encoded words in a header", () => {
  for (const [name, written, read] of SUBJECTS) {
    it(`read as one text: ${name}`, () => {
      expect(readHead(head(`Subject: ${written}\r\n`), ["subject"]).subject).toBe(read);
    });
  }

  it("keeps the space between an encoded word and plain text, and between plain words", () => {
    expect(decodeWords("Re: =?utf-8?q?Gr=C3=BC=C3=9Fe?= aus Berlin")).toBe("Re: Grüße aus Berlin");
    expect(decodeWords("plain words only")).toBe("plain words only");
  });

  it("does not join words of two charsets as bytes", () => {
    expect(decodeWords("=?utf-8?q?caf=C3=A9?= =?iso-8859-1?q?_d=E9j=E0?=")).toBe("café déjà");
  });

  it("reads a sender name split into words as one name", () => {
    const from = readHead(head("From: =?utf-8?q?J=C3=BCrgen?=\r\n =?utf-8?q?_M=C3=BCller?= <j@example.test>\r\n"), ["from"]).from;
    expect(from).toBe("Jürgen Müller <j@example.test>");
  });
});
