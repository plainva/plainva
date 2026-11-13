import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import {
  createDraftJournal,
  createDraftWriter,
  draftSessionOf,
  relocatedDraftPath,
  type DraftJournal,
  type DraftJournalEntry,
  type DraftJournalLayout,
  type DraftWriter,
  type DraftJournalStorage,
} from "@plainva/ui";
import { atomicWriteText } from "../platform/atomicFile";
import type { MobileVault } from "./vaultService";

/**
 * The phone's draft journal: the shared one (`draftJournal.ts` in
 * `@plainva/ui`, stability plan R6) over the app's data folder. Every
 * scheduled note save also lands as a crash-safe draft OUTSIDE the vault
 * (`drafts/` never syncs); a confirmed write clears its draft; on the next
 * open of the note a draft that differs from the file offers recovery.
 * Everything is best-effort — a journal hiccup must never block typing.
 *
 * What is the phone's own here:
 *
 * - **Where the files lie:** `drafts/<vault id>/<note path in URL-safe
 *   base64>.json` under `Directory.Data`, as the phone always wrote them, so a
 *   draft an older version left is found.
 * - **How a file is written:** through `atomicWriteText` — the native plugin
 *   fsyncs and renames into place, so the crash the journal exists for cannot
 *   tear it (finding 2026-08-19).
 * - **Whose entry it is:** one session per run of the app (`RUN_SESSION`); the
 *   note saver's revisions count from 1 again in the next run. A draft put on
 *   offer is lifted into a session of its own (3.125) by the shared journal.
 */

export interface NoteDraft {
  path: string;
  text: string;
  ts: number;
  /** Coordinator revision this text belongs to; older journals have none. */
  revision?: number;
  /** Whose entry it is (see the header); absent in drafts read before sessions existed. */
  sessionId?: string;
}

