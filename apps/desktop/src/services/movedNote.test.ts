// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import type { MissingFileDeps } from "@plainva/core";
import { adoptExternalMove, healMissingNote, movedChoiceBodyKey, movedFolderLabel, planMissingNote } from "@plainva/ui";

/**
 * Issue 110 (E9), the part both shells share around the core's decision: the
 * folder the message names, the sentence under "Moved?", what an open note
 * does with the answer, what follows a proven move, and one search per note
 * at a time. The decision itself is covered against real SQLite in the core
 * (missing-file.test.ts).
 */

const STAMP = 1_727_000_000_000;

/** A note moved from "a/n.md" to "b/n.md": one candidate, same hash, same time. */
function movedDeps() {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const deps = {
    exists: vi.fn(async (p: string) => p === "b/n.md"),
    db: {
      queryOne: vi.fn(async () => ({ sha256: "hash-n", mtime_local: STAMP })),
      query: vi.fn(async () => [{ path: "b/n.md", mtime_local: STAMP }]),
    },
    indexer: {
      reconcileFolder: vi.fn(async () => { await gate; }),
      indexVaultFull: vi.fn(async () => undefined),
    },
  };
  return { deps: deps as unknown as MissingFileDeps & typeof deps, release };
}

describe("movedFolderLabel", () => {
  it("names the folder with a trailing slash", () => {
    expect(movedFolderLabel("4 blog/taken/link-50.md", "md-handbook")).toBe("4 blog/taken/");
  });

  it("names the vault for its top level instead of a bare slash", () => {
    expect(movedFolderLabel("link-50.md", "md-handbook")).toBe("md-handbook/");
  });

  it("reads Windows separators the same way", () => {
    expect(movedFolderLabel("4 blog\\taken\\link-50.md", "md-handbook")).toBe("4 blog/taken/");
  });
});

describe("movedChoiceBodyKey", () => {
  it("asks about the one file it found, and picks among several", () => {
    expect(movedChoiceBodyKey(1)).toBe("editor.movedFileAskOneBody");
    expect(movedChoiceBodyKey(2)).toBe("editor.movedFileAskBody");
    expect(movedChoiceBodyKey(5)).toBe("editor.movedFileAskBody");
  });
});

describe("planMissingNote", () => {
  it("follows a proven move, carrying unsaved text to the new place first", () => {
    expect(planMissingNote({ kind: "moved", to: "b/n.md" }, false)).toEqual({ kind: "follow", to: "b/n.md", carry: false });
    expect(planMissingNote({ kind: "moved", to: "b/n.md" }, true)).toEqual({ kind: "follow", to: "b/n.md", carry: true });
  });

  it("keeps unsaved text on screen when it cannot be sure, and never writes it back by itself", () => {
    expect(planMissingNote({ kind: "ambiguous", candidates: ["x.md"] }, true)).toEqual({ kind: "ask", candidates: ["x.md"], keepText: true });
    expect(planMissingNote({ kind: "gone" }, true)).toEqual({ kind: "missing", keepText: true });
    expect(planMissingNote({ kind: "gone" }, false)).toEqual({ kind: "missing", keepText: false });
    expect(planMissingNote({ kind: "present" }, true)).toEqual({ kind: "stay" });
  });
});

