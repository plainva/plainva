import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import {
  decodeDraftJournal,
  draftSessionOf,
  encodeDraftJournal,
  offeredDraft,
  withoutSessionDraft,
  type DraftJournalEntry,
} from "@plainva/ui";
import { atomicWriteText } from "../platform/atomicFile";
import type { MobileVault } from "./vaultService";

/**
 * Mobile draft journal (M3E package G, desktop P2 counterpart): every
 * scheduled note save also lands as a crash-safe draft OUTSIDE the vault
 * (drafts/ never syncs). A confirmed write clears its draft; on the next
 * open of the note a draft that differs from the file offers recovery.
 * Everything is best-effort — a journal hiccup must never block typing.
 *
 * Two properties are not cosmetic (finding 2026-08-19, desktop parity):
 *
 * 1. The draft is written through `atomicWriteText`, not a plain file write.
 *    A journal that can be torn by the very crash it exists for is no safety
 *    net; the native plugin fsyncs and renames into place.
 * 2. Entries carry the coordinator's monotonic REVISION, and a confirmed write
 *    only clears the draft when nothing newer was journalled meanwhile. Without
 *    it, typing on while a save is in flight loses exactly those keystrokes:
 *    the confirmation would delete the newer draft.
 *
 * And a third (open-items plan 3.125): a note's file holds one entry per
 * SESSION, by the rule both shells share (`draftJournalEntries.ts` in
 * `@plainva/ui`). This run's saver writes and clears its own entry
 * (`RUN_SESSION`); a draft put on offer is lifted into a session of its own
 * (`offerDraft`) and stays until it is restored (`adoptDraft`) or discarded
 * (`clearDraftIf`). The journal used to hold ONE text per note: typing on
 * without answering the offer replaced it, the confirmed save deleted it, and
 * leaving the screen lost it. The desktop keeps one entry per editor session
 * for the same reason.
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

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const THROTTLE_MS = 400;

/** This run's saver. Its revisions count from 1 again in the next run. */
const RUN_SESSION = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

interface PendingDraft {
  v: MobileVault;
  path: string;
  text: string;
  revision: number;
  generation: number;
}
const lastWrite = new Map<string, number>();
const pendingDrafts = new Map<string, PendingDraft>();
const generations = new Map<string, number>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const lanes = new Map<string, Promise<void>>();

