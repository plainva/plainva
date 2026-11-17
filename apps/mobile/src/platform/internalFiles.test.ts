import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * iOS: the app's own files leave Documents (release list A11, the class of
 * the database move). The move runs against two folder trees in memory; each
 * file carries a marker and the time it was written, so a test sees which
 * copy ended up where. What only a device shows - that the Files app no
 * longer lists `drafts/` or `ai/`, and that the rename of a whole folder
 * works across Documents and Library - is not covered here.
 */

const platform = vi.hoisted(() => ({ kind: "ios" }));
vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: () => platform.kind, isNativePlatform: () => platform.kind !== "web" }, registerPlugin: () => ({}) }));

const { moveInternalFilesOutOfDocuments, internalPlace, resetInternalFilesForTests, IOS_INTERNAL_FOLDER } = await import("./internalFiles");
type InternalFolders = import("./internalFiles").InternalFolders;

interface Entry { data: string; mtime: number | null }

class Trees implements InternalFolders {
  old = new Map<string, Entry>();
  new = new Map<string, Entry>();
  failMove = new Set<string>();
  failStat = false;
  newFolders = new Set<string>();
  private has(tree: Map<string, Entry>, path: string, folders?: Set<string>) {
    if (this.failStat) throw Object.assign(new Error("not permitted"), { code: "OS-PLUG-FILE-0007" });
    return tree.has(path) || [...tree.keys()].some((key) => key.startsWith(`${path}/`)) || (folders?.has(path) ?? false);
  }
  async existsOld(path: string) { return this.has(this.old, path); }
  async existsNew(path: string) { return this.has(this.new, path, this.newFolders); }
  async listOld(folder: string) {
    if (this.failListAfter-- <= 0) throw new Error("readdir failed");
    return [...this.old].filter(([key]) => key.startsWith(`${folder}/`)).map(([key, entry]) => ({ rel: key.slice(folder.length + 1), mtime: entry.mtime }));
  }
  async mtimeNew(path: string) { return this.new.get(path)!.mtime; }
  async readOld(path: string) { return this.old.get(path)!.data; }
  async readNew(path: string) { return this.new.get(path)!.data; }
  failListAfter = Infinity;
  async writeNew(path: string, data: string) { this.new.set(path, { data, mtime: (this.new.get(path)?.mtime ?? 0) + 100 }); }
  async makeNewFolder(path: string) { this.newFolders.add(path); }
  async moveToNew(path: string) {
    if (this.failMove.has(path)) throw new Error(`rename ${path} failed`);
    const moving = [...this.old].filter(([key]) => key === path || key.startsWith(`${path}/`));
    if (moving.length === 0) throw new Error(`no ${path}`);
    for (const [key, entry] of moving) {
      if (this.new.has(key)) throw new Error(`${key} exists`);
      this.old.delete(key);
      this.new.set(key, entry);
    }
  }
  failRemoveOld = new Set<string>();
  async removeOld(path: string) {
    if (this.failRemoveOld.has(path)) throw new Error(`remove ${path} failed`);
    this.old.delete(path);
  }
  async removeNew(path: string) { this.new.delete(path); }
  async removeOldFolder(path: string) {
    for (const key of [...this.old.keys()]) if (key.startsWith(`${path}/`)) throw new Error("folder not empty");
  }
}

const at = (data: string, mtime: number | null): Entry => ({ data, mtime });
const DRAFT_TEXT = JSON.stringify({ version: 2, entries: [{ notePath: "a.md", text: "draft", revision: 1, savedAt: 1, sessionId: "run-1" }] });
const contents = (tree: Map<string, Entry>) => Object.fromEntries([...tree].map(([key, entry]) => [key, entry.data]));

let trees: Trees;
beforeEach(() => {
  trees = new Trees();
  platform.kind = "ios";
  resetInternalFilesForTests();
});

