/**
 * The journal's write path — ONE for both shells (plan Journal, J2).
 *
 * Every change to a journal is the same steps: resolve the daily note (creating
 * it on the way, headless — decision E4), then read it, transform the text with
 * the pure functions of `@plainva/core` and write it as ONE step
 * (`updateVaultText`): the vault's chain reads the note inside the gate it
 * holds for it, so a sync pull, the open editor's autosave and a second capture
 * cannot land between the read and the write, and a lost update is not
 * possible. Where the note has an open conflict, the same change goes into the
 * person's own version as well — the pure functions find an entry by its
 * spelling. A window that reaches the chain over a bus redoes a change that
 * lost against another writer; when the note never holds still it gives up.
 *
 * The step goes through whatever the shell hands in — the desktop's vault
 * adapter, the phone's `vaultOps.update` — so own-write marking, backups, the
 * index and an encrypted workspace are the shell's one way, not a second.
 *
 * An OPEN editor of the note is part of the path, the way it is for every shared
 * write (graph actions, mention linking): its pending save is flushed BEFORE the
 * note is read — otherwise that save would overwrite the entry a second later,
 * or the two would meet as a conflict — and the shell's write tells the editor
 * afterwards, so the clean buffer adopts the line. What was typed is on disk by
 * then and stays.
 */
import {
  insertJournalEntry,
  journalTimeOf,
  parseJournal,
  removeJournalEntry,
  replaceJournalEntry,
  restoreJournalEntry,
  setJournalEntryTask,
  toggleJournalTask,
  updateVaultText,
  TextFileChangedError,
  type JournalEditFailure,
  type JournalEntry,
  type JournalEntryRef,
  type TaskBoxState,
  type TextUpdateFiles,
} from "@plainva/core";
import { flushPendingSave } from "../platform/services";

/**
 * The shell's files: its read, its write and its entry for a change of a note
 * that exists — own-write marking, index update and change notice included.
 */
export interface JournalFiles extends TextUpdateFiles {
  /** The daily note for a day, created without questions when it is missing; `null` = it cannot be created. */
  ensureDailyNote(date: Date): Promise<{ path: string; created: boolean } | null>;
}

/**
 * What it takes to take a change back. While the note still reads `after`, the
 * undo is exact — `before` goes back byte for byte. Once it has moved on, the
 * entry is taken out (or put back) by its spelling instead.
 */
export interface JournalUndo {
  path: string;
  before: string;
  after: string;
  kind: "insert" | "remove";
  entry: JournalEntry;
}

export type JournalWriteFailure = JournalEditFailure | "no-note" | "changed";
export type JournalWriteResult =
  | { ok: true; path: string; entry: JournalEntry; createdNote: boolean; undo: JournalUndo | null }
  | { ok: false; reason: JournalWriteFailure };

type Transform = (raw: string) => { ok: true; content: string; entry: JournalEntry } | { ok: false; reason: JournalEditFailure };

async function changeNote(
  files: TextUpdateFiles,
  path: string,
  transform: Transform,
): Promise<{ ok: true; before: string; after: string; entry: JournalEntry } | { ok: false; reason: JournalWriteFailure }> {
  // Unsaved typing in an open editor goes to disk first (see the head of this file).
  await flushPendingSave(path);
  let before: string, after: string;
  try {
    ({ before, text: after } = await updateVaultText(files, path, (raw) => {
      const edit = transform(raw);
      return edit.ok ? edit.content : null;
    }));
  } catch (error) {
    if (error instanceof TextFileChangedError) return { ok: false, reason: "changed" };
    throw error;
  }
  // What the change did, read from the note as it was changed. `after` is the
  // text that was written, not this second run's: ticking a repeating task
  // gives its successor a fresh id each time the transform runs.
  const edit = transform(before);
  if (!edit.ok) return edit;
  return { ok: true, before, after, entry: edit.entry };
}

export interface JournalCapture {
  /** The day the entry belongs to — today, unless a view captures into another day. */
  date: Date;
  text: string;
  /** The vault's journal heading (setting, default "Journal"). */
  heading: string;
  /** Capture as a task entry (`- [ ] 14:05 …`). */
  task?: boolean;
  /** The moment of capture; the entry is stamped with its local time. */
  now?: Date;
  /**
   * A time that was decided earlier (`HH:mm`) and wins over `now` — a share that
   * was planned before it was written keeps its time across a retry, which is
   * what lets the retry find its own entry instead of writing a second one.
   */
  time?: string;
}