function draftFile(v: MobileVault, path: string): string {
  const key = btoa(unescape(encodeURIComponent(path))).replace(/\+/g, "-").replace(/\//g, "_");
  return `drafts/${v.vaultId}/${key}.json`;
}

const toNoteDraft = (entry: DraftJournalEntry): NoteDraft => ({
  path: entry.notePath,
  text: entry.text,
  ts: entry.savedAt,
  revision: entry.revision,
  sessionId: draftSessionOf(entry),
});

/** Is the entry exactly that draft — the one offered, kept or handed out? */
const isThatDraft = (entry: DraftJournalEntry, path: string, draft: { ts: number; revision?: number; sessionId?: string }) =>
  entry.notePath === path && entry.savedAt === draft.ts && entry.revision === (draft.revision ?? 0) &&
  (draft.sessionId === undefined || draftSessionOf(entry) === draft.sessionId);

/**
 * A file's entries. Missing → []; present but unreadable (an I/O fault, a
 * shape it cannot read) → throws, and the caller writes nothing over it: the
 * file may hold a draft of an earlier run that is still on offer.
 */
async function readEntries(file: string): Promise<DraftJournalEntry[]> {
  let raw: string;
  try {
    const res = await Filesystem.readFile({ path: file, directory: Directory.Data, encoding: Encoding.UTF8 });
    raw = String(res.data);
  } catch (error) {
    try {
      await Filesystem.stat({ path: file, directory: Directory.Data });
    } catch {
      return [];
    }
    throw error;
  }
  return decodeDraftJournal(raw);
}

/** Writes the entries, or removes the file when none are left. */
async function writeEntries(file: string, entries: readonly DraftJournalEntry[]): Promise<void> {
  if (entries.length === 0) await Filesystem.deleteFile({ path: file, directory: Directory.Data });
  else await atomicWriteText(file, encodeDraftJournal(entries));
}

function serial(file: string, work: () => Promise<void>): Promise<void> {
  const run = (lanes.get(file) ?? Promise.resolve()).catch(() => {}).then(work);
  lanes.set(file, run);
  void run.then(() => { if (lanes.get(file) === run) lanes.delete(file); },
    () => { if (lanes.get(file) === run) lanes.delete(file); });
  return run;
}

function cancelTimer(file: string): void {
  const timer = timers.get(file);
  if (timer !== undefined) clearTimeout(timer);
  timers.delete(file);
}

function schedulePersist(file: string, delay: number): void {
  if (timers.has(file)) return;
  timers.set(file, setTimeout(() => {
    timers.delete(file);
    void persist(file);
  }, delay));
}

/** The buffered snapshot into this run's entry — inside the file's lane. */
async function persistNow(file: string): Promise<void> {
  const pending = pendingDrafts.get(file);
  if (!pending) return;
  lastWrite.set(file, Date.now());
  try {
    const { path, text, revision } = pending;
    const others = withoutSessionDraft(await readEntries(file), { notePath: path }, RUN_SESSION, Infinity);
    // The buffer is always this run's latest text: it replaces the run's entry
    // whatever revision that holds, and leaves every other entry alone.
    await writeEntries(file, [...others, { notePath: path, text, revision, savedAt: Date.now(), sessionId: RUN_SESSION }]);
    // Native acknowledgement covers THIS snapshot, not keystrokes that
    // arrived while it was writing. A failed write keeps its pending text.
    if (pendingDrafts.get(file) === pending) pendingDrafts.delete(file);
  } catch {
    schedulePersist(file, 2000);
  }
}

function persist(file: string): Promise<void> {
  return serial(file, () => persistNow(file));
}

/** Throttled per vault/document, independently of editor lifetime. */
export function writeDraft(v: MobileVault, path: string, text: string, revision = 0): void {
  const file = draftFile(v, path);
  const generation = (generations.get(file) ?? 0) + 1;
  generations.set(file, generation);
  pendingDrafts.set(file, { v, path, text, revision, generation });
  if (Date.now() - (lastWrite.get(file) ?? 0) >= THROTTLE_MS) {
    cancelTimer(file);
    void persist(file);
  } else {
    schedulePersist(file, THROTTLE_MS);
  }
}

/** Attempt all buffered journal snapshots before the OS suspends timers. */
export async function flushDrafts(v?: MobileVault): Promise<void> {
  const selected = [...pendingDrafts].filter(([, pending]) => !v || pending.v.vaultId === v.vaultId);
  await Promise.all(selected.map(([file]) => { cancelTimer(file); return persist(file); }));
}

/**
 * Clear this run's entry up to the confirmed revision, ordered with all writes
 * to this file. Manual discard (`Infinity`) covers the generation present at
 * the call, never later input. Another session's entry — a draft on offer, one
 * an earlier run left — is never touched here (3.125); that one goes through
 * `clearDraftIf` or `adoptDraft`.
 */
export function clearDraft(v: MobileVault, path: string, upToRevision = Infinity): void {
  const file = draftFile(v, path);
  const generation = generations.get(file) ?? 0;
  const stillCovered = () => {
    const pending = pendingDrafts.get(file);
    return (generations.get(file) ?? 0) === generation &&
      (!pending || pending.revision <= upToRevision);
  };
  void serial(file, async () => {
    if (!stillCovered()) return;
    try {
      // Do not treat a permission/read/parse failure as an empty journal.
      const entries = await readEntries(file);
      if (!stillCovered()) return;
      cancelTimer(file);
      pendingDrafts.delete(file);
      const remaining = withoutSessionDraft(entries, { notePath: path }, RUN_SESSION, upToRevision);
      if (remaining.length !== entries.length) await writeEntries(file, remaining);
    } catch {
      // Keeping a recoverable draft is safer than guessing that a read failed
      // because no newer version exists.
    }
  }).catch(() => {});
}

/**
 * Clears the journal entry only while it is still exactly this draft (its
 * session, `ts` and revision) — for a draft kept beside its file (finding
 * 2026-10-11) and for an offer the reader discards. A revision alone says
 * nothing across runs of the app: the coordinator counts from 1 again, so a
 * newer draft of this run would pass for older.
 */
export function clearDraftIf(v: MobileVault, path: string, draft: { ts: number; revision?: number; sessionId?: string }): void {
  const file = draftFile(v, path);
  void serial(file, async () => {
    try {
      const entries = await readEntries(file);
      const remaining = entries.filter((entry) => !isThatDraft(entry, path, draft));
      if (remaining.length !== entries.length) await writeEntries(file, remaining);
    } catch {
      // A draft left there is offered or kept again; one deleted is gone.
    }
  }).catch(() => {});
}

/**
 * The draft to offer for this note, held for the offer (3.125): the newest
 * entry that is not the file's text. One of this run's saver is lifted into a
 * session of its own first, so typing on and the next confirmed save cannot
 * replace or clear it — it stays until `adoptDraft` or `clearDraftIf`.
 */
export async function offerDraft(v: MobileVault, path: string, diskText: string): Promise<NoteDraft | null> {
  prunedOnce(v);
  const file = draftFile(v, path);
  let offer: NoteDraft | null = null;
  await serial(file, async () => {
    try {
      const entries = await readEntries(file);
      const found = offeredDraft(entries, { notePath: path }, diskText);
      if (!found) return;
      if (draftSessionOf(found) !== RUN_SESSION) {
        offer = toNoteDraft(found);
        return;
      }
      const held: DraftJournalEntry = { ...found, sessionId: `offer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` };
      await writeEntries(file, entries.map((entry) => (entry === found ? held : entry)));
      offer = toNoteDraft(held);
    } catch {
      offer = null;
    }
  });
  return offer;
}

/**
 * The reader restored the offered draft: once this run's entry holds the
 * restored text — the snapshot the editor scheduled for it is written here,
 * first —, the offer's own entry goes. Without such an entry the offer stays
 * (a later open offers it again, never a lost text). Call it right after the
 * restored text was scheduled.
 */
export function adoptDraft(v: MobileVault, path: string, draft: { ts: number; revision?: number; sessionId?: string }): Promise<void> {
  const file = draftFile(v, path);
  cancelTimer(file);
  return serial(file, async () => {
    await persistNow(file);
    try {
      const entries = await readEntries(file);
      if (!entries.some((entry) => entry.notePath === path && draftSessionOf(entry) === RUN_SESSION)) return;
      const remaining = entries.filter((entry) => !isThatDraft(entry, path, draft));
      if (remaining.length !== entries.length) await writeEntries(file, remaining);
    } catch {
      // The offer stays in the journal; nothing is lost by keeping it.
    }
  }).catch(() => {});
}

/** Where `path` lives after `move`, or null when the move does not touch it. */
export function relocatedPath(path: string, move: { from: string; to: string }): string | null {
  if (path === move.from) return move.to;
  if (path.startsWith(`${move.from}/`)) return move.to + path.slice(move.from.length);
  return null;
}

/**
 * Journal entries follow a move or rename made in the app (issue 113, V3;
 * the desktop's `relocateDrafts` does the same). The journal is keyed by the
 * note's path, so an entry left under the old one would never be offered
 * again. Snapshots still buffered in memory land first, under the path they
 * were typed at, and then move with the rest — every entry, an offered one
 * included. A newer entry of the same session already at the destination
 * wins; the destination is written before the old file goes.
 */
export async function relocateDrafts(v: MobileVault, moves: ReadonlyArray<{ from: string; to: string }>): Promise<void> {
  if (moves.length === 0) return;
  try {
    await flushDrafts(v);
    const dir = await Filesystem.readdir({ path: `drafts/${v.vaultId}`, directory: Directory.Data });
    for (const f of dir.files) {
      if (f.type !== "file" || !f.name.endsWith(".json")) continue;
      const oldFile = `drafts/${v.vaultId}/${f.name}`;
      let entries: DraftJournalEntry[];
      try {
        entries = await readEntries(oldFile);
      } catch {
        continue; // unreadable: left exactly where it is
      }
      const from = entries[0]?.notePath;
      if (from === undefined) continue;
      const to = moves.map((m) => relocatedPath(from, m)).find((p): p is string => p !== null);
      if (!to) continue;
      const newFile = draftFile(v, to);
      if (newFile === oldFile) continue;
      await serial(newFile, () => serial(oldFile, async () => {
        const current = await readEntries(oldFile);
        if (current.length === 0) return;
        const held = await readEntries(newFile);
        const merged = [...held];
        for (const entry of current) {
          const moved = { ...entry, notePath: to };
          const at = merged.findIndex((e) => draftSessionOf(e) === draftSessionOf(moved));
          if (at < 0) merged.push(moved);
          else if (merged[at].savedAt < moved.savedAt) merged[at] = moved;
        }
        await writeEntries(newFile, merged);
        await Filesystem.deleteFile({ path: oldFile, directory: Directory.Data });
      }));
    }
  } catch {
    /* no drafts folder yet, or the platform refused: nothing to carry */
  }
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
  try {
    const found = offeredDraft(await readEntries(draftFile(v, path)), { notePath: path }, diskText);
    return found ? toNoteDraft(found) : null;
  } catch {
    return null;
  }
}

/** When this module came up: every draft of this run of the app was journaled after it. */
const runStartedAt = Date.now();
const handedOver = new Set<string>();
const leftoverKey = (v: MobileVault, path: string, draft: NoteDraft) =>
  JSON.stringify([v.vaultId, path, draft.sessionId ?? null, draft.ts, draft.revision ?? null]);

/**
 * The drafts of a note from before this run of the app — of editors that
 * held changes when the app went —, each handed out once per run (finding
 * 2026-10-11; the desktop's journal does the same). A draft of this run
 * belongs to the note's saver, which saves or keeps its own text.
 */
export async function takeLeftoverDrafts(v: MobileVault, path: string): Promise<NoteDraft[]> {
  let entries: DraftJournalEntry[];
  try {
    entries = await readEntries(draftFile(v, path));
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.notePath === path && entry.savedAt < runStartedAt)
    .map(toNoteDraft)
    .filter((draft) => {
      const key = leftoverKey(v, path, draft);
      if (handedOver.has(key)) return false;
      handedOver.add(key);
      return true;
    });
}

/** Drafts `takeLeftoverDrafts` handed out that could not be kept: handed out again on the next ask. */
export function releaseLeftoverDrafts(v: MobileVault, path: string, drafts: readonly NoteDraft[]): void {
  for (const draft of drafts) handedOver.delete(leftoverKey(v, path, draft));
}

/** Boot hygiene: drafts older than the retention window disappear. */
export async function pruneDrafts(v: MobileVault): Promise<void> {
  try {
    const dir = await Filesystem.readdir({ path: `drafts/${v.vaultId}`, directory: Directory.Data });
    const cutoff = Date.now() - RETENTION_MS;
    for (const f of dir.files) {
      if (f.type === "file" && typeof f.mtime === "number" && f.mtime < cutoff) {
        const file = `drafts/${v.vaultId}/${f.name}`;
        await serial(file, async () => {
          if (pendingDrafts.has(file)) return;
          try {
            // The directory snapshot can predate a fresh atomic write.
            const entries = await readEntries(file);
            if (pendingDrafts.has(file) || entries.some((entry) => entry.savedAt >= cutoff)) return;
            await Filesystem.deleteFile({ path: file, directory: Directory.Data });
          } catch { /* retain unreadable snapshots */ }
        });
      }
    }
  } catch {
    /* no drafts folder yet */
  }
}
