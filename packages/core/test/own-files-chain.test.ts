import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { realSqlite } from "./helpers/realSqlite.js";
import { MemoryVaultAdapter } from "./helpers/memoryVault.js";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.js";
import { SyncQueue } from "../src/sync/SyncQueue.js";
import { BackupVaultAdapter, DEFAULT_BACKUP_RETENTION } from "../src/vault/BackupVaultAdapter.js";
import { WORKSPACE_FORKS_FOLDER } from "../src/vault/backupNaming.js";
import { ConflictAwareVaultAdapter, ConflictError } from "../src/vault/ConflictAwareVaultAdapter.js";
import { ConflictFileStore } from "../src/vault/ConflictFileStore.js";
import { ConflictSessions, conflictDiagnostic, conflictHash, type ConflictEditSession, type ConflictSessionStore } from "../src/vault/conflictSession.js";
import { NotTextFileError } from "../src/vault/localText.js";
import { QueueingVaultAdapter } from "../src/vault/QueueingVaultAdapter.js";
import { SyncStateRepository } from "../src/vault/SyncStateRepository.js";

/**
 * What the app writes to its own files under `.plainva` passes every link of a
 * vault's chain untouched (finding 2026-10-12).
 *
 * The chain is three links over the files: a version of a file before it is
 * written over, the entry in the sync queue, and the check whether the file on
 * disk is still the one the app knows. The first two have always left the
 * app's own folder alone — nothing in it is versioned, nothing of it travels.
 * The third did not: it kept, for a list of bookmarks or the pins of a map,
 * what it had written last, like for a note. Whatever else then wrote such a
 * file — a settings profile, which writes the bookmarks through the chain's
 * lowest link; a second device in a shared folder — left a file the check did
 * not know. It has no text to merge such a file against (no version, no merge
 * base), so the next write ended as a conflict every time, and every one after
 * it as well.
 *
 * So what is kept of an own file no longer depends on the level it is written
 * on, and the rule "one file, one level" does not have to be kept for these
 * files by each of their writers. The local forks of an encrypted workspace
 * are no such files, and an editor's save is no such write, wherever the file
 * lies: both keep every protection. What is read here is what each link
 * leaves behind.
 *
 * `listConflictSessions()` never lists a conflict on an own file that a write
 * of the app opened, so where these tests ask whether one was opened, they
 * ask the store.
 */

const OWN_FILES = [
  ".plainva/bookmarks.json",
  ".plainva/recents.json",
  ".plainva/graph.json",
  ".plainva/sync/settings.json",
  ".plainva/sync/comments.device-a.json",
  ".plainva/comment-moves.device-a.0001.json",
];
const NOTE = "Projects/Plan.md";
/** A note in a folder a setting points into `.plainva` (daily notes, say): the editor saves it like any note. */
const NOTE_UNDER_PLAINVA = ".plainva/Journal/2026-10-20.md";
const FORK = `${WORKSPACE_FORKS_FOLDER}/abc-Plan.md`;

let files: MemoryVaultAdapter, db: IDatabaseAdapter, versions: BackupVaultAdapter, repo: SyncStateRepository, top: ConflictAwareVaultAdapter, merged: string[];
/** The backup layer's clock: a version is taken at most once per interval, so each step lies ten minutes after the last. */
let clock: number;

/** The chain as both shells build it; again for "the app starts again", over the same files and the same database. */
function openChain(): void {
  versions = new BackupVaultAdapter(files, { policy: DEFAULT_BACKUP_RETENTION, now: () => clock });
  repo = new SyncStateRepository(db, versions, "device-a");
  top = new ConflictAwareVaultAdapter(new QueueingVaultAdapter(versions, new SyncQueue(db)), repo, (path) => { merged.push(path); }, repo, "external-folder");
}

beforeEach(async () => {
  files = new MemoryVaultAdapter();
  db = await realSqlite();
  clock = Date.parse("2026-10-12T08:00:00Z");
  merged = [];
  openChain();
});
afterEach(async () => {
  // What a write started in the background is through before the database goes.
  await top.endOwnFileConflicts();
  vi.restoreAllMocks();
  await db.close();
});

