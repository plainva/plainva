import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realSqlite } from "./helpers/realSqlite.js";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.js";
import { BackupVaultAdapter, DEFAULT_BACKUP_RETENTION } from "../src/vault/BackupVaultAdapter.js";
import { QueueingVaultAdapter } from "../src/vault/QueueingVaultAdapter.js";
import { ConflictAwareVaultAdapter, ConflictError, OPEN_CONFLICT_MESSAGE, OpenConflictError, changeOf } from "../src/vault/ConflictAwareVaultAdapter.js";
import { ConflictFileStore } from "../src/vault/ConflictFileStore.js";
import { SyncStateRepository } from "../src/vault/SyncStateRepository.js";
import { VersionHistoryService } from "../src/vault/VersionHistoryService.js";
import { TextFileChangedError, VaultFileNotFoundError, type IVaultAdapter, type TextChange } from "../src/vault/IVaultAdapter.js";
import { replaceVaultText, updateVaultText } from "../src/vault/updateText.js";
import { decodeConflictSession, type ConflictWriter } from "../src/vault/conflictSession.js";
import { SyncQueue } from "../src/sync/SyncQueue.js";
import { SyncWorker } from "../src/sync/SyncWorker.js";
import type { SyncEngine } from "../src/sync/SyncEngine.js";
import type { ISyncTarget } from "../src/sync/ISyncTarget.js";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.js";

/**
 * Reading a file, changing a place of it and writing it back, as one step of
 * the vault's chain (finding 2026-10-12).
 *
 * A cell of a database, a task's box, a line of the journal, the links a
 * rename rewrites: each reads the note, changes a place and writes the note
 * back. Through `writeTextFile` the chain did not learn that the writer had
 * just read the file and judged it like an editor holding a text from minutes
 * ago — it compared the disk with what it knew last. Two things followed:
 *
 *  - a note changed below the chain (an earlier build of the app, another
 *    program in a folder the user picked) was refused as a conflict, with a
 *    conflict copy of a note nobody else had touched;
 *  - a note with an open conflict lost what the user had typed: the writer had
 *    read the note — the other side's text — and what it wrote was put in
 *    place of the working copy.
 *
 * `updateTextFile` reads inside the chain's gate and calls the change with
 * that text. The real chain throughout: real files, a real SQLite, versions,
 * the sync queue and the conflict check, put together as both shells do it.
 */

const NOTE = "Projects/Alpha.md";
const note = (line: string, status = "open", owner = "Ada") => `---\nstatus: ${status}\nowner: ${owner}\n---\n# Alpha\n\n${line}\n\n- [ ] Call Ada\n`;
const SYNCED = note("Text of Alpha.");
const THEIRS = note("Text of Alpha, as another device left it.");
const MINE = note("Text of Alpha, as it was typed here.");
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** One property set the way a property writer sets it: a line of the block. */
const status = (value: string): TextChange => (text) => text.replace(/^status: .*$/m, `status: ${value}`);
const owner = (value: string): TextChange => (text) => text.replace(/^owner: .*$/m, `owner: ${value}`);
/** A task's box, found by its line: `null` where the line is not there. */
const tick: TextChange = (text) => (text.includes("- [ ] Call Ada") ? text.replace("- [ ] Call Ada", "- [x] Call Ada") : null);

let root: string, raw: LocalVaultAdapter, db: IDatabaseAdapter, repo: SyncStateRepository, chain: ConflictAwareVaultAdapter;
let history: VersionHistoryService, queue: SyncQueue;
/** The versions layer's clock: it takes at most one version of a file per interval. */
let clock: number;
/** Paths the chain merged for. */
let merged: string[];

function build(files: IVaultAdapter = raw, syncQueue: Pick<SyncQueue, "queueWrite"> = queue): ConflictAwareVaultAdapter {
  const backup = new BackupVaultAdapter(files, { policy: DEFAULT_BACKUP_RETENTION, now: () => clock });
  return new ConflictAwareVaultAdapter(new QueueingVaultAdapter(backup, syncQueue as SyncQueue), repo, (path) => { merged.push(path); }, repo, "local");
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "plainva-update-text-"));
  raw = new LocalVaultAdapter(root);
  await raw.initialize();
  db = await realSqlite();
  clock = Date.now();
  merged = [];
  queue = new SyncQueue(db);
  repo = new SyncStateRepository(db, raw, "device-a");
  chain = build();
  history = new VersionHistoryService(raw);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await db.close();
  await rm(root, { recursive: true, force: true });
});

/** A note as a sync left it: on disk, known to the chain, with the base both sides agreed on. */
async function synced(text = SYNCED, path = NOTE): Promise<void> {
  await raw.writeTextFile(path, text);
  await repo.updateLocalHashAndBaseText(path, sha(text), text);
  await repo.updateBaseState(path, sha(text), "etag-1");
}
const onDisk = (path = NOTE) => raw.readTextFile(path);
const row = (path = NOTE) => repo.getSyncState(path);
const queued = async () =>
  (await db.query<{ file_path: string; operation: string }>("SELECT file_path, operation FROM offline_queue ORDER BY id")).map((r) => `${r.operation} ${r.file_path}`);
const versionsOf = async (path = NOTE) => Promise.all((await history.listVersions(path)).map((v) => history.readVersionText(v.backupPath)));
const conflictCopies = async () => (await readdir(join(root, "Projects"))).filter((name) => name.includes(".CONFLICT"));

