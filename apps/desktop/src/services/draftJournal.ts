import { invoke } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import { exists, mkdir, readDir, readTextFile, remove, stat } from "@tauri-apps/plugin-fs";
import { utf8Encode, workspaceSha256Hex } from "@plainva/core";
import {
  createDraftJournal,
  createDraftWriter,
  decodeDraftJournal,
  encodeDraftJournal,
  relocatedDraftPath,
  type DraftJournal,
  type DraftJournalEntry,
  type DraftJournalLayout,
  type DraftJournalStorage,
  type DraftWriter,
} from "@plainva/ui";
import { isOwnerWindow } from "./windowContext";
import { getWindowBus } from "./windowBus";
import { checkedReadTextFile } from "../adapters/checkedFilesystem";

/**
 * Crash/draft recovery journal (hardening plan P2.4). While a note is dirty,
 * the editor snapshots the buffer here (debounced ~2 s); a successful save
 * clears the entry. On opening a file, a surviving journal entry whose text
 * differs from the disk content is offered in a banner ("restore draft?").
 *
 * Honest scope: this narrows the loss window of a hard crash to roughly the
 * snapshot debounce and makes save failures RECOVERABLE and VISIBLE — it is
 * not a zero-loss guarantee.
 *
 * Storage: <appData>/drafts/<vaultKey>/<noteKey>.json — deliberately
 * OUTSIDE the vault (never synced, never in vault backups). Written through
 * the atomic write command (a torn journal would defeat its purpose).
 * Entries carry a monotonic revision: a save only clears the journal if no
 * NEWER snapshot was taken meanwhile (latest wins). Retention: entries older
 * than 7 days are pruned on vault open. "Forget app data" (vaultForget)
 * removes the vault's whole draft folder. Diagnostics exports never include
 * journal content (they only ever carry logs).
 *
 * The journal itself is the shared one (`draftJournal.ts` in `@plainva/ui`,
 * stability plan R6), the phone's as well; what is the desktop's own here is
 * where the files lie and how they are written, and that an auxiliary window
 * hands its snapshots to the owner. Snapshots are buffered and written at
 * most every 400 ms while typing goes on (`writeDraft`); until 2026-11-11 a
 * snapshot waited for a 400-ms PAUSE in the typing, and a crash during
 * continuous typing lost everything since the last pause.
 *
 * File names (open-items plan 3.124): the keys are SHA-256 of the vault path
 * and of the note path (`draftPathKey`). Until 2026-10-30 they were a 64-bit
 * FNV-1a computed with JavaScript numbers, whose products pass 2^53 and lose
 * their low digits: `Notes/A.md` and `Notes/B.md` — or the vaults
 * `C:/vaults/A` and `C:/vaults/B` — got the same name, and a draft could be
 * offered at, and restored into, the wrong note. Files under those old names
 * are still read, moved, cleared and pruned (`legacyPathHash`), never written
 * again, and every reader takes only the entries that name its vault and note.
 */

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
/** How long a move or a closing window waits for a snapshot that is still being written: never for good. */
const MOVE_WAIT_MS = 2_000;

type DraftEntry = DraftJournalEntry;

/**
 * The file-name key of a path in the app's own journals: SHA-256, 128 bits in
 * hex. Collision-free in practice, and every reader checks the path stored in
 * the entry anyway.
 */
export function draftPathKey(input: string): string {
  return workspaceSha256Hex(utf8Encode(input)).slice(0, 32);
}

/**
 * The OLD file-name handle, kept bit for bit so journals written before
 * 2026-10-30 are still found. It is lossy (see the header) — never use it for
 * a new name. Also the folder name of the comment-operation journal, which
 * keeps it so pending operations stay where they were written (its entries
 * carry their workspace context and are filtered by it).
 */