describe("adoptExternalMove", () => {
  it("carries bookmarks, pinboard places and the note's remarks — and no links", async () => {
    const files: Record<string, string> = {
      "Pinnwand.base": [
        "views:",
        "  - type: table",
        "    name: Pinnwand",
        "    plainva:",
        "      render: pinboard",
        "      pinboardOrder:",
        '        - "4 blog/link-50.md"',
        '        - "4 blog/other.md"',
        "",
      ].join("\n"),
      "Index.md": "See [[4 blog/link-50]].\n",
    };
    const retargetBookmarks = vi.fn(async () => undefined);
    const reindex = vi.fn(async () => undefined);
    const ops: unknown[] = [];
    const onOps = (e: Event) => ops.push(...((e as CustomEvent).detail?.ops ?? []));
    window.addEventListener("plainva-file-ops", onOps);
    try {
      await adoptExternalMove({
        retargetBookmarks,
        pinboard: {
          adapter: {
            readTextFile: async (p: string) => { if (!(p in files)) throw new Error("not found"); return files[p]; },
            writeTextFile: async (p: string, c: string) => { files[p] = c; },
          },
          queryService: { listBaseFilePaths: async () => ["Pinnwand.base"] },
        },
        reindex,
      }, "4 blog/link-50.md", "4 blog/taken/link-50.md");
    } finally {
      window.removeEventListener("plainva-file-ops", onOps);
    }
    expect(retargetBookmarks).toHaveBeenCalledWith("4 blog/link-50.md", "4 blog/taken/link-50.md");
    expect(files["Pinnwand.base"]).toContain("4 blog/taken/link-50.md");
    expect(files["Pinnwand.base"]).not.toContain('"4 blog/link-50.md"');
    expect(reindex).toHaveBeenCalledWith(["Pinnwand.base"]);
    expect(ops).toEqual([{ type: "move", from: "4 blog/link-50.md", to: "4 blog/taken/link-50.md" }]);
    // A move made elsewhere changes no other note's text.
    expect(files["Index.md"]).toBe("See [[4 blog/link-50]].\n");
  });

  it("still reports the move when the bookmark store cannot be written", async () => {
    const ops: unknown[] = [];
    const onOps = (e: Event) => ops.push(...((e as CustomEvent).detail?.ops ?? []));
    window.addEventListener("plainva-file-ops", onOps);
    try {
      await adoptExternalMove({
        retargetBookmarks: async () => { throw new Error("disk full"); },
        pinboard: { adapter: { readTextFile: async () => "", writeTextFile: async () => undefined }, queryService: null },
      }, "a.md", "b/a.md");
    } finally {
      window.removeEventListener("plainva-file-ops", onOps);
    }
    expect(ops).toEqual([{ type: "move", from: "a.md", to: "b/a.md" }]);
  });
});

describe("healMissingNote", () => {
  it("runs one search for a note that two panes ask about at once, and adopts a proven move once", async () => {
    const { deps, release } = movedDeps();
    const adopted = vi.fn(async () => undefined);
    const first = healMissingNote("a/n.md", deps, "vault-1", { onProvenMove: adopted });
    const second = healMissingNote("a/n.md", deps, "vault-1", { onProvenMove: adopted });
    expect(second).toBe(first);
    release();
    const search = await first;
    expect(search.first).toEqual({ kind: "moved", to: "b/n.md" });
    // Certain at once: no vault-wide pass in front of the answer or behind it.
    expect(search.settled).toBeNull();
    expect(deps.indexer.reconcileFolder).toHaveBeenCalledTimes(1);
    expect(deps.indexer.indexVaultFull).not.toHaveBeenCalled();
    expect(adopted).toHaveBeenCalledTimes(1);
    expect(adopted).toHaveBeenCalledWith("a/n.md", "b/n.md");
  });

  it("keeps two vaults apart, and looks again once the first search ended", async () => {
    const { deps, release } = movedDeps();
    const one = healMissingNote("a/n.md", deps, "vault-1");
    const other = healMissingNote("a/n.md", deps, "vault-2");
    expect(other).not.toBe(one);
    release();
    await Promise.all([one, other]);
    await new Promise((r) => setTimeout(r, 0));
    const again = healMissingNote("a/n.md", deps, "vault-1");
    expect(again).not.toBe(one);
    await again;
    expect(deps.indexer.reconcileFolder).toHaveBeenCalledTimes(3);
  });

  it("uses what the open note knew once the watcher removed the row", async () => {
    const { deps, release } = movedDeps();
    deps.db.queryOne.mockResolvedValue(null as never);
    release();
    const blind = await healMissingNote("a/n.md", deps, "vault-3");
    expect(blind.first).toEqual({ kind: "gone" });
    await new Promise((r) => setTimeout(r, 0));
    const known = await healMissingNote("a/n.md", deps, "vault-3", { known: { sha256: "hash-n", mtime: STAMP } });
    expect(known.first).toEqual({ kind: "moved", to: "b/n.md" });
  });
});