describe("a file the chain knows", () => {
  it("is read, changed and written like any write: a version, the queue, the marker — and the merge base stays", async () => {
    await synced();
    const result = await chain.updateTextFile(NOTE, status("done"));
    expect(result).toEqual({ before: SYNCED, text: note("Text of Alpha.", "done"), changed: true, conflict: null });
    expect(await onDisk()).toBe(note("Text of Alpha.", "done"));
    expect(await versionsOf()).toEqual([SYNCED]);
    expect(await queued()).toEqual([`write ${NOTE}`]);
    expect(await row()).toMatchObject({ local_sha256: sha(note("Text of Alpha.", "done")), base_text: SYNCED, base_sha256: sha(SYNCED) });
    expect(chain.wasWrittenByUs(NOTE, sha(note("Text of Alpha.", "done")))).toBe(true);
  });

  it("a change that changes nothing writes nothing", async () => {
    await synced();
    expect(await chain.updateTextFile(NOTE, status("open"))).toEqual({ before: SYNCED, text: SYNCED, changed: false, conflict: null });
    expect(await chain.updateTextFile(NOTE, () => null)).toEqual({ before: SYNCED, text: SYNCED, changed: false, conflict: null });
    expect(await versionsOf()).toEqual([]);
    expect(await queued()).toEqual([]);
  });

  it("what the change throws reaches the caller, and nothing is written", async () => {
    await synced();
    await expect(chain.updateTextFile(NOTE, () => { throw new Error("Frontmatter is not a YAML map"); })).rejects.toThrow("Frontmatter is not a YAML map");
    expect(await onDisk()).toBe(SYNCED);
    expect(await queued()).toEqual([]);
    // The gate is free again.
    await chain.updateTextFile(NOTE, status("done"));
    expect(await onDisk()).toBe(note("Text of Alpha.", "done"));
  });

  it("a file that is not there is an error: a change needs something to change", async () => {
    await expect(chain.updateTextFile("Projects/Missing.md", status("done"))).rejects.toBeInstanceOf(VaultFileNotFoundError);
    expect(await raw.exists("Projects/Missing.md")).toBe(false);
  });

  it("keeps line ends and a byte order mark: the change gets the file as it lies there", async () => {
    // Built at run time: the mark is never typed into this file.
    const mark = String.fromCharCode(0xfeff);
    const windows = `${mark}---\r\nstatus: open\r\n---\r\n# Alpha\r\n`;
    await synced(windows);
    await chain.updateTextFile(NOTE, status("done"));
    const written = await onDisk();
    expect(written.charCodeAt(0)).toBe(0xfeff);
    expect(written).toBe(windows.replace("status: open", "status: done"));
  });

  it("two changes of one file at the same time both land", async () => {
    await synced();
    await Promise.all([chain.updateTextFile(NOTE, status("done")), chain.updateTextFile(NOTE, owner("Grace")), chain.updateTextFile(NOTE, tick)]);
    expect(await onDisk()).toBe(note("Text of Alpha.", "done", "Grace").replace("- [ ] Call Ada", "- [x] Call Ada"));
  });

  it("which two plain writes of texts made from the same read cannot: one of them writes the other away", async () => {
    // Why a writer of this kind does not read and call `writeTextFile` itself.
    await synced();
    const read = await chain.readTextFile(NOTE);
    await Promise.all([chain.writeTextFile(NOTE, status("done")(read)!), chain.writeTextFile(NOTE, owner("Grace")(read)!)]);
    // Which of the two is left is a matter of who reached the gate last; both changes it never is.
    expect([note("Text of Alpha.", "done"), note("Text of Alpha.", "open", "Grace")]).toContain(await onDisk());
  });
});