describe("moving the app's own files out of Documents", () => {
  it("renames each folder into place when only Documents holds it", async () => {
    // A draft journal (a torn one would stay out, see the fourth review) and an unfinished comment operation.
    trees.old.set("drafts/v1/a.json", at(DRAFT_TEXT, 1)).set("drafts/v1/comment-operations/op.json", at("op", 1))
      .set("ai/v1/chat.json", at("chat", 1)).set("okf-journal/v1.json", at("okf", 1)).set("profile-journal/v1.json", at("profile", 1))
      .set("vaults/v1/note.md", at("note", 1));
    const outcome = await moveInternalFilesOutOfDocuments(trees);
    expect(outcome.stayed.size).toBe(0);
    expect(contents(trees.old)).toEqual({ "vaults/v1/note.md": "note" });
    expect(contents(trees.new)).toEqual({
      "drafts/v1/a.json": DRAFT_TEXT, "drafts/v1/comment-operations/op.json": "op",
      "ai/v1/chat.json": "chat", "okf-journal/v1.json": "okf", "profile-journal/v1.json": "profile",
    });
  });

  it("keeps the newer of two copies of a file that is no draft journal, whichever folder holds it", async () => {
    trees.new.set("ai/v1/a.json", at("new-older", 1)).set("ai/v1/b.json", at("new-newer", 9)).set("ai/v1/c.json", at("same-new", 5));
    trees.old.set("ai/v1/a.json", at("old-newer", 5)).set("ai/v1/b.json", at("old-older", 3)).set("ai/v1/c.json", at("same-old", 5))
      .set("ai/v1/d.json", at("only-old", 2));
    await moveInternalFilesOutOfDocuments(trees);
    expect(trees.old.size).toBe(0);
    expect(contents(trees.new)).toEqual({ "ai/v1/a.json": "old-newer", "ai/v1/b.json": "new-newer", "ai/v1/c.json": "same-new", "ai/v1/d.json": "only-old" });
  });

  it("a merge that ends half way loses nothing, and the next start finishes it", async () => {
    trees.new.set("ai/v1/x.json", at("new", 1));
    trees.old.set("ai/v1/x.json", at("old-newer", 5)).set("ai/v1/y.json", at("y", 1));
    trees.failMove.add("ai/v1/x.json");
    expect((await moveInternalFilesOutOfDocuments(trees)).stayed.size).toBe(0);
    // The older copy went first; the newer one is still where it was.
    expect(contents(trees.old)).toEqual({ "ai/v1/x.json": "old-newer" });
    expect(contents(trees.new)).toEqual({ "ai/v1/y.json": "y" });

    trees.failMove.clear();
    await moveInternalFilesOutOfDocuments(trees);
    expect(trees.old.size).toBe(0);
    expect(contents(trees.new)).toEqual({ "ai/v1/x.json": "old-newer", "ai/v1/y.json": "y" });
  });

  it("a folder that could not be renamed stays in Documents for this lifetime, and moves at the next start", async () => {
    trees.old.set("okf-journal/v1.json", at("okf", 1));
    trees.failMove.add("okf-journal");
    expect([...(await moveInternalFilesOutOfDocuments(trees)).stayed]).toEqual(["okf-journal"]);
    expect(contents(trees.old)).toEqual({ "okf-journal/v1.json": "okf" });

    trees.failMove.clear();
    expect((await moveInternalFilesOutOfDocuments(trees)).stayed.size).toBe(0);
    expect(contents(trees.new)).toEqual({ "okf-journal/v1.json": "okf" });
  });

  it("touches nothing when the folders cannot be asked", async () => {
    // Either place is safe then: what lands in the new one meets what stayed
    // in the old one at the next start, and the one written last wins.
    trees.old.set("drafts/v1/a.json", at("draft", 1));
    trees.failStat = true;
    await moveInternalFilesOutOfDocuments(trees);
    expect(contents(trees.old)).toEqual({ "drafts/v1/a.json": "draft" });
    expect(trees.new.size).toBe(0);
  });
});

