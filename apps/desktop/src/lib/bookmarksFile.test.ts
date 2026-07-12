import { describe, expect, it } from "vitest";
import { parseBookmarksFile, serializeBookmarksFile } from "@plainva/ui";

/** Shared .plainva/bookmarks.json contract (plan Mobile M3E 2026-07-12, A5). */
describe("bookmarksFile", () => {
  it("parses the canonical desktop object shape", () => {
    const raw = JSON.stringify({ items: [{ type: "file", path: "A.md" }, { type: "file", path: "B/C.md" }] });
    expect(parseBookmarksFile(raw)).toEqual({ paths: ["A.md", "B/C.md"], existed: true });
  });

  it("parses the legacy mobile bare-array shape", () => {
    expect(parseBookmarksFile('["A.md", "B.md"]')).toEqual({ paths: ["A.md", "B.md"], existed: true });
  });

  it("tolerates string items inside the object shape and drops junk entries", () => {
    const raw = JSON.stringify({ items: ["A.md", { path: "B.md" }, { type: "file" }, 7, null] });
    expect(parseBookmarksFile(raw).paths).toEqual(["A.md", "B.md"]);
  });

  it("drops non-string entries from the bare-array shape", () => {
    expect(parseBookmarksFile('["A.md", 5, {"path":"x"}]').paths).toEqual(["A.md"]);
  });

  it("reports foreign or broken JSON as not existed", () => {
    expect(parseBookmarksFile("not json")).toEqual({ paths: [], existed: false });
    expect(parseBookmarksFile('{"foo": 1}')).toEqual({ paths: [], existed: false });
    expect(parseBookmarksFile('{"items": "nope"}')).toEqual({ paths: [], existed: false });
  });

  it("serializes to the canonical object shape and round-trips", () => {
    const out = serializeBookmarksFile(["A.md", "B/C.md"]);
    expect(JSON.parse(out)).toEqual({ items: [{ type: "file", path: "A.md" }, { type: "file", path: "B/C.md" }] });
    expect(parseBookmarksFile(out)).toEqual({ paths: ["A.md", "B/C.md"], existed: true });
    // The legacy mobile shape round-trips into the canonical one.
    expect(parseBookmarksFile(serializeBookmarksFile(parseBookmarksFile('["A.md"]').paths)).paths).toEqual(["A.md"]);
  });
});