describe("a file changed below the chain", () => {
  it("is written again like any other: no merge, no conflict copy, and the chain knows it afterwards", async () => {
    await synced();
    // What a build of the app from before 2026-10-12 did, and what any other program does.
    await raw.writeTextFile(NOTE, note("Text of Alpha.", "waiting"));
    expect((await row())?.local_sha256).not.toBe(sha(await onDisk()));

    const result = await chain.updateTextFile(NOTE, status("done"));
    expect(result.changed).toBe(true);
    expect(await onDisk()).toBe(note("Text of Alpha.", "done"));
    expect(merged).toEqual([]);
    expect(await chain.listConflictSessions()).toEqual([]);
    expect(await conflictCopies()).toEqual([]);
    // Known again — and what the sync merges against is still the text both sides agreed on.
    expect(await row()).toMatchObject({ local_sha256: sha(note("Text of Alpha.", "done")), base_text: SYNCED, base_sha256: sha(SYNCED) });
    // …so the next plain write of such a file is an ordinary one, too.
    await chain.writeTextFile(NOTE, note("Text of Alpha.", "done", "Grace"));
    expect(await conflictCopies()).toEqual([]);
  });

  it("where a plain write of the same text is refused: it is taken for an editor's text from before the change", async () => {
    await synced();
    await raw.writeTextFile(NOTE, note("Text of Alpha.", "waiting"));
    await expect(chain.writeTextFile(NOTE, note("Text of Alpha.", "done"))).rejects.toThrow(/conflicting changes/);
    expect(await conflictCopies()).toHaveLength(1);
  });

  it("lands after the note was saved here and then changed by another program, wherever that change stands", async () => {
    await synced();
    const edited = note("Text of Alpha, edited here.");
    await chain.writeEditorText(NOTE, edited, SYNCED);
    await raw.writeTextFile(NOTE, `${edited}\nA line another program added.\n`);
    await chain.updateTextFile(NOTE, tick);
    expect(await onDisk()).toBe(`${edited.replace("- [ ] Call Ada", "- [x] Call Ada")}\nA line another program added.\n`);
    expect(await conflictCopies()).toEqual([]);
  });

  it("where a plain write finds no text to merge against and gives up", async () => {
    await synced();
    const edited = note("Text of Alpha, edited here.");
    await chain.writeEditorText(NOTE, edited, SYNCED);
    await raw.writeTextFile(NOTE, `${edited}\nA line another program added.\n`);
    await expect(chain.writeTextFile(NOTE, tick(edited)!)).rejects.toThrow(/base version not found/);
    expect(await conflictCopies()).toHaveLength(1);
  });

  it("a queue entry the database refused does not turn the next change into a conflict", async () => {
    // The phone's database is one connection that refuses a second transaction: the file is written, the entry is not.
    await synced();
    let refuse = true;
    const once = { queueWrite: async (path: string) => { if (refuse) { refuse = false; throw new Error("Already in transaction"); } await queue.queueWrite(path); } };
    chain = build(raw, once);
    await expect(chain.updateTextFile(NOTE, status("done"))).rejects.toThrow("Already in transaction");
    expect(await onDisk()).toBe(note("Text of Alpha.", "done"));
    await chain.updateTextFile(NOTE, owner("Grace"));
    expect(await onDisk()).toBe(note("Text of Alpha.", "done", "Grace"));
    expect(await conflictCopies()).toEqual([]);
    expect(await queued()).toEqual([`write ${NOTE}`]);
  });

  it("a write a link below refuses is not recorded as written", async () => {
    await synced();
    class ReadOnly extends LocalVaultAdapter {
      override async writeTextFile(): Promise<void> { throw Object.assign(new Error("Permission denied"), { code: "PERMISSION_DENIED" }); }
    }
    const locked = new ReadOnly(root);
    await locked.initialize();
    chain = build(locked);
    await expect(chain.updateTextFile(NOTE, status("done"))).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(await onDisk()).toBe(SYNCED);
    expect((await row())?.local_sha256).toBe(sha(SYNCED));
    expect(await queued()).toEqual([]);
  });
});

/** Opens a conflict on the note the way each kind of writer does: the note then carries THEIRS, the working copy MINE. */
async function openConflict(writer: ConflictWriter): Promise<string> {
  await synced();
  if (writer === "sync-pull") {
    // Typed here and not uploaded yet; the pull brings the other device's version of the same line.
    await raw.writeTextFile(NOTE, MINE);
    const worker = new SyncWorker({} as SyncEngine, { download: async () => new TextEncoder().encode(THEIRS) } as unknown as ISyncTarget, repo, raw, queue);
    worker["isRunning"] = true;
    await worker["reconcilePulledFile"](NOTE, "remote-v2", null, Date.now(), []);
    worker.stop();
  } else {
    await raw.writeTextFile(NOTE, THEIRS);
    if (writer === "editor-save") await chain.writeEditorText(NOTE, MINE, SYNCED);
    if (writer === "editor-external") await chain.preserveConflict(NOTE, MINE, writer);
    if (writer === "adapter") await chain.writeTextFile(NOTE, MINE).catch((error) => { expect(error).toBeInstanceOf(ConflictError); });
  }
  const session = await chain.getConflictSession(NOTE);
  if (!session) throw new Error(`no conflict opened by ${writer}`);
  expect(session.writer).toBe(writer);
  expect(await onDisk()).toBe(THEIRS);
  expect(await onDisk(session.workingCopyPath)).toBe(MINE);
  return session.workingCopyPath;
}

