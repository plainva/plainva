import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// In-memory doubles for the tauri fs/path/ipc surface the journal touches.
const files = new Map<string, string>();
const invokeMock = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
  if (cmd === "register_write_root") return "root-1";
  if (cmd === "checked_read_text_file") return files.get(`APPDATA/drafts/${args?.relPath as string}`) ?? null;
  if (cmd === "write_file_atomic") {
    files.set(`APPDATA/drafts/${args?.relPath as string}`, args?.contents as string);
    return undefined;
  }
  throw new Error(`unexpected invoke ${cmd}`);
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invokeMock(...(a as [string, Record<string, unknown>])) }));
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: async () => "APPDATA",
  join: async (...parts: string[]) => parts.join("/"),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: async (p: string) => files.has(p) || p === "APPDATA/drafts",
  mkdir: async () => {},
  readTextFile: async (p: string) => {
    const c = files.get(p);
    if (c === undefined) throw new Error(`missing ${p}`);
    return c;
  },
  remove: vi.fn(async (p: string) => { files.delete(p); }),
  readDir: async () => [],
  stat: async () => ({ mtime: new Date() }),
}));

import { clearDraft, pathHash, readDraft, recordDraft } from "./draftJournal";

const VAULT = "C:/vaults/main";
const NOTE = "Notes/A.md";
const FILE = `APPDATA/drafts/${pathHash(VAULT)}/${pathHash(NOTE)}.json`;

describe("draftJournal", () => {
  beforeEach(() => {
    files.clear();
    invokeMock.mockClear();
  });

  it("pathHash is stable, distinct and file-name safe", () => {
    expect(pathHash(VAULT)).toBe(pathHash(VAULT));
    expect(pathHash(VAULT)).not.toBe(pathHash(NOTE));
    expect(pathHash("Ünïcode/ノート.md")).toMatch(/^[0-9a-f]{16}$/);
  });

  it("records snapshots through the atomic write command", async () => {
    await recordDraft(VAULT, NOTE, "draft text", 3);
    expect(invokeMock).toHaveBeenCalledWith(
      "write_file_atomic",
      expect.objectContaining({ encoding: "utf8", rootId: "root-1" })
    );
    const entry = JSON.parse(files.get(FILE)!).entries[0];
    expect(entry).toMatchObject({ vaultPath: VAULT, notePath: NOTE, text: "draft text", revision: 3 });
    expect(await readDraft(VAULT, NOTE)).toMatchObject({ text: "draft text", revision: 3 });
  });

  it("clearDraft keeps NEWER snapshots (latest wins) and force-clears on Infinity", async () => {
    await recordDraft(VAULT, NOTE, "newer", 7);
    await clearDraft(VAULT, NOTE, 6); // save covered rev 6 — the rev-7 snapshot survives
    expect(files.has(FILE)).toBe(true);
    await clearDraft(VAULT, NOTE, 7); // save covered rev 7 — now it goes
    expect(files.has(FILE)).toBe(false);

    await recordDraft(VAULT, NOTE, "again", 9);
    await clearDraft(VAULT, NOTE, Infinity); // explicit user discard
    expect(files.has(FILE)).toBe(false);
  });

  it("readDraft returns null for missing or malformed entries", async () => {
    expect(await readDraft(VAULT, NOTE)).toBeNull();
    files.set(FILE, "{not json");
    expect(await readDraft(VAULT, NOTE)).toBeNull();
    files.set(FILE, JSON.stringify({ nope: true }));
    expect(await readDraft(VAULT, NOTE)).toBeNull();
  });

  it("keeps a reopened editor's revision 1 when the old editor confirms revision 100", async () => {
    await recordDraft(VAULT, NOTE, "old editor", 100, "old");
    await recordDraft(VAULT, NOTE, "reopened editor", 1, "new");
    await clearDraft(VAULT, NOTE, 100, "old");
    expect(await readDraft(VAULT, NOTE)).toMatchObject({ text: "reopened editor", revision: 1, sessionId: "new" });
  });

  it("preserves both window drafts and clears only the explicitly dismissed offer", async () => {
    await recordDraft(VAULT, NOTE, "left window", 3, "left");
    await recordDraft(VAULT, NOTE, "right window", 2, "right");
    const offered = (await readDraft(VAULT, NOTE))!;
    await clearDraft(VAULT, NOTE, offered.revision, offered.sessionId);
    const remaining = (await readDraft(VAULT, NOTE))!;
    expect(remaining.text).not.toBe(offered.text);
    expect([offered.text, remaining.text].sort()).toEqual(["left window", "right window"]);
  });

  it("migrates a legacy entry without allowing a new session to erase it", async () => {
    files.set(FILE, JSON.stringify({ vaultPath: VAULT, notePath: NOTE, text: "legacy recovery", revision: 99, savedAt: 1 }));
    await recordDraft(VAULT, NOTE, "current", 1, "new");
    await clearDraft(VAULT, NOTE, 1, "new");
    expect(await readDraft(VAULT, NOTE)).toMatchObject({ text: "legacy recovery", revision: 99 });
  });

  it("refuses to replace an unreadable existing journal", async () => {
    files.set(FILE, "{broken");
    await expect(recordDraft(VAULT, NOTE, "new", 1, "new")).rejects.toThrow();
    expect(files.get(FILE)).toBe("{broken");
  });

  it("offers an unsaved session even if a more recent draft already matches disk", async () => {
    await recordDraft(VAULT, NOTE, "unsaved", 4, "left");
    await recordDraft(VAULT, NOTE, "saved", 5, "right");
    expect(await readDraft(VAULT, NOTE, "saved")).toMatchObject({ text: "unsaved" });
    await recordDraft(VAULT, NOTE, "older arrival", 3, "left");
    expect(await readDraft(VAULT, NOTE, "saved")).toMatchObject({ text: "unsaved", revision: 4 });
  });
  it("does not replace another session's draft when the native read fails", async () => {
    await recordDraft(VAULT, NOTE, "kept in the old editor", 9, "old");
    const previous = files.get(FILE);
    invokeMock.mockRejectedValueOnce(new Error("cannot read existing draft"));
    await expect(recordDraft(VAULT, NOTE, "new editor", 1, "new")).rejects.toThrow("cannot read existing draft");
    expect(files.get(FILE)).toBe(previous);
    await recordDraft(VAULT, NOTE, "new editor", 1, "new");
    expect(JSON.parse(files.get(FILE)!).entries.map((entry: { sessionId: string }) => entry.sessionId)).toEqual(["old", "new"]);
  });
});

