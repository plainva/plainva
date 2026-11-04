import { invoke } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import { exists, mkdir, readDir, readTextFile, remove, stat } from "@tauri-apps/plugin-fs";
import { utf8Encode, workspaceSha256Hex } from "@plainva/core";
import {
  decodeDraftJournal,
  draftSessionOf,
  encodeDraftJournal,
  isDraftOf,
  offeredDraft,
  withDraftEntry,
  withoutSessionDraft,
  type DraftJournalEntry,
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
 * What a file holds and what may be offered is the shared rule in
 * `@plainva/ui` (`draftJournalEntries.ts`), the same as the phone's journal.
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

/** Both places a note's entries can be in, the current one first. */
const journalFilesOf = (vaultPath: string, notePath: string) => [draftJournalFile(vaultPath, notePath), legacyJournalFile(vaultPath, notePath)];

/** The vault's folders: the current one first. */
const vaultDirsOf = (vaultPath: string) => [draftPathKey(vaultPath), legacyPathHash(vaultPath)];

/** A file's entries, read locally (also from an auxiliary window); missing → []. Throws when unreadable. */
async function readLocal(rel: string): Promise<DraftEntry[]> {
  const file = await join(await draftsDir(), ...rel.split("/"));
  if (!(await exists(file))) return [];
  return decodeDraftJournal(await readTextFile(file));
}

/** The entries of every file that can hold this note's drafts — only those that name it. Unreadable files are skipped. */
async function entriesOf(vaultPath: string, notePath: string): Promise<DraftEntry[]> {
  const out: DraftEntry[] = [];
  for (const rel of journalFilesOf(vaultPath, notePath)) {
    try {
      out.push(...(await readLocal(rel)).filter((entry) => isDraftOf(entry, { vaultPath, notePath })));
    } catch {
      /* an unreadable journal is left alone; the other file may still hold the note's drafts */
    }
  }
  return out;
}

// Owner-window operations share one lane per journal file. A delayed
// clear must finish before a later atomic snapshot replaces the same file.
const lanes = new Map<string, Promise<void>>();
function serial(file: string, work: () => Promise<void>): Promise<void> {
  const run = (lanes.get(file) ?? Promise.resolve()).catch(() => {}).then(work);
  lanes.set(file, run);
  void run.then(() => { if (lanes.get(file) === run) lanes.delete(file); },
    () => { if (lanes.get(file) === run) lanes.delete(file); });
  return run;
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

/** A file's entries for an owner-side change: missing → [], an unreadable one throws (never written over). */
async function readChecked(rel: string): Promise<DraftEntry[]> {
  const { rootId } = await draftsRoot();
  const raw = await checkedReadTextFile(rootId, rel);
  return raw === null ? [] : decodeDraftJournal(raw);
}

export async function recordDraft(
  vaultPath: string,
  notePath: string,
  text: string,
  revision: number,
  sessionId = "legacy",
): Promise<void> {
  // An auxiliary window hands its snapshots to the owner, like every other
  // write. Not a restriction but the same rule: one window owns the disk. The
  // crash story is unchanged — a crash takes the whole process with it, and the
  // owner's journal covers the drafts of every window in it.
  if (!isOwnerWindow()) {
    const bus = await getWindowBus();
    await bus.request("draft-record", { vaultPath, notePath, text, revision, sessionId });
    return;
  }
  const rel = draftJournalFile(vaultPath, notePath);
  await serial(rel, async () => {
    // The plugin's exists() hides I/O errors. An unreadable older draft must
    // never become an empty journal that the next editor overwrites.
    const entries = await readChecked(rel);
    const next = withDraftEntry(entries, { vaultPath, notePath, text, revision, sessionId, savedAt: Date.now() });
    if (next) await store(rel, next);
  });
}

/** The draft to offer for this note: the newest of ITS entries that differs from `diskText`. */
export async function readDraft(
  vaultPath: string,
  notePath: string,
  diskText?: string,
): Promise<DraftEntry | null> {
  return offeredDraft(await entriesOf(vaultPath, notePath), { vaultPath, notePath }, diskText);
}

/** When this module came up: every draft of this run of the app was journaled after it. */
const runStartedAt = Date.now();
const handedOver = new Set<string>();
const leftoverKey = (vaultPath: string, notePath: string, entry: DraftEntry) =>
  JSON.stringify([vaultPath, notePath, draftSessionOf(entry), entry.revision]);

/**
 * The drafts the journal holds for a note from before this run of the app —
 * of editors that held changes when the app went —, each handed out once per
 * run (finding 2026-10-11). A draft of this run belongs to an editor that is
 * still open, which saves or keeps its own text. Only entries that name this
 * vault and note, from the current file and the one of the old name.
 */
export async function takeLeftoverDrafts(vaultPath: string, notePath: string): Promise<DraftEntry[]> {
  const entries = await entriesOf(vaultPath, notePath);
  return entries.filter((entry) => {
    const key = leftoverKey(vaultPath, notePath, entry);
    if (entry.savedAt >= runStartedAt || handedOver.has(key)) return false;
    handedOver.add(key);
    return true;
  });
}

/** Drafts `takeLeftoverDrafts` handed out that could not be kept: handed out again on the next ask. */
export function releaseLeftoverDrafts(vaultPath: string, notePath: string, drafts: DraftEntry[]): void {
  for (const entry of drafts) handedOver.delete(leftoverKey(vaultPath, notePath, entry));
}

/**
 * Clears the session's journal entry for this note — but only if no snapshot
 * NEWER than `upToRevision` was written meanwhile (latest wins). `Infinity`
 * forces. Looks in the file of the old name as well: a draft restored from
 * there is cleared by the save that took it in.
 */
export async function clearDraft(
  vaultPath: string,
  notePath: string,
  upToRevision: number,
  sessionId = "legacy",
): Promise<void> {
  if (!isOwnerWindow()) {
    // `Infinity` does not survive JSON — null carries "force" over the bus.
    const bus = await getWindowBus();
    await bus
      .request("draft-clear", {
        vaultPath,
        notePath,
        upToRevision: Number.isFinite(upToRevision) ? upToRevision : null,
        sessionId,
      })
      .catch(() => {
        /* best-effort, same as the local path below */
      });
    return;
  }
  for (const rel of journalFilesOf(vaultPath, notePath)) {
    await serial(rel, async () => {
      try {
        const entries = await readLocal(rel);
        const remaining = withoutSessionDraft(entries, { vaultPath, notePath }, sessionId, upToRevision);
        if (remaining.length !== entries.length) await store(rel, remaining);
      } catch {
        // best-effort — a stale journal entry is annoying, not dangerous
      }
    });
  }
}

/** Where `notePath` lives after `move`, or null when the move does not touch it. */
export function relocatedPath(notePath: string, move: { from: string; to: string }): string | null {
  if (notePath === move.from) return move.to;
  if (notePath.startsWith(`${move.from}/`)) return move.to + notePath.slice(move.from.length);
  return null;
}

/**
 * Journal entries follow a move or rename made in the app (issue 113, V3).
 * The journal is keyed by the note's path: an entry left under the old path
 * is one no editor ever asks for again — the unsaved text of a note whose
 * save failed would be offered nowhere once the note had moved. Entry by
 * entry: a file of the old name can hold several notes' entries, and only the
 * moved note's go (3.124). Entries of the same editor session keep the newer
 * revision when the destination already has one. The destination is written
 * before the entries leave their old file. Best-effort like every journal
 * operation.
 */
export async function relocateDrafts(
  vaultPath: string,
  moves: ReadonlyArray<{ from: string; to: string }>,
): Promise<void> {
  if (moves.length === 0) return;
  if (!isOwnerWindow()) {
    const bus = await getWindowBus();
    await bus.request("draft-relocate", { vaultPath, moves: moves.map(({ from, to }) => ({ from, to })) }).catch(() => {});
    return;
  }
  const ours = (entry: DraftEntry) => entry.vaultPath === undefined || entry.vaultPath === vaultPath;
  const target = (entry: DraftEntry) =>
    ours(entry) ? moves.map((m) => relocatedPath(entry.notePath, m)).find((p): p is string => p !== null) ?? null : null;
  try {
    for (const dirKey of vaultDirsOf(vaultPath)) {
      const vaultDir = await join(await draftsDir(), dirKey);
      if (!(await exists(vaultDir))) continue;
      for (const e of await readDir(vaultDir)) {
        if (e.isDirectory || !e.name?.endsWith(".json")) continue;
        const oldRel = `${dirKey}/${e.name}`;
        let entries: DraftEntry[];
        try {
          entries = await readLocal(oldRel);
        } catch {
          continue; // unreadable: left exactly where it is
        }
        const destinations = [...new Set(entries.map(target).filter((to): to is string => to !== null))];
        for (const to of destinations) {
          const newRel = draftJournalFile(vaultPath, to);
          if (newRel === oldRel) continue;
          await serial(newRel, () => serial(oldRel, async () => {
            // Read again inside the lane: a snapshot may have landed meanwhile.
            const current = await readChecked(oldRel);
            const moving = current.filter((entry) => target(entry) === to);
            if (moving.length === 0) return;
            let merged = await readChecked(newRel);
            for (const entry of moving) {
              const moved = { ...entry, notePath: to, vaultPath };
              merged = withDraftEntry(merged, moved) ?? merged;
            }
            await store(newRel, merged);
            await store(oldRel, current.filter((entry) => !moving.includes(entry)));
          }));
        }
      }
    }
  } catch (err) {
    console.warn("[draftJournal] drafts did not follow the move", err);
  }
}

/** Removes entries older than the retention window (called on vault open). */
export async function pruneDrafts(vaultPath: string): Promise<void> {
  try {
    const { dir } = await draftsRoot();
    const cutoff = Date.now() - RETENTION_MS;
    for (const dirKey of vaultDirsOf(vaultPath)) {
      const vaultDir = await join(dir, dirKey);
      if (!(await exists(vaultDir))) continue;
      for (const e of await readDir(vaultDir)) {
        if (e.isDirectory || !e.name) continue;
        const file = await join(vaultDir, e.name);
        await serial(`${dirKey}/${e.name}`, async () => {
          try {
            const s = await stat(file);
            if ((s.mtime?.getTime() ?? 0) < cutoff) await remove(file);
          } catch {
            /* skip unreadable entries */
          }
        });
      }
    }
  } catch {
    /* best-effort */
  }
}

/**
 * Removes ALL drafts of a vault — wired into "forget app data". The current
 * folder goes whole. The folder of the old name can be shared with another
 * vault whose path hashed alike: there only this vault's entries go, and the
 * comment-operation journal that lives in it (as before).
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
        if (e.name === "comment-operations") await remove(await join(legacyDir, e.name), { recursive: true });
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