describe("a file with an open conflict", () => {
  it.each(["editor-save", "editor-external", "sync-pull", "adapter"] as const)("opened by %s: the file takes the change, and so does the user's own version", async (writer) => {
    const copy = await openConflict(writer);
    const result = await chain.updateTextFile(NOTE, status("done"));
    expect(result).toEqual({ before: THEIRS, text: THEIRS.replace("status: open", "status: done"), changed: true, conflict: { workingCopyPath: copy, changed: true } });
    // The file as tables, task lists and the other devices read it …
    expect(await onDisk()).toBe(THEIRS.replace("status: open", "status: done"));
    // … and the working copy: what was typed here, with the same change — never the other side's text.
    expect(await onDisk(copy)).toBe(MINE.replace("status: open", "status: done"));
    expect(await conflictCopies()).toHaveLength(1);
    expect((await chain.getConflictSession(NOTE))?.workingCopyPath).toBe(copy);
    // The file goes up like any change; the working copy never does.
    expect(await queued()).toContain(`write ${NOTE}`);
    expect((await queued()).filter((entry) => entry.includes(".CONFLICT"))).toEqual([]);
  });

  it("keeps what was typed into the conflict half a minute before — the text no version holds", async () => {
    const copy = await openConflict("editor-save");
    clock += 10 * 60_000;
    const typed = MINE.replace("\n\n- [ ]", "\n\nA sentence typed half a minute ago.\n\n- [ ]");
    await chain.writeEditorText(NOTE, typed, MINE);
    expect(await versionsOf(copy)).toEqual([MINE]);
    clock += 30_000;
    await chain.updateTextFile(NOTE, status("done"));
    expect(await onDisk(copy)).toBe(typed.replace("status: open", "status: done"));
  });

  it("a change that finds no place in the user's own version leaves that version as it is", async () => {
    const copy = await openConflict("editor-save");
    // The user reworded the task in their version; the task list reads the file and ticks the line it shows.
    const reworded = MINE.replace("- [ ] Call Ada", "- [ ] Call Ada tomorrow morning");
    await chain.writeEditorText(NOTE, reworded, MINE);
    const exact: TextChange = (text) => (text.includes("- [ ] Call Ada\n") ? text.replace("- [ ] Call Ada\n", "- [x] Call Ada\n") : null);
    const result = await chain.updateTextFile(NOTE, exact);
    expect(result.changed).toBe(true);
    expect(result.conflict).toEqual({ workingCopyPath: copy, changed: false });
    expect(await onDisk()).toBe(THEIRS.replace("- [ ] Call Ada", "- [x] Call Ada"));
    expect(await onDisk(copy)).toBe(reworded);
  });

  it("each version takes what the change makes of it: where the file has nothing to change, the user's own version still may", async () => {
    const copy = await openConflict("editor-save");
    // A link to a note that was renamed: the other side dropped the link, the user's version still carries it.
    const linked = MINE.replace("typed here", "typed here, see [[Old name]]");
    await chain.writeEditorText(NOTE, linked, MINE);
    const before = await queued();
    const result = await chain.updateTextFile(NOTE, (text) => (text.includes("[[Old name]]") ? text.replace("[[Old name]]", "[[New name]]") : null));
    // The file was not written — no version, no queue entry, no new marker …
    expect(result).toEqual({ before: THEIRS, text: THEIRS, changed: false, conflict: { workingCopyPath: copy, changed: true } });
    expect(await onDisk()).toBe(THEIRS);
    expect(await queued()).toEqual(before);
    // … and the user's version follows the rename, whichever version is kept in the end.
    expect(await onDisk(copy)).toBe(linked.replace("[[Old name]]", "[[New name]]"));
  });

  it("a change the user's own version makes throw leaves that version as it is, and the file still takes it", async () => {
    const copy = await openConflict("editor-save");
    let calls = 0;
    const result = await chain.updateTextFile(NOTE, (text) => {
      calls += 1;
      if (text === MINE) throw new Error("Frontmatter is not a YAML map");
      return status("done")(text);
    });
    expect(calls).toBe(2);
    expect(result.conflict).toEqual({ workingCopyPath: copy, changed: false });
    expect(await onDisk()).toBe(THEIRS.replace("status: open", "status: done"));
    expect(await onDisk(copy)).toBe(MINE);
  });

  it("is called with the file first: what it throws there is the caller's, and neither text is touched", async () => {
    const copy = await openConflict("editor-save");
    await expect(chain.updateTextFile(NOTE, (text) => { if (text === THEIRS) throw new Error("refused"); return text; })).rejects.toThrow("refused");
    expect(await onDisk()).toBe(THEIRS);
    expect(await onDisk(copy)).toBe(MINE);
  });

  it("a writer that names the working copy changes that one only", async () => {
    const copy = await openConflict("editor-save");
    const result = await chain.updateTextFile(copy, status("done"));
    expect(result).toEqual({ before: MINE, text: MINE.replace("status: open", "status: done"), changed: true, conflict: { workingCopyPath: copy, changed: true } });
    expect(await onDisk(copy)).toBe(MINE.replace("status: open", "status: done"));
    expect(await onDisk()).toBe(THEIRS);
    expect(await queued()).toEqual([]);
    // The session's journal took it: an editor that goes on from this text is not told its draft changed elsewhere.
    const next = await chain.writeEditorText(NOTE, MINE.replace("status: open", "status: done").replace("typed here", "typed here, and more"), MINE.replace("status: open", "status: done"));
    expect(next.session?.foreignCopySnapshot).toBeNull();
  });

  it("an editor that still holds the text from before the change gets it merged into its next save", async () => {
    const copy = await openConflict("editor-save");
    await chain.updateTextFile(NOTE, status("done"));
    // The editor shows the working copy and saves its typing with the text it started from.
    const saved = await chain.writeEditorText(NOTE, MINE.replace("typed here", "typed here, and more"), MINE);
    expect(saved.stored).toBe(MINE.replace("status: open", "status: done").replace("typed here", "typed here, and more"));
    expect(await onDisk(copy)).toBe(saved.stored);
  });

  it("resolving afterwards finds the change on both sides, whichever is kept", async () => {
    const copy = await openConflict("editor-save");
    await chain.updateTextFile(NOTE, status("done"));
    const theirs = await onDisk(), mine = await onDisk(copy);
    await chain.resolveConflict(NOTE, { originalText: theirs, copyText: mine, content: mine });
    expect(await onDisk()).toBe(MINE.replace("status: open", "status: done"));
    expect(await chain.getConflictSession(NOTE)).toBeNull();
    expect(await conflictCopies()).toEqual([]);
  });

  it("a conflict that is being resolved is not written into", async () => {
    await openConflict("editor-save");
    vi.spyOn(raw, "deleteItem").mockRejectedValueOnce(new Error("busy"));
    await expect(chain.resolveConflict(NOTE, { originalText: THEIRS, copyText: MINE, content: MINE })).rejects.toThrow("busy");
    await expect(chain.updateTextFile(NOTE, status("done"))).rejects.toThrow("Conflict resolution is still being completed");
    // Asking for the conflict finishes what was confirmed; the file is an ordinary one again.
    expect(await chain.getConflictSession(NOTE)).toBeNull();
    await chain.updateTextFile(NOTE, status("done"));
    expect(await onDisk()).toBe(MINE.replace("status: open", "status: done"));
  });
});