/** One thought into the journal of its day. The daily note is created on the way when it is missing. */
export async function appendJournalEntry(files: JournalFiles, capture: JournalCapture): Promise<JournalWriteResult> {
  if (!capture.text.trim()) return { ok: false, reason: "empty" };
  const note = await files.ensureDailyNote(capture.date);
  if (!note) return { ok: false, reason: "no-note" };
  const time = capture.time ?? journalTimeOf(capture.now ?? new Date());
  const task: TaskBoxState | null = capture.task ? "open" : null;
  const changed = await changeNote(files, note.path, (raw) => insertJournalEntry(raw, { heading: capture.heading, time, text: capture.text, task }));
  if (!changed.ok) return changed;
  return {
    ok: true, path: note.path, entry: changed.entry, createdNote: note.created,
    undo: { path: note.path, before: changed.before, after: changed.after, kind: "insert", entry: changed.entry },
  };
}

/** An entry whose day, time and text were fixed BEFORE it is written — the share target plans its import durably. */
export interface PlannedJournalEntry {
  /** Local day `YYYY-MM-DD`. */
  date: string;
  /** `HH:mm`. */
  time: string;
  heading: string;
  text: string;
}

/**
 * Writes a planned entry and resolves with the note it went to — or `null` when
 * it cannot be written. IDEMPOTENT: a retry after a crash finds the entry a
 * finished attempt left behind (same time, same text as the writer spells it)
 * and writes nothing.
 */
export async function appendPlannedJournalEntry(files: JournalFiles, planned: PlannedJournalEntry): Promise<string | null> {
  const [year, month, day] = planned.date.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const probe = insertJournalEntry("", { heading: planned.heading, time: planned.time, text: planned.text });
  if (!probe.ok) return null;
  const note = await files.ensureDailyNote(date);
  if (!note) return null;
  const existing = parseJournal(await files.readTextFile(note.path), { heading: planned.heading }).entries;
  if (existing.some((entry) => entry.time === probe.entry.time && entry.text === probe.entry.text)) return note.path;
  const result = await appendJournalEntry(files, { date, text: planned.text, heading: planned.heading, time: planned.time });
  return result.ok ? result.path : null;
}

export interface JournalTarget { path: string; entry: JournalEntryRef; heading: string }

/** New text (and optionally a new time) for an entry, in place. */
export async function editJournalEntry(files: JournalFiles, target: JournalTarget, change: { text: string; time?: string }): Promise<JournalWriteResult> {
  const changed = await changeNote(files, target.path, (raw) => replaceJournalEntry(raw, target.entry, change, { heading: target.heading }));
  return changed.ok ? { ok: true, path: target.path, entry: changed.entry, createdNote: false, undo: null } : changed;
}

/** Turns an entry into a checkbox task the task view knows (decision E8) — or, with `null`, back into a plain entry. */
export async function setJournalEntryTaskState(files: JournalFiles, target: JournalTarget, task: TaskBoxState | null): Promise<JournalWriteResult> {
  const changed = await changeNote(files, target.path, (raw) => setJournalEntryTask(raw, target.entry, task, { heading: target.heading }));
  return changed.ok ? { ok: true, path: target.path, entry: changed.entry, createdNote: false, undo: null } : changed;
}

/** A tap on the box of a task entry: open ↔ done, with the completion date the task view writes. */
export async function toggleJournalEntryTask(files: JournalFiles, target: JournalTarget, options: { today?: string } = {}): Promise<JournalWriteResult> {
  const changed = await changeNote(files, target.path, (raw) => toggleJournalTask(raw, target.entry, { heading: target.heading, ...options }));
  return changed.ok ? { ok: true, path: target.path, entry: changed.entry, createdNote: false, undo: null } : changed;
}

/** Removes an entry. The result carries what it takes to put it back. */
export async function deleteJournalEntry(files: JournalFiles, target: JournalTarget): Promise<JournalWriteResult> {
  const changed = await changeNote(files, target.path, (raw) => {
    const removal = removeJournalEntry(raw, target.entry, { heading: target.heading });
    return removal.ok ? { ok: true, content: removal.content, entry: removal.removed } : removal;
  });
  if (!changed.ok) return changed;
  return {
    ok: true, path: target.path, entry: changed.entry, createdNote: false,
    undo: { path: target.path, before: changed.before, after: changed.after, kind: "remove", entry: changed.entry },
  };
}

/**
 * Takes a capture or a deletion back. Exact while nothing else touched the note;
 * afterwards by the entry's spelling — never by overwriting what somebody else
 * wrote in the meantime.
 */
export async function undoJournalChange(files: TextUpdateFiles, undo: JournalUndo, heading: string): Promise<boolean> {
  const undone = (raw: string): string | null => {
    if (raw === undo.after) return undo.before;
    if (undo.kind === "insert") {
      const removal = removeJournalEntry(raw, undo.entry, { heading });
      return removal.ok ? removal.content : null;
    }
    const restored = restoreJournalEntry(raw, undo.entry, { heading });
    return restored.ok ? restored.content : null;
  };
  await flushPendingSave(undo.path);
  try {
    const { before } = await updateVaultText(files, undo.path, undone);
    return undone(before) !== null;
  } catch (error) {
    if (error instanceof TextFileChangedError) return false;
    throw error;
  }
}
