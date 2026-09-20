/**
 * The journal's write path — ONE for both shells (plan Journal, J2).
 *
 * Every change to a journal is the same five steps: resolve the daily note
 * (creating it on the way, headless — decision E4), read it, transform the text
 * with the pure functions of `@plainva/core`, read it AGAIN immediately before
 * writing and redo the transformation if the file moved on in between, write.
 * A sync pull, the open editor's autosave and a second capture can all land in
 * that window; the pure functions find the entry again by its spelling, so a
 * retry costs nothing and a lost update is not possible.
 *
 * The write itself goes through whatever the shell hands in — the desktop's
 * vault adapter, the phone's `vaultOps.save` — so own-write marking, backups,
 * the index and an encrypted workspace are the shell's one way, not a second.
 * An open editor receives the line through the existing path for changes from
 * outside; typed text stays (`mergeEditorText`, which knows journal lines).
 */
import {
  insertJournalEntry,
  journalTimeOf,
  removeJournalEntry,
  replaceJournalEntry,
  restoreJournalEntry,
  setJournalEntryTask,
  toggleJournalTask,
  type JournalEditFailure,
  type JournalEntry,
  type JournalEntryRef,
  type TaskBoxState,
} from "@plainva/core";

export interface JournalFiles {
  /** The daily note for a day, created without questions when it is missing; `null` = it cannot be created. */
  ensureDailyNote(date: Date): Promise<{ path: string; created: boolean } | null>;
  readTextFile(path: string): Promise<string>;
  /** The shell's write: own-write marking, index update and change notice included. */
  writeTextFile(path: string, content: string): Promise<void>;
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

/** How often a change that lost the race against another writer is redone before it gives up. */
const ATTEMPTS = 4;

async function changeNote(
  files: Pick<JournalFiles, "readTextFile" | "writeTextFile">,
  path: string,
  transform: Transform,
): Promise<{ ok: true; before: string; after: string; entry: JournalEntry } | { ok: false; reason: JournalWriteFailure }> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const raw = await files.readTextFile(path);
    const edit = transform(raw);
    if (!edit.ok) return edit;
    // Immediately before the write: is this still the text that was transformed?
    if ((await files.readTextFile(path)) !== raw) continue;
    if (edit.content !== raw) await files.writeTextFile(path, edit.content);
    return { ok: true, before: raw, after: edit.content, entry: edit.entry };
  }
  return { ok: false, reason: "changed" };
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
}

/** One thought into the journal of its day. The daily note is created on the way when it is missing. */
export async function appendJournalEntry(files: JournalFiles, capture: JournalCapture): Promise<JournalWriteResult> {
  if (!capture.text.trim()) return { ok: false, reason: "empty" };
  const note = await files.ensureDailyNote(capture.date);
  if (!note) return { ok: false, reason: "no-note" };
  const time = journalTimeOf(capture.now ?? new Date());
  const task: TaskBoxState | null = capture.task ? "open" : null;
  const changed = await changeNote(files, note.path, (raw) => insertJournalEntry(raw, { heading: capture.heading, time, text: capture.text, task }));
  if (!changed.ok) return changed;
  return {
    ok: true, path: note.path, entry: changed.entry, createdNote: note.created,
    undo: { path: note.path, before: changed.before, after: changed.after, kind: "insert", entry: changed.entry },
  };
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
export async function undoJournalChange(files: Pick<JournalFiles, "readTextFile" | "writeTextFile">, undo: JournalUndo, heading: string): Promise<boolean> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const raw = await files.readTextFile(undo.path);
    let next: string | null;
    if (raw === undo.after) next = undo.before;
    else if (undo.kind === "insert") {
      const removal = removeJournalEntry(raw, undo.entry, { heading });
      next = removal.ok ? removal.content : null;
    } else {
      const restored = restoreJournalEntry(raw, undo.entry, { heading });
      next = restored.ok ? restored.content : null;
    }
    if (next === null) return false;
    if ((await files.readTextFile(undo.path)) !== raw) continue;
    await files.writeTextFile(undo.path, next);
    return true;
  }
  return false;
}