describe("where an app-owned file lies", () => {
  it("below Library on iOS, after the move, once per lifetime", async () => {
    trees.old.set("drafts/v1/a.json", at("draft", 1));
    expect(await internalPlace("drafts/v1/a.json", trees)).toEqual({ directory: "LIBRARY", path: `${IOS_INTERNAL_FOLDER}/drafts/v1/a.json` });
    trees.old.set("drafts/v1/late.json", at("late", 1));
    await internalPlace("ai/v1/x.json", trees);
    expect(trees.old.has("drafts/v1/late.json")).toBe(true);
  });

  it("in Documents for a folder that stayed there", async () => {
    trees.old.set("ai/v1/x.json", at("chat", 1));
    trees.failMove.add("ai");
    expect(await internalPlace("ai/v1/x.json", trees)).toEqual({ directory: "DATA", path: "ai/v1/x.json" });
  });

  it.each(["android", "web"])("in the data folder on %s, without a move", async (kind) => {
    platform.kind = kind;
    trees.old.set("drafts/v1/a.json", at("draft", 1));
    expect(await internalPlace("drafts/v1/a.json", trees)).toEqual({ directory: "DATA", path: "drafts/v1/a.json" });
    expect(trees.new.size).toBe(0);
  });

  it("refuses a path outside the app's own folders", async () => {
    await expect(internalPlace("vaults/v1/note.md", trees)).rejects.toThrow(/not below/);
  });

  it("the native atomic write can write below Library", () => {
    const swift = readFileSync(new URL("../../ios/App/App/AtomicFilePlugin.swift", import.meta.url), "utf8");
    expect(swift).toMatch(/case "LIBRARY": searchPath = \.libraryDirectory/);
    expect(swift).toMatch(/case "DATA": searchPath = \.documentDirectory/);
  });
});

/** Every operation of the move, with one of them failing (`failAt`) or the lifetime ending there (`crashAt`). */
function faulty(trees: Trees, { failAt = -1, crashAt = -1 }: { failAt?: number; crashAt?: number }): InternalFolders & { ops: number } {
  const wrapped = { ops: 0 } as InternalFolders & { ops: number };
  for (const name of ["existsOld", "existsNew", "listOld", "mtimeNew", "readOld", "readNew", "writeNew", "makeNewFolder", "moveToNew", "removeOld", "removeNew", "removeOldFolder"] as const) {
    (wrapped as unknown as Record<string, unknown>)[name] = async (...args: unknown[]) => {
      wrapped.ops += 1;
      if (crashAt >= 0 && wrapped.ops >= crashAt) throw new Error("the app was ended");
      if (wrapped.ops === failAt) throw new Error(`injected failure of ${name}`);
      return (trees[name] as unknown as (...a: unknown[]) => Promise<unknown>).apply(trees, args);
    };
  }
  return wrapped;
}

const journalOf = (...entries: Array<{ session: string; text: string; revision?: number }>) =>
  JSON.stringify({ version: 2, entries: entries.map((e) => ({ notePath: "Note.md", text: e.text, revision: e.revision ?? 1, savedAt: 1, sessionId: e.session })) });
const sessionsIn = (raw: string) => (JSON.parse(raw) as { entries: Array<{ sessionId: string; text: string }> }).entries.map((e) => `${e.sessionId}:${e.text}`).sort();

