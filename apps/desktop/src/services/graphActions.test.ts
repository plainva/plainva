// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { IVaultAdapter, VaultQueryService } from "@plainva/core";
import {
  appendWikiLink,
  applyInlineLink,
  applyMentionLink,
  findFirstUnlinkedOccurrence,
  frontmatterBodyOffset,
  removeLinksTo,
} from "./graphActions";

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
  it("appends a bare-basename link, fires the save-flush handshake, and notifies the open editor", async () => {
    const files = { "note.md": "# Note\nBody" };
    const flushed: string[] = [];
    const refreshed: string[] = [];
    const onFlush = (e: Event) => flushed.push((e as CustomEvent<{ path: string }>).detail.path);
    const onRefresh = (e: Event) => refreshed.push((e as CustomEvent<{ path: string }>).detail.path);
    window.addEventListener("plainva-flush-pending-save", onFlush);
    window.addEventListener("plainva-external-update", onRefresh);

    const link = await appendWikiLink(fakeAdapter(files), fakeQuery(["note.md", "Ziel.md"]), "note.md", "Ziel.md");

    window.removeEventListener("plainva-flush-pending-save", onFlush);
    window.removeEventListener("plainva-external-update", onRefresh);
    expect(link).toBe("[[Ziel]]");
    expect(files["note.md"]).toBe("# Note\nBody\n\n[[Ziel]]\n");
    expect(flushed).toEqual(["note.md"]);
    // The just-written link must reach an open editor live (no reopen needed).
    expect(refreshed).toEqual(["note.md"]);
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

describe("frontmatterBodyOffset", () => {
  it("returns 0 when there is no frontmatter", () => {
    expect(frontmatterBodyOffset("# Note\nBody")).toBe(0);
  });

  it("points past a leading YAML block", () => {
    const c = "---\ntype: note\nalias: Ziel\n---\nBody text";
    expect(c.slice(frontmatterBodyOffset(c))).toBe("Body text");
  });

  it("treats an unterminated block as body (safe fallback)", () => {
    expect(frontmatterBodyOffset("---\nno closing fence\nmore")).toBe(0);
  });
});

describe("findFirstUnlinkedOccurrence", () => {
  it("finds a word-boundary occurrence and keeps the document casing", () => {
    expect(findFirstUnlinkedOccurrence("We met Projekt X today.", ["projekt x"])).toEqual({
      index: 7,
      matched: "Projekt X",
    });
  });

  it("skips occurrences already inside a wiki link", () => {
    const occ = findFirstUnlinkedOccurrence("[[Projekt X]] then Projekt X bare.", ["Projekt X"]);
    expect(occ?.index).toBe("[[Projekt X]] then ".length);
    expect(occ?.matched).toBe("Projekt X");
  });

  it("never matches inside the frontmatter (would corrupt YAML)", () => {
    const c = "---\nalias: Ziel\n---\nprose without the term";
    expect(findFirstUnlinkedOccurrence(c, ["Ziel"])).toBeNull();
  });

  it("respects word boundaries", () => {
    expect(findFirstUnlinkedOccurrence("Projekt Xtra only", ["Projekt X"])).toBeNull();
  });

  it("returns the earliest occurrence across terms; the longer phrase wins on a tie", () => {
    expect(findFirstUnlinkedOccurrence("see Project Plan here", ["Project", "Project Plan"])).toEqual({
      index: 4,
      matched: "Project Plan",
    });
  });
});

describe("applyInlineLink", () => {
  it("links the passage bare when the visible text equals the wiki target", async () => {
    const files: Record<string, string> = { "src.md": "We met Projekt X today." };
    const res = await applyInlineLink(
      fakeAdapter(files),
      fakeQuery(["src.md", "Projekt X.md"]),
      "src.md",
      "Projekt X.md",
      ["Projekt X"]
    );
    expect(res).toEqual({ matched: "Projekt X", link: "[[Projekt X]]" });
    expect(files["src.md"]).toBe("We met [[Projekt X]] today.");
  });

  it("uses the [[target|text]] form when the visible text differs (the aliased-link principle)", async () => {
    const files: Record<string, string> = { "src.md": "We met projekt x today." };
    const res = await applyInlineLink(
      fakeAdapter(files),
      fakeQuery(["src.md", "Projekt X.md"]),
      "src.md",
      "Projekt X.md",
      ["projekt x"]
    );
    expect(res).toEqual({ matched: "projekt x", link: "[[Projekt X|projekt x]]" });
    expect(files["src.md"]).toBe("We met [[Projekt X|projekt x]] today.");
  });

  it("path-qualifies the target and aliases the visible text on a basename collision", async () => {
    const files: Record<string, string> = { "src.md": "about Ziel here" };
    const res = await applyInlineLink(
      fakeAdapter(files),
      fakeQuery(["src.md", "A/Ziel.md", "B/Ziel.md"]),
      "src.md",
      "A/Ziel.md",
      ["Ziel"]
    );
    expect(res).toEqual({ matched: "Ziel", link: "[[A/Ziel|Ziel]]" });
    expect(files["src.md"]).toBe("about [[A/Ziel|Ziel]] here");
  });

  it("returns null and writes nothing when no live occurrence remains (stale preview)", async () => {
    const files: Record<string, string> = { "src.md": "no term here" };
    const res = await applyInlineLink(fakeAdapter(files), fakeQuery(["src.md", "T.md"]), "src.md", "T.md", ["Missing"]);
    expect(res).toBeNull();
    expect(files["src.md"]).toBe("no term here");
  });
});