describe("a write that names no starting text, at a file with an open conflict", () => {
  it("does not replace the user's own version: nothing is written, and it is told so", async () => {
    const copy = await openConflict("editor-save");
    // A view that read the file — the other side — and writes its whole text back.
    const failure = await chain.writeTextFile(NOTE, THEIRS.replace("status: open", "status: done")).then(() => null, (error: unknown) => error);
    expect(failure).toBeInstanceOf(ConflictError);
    expect((failure as ConflictError).message).toBe(OPEN_CONFLICT_MESSAGE);
    expect((failure as ConflictError).conflictPath).toBe(copy);
    expect(await onDisk(copy)).toBe(MINE);
    expect(await onDisk()).toBe(THEIRS);
    expect(await versionsOf(copy)).toEqual([]);
  });

  it.each(["editor-external", "sync-pull"] as const)("nor a version the %s kept", async (writer) => {
    const copy = await openConflict(writer);
    await expect(chain.writeTextFile(NOTE, "something else entirely\n")).rejects.toThrow(OPEN_CONFLICT_MESSAGE);
    expect(await onDisk(copy)).toBe(MINE);
  });

  it("replaces the copy it opened itself: its own earlier text, followed by its newer one", async () => {
    const copy = await openConflict("adapter");
    const newer = MINE.replace("owner: Ada", "owner: Grace");
    await expect(chain.writeTextFile(NOTE, newer)).rejects.toThrow("The changes are saved in the local conflict working copy");
    expect(await onDisk(copy)).toBe(newer);
    await expect(chain.writeTextFile(NOTE, newer.replace("status: open", "status: done"))).rejects.toThrow("The changes are saved in the local conflict working copy");
    expect(await onDisk(copy)).toBe(newer.replace("status: open", "status: done"));
    expect(await onDisk()).toBe(THEIRS);
  });

  it("but no longer once an editor has typed into that copy", async () => {
    const copy = await openConflict("adapter");
    const typed = MINE.replace("typed here", "typed here, and then in the editor");
    await chain.writeEditorText(NOTE, typed, MINE);
    await expect(chain.writeTextFile(NOTE, MINE.replace("owner: Ada", "owner: Grace"))).rejects.toThrow(OPEN_CONFLICT_MESSAGE);
    expect(await onDisk(copy)).toBe(typed);
  });

  it("nor once a change was carried into it", async () => {
    const copy = await openConflict("adapter");
    await chain.updateTextFile(NOTE, status("done"));
    await expect(chain.writeTextFile(NOTE, MINE.replace("owner: Ada", "owner: Grace"))).rejects.toThrow(OPEN_CONFLICT_MESSAGE);
    expect(await onDisk(copy)).toBe(MINE.replace("status: open", "status: done"));
  });

  it("the same text again is no second write, and no refusal of the first", async () => {
    const copy = await openConflict("editor-save");
    await expect(chain.writeTextFile(NOTE, MINE)).rejects.toThrow("The changes are saved in the local conflict working copy");
    expect(await onDisk(copy)).toBe(MINE);
  });

  it("the refusal has a name of its own: nothing was kept anywhere, where a ConflictError says the text was kept", async () => {
    await openConflict("editor-save");
    const refused = await chain.writeTextFile(NOTE, "something else entirely\n").then(() => null, (error: unknown) => error);
    expect(refused).toBeInstanceOf(OpenConflictError);
    expect((refused as Error).name).toBe("OpenConflictError");
    // The text is the user's own already: kept, and said the way it always was.
    const kept = await chain.writeTextFile(NOTE, MINE).then(() => null, (error: unknown) => error);
    expect(kept).toBeInstanceOf(ConflictError);
    expect(kept).not.toBeInstanceOf(OpenConflictError);
    expect((kept as Error).name).toBe("ConflictError");
  });

  it("a whole text that names the working copy itself is written into it: that writer read the copy", async () => {
    // Opened by a write without a starting text: until here the copy was that writer's own, and its next text would follow it.
    const copy = await openConflict("adapter");
    // A version of the working copy put back, a database opened from its own conflict copy and saved.
    const restored = MINE.replace("typed here", "typed here, in an earlier version");
    await chain.writeTextFile(copy, restored);
    expect(await onDisk(copy)).toBe(restored);
    expect(await onDisk()).toBe(THEIRS);
    // The copy stays the draft of a conflict and no file of the vault: no marker of its own, nothing to upload.
    expect(await row(copy)).toBeNull();
    expect(await queued()).toEqual([]);
    expect((await chain.getConflictSession(NOTE))?.workingCopyPath).toBe(copy);
    // From here on it is the user's own version: a whole text for the file itself no longer replaces it.
    await expect(chain.writeTextFile(NOTE, "something else entirely\n")).rejects.toThrow(OPEN_CONFLICT_MESSAGE);
    expect(await onDisk(copy)).toBe(restored);
  });

  it("a conflict an older version left counts as somebody else's", async () => {
    const copy = await openConflict("adapter");
    // As a version before 2026-10-12 stored it: no word on who wrote the draft.
    const store = new ConflictFileStore(raw, "device-a");
    const older = { ...(await repo.getConflictSession(NOTE))! };
    delete older.plainDraft;
    await store.saveConflictSession(decodeConflictSession(JSON.stringify(older)));
    expect((await repo.getConflictSession(NOTE))?.plainDraft).toBeUndefined();
    await expect(chain.writeTextFile(NOTE, MINE.replace("owner: Ada", "owner: Grace"))).rejects.toThrow(OPEN_CONFLICT_MESSAGE);
    expect(await onDisk(copy)).toBe(MINE);
  });
});