describe("after a step back to an older build (F43)", () => {
  const DRAFT = "drafts/v1/Tm90ZS5tZA==.json";

  it("joins two copies of a draft journal entry by entry, so neither build's drafts are lost", async () => {
    trees.new.set(DRAFT, at(journalOf({ session: "run-new", text: "typed in the newer build" }), 9));
    trees.old.set(DRAFT, at(journalOf({ session: "run-old", text: "typed in the older build" }, { session: "run-new", text: "stale", revision: 0 }), 5));
    await moveInternalFilesOutOfDocuments(trees);
    expect(trees.old.size).toBe(0);
    expect(sessionsIn(trees.new.get(DRAFT)!.data)).toEqual(["run-new:typed in the newer build", "run-old:typed in the older build"]);
  });

  it("keeps both builds' drafts wherever the start ends, and the next start finishes", async () => {
    const fresh = () => {
      const t = new Trees();
      t.new.set(DRAFT, at(journalOf({ session: "run-new", text: "new" }), 9));
      t.old.set(DRAFT, at(journalOf({ session: "run-old", text: "old" }), 5));
      return t;
    };
    const total = faulty(fresh(), {});
    await moveInternalFilesOutOfDocuments(total);
    for (let crashAt = 1; crashAt <= total.ops + 1; crashAt += 1) {
      const t = fresh();
      await moveInternalFilesOutOfDocuments(faulty(t, { crashAt }));
      await moveInternalFilesOutOfDocuments(t);
      expect({ crashAt, old: t.old.size, entries: sessionsIn(t.new.get(DRAFT)!.data) }).toEqual({ crashAt, old: 0, entries: ["run-new:new", "run-old:old"] });
    }
  });

  it("reads a profile journal left in Documents when the merge breaks off", async () => {
    trees.new.set("profile-journal/other.json", at("{}", 9));
    trees.old.set("profile-journal/v1.json", at("rollback image", 5));
    trees.failListAfter = 0;
    expect(await internalPlace("profile-journal/v1.json", trees)).toEqual({ directory: "DATA", path: "profile-journal/v1.json" });
    // What is only in the new place is still read there.
    expect(await internalPlace("profile-journal/other.json", trees)).toEqual({ directory: "LIBRARY", path: `${IOS_INTERNAL_FOLDER}/profile-journal/other.json` });
  });

  it("reads a file in Documents whose copy there is the newer one and could not move", async () => {
    trees.new.set("profile-journal/v1.json", at("older answer", 1));
    trees.old.set("profile-journal/v1.json", at("rollback image", 5));
    trees.failMove.add("profile-journal/v1.json");
    expect(await internalPlace("profile-journal/v1.json", trees)).toEqual({ directory: "DATA", path: "profile-journal/v1.json" });
    expect(trees.old.get("profile-journal/v1.json")?.data).toBe("rollback image");
  });

  it("finds an interrupted import's journal whichever step of the move fails", async () => {
    const REL = "profile-journal/v1.json";
    const fresh = () => {
      const t = new Trees();
      t.new.set("profile-journal/other.json", at("{}", 9));
      t.old.set(REL, at("rollback image", 5));
      return t;
    };
    const total = faulty(fresh(), {});
    await internalPlace(REL, total);
    for (let failAt = 1; failAt <= total.ops + 2; failAt += 1) {
      const t = fresh();
      resetInternalFilesForTests();
      const place = await internalPlace(REL, faulty(t, { failAt }));
      const found = place.directory === "DATA" ? t.old.get(REL) : t.new.get(REL);
      expect({ failAt, found: found?.data }).toEqual({ failAt, found: "rollback image" });
    }
  });
});

const entriesOf = (...entries: Array<[session: string, revision: number]>) =>
  JSON.stringify({ version: 2, entries: entries.map(([session, revision]) => ({ notePath: "Note.md", text: `${session}@${revision}`, revision, savedAt: revision, sessionId: session })) });
const textsIn = (raw: string) => (JSON.parse(raw) as { entries: Array<{ text: string }> }).entries.map((e) => e.text).sort();

describe("a draft journal is never decided by its time (F43, third round)", () => {
  const DRAFT = "drafts/v1/Tm90ZS5tZA==.json";

  it("keeps every entry of both copies whichever single step fails, and the next start joins them", async () => {
    const fresh = () => {
      const t = new Trees();
      t.old.set(DRAFT, at(entriesOf(["old-run", 3], ["shared", 1]), 5));
      t.new.set(DRAFT, at(entriesOf(["new-run", 7], ["shared", 2]), 9));
      return t;
    };
    const total = faulty(fresh(), {});
    await moveInternalFilesOutOfDocuments(total);
    for (let failAt = 1; failAt <= total.ops; failAt += 1) {
      const t = fresh();
      await moveInternalFilesOutOfDocuments(faulty(t, { failAt }));
      await moveInternalFilesOutOfDocuments(t);
      expect({ failAt, old: t.old.size, entries: textsIn(t.new.get(DRAFT)!.data) }).toEqual({ failAt, old: 0, entries: ["new-run@7", "old-run@3", "shared@2"] });
    }
  });

  it("never removes or writes over a copy that is no journal, and reads the one that is", async () => {
    trees.old.set(DRAFT, at("{ torn", 9));
    trees.new.set(DRAFT, at(entriesOf(["new-run", 7]), 5));
    expect(await internalPlace(DRAFT, trees)).toEqual({ directory: "LIBRARY", path: `${IOS_INTERNAL_FOLDER}/${DRAFT}` });
    expect(trees.old.get(DRAFT)?.data).toBe("{ torn");
    expect(textsIn(trees.new.get(DRAFT)!.data)).toEqual(["new-run@7"]);

    resetInternalFilesForTests();
    trees = new Trees();
    trees.old.set(DRAFT, at(entriesOf(["old-run", 3]), 5));
    trees.new.set(DRAFT, at("{ torn", 9));
    expect(await internalPlace(DRAFT, trees)).toEqual({ directory: "DATA", path: DRAFT });
    expect(trees.new.get(DRAFT)?.data).toBe("{ torn");
    expect(textsIn(trees.old.get(DRAFT)!.data)).toEqual(["old-run@3"]);
  });

  it("a draft discarded after the copy in Documents would not go stays discarded", async () => {
    trees.old.set(DRAFT, at(entriesOf(["old-run", 3]), 5));
    trees.new.set(DRAFT, at(entriesOf(["new-run", 7]), 9));
    trees.failRemoveOld.add(DRAFT);
    await moveInternalFilesOutOfDocuments(trees);
    expect(textsIn(trees.new.get(DRAFT)!.data)).toEqual(["new-run@7", "old-run@3"]);
    // The person discards the older build's draft in this lifetime.
    trees.new.set(DRAFT, at(entriesOf(["new-run", 7]), 20));

    trees.failRemoveOld.clear();
    await moveInternalFilesOutOfDocuments(trees);
    expect(trees.old.size).toBe(0);
    expect(textsIn(trees.new.get(DRAFT)!.data)).toEqual(["new-run@7"]);
    expect([...trees.new.keys()].filter((key) => key.startsWith(".joined/"))).toEqual([]);
  });
});