const later = () => { clock += 10 * 60_000; };
const rows = async (table: string, column: string) => (await db.query<Record<string, string>>(`SELECT ${column} FROM ${table}`)).map((row) => row[column]);
const under = async (folder: string) => (await files.exists(folder) ? (await files.listDir(folder, true)).filter((entry) => !entry.isDirectory).map((entry) => entry.path).sort() : []);
/** Where the sessions keep what they set aside. */
const setAside = () => under(".plainva/conflict-revisions");
/** Conflict copies where a surface would look for them — not what is set aside. */
const conflictCopies = async () => (await under("")).filter((path) => path.includes(".CONFLICT-") && !path.startsWith(".plainva/conflict-revisions/"));
/** The conflicts the store holds, listed or not. */
const opened = async (store: Pick<ConflictSessionStore, "listConflictSessions"> = repo) => (await store.listConflictSessions()).map((session) => session.originalPath).sort();
/** What an older version left: an open conflict on a file, with its working copy. */
async function conflictLeftOn(path: string, attempted: string, store: ConflictSessionStore = repo, scope: object = repo): Promise<ConflictEditSession> {
  const sessions = new ConflictSessions(versions, store, scope);
  return sessions.withMutation(path, async (gate) =>
    sessions.preserveLocked(gate, { path, text: attempted, base: null, external: await files.readTextFile(path), writer: "adapter" }));
}
const confirmed = async (session: ConflictEditSession, take: string, over: string) =>
  repo.saveConflictSession({ ...session, resolution: { content: take, originalHash: await conflictHash(over), copyHash: await conflictHash(take) } });

describe("an own file written through the top of the chain", () => {
  it.each(OWN_FILES)("%s leaves nothing behind in any link", async (path) => {
    await top.writeTextFile(path, "one");
    later();
    await top.writeTextFile(path, "two");
    later();
    await top.writeTextFile(path, "three");
    expect(await files.readTextFile(path)).toBe("three");
    expect(await under(".plainva/backups"), "a version").toEqual([]);
    expect(await rows("offline_queue", "file_path"), "an entry in the sync queue").toEqual([]);
    expect(await rows("sync_state", "path"), "what the chain wrote last").toEqual([]);
    expect(await under(".plainva/conflicts"), "conflict bookkeeping").toEqual([]);
  });

  it.each(OWN_FILES)("%s is written whatever wrote it in between", async (path) => {
    await top.writeTextFile(path, "one");
    later();
    await top.writeTextFile(path, "two");
    later();
    // Below the chain: a settings profile, a sideband step of the sync — or another device, in a folder both write to.
    await versions.writeTextFile(path, "from elsewhere");
    later();
    await top.writeTextFile(path, "four");
    later();
    await top.writeTextFile(path, "five");
    expect(await files.readTextFile(path)).toBe("five");
    expect(await conflictCopies()).toEqual([]);
    expect(await opened()).toEqual([]);
    expect(merged).toEqual([]);
  });

  it("is changed the same way through the other way in, and through its two halves", async () => {
    const path = OWN_FILES[0];
    await top.writeTextFile(path, "one");
    await versions.writeTextFile(path, "from elsewhere");
    expect(await top.updateTextFile(path, (text) => `${text} and a star`)).toEqual({ before: "from elsewhere", text: "from elsewhere and a star", changed: true, conflict: null });
    // A window that reaches the chain over a bus reads, and writes what it made of that — if the file still is what it read.
    const read = await top.readTextFileState(path);
    expect(read).toEqual({ text: "from elsewhere and a star", workingCopy: null });
    await versions.writeTextFile(path, "from elsewhere again");
    expect(await top.writeTextFileChange(path, read, { text: "made of what was read", workingCopy: null })).toBeNull();
    const again = await top.readTextFileState(path);
    expect(await top.writeTextFileChange(path, again, { text: "made of what is there", workingCopy: null }))
      .toEqual({ before: "from elsewhere again", text: "made of what is there", changed: true, conflict: null });
    expect(await files.readTextFile(path)).toBe("made of what is there");
    expect(await rows("sync_state", "path")).toEqual([]);
    expect(await conflictCopies()).toEqual([]);
    expect(await opened()).toEqual([]);
  });

  it("is no text where its bytes are not UTF-8, and no text is written over it", async () => {
    const path = OWN_FILES[1];
    const bytes = new Uint8Array([0x5b, 0x22, 0xe4, 0x22, 0x5d]); // ["ä"] in Windows-1252
    await files.writeBinaryFile(path, bytes);
    await expect(top.writeTextFile(path, "[]")).rejects.toBeInstanceOf(NotTextFileError);
    await expect(top.updateTextFile(path, () => "[]")).rejects.toBeInstanceOf(NotTextFileError);
    expect(await files.readBinaryFile(path)).toEqual(bytes);
  });

  it("where the app has no index, too: the store that keeps the markers as files gets none", async () => {
    // The phone without its database: the conflict check keeps what it knows in files of its own.
    const store = new ConflictFileStore(files, "device-a");
    const chain = new ConflictAwareVaultAdapter(versions, store, undefined, files, "container");
    const path = OWN_FILES[2];
    await chain.writeTextFile(path, "one");
    await chain.writeTextFile(path, "two");
    await files.writeTextFile(path, "from elsewhere");
    await chain.writeTextFile(path, "three");
    await chain.endOwnFileConflicts();
    expect(await files.readTextFile(path)).toBe("three");
    expect(await under(".plainva/conflicts")).toEqual([]);
    expect(await conflictCopies()).toEqual([]);
  });
});