describe("the same step for a window that reaches the chain over a bus", () => {
  it("reads the file, and writes what was made of it if the file still is what was read", async () => {
    await synced();
    const state = await chain.readTextFileState(NOTE);
    expect(state).toEqual({ text: SYNCED, workingCopy: null });
    const result = await chain.writeTextFileChange(NOTE, state, changeOf(state, status("done")));
    expect(result).toEqual({ before: SYNCED, text: note("Text of Alpha.", "done"), changed: true, conflict: null });
    expect(await onDisk()).toBe(note("Text of Alpha.", "done"));
  });

  it("writes nothing over a file that changed in between: the window reads again", async () => {
    await synced();
    const state = await chain.readTextFileState(NOTE);
    await chain.updateTextFile(NOTE, owner("Grace"));
    expect(await chain.writeTextFileChange(NOTE, state, changeOf(state, status("done")))).toBeNull();
    expect(await onDisk()).toBe(note("Text of Alpha.", "open", "Grace"));
    const again = await chain.readTextFileState(NOTE);
    await chain.writeTextFileChange(NOTE, again, changeOf(again, status("done")));
    expect(await onDisk()).toBe(note("Text of Alpha.", "done", "Grace"));
  });

  it("carries both texts of an open conflict, and notices typing into the working copy in between", async () => {
    const copy = await openConflict("editor-save");
    const state = await chain.readTextFileState(NOTE);
    expect(state).toEqual({ text: THEIRS, workingCopy: MINE });
    const typed = MINE.replace("typed here", "typed here, and more");
    await chain.writeEditorText(NOTE, typed, MINE);
    expect(await chain.writeTextFileChange(NOTE, state, changeOf(state, status("done")))).toBeNull();
    const again = await chain.readTextFileState(NOTE);
    const result = await chain.writeTextFileChange(NOTE, again, changeOf(again, status("done")));
    expect(result?.conflict).toEqual({ workingCopyPath: copy, changed: true });
    expect(await onDisk(copy)).toBe(typed.replace("status: open", "status: done"));
    expect(await onDisk()).toBe(THEIRS.replace("status: open", "status: done"));
  });

  it("notices a conflict that opened, and one that was resolved, between its two halves", async () => {
    await synced();
    const before = await chain.readTextFileState(NOTE);
    // A conflict opens while the window computes: the file now has a second version to change.
    await raw.writeTextFile(NOTE, THEIRS);
    const copy = (await chain.writeEditorText(NOTE, MINE, SYNCED)).session!.workingCopyPath;
    expect(await chain.writeTextFileChange(NOTE, before, changeOf(before, status("done")))).toBeNull();
    expect(await onDisk()).toBe(THEIRS);
    expect(await onDisk(copy)).toBe(MINE);
    // And the other way round: read with the conflict open, written after it was resolved.
    const during = await chain.readTextFileState(NOTE);
    await chain.resolveConflict(NOTE, { originalText: THEIRS, copyText: MINE, content: MINE });
    expect(await chain.writeTextFileChange(NOTE, during, changeOf(during, status("done")))).toBeNull();
    expect(await onDisk()).toBe(MINE);
  });

  it("with the working copy as the path named, it is that copy's two halves", async () => {
    const copy = await openConflict("editor-save");
    const state = await chain.readTextFileState(copy);
    expect(state).toEqual({ text: MINE, workingCopy: null });
    const result = await chain.writeTextFileChange(copy, state, changeOf(state, status("done")));
    expect(result).toEqual({ before: MINE, text: MINE.replace("status: open", "status: done"), changed: true, conflict: { workingCopyPath: copy, changed: true } });
    expect(await onDisk(copy)).toBe(MINE.replace("status: open", "status: done"));
    expect(await onDisk()).toBe(THEIRS);
  });
});

