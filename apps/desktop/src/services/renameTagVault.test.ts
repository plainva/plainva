import { describe, it, expect } from "vitest";
import { renameTagAcrossVault, normalizeRenameTarget } from "@plainva/ui";
import { renameTagInText, isValidTagName } from "@plainva/core";

function vault(seed: Record<string, string>, unreadable: string[] = []) {
  const files = new Map(Object.entries(seed));
  return {
    files,
    deps: {
      findNotesWithTag: async () => [...files.keys()],
      readTextFile: async (p: string) => {
        if (unreadable.includes(p)) throw new Error("locked");
        return files.get(p) ?? "";
      },
      writeTextFile: async (p: string, c: string) => { files.set(p, c); },
      rename: renameTagInText,
    },
  };
}

describe("renameTagAcrossVault", () => {
  it("rewrites frontmatter and inline occurrences", async () => {
    const v = vault({
      "a.md": "---\ntags: [work]\n---\n\nSee #work today.\n",
      "b.md": "Nothing here.\n",
    });
    const res = await renameTagAcrossVault(v.deps, "work", "job");
    expect(res.notes).toBe(1);
    expect(v.files.get("a.md")).toContain("job");
    expect(v.files.get("a.md")).not.toContain("#work");
    expect(v.files.get("b.md")).toBe("Nothing here.\n");
  });

  it("skips a note it cannot read and still renames the rest", async () => {
    const v = vault({ "a.md": "#work\n", "b.md": "#work\n" }, ["a.md"]);
    const res = await renameTagAcrossVault(v.deps, "work", "job");
    // Half a vault renamed beats none: aborting leaves the same split state
    // minus the work that did succeed.
    expect(res).toEqual({ notes: 1, failed: 1 });
    expect(v.files.get("b.md")).toContain("#job");
  });

  it("counts notes CHANGED, not notes examined", async () => {
    // The index can be a moment stale — a note that no longer carries the tag
    // must not inflate the number the user is told.
    const v = vault({ "a.md": "#work\n", "stale.md": "no tag anymore\n" });
    expect((await renameTagAcrossVault(v.deps, "work", "job")).notes).toBe(1);
  });
});

describe("normalizeRenameTarget", () => {
  it("accepts a name typed with a leading hash", () => {
    expect(normalizeRenameTarget("#job", "work", isValidTagName)).toBe("job");
  });
  it("refuses empty, unchanged and invalid names", () => {
    expect(normalizeRenameTarget("   ", "work", isValidTagName)).toBeNull();
    expect(normalizeRenameTarget("work", "work", isValidTagName)).toBeNull();
    expect(normalizeRenameTarget("has space", "work", isValidTagName)).toBeNull();
  });
});