import { remove } from "@tauri-apps/plugin-fs";

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
function holdNextAtomicWrite() {
  const entered = gate(), release = gate();
  const original = invokeMock.getMockImplementation()!;
  invokeMock.mockImplementation(async (command, args) => {
    if (command !== "write_file_atomic") return original(command, args);
    invokeMock.mockImplementation(original);
    entered.resolve();
    await release.promise;
    return original(command, args);
  });
  return { entered, release };
}
describe("ordered desktop draft writes", () => {
  beforeEach(() => { files.clear(); invokeMock.mockClear(); });
  afterEach(() => vi.restoreAllMocks());

  it("finishes an old removal before allowing the next atomic snapshot", async () => {
    await recordDraft(VAULT, NOTE, "old", 1);
    const entered = gate(), release = gate();
    const removeFile = vi.mocked(remove);
    removeFile.mockImplementationOnce(async (path) => {
      entered.resolve();
      await release.promise;
      files.delete(path as string);
    });
    const clearing = clearDraft(VAULT, NOTE, 1);
    await entered.promise;
    const writing = recordDraft(VAULT, NOTE, "new typing", 2);
    release.resolve();
    await Promise.all([clearing, writing]);
    expect((await readDraft(VAULT, NOTE))?.text).toBe("new typing");
  });

  it("serializes a delayed atomic write, confirmation and newer snapshot", async () => {
    const { entered, release } = holdNextAtomicWrite();
    const old = recordDraft(VAULT, NOTE, "old", 3);
    await entered.promise;
    const clearing = clearDraft(VAULT, NOTE, 3);
    const newer = recordDraft(VAULT, NOTE, "new", 4);
    release.resolve();
    await Promise.all([old, clearing, newer]);
    expect((await readDraft(VAULT, NOTE))?.text).toBe("new");
  });

  it("keeps unrelated vaults independent while one atomic write waits", async () => {
    const { entered, release } = holdNextAtomicWrite();
    const held = recordDraft(VAULT, NOTE, "vault A", 5);
    await entered.promise;
    await recordDraft("other", NOTE, "vault B", 1);
    expect((await readDraft("other", NOTE))?.text).toBe("vault B");
    release.resolve();
    await held;
    expect((await readDraft(VAULT, NOTE))?.text).toBe("vault A");
  });
});
