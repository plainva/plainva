// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { IVaultAdapter, VaultQueryService } from "@plainva/core";
import { appendWikiLink, applyMentionLink, removeLinksTo } from "./graphActions";

vi.mock("./newNote", () => ({
  buildNewNoteContent: (type: string, title?: string) => `---\ntype: ${type}\n---\n# ${title}\n`,
}));

function fakeAdapter(files: Record<string, string>): IVaultAdapter {
  return {
    initialize: async () => {},
    dispose: async () => {},
    readTextFile: async (path: string) => {
      if (files[path] === undefined) throw new Error("not found");
      return files[path];
    },
    readBinaryFile: async () => new Uint8Array(),
    writeTextFile: async (path: string, content: string) => {
      files[path] = content;
    },
    writeBinaryFile: async () => {},
    deleteItem: async () => {},
    renameItem: async () => {},
    exists: async () => true,
    getFileInfo: async () => ({ path: "", name: "", isDirectory: false, size: 0, mtime: 0 }),
    listDir: async () => [],
    createDir: async () => {},
  };
}

function fakeQuery(paths: string[]): VaultQueryService {
  return { listNotes: async () => paths.map((p) => ({ path: p, title: p })) } as unknown as VaultQueryService;
}

describe("appendWikiLink", () => {
  it("appends a bare-basename link after a blank line and fires the save-flush handshake", async () => {
    const files = { "note.md": "# Note\nBody" };
    const flushed: string[] = [];
    const onFlush = (e: Event) => flushed.push((e as CustomEvent<{ path: string }>).detail.path);
    window.addEventListener("plainva-flush-pending-save", onFlush);

    const link = await appendWikiLink(fakeAdapter(files), fakeQuery(["note.md", "Ziel.md"]), "note.md", "Ziel.md");

    window.removeEventListener("plainva-flush-pending-save", onFlush);
    expect(link).toBe("[[Ziel]]");
    expect(files["note.md"]).toBe("# Note\nBody\n\n[[Ziel]]\n");
    expect(flushed).toEqual(["note.md"]);
  });

  it("path-qualifies the link when the basename collides", async () => {
    const files = { "note.md": "x\n" };
    const link = await appendWikiLink(
      fakeAdapter(files),
      fakeQuery(["note.md", "A/Ziel.md", "B/Ziel.md"]),
      "note.md",
      "A/Ziel.md"
    );
    expect(link).toBe("[[A/Ziel]]");
    expect(files["note.md"]).toBe("x\n\n[[A/Ziel]]\n");
  });

  it("removes only links resolving to the target and keeps display text", async () => {
    const files: Record<string, string> = {
      "src.md": "See [[Ziel]] and [[A/Other]] plus [[Ziel|shown text]] and [[Ziel#sec]].",
    };
    const removed = await removeLinksTo(
      fakeAdapter(files),
      fakeQuery(["src.md", "Ziel.md", "A/Other.md"]),
      "src.md",
      "Ziel.md"
    );
    expect(removed).toBe(3);
    expect(files["src.md"]).toBe("See Ziel and [[A/Other]] plus shown text and Ziel.");
  });

  it("links the first unlinked mention with word boundaries and alias form", async () => {
    const files: Record<string, string> = {
      "src.md": "[[Projekt X]] is linked. Projekt Xtra stays. But Projekt X here is bare.",
    };
    const ok = await applyMentionLink(
      fakeAdapter(files),
      fakeQuery(["src.md", "Projekt X.md"]),
      "src.md",
      "Projekt X.md",
      "Projekt X"
    );
    expect(ok).toBe(true);
    expect(files["src.md"]).toBe("[[Projekt X]] is linked. Projekt Xtra stays. But [[Projekt X]] here is bare.");
  });

  it("returns false when the mention no longer exists (stale scan)", async () => {
    const files: Record<string, string> = { "src.md": "nothing here" };
    const ok = await applyMentionLink(fakeAdapter(files), fakeQuery(["src.md", "T.md"]), "src.md", "T.md", "Term");
    expect(ok).toBe(false);
    expect(files["src.md"]).toBe("nothing here");
  });

  it("waits for the editor ack before reading the file", async () => {
    const files: Record<string, string> = { "open.md": "stale" };
    // Simulate an open editor: on flush request it saves NEW content, then acks.
    const onFlush = (e: Event) => {
      const path = (e as CustomEvent<{ path: string }>).detail.path;
      files[path] = "fresh";
      window.dispatchEvent(new CustomEvent("plainva-pending-save-flushed", { detail: { path } }));
    };
    window.addEventListener("plainva-flush-pending-save", onFlush);
    vi.useRealTimers();

    await appendWikiLink(fakeAdapter(files), fakeQuery(["open.md", "Z.md"]), "open.md", "Z.md");
    window.removeEventListener("plainva-flush-pending-save", onFlush);
    expect(files["open.md"]).toBe("fresh\n\n[[Z]]\n");
  });
});
