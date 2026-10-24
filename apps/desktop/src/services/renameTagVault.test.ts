import { describe, it, expect } from "vitest";
import { renameTagAcrossVault, normalizeRenameTarget } from "@plainva/ui";
import { contentHasTag, renameTagInText, isValidTagName } from "@plainva/core";

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

  it("goes on past a note whose tag another value refers to, and counts it", async () => {
    // `other: *t` reads the same text as the tags: renamed in place it would change as well, and the writer
    // refuses that note. The search for the notes with the tag threw there, and nothing was renamed at all.
    const anchored = "---\ntags: &t work, home\nother: *t\n---\nx\n";
    const v = vault({ "a.md": anchored, "b.md": "---\ntags: work\n---\nx\n" });
    // The index's search (`findNotesWithTag`): every note whose text carries the tag.
    const deps = { ...v.deps, findNotesWithTag: async (tag: string) => [...v.files].filter(([, text]) => contentHasTag(text, tag)).map(([path]) => path) };
    expect(await renameTagAcrossVault(deps, "work", "job")).toEqual({ notes: 1, failed: 1 });
    expect(v.files.get("a.md")).toBe(anchored);
    expect(v.files.get("b.md")).toBe("---\ntags: job\n---\nx\n");
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
