import { describe, expect, it } from "vitest";
import { folderContents } from "./folderContents";

const t = (key: string, options?: Record<string, unknown>) => `${key}:${String(options?.count)}`;

// Finding X10 (review 2026-11-10): a folder holding two files said "0 notes".
describe("folderContents", () => {
  it("names the files of a folder without notes instead of 0 notes", () => {
    expect(folderContents(t, 0, 2)).toBe("mobile.attachmentCount:2");
  });
  it("names both when a folder holds both", () => {
    expect(folderContents(t, 6, 1)).toBe("mobile.folderCount:6 · mobile.attachmentCount:1");
  });
  it("stays the note count for a folder of notes, and for an empty one", () => {
    expect(folderContents(t, 3, 0)).toBe("mobile.folderCount:3");
    expect(folderContents(t, 0, 0)).toBe("mobile.folderCount:0");
  });
});
