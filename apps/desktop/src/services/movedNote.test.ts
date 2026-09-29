import { describe, it, expect, vi } from "vitest";
import type { MissingFileDeps } from "@plainva/core";
import { healMissingNote, movedChoiceBodyKey, movedFolderLabel } from "@plainva/ui";

/**
 * Issue 110 (E9), the part both shells share around the core's decision: the
 * folder the message names, the sentence under "Moved?", and one lookup per
 * note at a time. The decision itself is covered against real SQLite in the
 * core (missing-file.test.ts).
 */

/** A note moved from "a/n.md" to "b/n.md": one candidate, same hash, same time. */
function movedDeps() {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const deps = {
    exists: vi.fn(async (p: string) => p === "b/n.md"),
    db: {
      queryOne: vi.fn(async () => ({ sha256: "hash-n", mtime_local: 1_727_000_000_000 })),
      query: vi.fn(async () => [{ path: "b/n.md", mtime_local: 1_727_000_000_000 }]),
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

describe("healMissingNote", () => {
  it("runs one lookup for a note that two panes ask about at once", async () => {
    const { deps, release } = movedDeps();
    const first = healMissingNote("a/n.md", deps, "vault-1");
    const second = healMissingNote("a/n.md", deps, "vault-1");
    expect(second).toBe(first);
    release();
    expect(await first).toEqual({ kind: "moved", to: "b/n.md" });
    expect(deps.indexer.reconcileFolder).toHaveBeenCalledTimes(1);
    expect(deps.indexer.indexVaultFull).toHaveBeenCalledTimes(1);
  });

  it("keeps two vaults apart, and looks again once the first lookup ended", async () => {
    const { deps, release } = movedDeps();
    const one = healMissingNote("a/n.md", deps, "vault-1");
    const other = healMissingNote("a/n.md", deps, "vault-2");
    expect(other).not.toBe(one);
    release();
    await Promise.all([one, other]);
    const again = healMissingNote("a/n.md", deps, "vault-1");
    expect(again).not.toBe(one);
    await again;
    expect(deps.indexer.reconcileFolder).toHaveBeenCalledTimes(3);
  });
});