export function legacyPathHash(input: string): string {
  let hi = 0xcbf29ce4, lo = 0x84222325;
  for (let i = 0; i < input.length; i++) {
    lo ^= input.charCodeAt(i);
    const loNew = (lo >>> 0) * 0x1b3 + (((hi >>> 0) * 0x1b3) % 0x100000000) * 0x100000000;
    hi = Math.floor(loNew / 0x100000000) % 0x100000000;
    lo = loNew % 0x100000000;
  }
  return ((hi >>> 0).toString(16).padStart(8, "0") + (lo >>> 0).toString(16).padStart(8, "0"));
}

let draftsRootPromise: Promise<{ dir: string; rootId: string }> | null = null;

/**
 * Where the journal lives — without creating anything.
 *
 * Split from `draftsRoot()` for the auxiliary windows (multi-window P1): they
 * READ drafts locally, and creating the directory is an fs write their
 * capability deliberately withholds. Nothing to read means nothing to create.
 */
async function draftsDir(): Promise<string> {
  return join(await appDataDir(), "drafts");
}

async function draftsRoot(): Promise<{ dir: string; rootId: string }> {
  if (!draftsRootPromise) {
    draftsRootPromise = (async () => {
      const dir = await draftsDir();
      if (!(await exists(dir))) await mkdir(dir, { recursive: true });
      const rootId = await invoke<string>("register_write_root", { path: dir });
      return { dir, rootId };
    })().catch((e) => {
      draftsRootPromise = null;
      throw e;
    });
  }
  return draftsRootPromise;
}

/** The journal file of a note, relative to the drafts folder — the one every snapshot is written to. */
export function draftJournalFile(vaultPath: string, notePath: string): string {
  return `${draftPathKey(vaultPath)}/${draftPathKey(notePath)}.json`;
}

/** Where an older version kept that note's journal: read, never written. */
function legacyJournalFile(vaultPath: string, notePath: string): string {
  return `${legacyPathHash(vaultPath)}/${legacyPathHash(notePath)}.json`;
}

/** A file's entries, read locally (also from an auxiliary window); missing → []. Throws when unreadable. */
async function readLocal(rel: string): Promise<DraftEntry[]> {
  const file = await join(await draftsDir(), ...rel.split("/"));
  if (!(await exists(file))) return [];
  return decodeDraftJournal(await readTextFile(file));
}

/** Writes `entries` to `rel`, or removes the file when none are left. Owner only. */
async function store(rel: string, entries: readonly DraftEntry[]): Promise<void> {
  if (entries.length === 0) {
    const file = await join(await draftsDir(), ...rel.split("/"));
    if (await exists(file)) await remove(file);
    return;
  }
  const { rootId } = await draftsRoot();
  await invoke("write_file_atomic", { rootId, relPath: rel, contents: encodeDraftJournal(entries), encoding: "utf8" });
}

/**
 * The journal's files under `<appData>/drafts`. The owner reads through the
 * checked read (the plugin's `exists()` hides I/O errors, and an unreadable
 * older draft must never become an empty journal the next editor overwrites);
 * an auxiliary window reads locally — creating the folder, as the checked read
 * does, is a write its capability withholds — and never writes.
 */
const storage: DraftJournalStorage = {
  async read(rel) {
    if (!isOwnerWindow()) {
      const file = await join(await draftsDir(), ...rel.split("/"));
      return (await exists(file)) ? readTextFile(file) : null;
    }
    const { rootId } = await draftsRoot();
    return checkedReadTextFile(rootId, rel);
  },
  async write(rel, text) {
    const { rootId } = await draftsRoot();
    await invoke("write_file_atomic", { rootId, relPath: rel, contents: text, encoding: "utf8" });
  },
  async remove(rel) {
    const file = await join(await draftsDir(), ...rel.split("/"));
    if (await exists(file)) await remove(file);
  },
  async list(dirKey) {
    const dir = await join(await draftsDir(), dirKey);
    if (!(await exists(dir))) return [];
    const out: { name: string; isFile: boolean; mtimeMs: number | null }[] = [];
    for (const e of await readDir(dir)) {
      if (!e.name) continue;
      let mtimeMs: number | null = null;
      if (!e.isDirectory) {
        try { mtimeMs = (await stat(await join(dir, e.name))).mtime?.getTime() ?? 0; } catch { mtimeMs = null; }
      }
      out.push({ name: e.name, isFile: !e.isDirectory, mtimeMs });
    }
    return out;
  },
};

