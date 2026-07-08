import { describe, it, expect } from "vitest";
import { conflictOriginalPath, isConflictCopyPath } from "./conflictFiles";

describe("conflict copy path mapping (P3.11)", () => {
  it("maps a conflict copy back to its original", () => {
    expect(conflictOriginalPath("Notes/a.CONFLICT-2026-07-05T12-30-00-000Z.md")).toBe("Notes/a.md");
    expect(conflictOriginalPath("Tasks.CONFLICT-2026-07-05T12-30-00-000Z.base")).toBe("Tasks.base");
    expect(conflictOriginalPath("noext.CONFLICT-2026-07-05T12-30-00-000Z")).toBe("noext");
  });

  it("keeps dots in the base name intact", () => {
    expect(conflictOriginalPath("v1.2/notes.v2.CONFLICT-2026-01-01T00-00-00-000Z.md")).toBe("v1.2/notes.v2.md");
  });

  it("returns null for non-conflict paths", () => {
    expect(conflictOriginalPath("Notes/a.md")).toBeNull();
    expect(conflictOriginalPath("CONFLICT-notes.md")).toBeNull();
  });

  it("detects conflict copies", () => {
    expect(isConflictCopyPath("a.CONFLICT-2026-07-05T12-30-00-000Z.md")).toBe(true);
    expect(isConflictCopyPath("a.md")).toBe(false);
  });
});
