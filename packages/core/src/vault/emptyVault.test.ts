import { describe, expect, it } from "vitest";
import { PLAINVA_INDEX_MARKER } from "../okf-index.js";
import { readVaultEmptiness, type VaultRootReader } from "./emptyVault.js";

type Entry = { name: string; isDirectory: boolean };
const file = (name: string) => ({ name, isDirectory: false });
const dir = (name: string) => ({ name, isDirectory: true });

const MANAGED = `# test-vault\n\n${PLAINVA_INDEX_MARKER}\n`;

/** A root with these entries; `texts` holds what a file reads as. */
function root(entries: Entry[] | Error, texts: Record<string, string | Error> = {}): VaultRootReader & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    listDir: async () => {
      if (entries instanceof Error) throw entries;
      return entries;
    },
    readTextFile: async (path: string) => {
      reads.push(path);
      const text = texts[path];
      if (text === undefined) throw new Error(`no ${path}`);
      if (text instanceof Error) throw text;
      return text;
    },
  };
}

describe("readVaultEmptiness", () => {
  it("is empty for a vault with nothing in it", async () => {
    expect(await readVaultEmptiness(root([]))).toBe("empty");
  });

  it("is empty for a new vault that holds only the overview Plainva generated", async () => {
    expect(await readVaultEmptiness(root([file("index.md")], { "index.md": MANAGED }))).toBe("empty");
  });

  it("counts a person's own index.md as content — an Obsidian home note is a note", async () => {
    expect(await readVaultEmptiness(root([dir(".obsidian"), file("index.md")], { "index.md": "# My home\n[[Projects]]\n" }))).toBe("content");
  });

  it("counts a log.md as content — Plainva never writes one into a new vault", async () => {
    expect(await readVaultEmptiness(root([file("log.md")], { "log.md": "- 2026-11-17 started\n" }))).toBe("content");
    expect(await readVaultEmptiness(root([file("index.md"), file("LOG.MD")], { "index.md": MANAGED }))).toBe("content");
  });

  it("an index.md that cannot be read is content, never 'empty'", async () => {
    expect(await readVaultEmptiness(root([file("index.md")], { "index.md": new Error("denied") }))).toBe("content");
  });

  it("ignores hidden folders and operating-system bookkeeping", async () => {
    const r = root([dir(".plainva"), dir(".obsidian"), file(".DS_Store"), file("Thumbs.db"), file("index.md")], { "index.md": MANAGED });
    expect(await readVaultEmptiness(r)).toBe("empty");
  });

  it("is not empty as soon as there is a note, a database, an attachment or a folder", async () => {
    expect(await readVaultEmptiness(root([file("First.md")]))).toBe("content");
    expect(await readVaultEmptiness(root([file("Tasks.base")]))).toBe("content");
    expect(await readVaultEmptiness(root([file("photo.jpg")]))).toBe("content");
    expect(await readVaultEmptiness(root([dir("Projects")]))).toBe("content");
    expect(await readVaultEmptiness(root([dir("index.md")]))).toBe("content");
  });

  it("reads no file when the listing already shows content", async () => {
    const r = root([file("index.md"), file("First.md")], { "index.md": MANAGED });
    expect(await readVaultEmptiness(r)).toBe("content");
    expect(r.reads).toEqual([]);
  });

  it("a root that could not be listed is never empty", async () => {
    expect(await readVaultEmptiness(root(new Error("offline")))).toBe("content");
  });

  it("an empty root whose first pull is still running is being fetched, not empty", async () => {
    expect(await readVaultEmptiness(root([]), { firstPullPending: true })).toBe("fetching");
    expect(await readVaultEmptiness(root([file("index.md")], { "index.md": MANAGED }), { firstPullPending: true })).toBe("fetching");
    // Content is content, pull or not.
    expect(await readVaultEmptiness(root([file("First.md")]), { firstPullPending: true })).toBe("content");
  });
});
