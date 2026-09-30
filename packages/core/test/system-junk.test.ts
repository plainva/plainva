import { describe, expect, it } from "vitest";
import {
  hasAppleDoubleHeader,
  isAppleDoubleCompanion,
  isAppleDoubleName,
  isSystemJunkFile,
  isSystemJunkName,
  isSystemJunkPath,
} from "../src/vault/systemJunk.ts";
import { isInternalPath } from "../src/vault/VaultIndexer.ts";

/**
 * Issue #110 (E10): `.DS_Store` stood in the tree as an attachment and
 * travelled through sync. One list in the core decides what is operating-system
 * bookkeeping; AppleDouble sidecars are decided by their header, never by the
 * name alone.
 */

const APPLE_DOUBLE = new Uint8Array([0x00, 0x05, 0x16, 0x07, 0x00, 0x02, 0x00, 0x00]);
const MARKDOWN = new TextEncoder().encode("# My notes\n");

describe("isSystemJunkName", () => {
  it("knows the files and folders macOS and Windows leave behind", () => {
    for (const name of [".DS_Store", "Thumbs.db", "desktop.ini", "Icon\r", ".Spotlight-V100", ".Trashes", ".fseventsd"]) {
      expect(isSystemJunkName(name), JSON.stringify(name)).toBe(true);
    }
  });

  it("ignores case where the operating system does", () => {
    expect(isSystemJunkName(".ds_store")).toBe(true);
    expect(isSystemJunkName("THUMBS.DB")).toBe(true);
    expect(isSystemJunkName("Desktop.ini")).toBe(true);
  });

  it("leaves the user's own names alone", () => {
    for (const name of ["Icon", "Icon.png", "notes.DS_Store.md", "thumbs.db.md", "desktop", ".env-notes.md", "Trashes", "._notes.md"]) {
      expect(isSystemJunkName(name), JSON.stringify(name)).toBe(false);
    }
  });

  it("marks everything under a volume's system folders", () => {
    expect(isSystemJunkPath(".Spotlight-V100/Store-V2/x")).toBe(true);
    expect(isSystemJunkPath("Projekte/.DS_Store")).toBe(true);
    expect(isSystemJunkPath("Projekte\\Thumbs.db")).toBe(true);
    expect(isSystemJunkPath("Projekte/plan.md")).toBe(false);
  });

  it("is part of the internal-path rule the index and the walk share", () => {
    expect(isInternalPath("Projekte/.DS_Store")).toBe(true);
    expect(isInternalPath(".Trashes/501/x.md")).toBe(true);
    // AppleDouble is NOT a path decision: a note may be called `._notes.md`.
    expect(isInternalPath("Projekte/._plan.md")).toBe(false);
  });
});

describe("AppleDouble", () => {
  it("is decided by the magic number, not by the name", () => {
    expect(isAppleDoubleName("._Note.md")).toBe(true);
    expect(isAppleDoubleName("._")).toBe(false);
    expect(isAppleDoubleName("Note.md")).toBe(false);
    expect(hasAppleDoubleHeader(APPLE_DOUBLE)).toBe(true);
    expect(hasAppleDoubleHeader(MARKDOWN)).toBe(false);
    expect(hasAppleDoubleHeader(new Uint8Array([0x00, 0x05]))).toBe(false);
  });

  it("reads the header only for AppleDouble-shaped names", async () => {
    const reads: string[] = [];
    const bytes = new Map<string, Uint8Array>([
      ["notes/._x.md", APPLE_DOUBLE],
      ["notes/._notes.md", MARKDOWN],
    ]);
    const read = async (p: string) => { reads.push(p); return bytes.get(p) ?? new Uint8Array(); };
    expect(await isSystemJunkFile("notes/._x.md", read)).toBe(true);
    // A real user file that merely starts with `._` stays.
    expect(await isSystemJunkFile("notes/._notes.md", read)).toBe(false);
    expect(await isSystemJunkFile("notes/.DS_Store", read)).toBe(true);
    expect(await isSystemJunkFile("notes/plan.md", read)).toBe(false);
    expect(reads).toEqual(["notes/._x.md", "notes/._notes.md"]);
  });

  it("counts an unreadable file as the user's", async () => {
    expect(await isSystemJunkFile("._x.md", async () => { throw new Error("EACCES"); })).toBe(false);
  });

  it("falls back to the companion rule where the bytes cannot be read", () => {
    const listing = new Set(["notes/x.md", "notes/._x.md", "notes/._solo.md", "._top.md", "top.md"]);
    const has = (p: string) => listing.has(p);
    expect(isAppleDoubleCompanion("notes/._x.md", has)).toBe(true);
    expect(isAppleDoubleCompanion("._top.md", has)).toBe(true);
    // Without `solo.md` beside it, `._solo.md` is somebody's note.
    expect(isAppleDoubleCompanion("notes/._solo.md", has)).toBe(false);
    expect(isAppleDoubleCompanion("notes/x.md", has)).toBe(false);
  });
});
