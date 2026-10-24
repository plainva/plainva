import { describe, it, expect } from "vitest";
import { isTextFile, mergeableText, mimeTypeForPath } from "../../src/sync/fileType.js";

describe("isTextFile", () => {
  it("treats known text/note extensions as text", () => {
    for (const p of ["note.md", "Sub/Folder/doc.markdown", "data.json", "list.csv", "board.canvas", "a.txt", "style.css"]) {
      expect(isTextFile(p)).toBe(true);
    }
  });

  it("treats binary and unknown/extensionless files as binary", () => {
    for (const p of ["image.png", "scan.PDF", "clip.mp4", "archive.zip", "font.woff2", "noext", "weird.xyz"]) {
      expect(isTextFile(p)).toBe(false);
    }
  });

  it("is case-insensitive on the extension", () => {
    expect(isTextFile("README.MD")).toBe(true);
    expect(isTextFile("Photo.JPG")).toBe(false);
  });
});

describe("mergeableText — the one answer to \"is this file text?\"", () => {
  const utf8 = (text: string) => new TextEncoder().encode(text);
  const windows1252 = (text: string) => new Uint8Array([...text].map((char) => char.charCodeAt(0)));

  it("is the file's text where the name says text and the bytes are UTF-8", () => {
    expect(mergeableText("Data.csv", utf8("id;name\r\n1;Grün\r\n"))).toBe("id;name\r\n1;Grün\r\n");
    expect(mergeableText("Note.md", utf8("# Grüße\n"))).toBe("# Grüße\n");
    expect(mergeableText("empty.txt", new Uint8Array())).toBe("");
  });

  it("keeps the byte order mark in that text", () => {
    const marked = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("a\r\n")]);
    expect(mergeableText("Settings.ini", marked)).toBe(`${String.fromCharCode(0xfeff)}a\r\n`);
  });

  it("is null where the name says text and the bytes do not", () => {
    // Windows-1252, as Excel saves a CSV file with German settings.
    expect(mergeableText("Data.csv", windows1252("id;name\r\n1;Grün\r\n"))).toBeNull();
    expect(mergeableText("Alt.md", windows1252("# Grüße\r\n"))).toBeNull();
    // UTF-16 with its mark, as some Windows tools write a text file.
    expect(mergeableText("Liste.txt", new Uint8Array([0xff, 0xfe, 0x47, 0x00, 0x72, 0x00, 0xfc, 0x00, 0x6e, 0x00]))).toBeNull();
  });

  it("is null where the name does not say text, whatever the bytes are", () => {
    expect(mergeableText("image.png", utf8("looks like text"))).toBeNull();
    expect(mergeableText("noext", utf8("plain"))).toBeNull();
  });
});

describe("mimeTypeForPath", () => {
  it("maps common extensions to their MIME type", () => {
    expect(mimeTypeForPath("assets/pic.png")).toBe("image/png");
    expect(mimeTypeForPath("Photo.JPG")).toBe("image/jpeg");
    expect(mimeTypeForPath("scan.PDF")).toBe("application/pdf");
    expect(mimeTypeForPath("note.md")).toBe("text/markdown");
  });

  it("falls back to application/octet-stream for unknown/extensionless files", () => {
    expect(mimeTypeForPath("blob.xyz")).toBe("application/octet-stream");
    expect(mimeTypeForPath("noext")).toBe("application/octet-stream");
  });
});