describe("a person's text", () => {
  it("is still guarded: written below the chain, the next write through it is not a silent overwrite", async () => {
    await top.writeTextFile(NOTE, "# Plan\n\none\n");
    later();
    await top.writeTextFile(NOTE, "# Plan\n\ntwo\n");
    later();
    await files.writeTextFile(NOTE, "# Plan\n\nfrom elsewhere\n");
    later();
    await expect(top.writeTextFile(NOTE, "# Plan\n\nthree\n")).rejects.toBeInstanceOf(ConflictError);
    expect(await files.readTextFile(NOTE)).toBe("# Plan\n\nfrom elsewhere\n");
    expect((await top.listConflictSessions()).map((session) => session.originalPath)).toEqual([NOTE]);
    expect(await rows("sync_state", "path")).toEqual([NOTE]);
    expect(await rows("offline_queue", "file_path")).toContain(NOTE);
  });

  it("is guarded at a local fork of an encrypted workspace as well, though it lies under `.plainva`", async () => {
    // A copy of a note a member may not change: what the app writes there is checked like a write to a note.
    await top.writeTextFile(FORK, "# Plan\n\none\n");
    later();
    await top.writeTextFile(FORK, "# Plan\n\ntwo\n");
    later();
    await files.writeTextFile(FORK, "# Plan\n\nfrom elsewhere\n");
    await expect(top.writeTextFile(FORK, "# Plan\n\nthree\n")).rejects.toBeInstanceOf(ConflictError);
    expect(await files.readTextFile(FORK)).toBe("# Plan\n\nfrom elsewhere\n");

    openChain(); // the app starts again: the conflict is listed, and stays
    expect((await top.listConflictSessions()).map((session) => session.originalPath)).toEqual([FORK]);
    await top.endOwnFileConflicts();
    expect(await opened()).toEqual([FORK]);
    expect(await setAside()).toEqual([]);
  });

  it.each([
    ["the text it started from", "# Plan\n\nmine\n"],
    ["no text it started from — a draft it recovered", null],
  ] as const)("is guarded under `.plainva` when an editor saves it, with %s", async (_case, base) => {
    await files.writeTextFile(NOTE_UNDER_PLAINVA, "# Plan\n\nmine\n");
    await top.acknowledgeExternalUpdate(NOTE_UNDER_PLAINVA);
    await files.writeTextFile(NOTE_UNDER_PLAINVA, "# Plan\n\nfrom elsewhere\n");
    const saved = await top.writeEditorText(NOTE_UNDER_PLAINVA, "# Plan\n\ntyped\n", base);
    expect(saved.session?.writer).toBe("editor-save");
    expect(await files.readTextFile(NOTE_UNDER_PLAINVA)).toBe("# Plan\n\nfrom elsewhere\n");
    const workingCopy = saved.session!.workingCopyPath;
    expect(await files.readTextFile(workingCopy)).toBe("# Plan\n\ntyped\n");
    // What the app writes there while the person's conflict is open does not pass that version by.
    await expect(top.writeTextFile(NOTE_UNDER_PLAINVA, "# Plan\n\nby the app\n")).rejects.toBeInstanceOf(ConflictError);
    expect(await files.readTextFile(NOTE_UNDER_PLAINVA)).toBe("# Plan\n\nfrom elsewhere\n");
    expect(await files.readTextFile(workingCopy)).toBe("# Plan\n\ntyped\n");

    openChain(); // the app starts again: a person's conflict is listed, handed out, and stays
    expect((await top.listConflictSessions()).map((session) => session.originalPath)).toEqual([NOTE_UNDER_PLAINVA]);
    expect((await top.getConflictSession(NOTE_UNDER_PLAINVA))?.workingCopyPath).toBe(workingCopy);
    await top.endOwnFileConflicts();
    expect(await opened()).toEqual([NOTE_UNDER_PLAINVA]);
    expect(await files.readTextFile(workingCopy)).toBe("# Plan\n\ntyped\n");
    expect(await setAside()).toEqual([]);
  });
});

