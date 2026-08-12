import { describe, expect, it } from "vitest";
import { importAttachment } from "@plainva/ui";

/**
 * The rule both shells now share (issue #56): where an outside file lands, and
 * how it is referenced. It used to live in the desktop editor alone, which is
 * why the phone renamed every file `Image-<stamp>` and wrote `![[Report.pdf]]`
 * — an embed that draws a broken image for a document.
 */

function io(existing: string[] = []) {
  const written: { path: string; size: number }[] = [];
  const dirs: string[] = [];
  return {
    written,
    dirs,
    exists: async (p: string) => existing.includes(p),
    createDir: async (p: string) => { dirs.push(p); },
    writeBinaryFile: async (p: string, bytes: Uint8Array) => { written.push({ path: p, size: bytes.length }); },
  };
}

const bytes = new Uint8Array([1, 2, 3]);

describe("importing an outside file", () => {
  it("links a document and embeds an image", async () => {
    const doc = await importAttachment(
      { name: "Report.pdf", mime: "application/pdf", bytes },
      { configuredFolder: "Attachments", noteFolder: "Projects" },
      io(),
    );
    expect(doc).toEqual({ path: "Attachments/Report.pdf", insert: "[[Attachments/Report.pdf]]" });

    const img = await importAttachment(
      { name: "Shot.png", mime: "image/png", bytes },
      { configuredFolder: "Attachments", noteFolder: "Projects" },
      io(),
    );
    expect(img.insert).toBe("![[Attachments/Shot.png]]");
  });

  it("recognises an image by its extension when no MIME type is known", async () => {
    // A file dialog hands over a PATH, not a File — there is no MIME type to
    // read, and only the extension says what it is.
    const picked = await importAttachment(
      { name: "Diagram.png", mime: "", bytes },
      { configuredFolder: "Attachments", noteFolder: "" },
      io(),
    );
    expect(picked.insert).toBe("![[Attachments/Diagram.png]]");
  });

  it("falls back to the note's folder when the setting is empty", async () => {
    // The documented meaning of an empty setting: beside the note. The phone
    // used to pass no note folder at all, so attachments landed in the root.
    const r = await importAttachment(
      { name: "Notes.txt", mime: "text/plain", bytes },
      { configuredFolder: "", noteFolder: "Projects/2026" },
      io(),
    );
    expect(r.path).toBe("Projects/2026/Notes.txt");
  });

  it("numbers a collision instead of overwriting", async () => {
    const r = await importAttachment(
      { name: "Report.pdf", mime: "application/pdf", bytes },
      { configuredFolder: "Attachments", noteFolder: "" },
      io(["Attachments/Report.pdf"]),
    );
    expect(r.path).toBe("Attachments/Report-2.pdf");
  });

  it("names a clipboard bitmap that arrives without one", async () => {
    const r = await importAttachment(
      { name: "", mime: "image/png", bytes },
      { configuredFolder: "Attachments", noteFolder: "" },
      io(),
    );
    expect(r.path).toMatch(/^Attachments\/Pasted-\d{8}-\d{6}\.png$/);
    expect(r.insert.startsWith("![[")).toBe(true);
  });

  it("creates the folder and writes the bytes exactly once", async () => {
    const fs = io();
    await importAttachment(
      { name: "Report.pdf", mime: "application/pdf", bytes },
      { configuredFolder: "Attachments", noteFolder: "" },
      fs,
    );
    expect(fs.dirs).toEqual(["Attachments"]);
    expect(fs.written).toEqual([{ path: "Attachments/Report.pdf", size: 3 }]);
  });
});
