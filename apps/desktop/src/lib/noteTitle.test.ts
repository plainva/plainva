import { describe, expect, it } from "vitest";
import { noteDisplayName, stripNoteExtension } from "@plainva/ui";

describe("stripNoteExtension", () => {
  it("strips .md and .base (case-insensitive)", () => {
    expect(stripNoteExtension("Hello.md")).toBe("Hello");
    expect(stripNoteExtension("Tasks.base")).toBe("Tasks");
    expect(stripNoteExtension("Tasks.BASE")).toBe("Tasks");
  });

  it("keeps unrelated extensions and inner dots", () => {
    expect(stripNoteExtension("image.png")).toBe("image.png");
    expect(stripNoteExtension("v1.2.md")).toBe("v1.2");
    expect(stripNoteExtension("no-extension")).toBe("no-extension");
  });

  it("leaves a frontmatter title (no extension) untouched", () => {
    expect(stripNoteExtension("My Note")).toBe("My Note");
  });
});

describe("noteDisplayName", () => {
  it("returns the basename without the note/base extension", () => {
    expect(noteDisplayName("notes/Hello.md")).toBe("Hello");
    expect(noteDisplayName("db/Tasks.base")).toBe("Tasks");
  });

  it("handles Windows backslash separators", () => {
    expect(noteDisplayName("notes\\sub\\Note.md")).toBe("Note");
  });

  it("keeps an attachment's extension", () => {
    expect(noteDisplayName("assets/pic.png")).toBe("pic.png");
  });

  it("is empty for an empty path (the caller supplies the fallback)", () => {
    expect(noteDisplayName("")).toBe("");
  });
});