describe("a conflict an older version left on an own file", () => {
  const BOOKMARKS = OWN_FILES[0];

  it("is neither listed nor handed out, and ended in the background: the file stays, what it held is set aside", async () => {
    await files.writeTextFile(BOOKMARKS, "the list the profile wrote");
    await repo.updateLocalHash(BOOKMARKS, await conflictHash("the list the chain wrote before"));
    const left = await conflictLeftOn(BOOKMARKS, "the list of the star that was refused");
    await files.writeTextFile(NOTE, "theirs");
    const kept = await conflictLeftOn(NOTE, "mine");
    expect(await conflictCopies()).toEqual([left.workingCopyPath, kept.workingCopyPath].sort());
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    openChain(); // the app starts again
    expect((await top.listConflictSessions()).map((session) => session.originalPath)).toEqual([NOTE]);
    expect(await top.getConflictSession(BOOKMARKS)).toBeNull();
    await top.endOwnFileConflicts();
    expect(await opened()).toEqual([NOTE]);
    expect(await files.readTextFile(BOOKMARKS)).toBe("the list the profile wrote");
    expect(await files.exists(left.workingCopyPath)).toBe(false);
    const aside = await setAside();
    expect(aside).toHaveLength(1);
    expect(aside[0].endsWith(`-${left.workingCopyPath.slice(left.workingCopyPath.lastIndexOf("/") + 1)}`)).toBe(true);
    expect(await files.readTextFile(aside[0])).toBe("the list of the star that was refused");
    expect(info).toHaveBeenCalledWith(expect.stringContaining(BOOKMARKS));
    // A conflict on a note is the user's to resolve, and stays.
    expect(await files.readTextFile(kept.workingCopyPath)).toBe("mine");
    expect(await conflictCopies()).toEqual([kept.workingCopyPath]);
  });

  it("is passed by by the next write of that file, which lands in the file, and ended in the background", async () => {
    await files.writeTextFile(BOOKMARKS, "the list the profile wrote");
    await repo.updateLocalHash(BOOKMARKS, await conflictHash("the list the chain wrote before"));
    const left = await conflictLeftOn(BOOKMARKS, "the list of the star that was refused");
    vi.spyOn(console, "info").mockImplementation(() => {});

    openChain();
    await top.writeTextFile(BOOKMARKS, "the list with the next star");
    expect(await files.readTextFile(BOOKMARKS)).toBe("the list with the next star");
    await top.endOwnFileConflicts();
    expect(await files.readTextFile(BOOKMARKS)).toBe("the list with the next star");
    expect(await files.exists(left.workingCopyPath)).toBe(false);
    expect(await setAside()).toHaveLength(1);
    expect(await opened()).toEqual([]);
    expect((await under(".plainva/conflicts")).filter((path) => path.includes("/sessions/"))).toEqual([]);
  });

  it("keeps what the conflict held when its working copy is gone: the draft of the session is set aside", async () => {
    await files.writeTextFile(BOOKMARKS, "the list the profile wrote");
    const left = await conflictLeftOn(BOOKMARKS, "the list of the star that was refused");
    await files.deleteItem(left.workingCopyPath);
    vi.spyOn(console, "info").mockImplementation(() => {});

    openChain();
    await top.endOwnFileConflicts();
    const aside = await setAside();
    expect(aside).toHaveLength(1);
    expect(await files.readTextFile(aside[0])).toBe("the list of the star that was refused");
    expect(await files.exists(left.workingCopyPath)).toBe(false);
    expect(await opened()).toEqual([]);
  });

  it("whose resolution was already confirmed is carried out as confirmed", async () => {
    await files.writeTextFile(BOOKMARKS, "theirs");
    const left = await conflictLeftOn(BOOKMARKS, "mine");
    // The comparison was answered ("take mine") and the app went away before the file was replaced.
    await confirmed(left, "mine", "theirs");
    vi.spyOn(console, "info").mockImplementation(() => {});

    openChain();
    expect(await top.listConflictSessions()).toEqual([]);
    await top.endOwnFileConflicts();
    expect(await files.readTextFile(BOOKMARKS)).toBe("mine");
    expect(await opened()).toEqual([]);
    expect(await conflictCopies()).toEqual([]);
    expect(await setAside()).toEqual([]);
  });

  it.each([
    ["its working copy cannot be set aside", (path: string) => path.startsWith(".plainva/conflict-revisions/"), false],
    ["the confirmed resolution cannot be written", (path: string) => path === ".plainva/bookmarks.json", true],
  ] as const)("that cannot be ended now — %s — stays, unlisted, and is ended the next time", async (_case, fails, isConfirmed) => {
    await files.writeTextFile(BOOKMARKS, "theirs");
    const left = await conflictLeftOn(BOOKMARKS, "mine");
    if (isConfirmed) await confirmed(left, "mine", "theirs");
    const write = files.writeTextFile.bind(files);
    const failing = vi.spyOn(files, "writeTextFile").mockImplementation(async (path, text) => {
      if (fails(path)) throw new Error("the disk is full");
      return write(path, text);
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});

    openChain();
    expect(await top.listConflictSessions()).toEqual([]);
    await top.endOwnFileConflicts();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(BOOKMARKS));
    expect(await opened()).toEqual([BOOKMARKS]);
    // Asked by either name, it is not handed out — and not touched: its resolution is not carried out there.
    expect(await top.getConflictSession(BOOKMARKS)).toBeNull();
    expect(await top.getConflictSession(left.workingCopyPath)).toBeNull();
    expect(await files.readTextFile(left.workingCopyPath)).toBe("mine");
    expect(await files.readTextFile(BOOKMARKS)).toBe("theirs");

    failing.mockRestore();
    openChain(); // the next time the vault is open
    await top.endOwnFileConflicts();
    expect(await opened()).toEqual([]);
    expect(await files.exists(left.workingCopyPath)).toBe(false);
    expect(await files.readTextFile(BOOKMARKS)).toBe(isConfirmed ? "mine" : "theirs");
    expect((await setAside()).length).toBe(isConfirmed ? 0 : 1);
  });

  it("is not ended where its copy does not read back the same: the working copy stays, for the next time", async () => {
    await files.writeTextFile(BOOKMARKS, "theirs");
    const left = await conflictLeftOn(BOOKMARKS, "mine");
    const write = files.writeTextFile.bind(files);
    // A copy that lands short — a full disk, a share that drops the end.
    const short = vi.spyOn(files, "writeTextFile").mockImplementation(async (path, text) =>
      write(path, path.startsWith(".plainva/conflict-revisions/") ? text.slice(0, -1) : text));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});

    openChain();
    await top.endOwnFileConflicts();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(BOOKMARKS));
    expect(await opened()).toEqual([BOOKMARKS]);
    expect(await files.readTextFile(left.workingCopyPath)).toBe("mine");

    short.mockRestore();
    openChain(); // the next time the vault is open
    await top.endOwnFileConflicts();
    expect(await opened()).toEqual([]);
    expect(await files.exists(left.workingCopyPath)).toBe(false);
    // The short copy stays where it is; the whole one lies beside it.
    expect((await Promise.all((await setAside()).map((path) => files.readTextFile(path)))).sort()).toEqual(["min", "mine"]);
  });

  it("keeps a working copy another program changed as well: both texts are set aside", async () => {
    await files.writeTextFile(BOOKMARKS, "theirs");
    const left = await conflictLeftOn(BOOKMARKS, "mine");
    await files.writeTextFile(left.workingCopyPath, "changed by another program");
    vi.spyOn(console, "info").mockImplementation(() => {});

    openChain();
    await top.endOwnFileConflicts();
    expect(await opened()).toEqual([]);
    expect(await files.readTextFile(BOOKMARKS)).toBe("theirs");
    expect((await Promise.all((await setAside()).map((path) => files.readTextFile(path)))).sort()).toEqual(["changed by another program", "mine"]);
  });

  it("does not take the list of the vault's conflicts down when it ends while that list is read", async () => {
    await files.writeTextFile(BOOKMARKS, "theirs");
    await conflictLeftOn(BOOKMARKS, "mine");
    await files.writeTextFile(NOTE, "theirs");
    await conflictLeftOn(NOTE, "mine");
    // The background end removes the bookmarks' entry after the folder of entries was listed and before it is read.
    const read = files.readTextFile.bind(files);
    vi.spyOn(files, "readTextFile").mockImplementation(async (path) => {
      if (path.includes("/sessions/") && (await read(path)).includes(BOOKMARKS)) await files.deleteItem(path);
      return read(path);
    });
    expect(await opened()).toEqual([NOTE]);
  });

  it("does not take the conflicts' diagnostics down either, when one of them is pruned while they are read", async () => {
    const store = new ConflictFileStore(files, "device-a");
    for (const path of [BOOKMARKS, NOTE]) {
      await store.recordConflictDiagnostic(await conflictDiagnostic({ path, adapter: "container", writer: "adapter", disk: null, expectedLocalHash: null, base: null, baseSource: "none", wasWrittenByUs: false }));
    }
    const bookmarks = await conflictHash(BOOKMARKS);
    // The newest is recorded and the oldest pruned after the folder of diagnostics was listed and before it is read.
    const read = files.readTextFile.bind(files);
    vi.spyOn(files, "readTextFile").mockImplementation(async (path) => {
      if (path.includes("/diagnostics/") && (await read(path)).includes(bookmarks)) await files.deleteItem(path);
      return read(path);
    });
    expect((await store.listConflictDiagnostics()).map((diagnostic) => diagnostic.pathHash)).toEqual([await conflictHash(NOTE)]);
  });

  it("is ended where the app has no index, too", async () => {
    // The phone without its database: the sessions are files of their own, and the raw storage is the scope.
    const store = new ConflictFileStore(files, "device-a");
    await files.writeTextFile(BOOKMARKS, "the list the profile wrote");
    const left = await conflictLeftOn(BOOKMARKS, "the list of the star that was refused", store, files);
    vi.spyOn(console, "info").mockImplementation(() => {});

    const chain = new ConflictAwareVaultAdapter(versions, store, undefined, files, "container");
    expect(await chain.listConflictSessions()).toEqual([]);
    await chain.endOwnFileConflicts();
    expect(await opened(store)).toEqual([]);
    expect(await files.readTextFile(BOOKMARKS)).toBe("the list the profile wrote");
    expect(await files.exists(left.workingCopyPath)).toBe(false);
    const aside = await setAside();
    expect(aside).toHaveLength(1);
    expect(await files.readTextFile(aside[0])).toBe("the list of the star that was refused");
  });
});
