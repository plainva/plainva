import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// In-memory doubles for the tauri fs/path/ipc surface the journal touches.
const files = new Map<string, string>();
const invokeMock = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
  if (cmd === "register_write_root") return "root-1";
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
    const entry = JSON.parse(files.get(FILE)!);
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
});

import { remove } from "@tauri-apps/plugin-fs";

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
describe("ordered desktop draft writes", () => {
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
    const entered = gate(), release = gate();
    invokeMock.mockImplementationOnce(async (_cmd, args) => {
      entered.resolve();
      await release.promise;
      files.set("APPDATA/drafts/" + String(args?.relPath), String(args?.contents));
    });
    const old = recordDraft(VAULT, NOTE, "old", 3);
    await entered.promise;
    const clearing = clearDraft(VAULT, NOTE, 3);
    const newer = recordDraft(VAULT, NOTE, "new", 4);
    release.resolve();
    await Promise.all([old, clearing, newer]);
    expect((await readDraft(VAULT, NOTE))?.text).toBe("new");
  });

  it("keeps unrelated vaults independent while one atomic write waits", async () => {
    const entered = gate(), release = gate();
    invokeMock.mockImplementationOnce(async (_cmd, args) => {
      entered.resolve();
      await release.promise;
      files.set("APPDATA/drafts/" + String(args?.relPath), String(args?.contents));
    });
    const held = recordDraft(VAULT, NOTE, "vault A", 5);
    await entered.promise;
    await recordDraft("other", NOTE, "vault B", 1);
    expect((await readDraft("other", NOTE))?.text).toBe("vault B");
    release.resolve();
    await held;
    expect((await readDraft(VAULT, NOTE))?.text).toBe("vault A");
  });
});
