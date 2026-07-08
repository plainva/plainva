import { describe, it, expect } from "vitest";
import { isTextFile, mimeTypeForPath } from "../../src/sync/fileType.js";

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