const layout: DraftJournalLayout<string> = {
  key: (vaultPath) => vaultPath,
  file: draftJournalFile,
  olderFiles: (vaultPath, notePath) => [legacyJournalFile(vaultPath, notePath)],
  dirs: (vaultPath) => [draftPathKey(vaultPath), legacyPathHash(vaultPath)],
  fileIn: (dir, name) => `${dir}/${name}`,
  owner: (vaultPath, notePath) => ({ vaultPath, notePath }),
  // A folder of the old name can be shared with another vault whose path hashed alike.
  ours: (vaultPath, entry) => entry.vaultPath === undefined || entry.vaultPath === vaultPath,
};

// Made on first use, not while this module loads: the journal lives in another package (C20, moduleInitBoundary.test.ts).
let journalInstance: DraftJournal<string> | null = null;
const journal = () => (journalInstance ??= createDraftJournal<string>({ storage, layout, retentionMs: RETENTION_MS, moveWaitMs: MOVE_WAIT_MS }));

/**
 * The owner writes its snapshots itself; an auxiliary window hands each one
 * to the owner, like every other write. Not a restriction but the same rule:
 * one window owns the disk. The crash story is unchanged — a crash takes the
 * whole process with it, and the owner's journal covers the drafts of every
 * window in it.
 */
let ownerWriterInstance: DraftWriter<string> | null = null;
const ownerWriter = () => (ownerWriterInstance ??= createDraftWriter<string>(journal(), layout));
const auxLanes = new Map<string, Promise<void>>();
let auxWriterInstance: DraftWriter<string> | null = null;
const auxWriter = () => (auxWriterInstance ??= createDraftWriter<string>({
  serial: <T,>(file: string, work: () => Promise<T>): Promise<T> => {
    const run = (auxLanes.get(file) ?? Promise.resolve()).catch(() => {}).then(work);
    auxLanes.set(file, run.then(() => {}, () => {}));
    return run;
  },
  recordInLane: async (vaultPath: string, notePath: string, text: string, revision: number, sessionId: string) => {
    const bus = await getWindowBus();
    await bus.request("draft-record", { vaultPath, notePath, text, revision, sessionId });
  },
  clear: async (vaultPath: string, notePath: string, upToRevision: number, sessionId: string) => {
    const bus = await getWindowBus();
    // `Infinity` does not survive JSON — null carries "force" over the bus.
    await bus.request("draft-clear", { vaultPath, notePath, upToRevision: Number.isFinite(upToRevision) ? upToRevision : null, sessionId }).catch(() => {});
  },
  adopt: async () => {},
}, layout));
const writer = () => (isOwnerWindow() ? ownerWriter() : auxWriter());

/** An immediate snapshot — what a closing editor, a transfer or the start of a save journals. */
export async function recordDraft(
  vaultPath: string,
  notePath: string,
  text: string,
  revision: number,
  sessionId = "legacy",
): Promise<void> {
  if (!isOwnerWindow()) {
    const bus = await getWindowBus();
    await bus.request("draft-record", { vaultPath, notePath, text, revision, sessionId });
    return;
  }
  await journal().record(vaultPath, notePath, text, revision, sessionId);
}

/**
 * The editor's snapshot while typing goes on: buffered, and written at most
 * every 400 ms per note and editor — also while the typing never pauses.
 * `text` is read when the snapshot is written. A save that covers the
 * revision takes it out of the buffer (`clearDraft`).
 */
export function writeDraft(vaultPath: string, notePath: string, text: string | (() => string | null), revision: number, sessionId: string): void {
  writer().write(vaultPath, notePath, text, revision, sessionId);
}