describe("what a step leaves behind when it fails half way", () => {
  /** The files, with a write of one path refused as long as `refusing` says so. */
  function refusingWrites(refusing: (path: string) => boolean): IVaultAdapter {
    class Refusing extends LocalVaultAdapter {
      override async writeTextFile(path: string, content: string): Promise<void> {
        if (refusing(path)) throw new Error("disk full");
        return super.writeTextFile(path, content);
      }
    }
    return new Refusing(root);
  }

  it("the working copy that could not be written: the journal holds the change, the result says so, and the copy follows with the conflict's next step", async () => {
    const copy = await openConflict("editor-save");
    let full = true;
    const files = refusingWrites((path) => full && path === copy);
    await files.initialize();
    chain = build(files);
    const result = await chain.updateTextFile(NOTE, status("done"));
    // The file has the change, and nothing was thrown for it.
    expect(result.changed).toBe(true);
    expect(await onDisk()).toBe(THEIRS.replace("status: open", "status: done"));
    // The working copy's file is still the old text — but the journal took the new draft, and the result does not claim otherwise.
    expect(await onDisk(copy)).toBe(MINE);
    expect(result.conflict).toEqual({ workingCopyPath: copy, changed: true });
    // The disk has room again: the next time anybody asks for the conflict, the copy is written.
    full = false;
    await chain.getConflictSession(NOTE);
    expect(await onDisk(copy)).toBe(MINE.replace("status: open", "status: done"));
  });

  it("the journal that could not be written: the user's version stays what it was, and the result says that", async () => {
    const copy = await openConflict("editor-save");
    const save = vi.spyOn(repo, "saveConflictSession").mockRejectedValueOnce(new Error("database is locked"));
    const result = await chain.updateTextFile(NOTE, status("done"));
    expect(save).toHaveBeenCalled();
    expect(result.changed).toBe(true);
    expect(result.conflict).toEqual({ workingCopyPath: copy, changed: false });
    expect(await onDisk()).toBe(THEIRS.replace("status: open", "status: done"));
    expect(await onDisk(copy)).toBe(MINE);
    // Asked again, the change finds the file done and the copy still to do.
    const again = await chain.updateTextFile(NOTE, status("done"));
    expect(again).toMatchObject({ changed: false, conflict: { workingCopyPath: copy, changed: true } });
    expect(await onDisk(copy)).toBe(MINE.replace("status: open", "status: done"));
  });
});

describe("where the chain keeps its conflicts in files, because the vault's database could not be opened", () => {
  it("the entry works the same: the file is changed as it lies there, and an open conflict takes the change in both versions", async () => {
    const store = new ConflictFileStore(raw, "device-a");
    chain = new ConflictAwareVaultAdapter(new BackupVaultAdapter(raw, { policy: DEFAULT_BACKUP_RETENTION, now: () => clock }), store, undefined, raw, "local");
    await raw.writeTextFile(NOTE, SYNCED);
    await chain.updateTextFile(NOTE, owner("Grace"));
    expect(await onDisk()).toBe(note("Text of Alpha.", "open", "Grace"));
    // Another program changes the note, an editor's save cannot be merged: a conflict, kept in files.
    await raw.writeTextFile(NOTE, THEIRS);
    const copy = (await chain.writeEditorText(NOTE, MINE, note("Text of Alpha.", "open", "Grace"))).session!.workingCopyPath;
    const result = await chain.updateTextFile(NOTE, status("done"));
    expect(result.conflict).toEqual({ workingCopyPath: copy, changed: true });
    expect(await onDisk()).toBe(THEIRS.replace("status: open", "status: done"));
    expect(await onDisk(copy)).toBe(MINE.replace("status: open", "status: done"));
  });
});

