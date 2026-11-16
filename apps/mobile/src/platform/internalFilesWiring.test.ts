import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * iOS: the readers and writers of the app's own files go through
 * `internalPlace`, so a journal is written below `Library/PlainvaData` and one
 * an older version left in Documents is found there after the move (release
 * list A11, the class of the database move). Documents and Library are two
 * maps in memory; the native atomic write is a recorder.
 */

const fs = vi.hoisted(() => ({
  documents: new Map<string, string>(),
  library: new Map<string, string>(),
  writes: [] as Array<{ path: string; directory?: string }>,
}));

const missing = () => Object.assign(new Error("File does not exist"), { code: "OS-PLUG-FILE-0008" });

vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: () => "ios", isNativePlatform: () => true },
  registerPlugin: () => ({
    write: async ({ path, data, directory }: { path: string; data: string; directory?: string }) => {
      fs.writes.push({ path, directory });
      (directory === "LIBRARY" ? fs.library : fs.documents).set(path, data);
    },
  }),
}));
vi.mock("@capacitor/filesystem", () => {
  // Directory.Data is Documents on iOS.
  const tree = (directory: string) => (directory === "LIBRARY" ? fs.library : fs.documents);
  const below = (map: Map<string, string>, path: string) => [...map.keys()].filter((key) => key.startsWith(`${path}/`));
  return {
    Directory: { Data: "DOCUMENTS", Documents: "DOCUMENTS", Library: "LIBRARY" },
    Encoding: { UTF8: "utf8" },
    Filesystem: {
      stat: async ({ path, directory }: { path: string; directory: string }) => {
        const map = tree(directory);
        if (!map.has(path) && below(map, path).length === 0) throw missing();
        return { mtime: 1 };
      },
      readdir: async ({ path, directory }: { path: string; directory: string }) => {
        const names = new Map<string, string>();
        for (const key of below(tree(directory), path)) {
          const rest = key.slice(path.length + 1);
          const name = rest.split("/", 1)[0];
          names.set(name, rest.includes("/") ? "directory" : "file");
        }
        if (names.size === 0) throw missing();
        return { files: [...names].map(([name, type]) => ({ name, type, mtime: 1 })) };
      },
      mkdir: async () => {},
      rename: async ({ from, directory, to, toDirectory }: { from: string; directory: string; to: string; toDirectory: string }) => {
        const source = tree(directory);
        const target = tree(toDirectory);
        const moving = [from, ...below(source, from)].filter((key) => source.has(key));
        if (moving.length === 0) throw missing();
        for (const key of moving) {
          target.set(to + key.slice(from.length), source.get(key)!);
          source.delete(key);
        }
      },
      readFile: async ({ path, directory }: { path: string; directory: string }) => {
        const data = tree(directory).get(path);
        if (data === undefined) throw missing();
        return { data };
      },
      deleteFile: async ({ path, directory }: { path: string; directory: string }) => {
        if (!tree(directory).delete(path)) throw missing();
      },
      rmdir: async ({ path, directory }: { path: string; directory: string }) => {
        for (const key of below(tree(directory), path)) tree(directory).delete(key);
      },
    },
  };
});

const { resetInternalFilesForTests } = await import("./internalFiles");
const { clearOkfJournal, readOkfJournal, writeOkfJournal } = await import("../services/okfJournal");
const { mobileCommentOperationJournal } = await import("../services/commentOperationJournal");

const journal = { backupDir: ".plainva/okf-backup", options: { defaultType: "note" } } as unknown as Parameters<typeof writeOkfJournal>[1];

beforeEach(() => {
  fs.documents.clear();
  fs.library.clear();
  fs.writes.length = 0;
  resetInternalFilesForTests();
});

describe("the app's own files on iOS", () => {
  it("a journal is written below Library, not in Documents", async () => {
    await writeOkfJournal("v1", journal);
    expect(fs.writes).toEqual([{ path: "PlainvaData/okf-journal/v1.json", directory: "LIBRARY" }]);
    expect(fs.documents.size).toBe(0);
    expect(await readOkfJournal("v1")).toMatchObject({ backupDir: ".plainva/okf-backup" });
    await clearOkfJournal("v1");
    expect(fs.library.size).toBe(0);
  });

  it("a journal an older version left in Documents is found after the move", async () => {
    fs.documents.set("okf-journal/v1.json", JSON.stringify(journal)).set("vaults/v1/note.md", "note");
    expect(await readOkfJournal("v1")).toMatchObject({ backupDir: ".plainva/okf-backup" });
    expect([...fs.documents.keys()]).toEqual(["vaults/v1/note.md"]);
    expect([...fs.library.keys()]).toEqual(["PlainvaData/okf-journal/v1.json"]);
  });

  it("an unfinished comment operation is kept below Library", async () => {
    fs.documents.set("drafts/v1/comment-operations/op-1.json", "{}");
    // The record itself is not valid here; what matters is where it was looked for.
    await mobileCommentOperationJournal("v1").list().catch(() => []);
    expect([...fs.library.keys()]).toEqual(["PlainvaData/drafts/v1/comment-operations/op-1.json"]);
    expect(fs.documents.size).toBe(0);
  });
});
