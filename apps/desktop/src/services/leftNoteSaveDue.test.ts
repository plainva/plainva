import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A left editor knows only its own window (`EditorSaveLifetime.holds`). Before
 * each try its saver asks the journal and the file whether the text is still
 * owed (`leftNoteSaveDue`): four ways the note moves on elsewhere, each with
 * the desktop's real draft journal over in-memory stand-ins for the disk.
 */

const files = new Map<string, string>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "register_write_root") return "root-1";
    if (cmd === "checked_read_text_file") return files.get(`APPDATA/drafts/${args?.relPath as string}`) ?? null;
    if (cmd === "write_file_atomic") {
      files.set(`APPDATA/drafts/${args?.relPath as string}`, args?.contents as string);
      return undefined;
    }
    throw new Error(`unexpected invoke ${cmd}`);
  },
}));
vi.mock("@tauri-apps/api/path", () => ({ appDataDir: async () => "APPDATA", join: async (...parts: string[]) => parts.join("/") }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: async (p: string) => files.has(p) || p === "APPDATA/drafts" || [...files.keys()].some((k) => k.startsWith(`${p}/`)),
  mkdir: async () => {},
  readTextFile: async (p: string) => {
    const c = files.get(p);
    if (c === undefined) throw new Error(`missing ${p}`);
    return c;
  },
  remove: async (p: string) => { files.delete(p); },
  readDir: async (dir: string) =>
    [...files.keys()].filter((k) => k.startsWith(`${dir}/`) && !k.slice(dir.length + 1).includes("/")).map((k) => ({ name: k.slice(dir.length + 1), isDirectory: false })),
  stat: async () => ({ mtime: new Date() }),
}));

const { clearDraft, readDraft, readDraftStrict, recordDraft } = await import("./draftJournal");
const { leftNoteSaveDue } = await import("./leftNoteSaveDue");

const VAULT = "/vaults/main";
const NOTE = "Notes/A.md";
const A = "session-of-window-a";
const B = "session-of-window-b";

/** The vault's file as each case leaves it. */
const disk = new Map<string, string>();
const gone = () => Object.assign(new Error(`File or directory not found: ${NOTE}`), { name: "VaultFileNotFoundError", code: "FILE_NOT_FOUND" });

const due = () => leftNoteSaveDue(
  { path: NOTE, sessionId: A, revision: 4, journaled: true, persisted: "# A\n" },
  {
    newestDraft: () => readDraftStrict(VAULT, NOTE),
    readTextFile: async (p) => {
      const text = disk.get(p);
      if (text === undefined) throw gone();
      return text;
    },
  },
);

beforeEach(async () => {
  files.clear();
  disk.clear();
  disk.set(NOTE, "# A\n");
  // Window A left the note with unsaved text; its last try failed.
  await recordDraft(VAULT, NOTE, "# A\nleft unsaved in window A\n", 4, A);
});

describe("a save of a note window A left", () => {
  it("is owed while nothing moved on: the journal's newest entry is A's text, the file what A last knew", async () => {
    expect.hasAssertions();
    expect(await due()).toBe(true);
  });

  it("(a) gives way once window B offered A's draft and B chose Discard draft", async () => {
    expect.hasAssertions();
    const offered = await readDraft(VAULT, NOTE, "# A\n");
    expect(offered?.sessionId).toBe(A);
    // Editor.tsx, "Discard draft": the offered entry is cleared, by its own session and revision.
    await clearDraft(VAULT, NOTE, offered!.revision, offered!.sessionId);
    expect(await due()).toBe(false);
  });

  it("(b) gives way once window B holds the note: B typed on, or B saved", async () => {
    expect.hasAssertions();
    // A moment later, B types on: its snapshot is the journal's newest.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 2_000);
    await recordDraft(VAULT, NOTE, "# A\ntyped in window B\n", 1, B);
    vi.useRealTimers();
    expect(await due()).toBe(false);
    // B's save went through and cleared B's entry: the file is no longer what A knew.
    await clearDraft(VAULT, NOTE, 1, B);
    disk.set(NOTE, "# A\ntyped in window B\n");
    expect(await due()).toBe(false);
  });

  it("(c) and (d) gives way once the note was moved or deleted: nothing is written at the old place", async () => {
    expect.hasAssertions();
    disk.delete(NOTE);
    disk.set("Elsewhere/A.md", "# A\n");
    expect(await due()).toBe(false);
  });

  it("goes on while the file cannot be read for another reason: a folder that is away is what the retry waits out", async () => {
    expect.hasAssertions();
    const away = leftNoteSaveDue(
      { path: NOTE, sessionId: A, revision: 4, journaled: true, persisted: "# A\n" },
      { newestDraft: () => readDraftStrict(VAULT, NOTE), readTextFile: async () => { throw Object.assign(new Error("The vault folder cannot be reached"), { name: "VaultUnreachableError" }); } },
    );
    expect(await away).toBe(true);
  });

  it("goes on where the journal never took the text: its absence there proves nothing (a full disk fails the vault and the journal at once)", async () => {
    expect.hasAssertions();
    files.clear();
    const owed = await leftNoteSaveDue(
      { path: NOTE, sessionId: A, revision: 4, journaled: false, persisted: "# A\n" },
      { newestDraft: () => readDraftStrict(VAULT, NOTE), readTextFile: async (p) => disk.get(p) ?? "" },
    );
    expect(owed).toBe(true);
  });

  it("goes on where the journal cannot be read: that is no proof the entry is gone", async () => {
    expect.hasAssertions();
    // The journal file of the note is torn.
    for (const key of [...files.keys()]) files.set(key, "{ torn");
    await expect(readDraftStrict(VAULT, NOTE)).rejects.toThrow();
    // The lenient read the offer uses says "none" for it…
    expect(await readDraft(VAULT, NOTE)).toBeNull();
    // …and the saver does not take that for a draft discarded elsewhere.
    expect(await due()).toBe(true);
  });

  it("goes on for a note that was never loaded — a new one whose first save failed — also while its file is not there yet", async () => {
    expect.hasAssertions();
    disk.clear();
    const owed = await leftNoteSaveDue(
      { path: NOTE, sessionId: A, revision: 4, journaled: true, persisted: null },
      { newestDraft: () => readDraftStrict(VAULT, NOTE), readTextFile: async () => { throw gone(); } },
    );
    expect(owed).toBe(true);
  });
});