/** This run's saver. Its revisions count from 1 again in the next run. */
const RUN_SESSION = `run-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
/** How long a move waits for a moved note's snapshot that is still being written (see the shared journal). */
const MOVE_WAIT_MS = 2_000;

const dirOf = (v: MobileVault) => `drafts/${v.vaultId}`;

function draftFile(v: MobileVault, path: string): string {
  const key = btoa(unescape(encodeURIComponent(path))).replace(/\+/g, "-").replace(/\//g, "_");
  return `${dirOf(v)}/${key}.json`;
}

/** Whether `file` is there: a failed stat is "not there" only for what the platform calls missing. */
async function isThere(file: string): Promise<boolean> {
  try {
    await Filesystem.stat({ path: file, directory: Directory.Data });
    return true;
  } catch {
    return false;
  }
}

const storage: DraftJournalStorage = {
  async read(file) {
    try {
      const res = await Filesystem.readFile({ path: file, directory: Directory.Data, encoding: Encoding.UTF8 });
      return String(res.data);
    } catch (error) {
      // Present but unreadable (an I/O fault) throws, and nothing is written over it.
      if (!(await isThere(file))) return null;
      throw error;
    }
  },
  write: (file, text) => atomicWriteText(file, text),
  async remove(file) {
    try {
      await Filesystem.deleteFile({ path: file, directory: Directory.Data });
    } catch (error) {
      if (await isThere(file)) throw error;
    }
  },
  async list(dir) {
    try {
      const listed = await Filesystem.readdir({ path: dir, directory: Directory.Data });
      return listed.files.map((f) => ({ name: f.name, isFile: f.type === "file", mtimeMs: typeof f.mtime === "number" ? f.mtime : null }));
    } catch {
      return [];
    }
  },
};

const layout: DraftJournalLayout<MobileVault> = {
  key: (v) => v.vaultId,
  file: draftFile,
  dirs: (v) => [dirOf(v)],
  fileIn: (dir, name) => `${dir}/${name}`,
  owner: (_v, notePath) => ({ notePath }),
};

// Made on first use, not while this module loads: both live in another package (C20, moduleInitBoundary.test.ts).
let made: { journal: DraftJournal<MobileVault>; writer: DraftWriter<MobileVault> } | null = null;
function journalAndWriter() {
  if (!made) {
    const journal = createDraftJournal<MobileVault>({ storage, layout, moveWaitMs: MOVE_WAIT_MS });
    made = { journal, writer: createDraftWriter<MobileVault>(journal, layout) };
  }
  return made;
}
const journal = () => journalAndWriter().journal;
const writer = () => journalAndWriter().writer;

const toNoteDraft = (entry: DraftJournalEntry): NoteDraft => ({
  path: entry.notePath,
  text: entry.text,
  ts: entry.savedAt,
  revision: entry.revision,
  sessionId: draftSessionOf(entry),
});
const identityOf = (draft: { ts: number; revision?: number; sessionId?: string }) => ({ savedAt: draft.ts, revision: draft.revision ?? 0, sessionId: draft.sessionId });

/** Throttled per vault/document, independently of editor lifetime. */
export function writeDraft(v: MobileVault, path: string, text: string, revision = 0): void {
  writer().write(v, path, text, revision, RUN_SESSION);
}

/** Attempt all buffered journal snapshots before the OS suspends timers. */
export async function flushDrafts(v?: MobileVault): Promise<void> {
  await writer().flush((scope) => !v || scope.vaultId === v.vaultId);
}

/**
 * Clear this run's entry up to the confirmed revision, ordered with all writes
 * to this file. Manual discard (`Infinity`) covers what was there at the call,
 * never later input. Another session's entry — a draft on offer, one an
 * earlier run left — is never touched here (3.125); that one goes through
 * `clearDraftIf` or `adoptDraft`.
 */
export function clearDraft(v: MobileVault, path: string, upToRevision = Infinity): void {
  void writer().clear(v, path, upToRevision, RUN_SESSION).catch(() => {});
}

/**
 * Clears the journal entry only while it is still exactly this draft (its
 * session, `ts` and revision) — for a draft kept beside its file (finding
 * 2026-10-11) and for an offer the reader discards. A revision alone says
 * nothing across runs of the app: the coordinator counts from 1 again.
 */
export function clearDraftIf(v: MobileVault, path: string, draft: { ts: number; revision?: number; sessionId?: string }): void {
  void journal().clearIf(v, path, identityOf(draft)).catch(() => {});
}

/**
 * The draft to offer for this note, held for the offer (3.125): the newest
 * entry that is not the file's text; one of this run's saver is lifted into a
 * session of its own first.
 */
export async function offerDraft(v: MobileVault, path: string, diskText: string): Promise<NoteDraft | null> {
  prunedOnce(v);
  const found = await journal().offer(v, path, diskText, RUN_SESSION);
  return found ? toNoteDraft(found) : null;
}

/**
 * The reader restored the offered draft: once this run's entry holds the
 * restored text — the snapshot the editor scheduled for it is written first —,
 * the offer's own entry goes. Call it right after the restored text was scheduled.
 */
export function adoptDraft(v: MobileVault, path: string, draft: { ts: number; revision?: number; sessionId?: string }): Promise<void> {
  return writer().adopt(v, path, identityOf(draft), RUN_SESSION).catch(() => {});
}

/** Where `path` lives after `move`, or null when the move does not touch it. */
export function relocatedPath(path: string, move: { from: string; to: string }): string | null {
  return relocatedDraftPath(path, move);
}

/**
 * Journal entries follow a move or rename made in the app (issue 113, V3; the
 * same rule as the desktop's, shared). Snapshots still buffered in memory land
 * first, under the path they were typed at, and then move with the rest.
 */
export async function relocateDrafts(v: MobileVault, moves: ReadonlyArray<{ from: string; to: string }>): Promise<void> {
  if (moves.length === 0) return;
  // Only the moved notes' buffered snapshots, and not longer than a moment: a
  // write that never settles must not hold up the end of the rename.
  await writer().flush((scope) => scope.vaultId === v.vaultId, { notes: (path) => moves.some((m) => relocatedDraftPath(path, m) !== null), waitMs: MOVE_WAIT_MS }).catch(() => {});
  await journal().relocate(v, moves);
}

const pruned = new Set<string>();

function prunedOnce(v: MobileVault): void {
  if (pruned.has(v.vaultId)) return;
  pruned.add(v.vaultId);
  void pruneDrafts(v);
}

/** The draft that would be offered for this note (newest entry that is not `diskText`), or null. Prunes stale drafts once per vault session. */
export async function readDraft(v: MobileVault, path: string, diskText?: string): Promise<NoteDraft | null> {
  prunedOnce(v);
  const found = await journal().read(v, path, diskText);
  return found ? toNoteDraft(found) : null;
}

/**
 * The drafts of a note from before this run of the app — of editors that held
 * changes when the app went —, each handed out once per run (finding
 * 2026-10-11). A draft of this run belongs to the note's saver.
 */
export async function takeLeftoverDrafts(v: MobileVault, path: string): Promise<NoteDraft[]> {
  return (await journal().takeLeftovers(v, path)).map(toNoteDraft);
}

/** Drafts `takeLeftoverDrafts` handed out that could not be kept: handed out again on the next ask. */
export function releaseLeftoverDrafts(v: MobileVault, path: string, drafts: readonly NoteDraft[]): void {
  journal().releaseLeftovers(v, path, drafts.map((draft) => ({ notePath: draft.path, text: draft.text, savedAt: draft.ts, revision: draft.revision ?? 0, sessionId: draft.sessionId })));
}

/** Boot hygiene: drafts older than the retention window disappear. */
export async function pruneDrafts(v: MobileVault): Promise<void> {
  await journal().prune(v, (file) => writer().isPending(file));
}