/**
 * Every snapshot this window has buffered, written now — on the way out: the
 * vault closes or the window switches to another one (`VaultContext`), the
 * page goes (`flushDraftsOnLeave`). With the interval growing to seconds for a
 * large note, what is buffered there is otherwise gone with the window.
 * Bounded: a write that never settles does not hold the way out up.
 */
export async function flushDrafts(vaultPath?: string): Promise<void> {
  await writer().flush((scope) => vaultPath === undefined || scope === vaultPath, { waitMs: MOVE_WAIT_MS });
}

/**
 * The last way out a window's page still sees: `pagehide`, and the page going
 * hidden (minimised, another app in front, the window closing on a platform
 * that hides it first). Both start the flush; neither can wait for it — the
 * snapshot reaches the disk if the process lives long enough (the owner's
 * write is one native call; an auxiliary window's goes over the bus to the
 * owner, which outlives it). Installed once per window, when this module
 * loads (the vault context imports it).
 */
/** What `flushDraftsOnLeave` listens on: a window and its document, or a stand-in. */
interface LeaveEvents {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener?(type: string, listener: () => void): void;
}

export function flushDraftsOnLeave(page: LeaveEvents, document?: LeaveEvents & { readonly visibilityState: string }): () => void {
  const flush = () => { void flushDrafts().catch(() => {}); };
  const hidden = () => { if (document?.visibilityState === "hidden") flush(); };
  page.addEventListener("pagehide", flush);
  document?.addEventListener("visibilitychange", hidden);
  return () => {
    page.removeEventListener?.("pagehide", flush);
    document?.removeEventListener?.("visibilitychange", hidden);
  };
}

if (typeof window !== "undefined" && typeof document !== "undefined") flushDraftsOnLeave(window, document);

/** What an editor buffered for the note is let go unwritten (its text went to another window). */
export function dropDraft(vaultPath: string, notePath: string, sessionId: string): void {
  writer().drop(vaultPath, notePath, sessionId);
}

/**
 * The draft to offer for this note at its load, held for the offer (3.125):
 * the newest of ITS entries that differs from `diskText`; one of `sessionId`
 * (this editor, reloading the note) is lifted into a session of its own
 * first, so the editor's next save cannot clear it. The owner lifts; an
 * auxiliary window only reads, as it writes nothing itself.
 */
export async function offerDraft(vaultPath: string, notePath: string, diskText: string, sessionId: string): Promise<DraftEntry | null> {
  if (!isOwnerWindow()) return journal().read(vaultPath, notePath, diskText);
  return journal().offer(vaultPath, notePath, diskText, sessionId);
}

/** The draft to offer for this note: the newest of ITS entries that differs from `diskText`. */
export async function readDraft(
  vaultPath: string,
  notePath: string,
  diskText?: string,
): Promise<DraftEntry | null> {
  return journal().read(vaultPath, notePath, diskText);
}

/**
 * The drafts the journal holds for a note from before this run of the app —
 * of editors that held changes when the app went —, each handed out once per
 * run (finding 2026-10-11). A draft of this run belongs to an editor that is
 * still open, which saves or keeps its own text. Only entries that name this
 * vault and note, from the current file and the one of the old name.
 */
export async function takeLeftoverDrafts(vaultPath: string, notePath: string): Promise<DraftEntry[]> {
  return journal().takeLeftovers(vaultPath, notePath);
}

/** Drafts `takeLeftoverDrafts` handed out that could not be kept: handed out again on the next ask. */
export function releaseLeftoverDrafts(vaultPath: string, notePath: string, drafts: DraftEntry[]): void {
  journal().releaseLeftovers(vaultPath, notePath, drafts);
}