describe("the fourth review: the mark decides, a torn copy stays out, an unknown time deletes nothing", () => {
  const DRAFT = "drafts/v1/Tm90ZS5tZA==.json";

  it("a joined copy is not brought back after every draft of the note was discarded", async () => {
    trees.old.set(DRAFT, at(entriesOf(["old-run", 3]), 5));
    trees.new.set(DRAFT, at(entriesOf(["new-run", 7]), 9));
    trees.failRemoveOld.add(DRAFT);
    await moveInternalFilesOutOfDocuments(trees);
    expect([...trees.new.keys()].some((key) => key.startsWith(".joined/"))).toBe(true);
    // The person discards every draft of the note: the journal goes from the new place.
    trees.new.delete(DRAFT);
    trees.failRemoveOld.clear();
    await moveInternalFilesOutOfDocuments(trees);
    expect(trees.new.has(DRAFT)).toBe(false);
    expect(trees.old.has(DRAFT)).toBe(false);
    expect([...trees.new.keys()].filter((key) => key.startsWith(".joined/"))).toEqual([]);
  });

  it("a torn copy in Documents is never put in the journal's place", async () => {
    trees.old.set(DRAFT, at("{ torn", 5));
    // Every draft was discarded: nothing stands in the new place.
    await moveInternalFilesOutOfDocuments(trees);
    expect(trees.new.has(DRAFT)).toBe(false);
    expect(trees.old.get(DRAFT)?.data).toBe("{ torn");
    expect(await internalPlace(DRAFT, trees)).toEqual({ directory: "LIBRARY", path: `${IOS_INTERNAL_FOLDER}/${DRAFT}` });
  });

  it("a copy without a time is joined, never removed on a mark it cannot be told from", async () => {
    trees.old.set(DRAFT, at(entriesOf(["old-run", 3]), null));
    trees.new.set(DRAFT, at(entriesOf(["new-run", 7]), 9));
    // A mark for "0" - what a missing time used to read as - must not count for this copy.
    trees.new.set(`.joined/${DRAFT}`, at("0", 9));
    await moveInternalFilesOutOfDocuments(trees);
    expect(textsIn(trees.new.get(DRAFT)!.data)).toEqual(["new-run@7", "old-run@3"]);
    expect(trees.old.size).toBe(0);
  });

  it("of two other files without a known time, neither goes", async () => {
    trees.old.set("ai/v1/x.json", at("old", null));
    trees.new.set("ai/v1/x.json", at("new", 9));
    await moveInternalFilesOutOfDocuments(trees);
    expect(trees.old.get("ai/v1/x.json")?.data).toBe("old");
    expect(trees.new.get("ai/v1/x.json")?.data).toBe("new");
  });
});

