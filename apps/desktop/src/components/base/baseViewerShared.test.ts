import { describe, it, expect } from "vitest";
import { capitalizeFirst, columnLabel } from "./baseViewerShared";

// t stub: returns the German default like i18next would when the key resolves
// to the inline fallback.
const t = ((_key: string, fallback?: string) => fallback ?? _key) as any;

describe("columnLabel", () => {
  it("maps the built-in file properties to human-readable labels", () => {
    expect(columnLabel("file.name", t)).toBe("Name");
    expect(columnLabel("file.mtime", t)).toBe("Geändert");
    expect(columnLabel("file.size", t)).toBe("Größe");
    expect(columnLabel("file.path", t)).toBe("Pfad");
  });

  it("strips the file. prefix from unmapped file properties", () => {
    expect(columnLabel("file.something", t)).toBe("something");
  });

  it("title-cases the first letter of a bare frontmatter key (report 2026-07-07)", () => {
    expect(columnLabel("status", t)).toBe("Status");
    expect(columnLabel("note.status", t)).toBe("Status");
    expect(columnLabel("bereich", t)).toBe("Bereich");
    expect(columnLabel("über", t)).toBe("Über"); // non-ASCII first letter
  });

  it("honors an Obsidian displayName verbatim — never re-capitalized", () => {
    const dbConfig = { _obsidian: { properties: { "note.status": { displayName: "myStatus" } } } };
    expect(columnLabel("status", t, dbConfig)).toBe("myStatus");
    expect(columnLabel("note.status", t, dbConfig)).toBe("myStatus");
  });

  it("falls back to the title-cased key for empty or non-string displayName values", () => {
    expect(columnLabel("a", t, { _obsidian: { properties: { "note.a": { displayName: "  " } } } })).toBe("A");
    expect(columnLabel("b", t, { _obsidian: { properties: { "note.b": { displayName: 5 } } } })).toBe("B");
  });
});

describe("capitalizeFirst", () => {
  it("uppercases the first code point and leaves the rest untouched", () => {
    expect(capitalizeFirst("bereich")).toBe("Bereich");
    expect(capitalizeFirst("über")).toBe("Über");
    expect(capitalizeFirst("eMail")).toBe("EMail");
  });

  it("is a no-op for empty strings and scripts without case", () => {
    expect(capitalizeFirst("")).toBe("");
    expect(capitalizeFirst("プロジェクト")).toBe("プロジェクト");
  });
});