/**
 * Clears the session's journal entry for this note, up to `upToRevision`
 * (`Infinity` forces) — in the file of the old name as well: a draft restored
 * from there is cleared by the save that took it in. Best-effort.
 *
 * The rule (the shared writer's `clear`, pinned in sharedDraftJournal.test.ts):
 * only while what this window buffered for the session is still covered — the
 * same snapshot as at the call, of a revision the save wrote. Typing that came
 * meanwhile keeps the entry on disk until its own, newer snapshot replaces it;
 * that snapshot is written within an interval, and its own save clears it. So
 * no entry stays for good, and a crash in between never finds neither.
 */
export async function clearDraft(
  vaultPath: string,
  notePath: string,
  upToRevision: number,
  sessionId = "legacy",
): Promise<void> {
  await writer().clear(vaultPath, notePath, upToRevision, sessionId).catch(() => {});
}

/** Where `notePath` lives after `move`, or null when the move does not touch it. */
export function relocatedPath(path: string, move: { from: string; to: string }): string | null {
  return relocatedDraftPath(path, move);
}

/**
 * Journal entries follow a move or rename made in the app (issue 113, V3).
 * The journal is keyed by the note's path: an entry left under the old path
 * is one no editor ever asks for again. Snapshots still buffered land first,
 * under the path they were typed at, and then move with the rest, entry by
 * entry by the shared rule. Best-effort like every journal operation.
 */
export async function relocateDrafts(
  vaultPath: string,
  moves: ReadonlyArray<{ from: string; to: string }>,
): Promise<void> {
  if (moves.length === 0) return;
  if (!isOwnerWindow()) {
    await auxWriter().flush((scope) => scope === vaultPath, { notes: (path) => moves.some((m) => relocatedDraftPath(path, m) !== null), waitMs: MOVE_WAIT_MS }).catch(() => {});
    const bus = await getWindowBus();
    await bus.request("draft-relocate", { vaultPath, moves: moves.map(({ from, to }) => ({ from, to })) }).catch(() => {});
    return;
  }
  // Only the moved notes' buffered snapshots, and not longer than a moment: a
  // write that never settles must not hold up the end of the rename.
  await ownerWriter().flush((scope) => scope === vaultPath, { notes: (path) => moves.some((m) => relocatedDraftPath(path, m) !== null), waitMs: MOVE_WAIT_MS }).catch(() => {});
  await journal().relocate(vaultPath, moves).catch((err) => console.warn("[draftJournal] drafts did not follow the move", err));
}

/** Removes entries older than the retention window (called on vault open). */
export async function pruneDrafts(vaultPath: string): Promise<void> {
  try {
    await draftsRoot();
    await journal().prune(vaultPath, (file) => ownerWriter().isPending(file));
  } catch {
    /* best-effort */
  }
}

/**
 * Removes ALL drafts of a vault — wired into "forget app data". The current
 * folder goes whole. The folder of the old name can be shared with another
 * vault whose path hashed alike: there only this vault's entries go, and the
 * old comment-operation queue in it stays for `removeLegacyCommentOperations`.
 */
export async function removeVaultDrafts(vaultPath: string): Promise<void> {
  try {
    const base = await join(await appDataDir(), "drafts");
    const dir = await join(base, draftPathKey(vaultPath));
    if (await exists(dir)) await remove(dir, { recursive: true });
    const legacyKey = legacyPathHash(vaultPath);
    const legacyDir = await join(base, legacyKey);
    if (!(await exists(legacyDir))) return;
    for (const e of await readDir(legacyDir)) {
      if (!e.name) continue;
      if (e.isDirectory) {
        // The comment-operation queue is not ours to delete here: it can hold
        // another vault's unsent operations. removeLegacyCommentOperations
        // takes only this vault's entries out of it.
        continue;
      }
      const rel = `${legacyKey}/${e.name}`;
      try {
        const entries = await readLocal(rel);
        await store(rel, entries.filter((entry) => entry.vaultPath !== undefined && entry.vaultPath !== vaultPath));
      } catch {
        await remove(await join(legacyDir, e.name));
      }
    }
    if ((await readDir(legacyDir)).length === 0) await remove(legacyDir, { recursive: true });
  } catch {
    /* best-effort */
  }
}