describe("replaceVaultText: a whole file replaced by what was made of exactly its text", () => {
  /** What a conversion does: a backup of the text it was handed, then the new text. */
  const converted = (backups: string[]) => async (text: string) => { backups.push(text); return text.replace("# Alpha", "# Alpha, converted"); };

  it("writes what was made of the file's text, and the backup holds the text that was replaced", async () => {
    await synced();
    const backups: string[] = [];
    const result = await replaceVaultText(chain, NOTE, converted(backups));
    expect(result.changed).toBe(true);
    expect(await onDisk()).toBe(SYNCED.replace("# Alpha", "# Alpha, converted"));
    expect(backups).toEqual([SYNCED]);
  });

  it("is asked again where the file changed while it was prepared: nothing is written over the change, and the backup that counts is the later one", async () => {
    await synced();
    const backups: string[] = [];
    const result = await replaceVaultText(chain, NOTE, async (text) => {
      // While the backup is written, a cell is edited elsewhere.
      if (backups.length === 0) await chain.updateTextFile(NOTE, owner("Grace"));
      return converted(backups)(text);
    });
    expect(backups).toEqual([SYNCED, note("Text of Alpha.", "open", "Grace")]);
    expect(result.before).toBe(note("Text of Alpha.", "open", "Grace"));
    expect(await onDisk()).toBe(note("Text of Alpha.", "open", "Grace").replace("# Alpha", "# Alpha, converted"));
  });

  it("gives up on a file that never holds still, with nothing of its own written", async () => {
    await synced();
    let n = 0;
    await expect(replaceVaultText(chain, NOTE, async (text) => {
      await chain.updateTextFile(NOTE, owner(`Writer ${++n}`));
      return `${text}converted\n`;
    })).rejects.toBeInstanceOf(TextFileChangedError);
    expect(n).toBe(4);
    expect(await onDisk()).toBe(note("Text of Alpha.", "open", "Writer 4"));
  });

  it("leaves the file alone where there is nothing to make of it", async () => {
    await synced();
    const result = await replaceVaultText(chain, NOTE, async () => null);
    expect(result).toMatchObject({ before: SYNCED, changed: false });
    expect(await queued()).toEqual([]);
  });

  it("refuses a file with an open conflict, whichever of its two texts is named: nothing is prepared and neither is touched", async () => {
    const copy = await openConflict("editor-save");
    const backups: string[] = [];
    for (const path of [NOTE, copy]) {
      const refused = await replaceVaultText(chain, path, converted(backups)).then(() => null, (error: unknown) => error);
      expect(refused).toBeInstanceOf(OpenConflictError);
      expect((refused as OpenConflictError).conflictPath).toBe(copy);
    }
    // No backup of a file nothing was done to: an undo has nothing to put back over the version the user decides for.
    expect(backups).toEqual([]);
    expect(await onDisk()).toBe(THEIRS);
    expect(await onDisk(copy)).toBe(MINE);
    expect(await queued()).toEqual([]);
  });

  it("a conflict that opens while the file is prepared: the new text is not written, and the next look refuses", async () => {
    await synced();
    const backups: string[] = [];
    const refused = await replaceVaultText(chain, NOTE, async (text) => {
      // While the backup is written, another device's version arrives and collides with what is typed here.
      if (backups.length === 0) {
        await raw.writeTextFile(NOTE, THEIRS);
        await chain.writeEditorText(NOTE, MINE, SYNCED);
      }
      return converted(backups)(text);
    }).then(() => null, (error: unknown) => error);
    expect(refused).toBeInstanceOf(OpenConflictError);
    // Prepared once, from the text before the conflict; what was made of it went nowhere.
    expect(backups).toEqual([SYNCED]);
    const copy = (await chain.getConflictSession(NOTE))!.workingCopyPath;
    expect((refused as OpenConflictError).conflictPath).toBe(copy);
    expect(await onDisk()).toBe(THEIRS);
    expect(await onDisk(copy)).toBe(MINE);
  });

  it("compares inside a change where the files carry the chain's entry and not its two halves", async () => {
    await synced();
    const entryOnly = {
      readTextFile: (path: string) => chain.readTextFile(path),
      writeTextFile: (path: string, text: string) => chain.writeTextFile(path, text),
      updateTextFile: (path: string, change: TextChange) => chain.updateTextFile(path, change),
    };
    const grace = note("Text of Alpha.", "open", "Grace");
    const backups: string[] = [];
    const result = await replaceVaultText(entryOnly, NOTE, async (text) => {
      if (backups.length === 0) await chain.updateTextFile(NOTE, owner("Grace"));
      return converted(backups)(text);
    });
    expect(backups).toEqual([SYNCED, grace]);
    expect(result).toMatchObject({ before: grace, changed: true });
    expect(await onDisk()).toBe(grace.replace("# Alpha", "# Alpha, converted"));
    // Nothing to make of the file: it is left alone, and that is an answer, not a file that changed.
    expect(await replaceVaultText(entryOnly, NOTE, async () => null)).toMatchObject({ changed: false });
    // And a file that never holds still is given up on here too.
    let n = 0;
    await expect(replaceVaultText(entryOnly, NOTE, async (text) => {
      await chain.updateTextFile(NOTE, owner(`Writer ${++n}`));
      return `${text}converted\n`;
    })).rejects.toBeInstanceOf(TextFileChangedError);
    expect(n).toBe(4);
  });

  it("reads and writes where the files are a storage with no chain above it", async () => {
    await raw.writeTextFile(NOTE, SYNCED);
    const backups: string[] = [];
    await replaceVaultText(raw, NOTE, converted(backups));
    expect(await onDisk()).toBe(SYNCED.replace("# Alpha", "# Alpha, converted"));
  });
});

describe("updateVaultText, the one call of every writer of this kind", () => {
  it("takes the chain's entry where the files are a chain", async () => {
    const copy = await openConflict("editor-save");
    const result = await updateVaultText(chain, NOTE, status("done"));
    expect(result.conflict).toEqual({ workingCopyPath: copy, changed: true });
    expect(await onDisk(copy)).toBe(MINE.replace("status: open", "status: done"));
  });

  it("reads and writes where they are a storage with no chain above it", async () => {
    await raw.writeTextFile(NOTE, SYNCED);
    expect(await updateVaultText(raw, NOTE, status("done"))).toEqual({ before: SYNCED, text: note("Text of Alpha.", "done"), changed: true, conflict: null });
    expect(await onDisk()).toBe(note("Text of Alpha.", "done"));
    expect(await updateVaultText(raw, NOTE, () => null)).toMatchObject({ changed: false });
    // …and for the double of a test, which has the two methods and nothing else.
    const texts = new Map([[NOTE, SYNCED]]);
    const double = { readTextFile: async (path: string) => texts.get(path)!, writeTextFile: async (path: string, text: string) => { texts.set(path, text); } };
    await updateVaultText(double, NOTE, owner("Grace"));
    expect(texts.get(NOTE)).toBe(note("Text of Alpha.", "open", "Grace"));
  });

  it("refuses files that hand on a chain and leave its entry behind", async () => {
    await synced();
    // A wrapper around the chain that forwards what it knew of: it would read and write the old way without anyone noticing.
    const wrapper = {
      readTextFile: (path: string) => chain.readTextFile(path),
      writeTextFile: (path: string, text: string) => chain.writeTextFile(path, text),
      getConflictSession: (path: string) => chain.getConflictSession(path),
    };
    await expect(updateVaultText(wrapper, NOTE, status("done"))).rejects.toThrow(/without its entry for a change/);
    expect(await onDisk()).toBe(SYNCED);
  });
});
