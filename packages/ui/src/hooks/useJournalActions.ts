import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type { JournalEntry } from "@plainva/core";
import { errorText } from "../lib/errorText";
import type { JournalDay } from "../lib/journalFeed";
import {
  deleteJournalEntry,
  editJournalEntry,
  setJournalEntryTaskState,
  toggleJournalEntryTask,
  undoJournalChange,
  type JournalFiles,
  type JournalWriteFailure,
  type JournalWriteResult,
} from "../lib/journalWrite";
import type { JournalRowCaps } from "../lib/rowActions";
import { toast } from "../services/toastStore";

/**
 * What can be DONE to a journal entry, once for every surface (plan Journal,
 * J5): the desktop tab, the phone screen and the "journal of this day" sections
 * all tick, edit, convert, copy and delete through this one hook — and therefore
 * through the one write path, with the same sentences and the same undo.
 *
 * The shell says how it writes (`files`), what a refused change is called in its
 * language (`failureText`), how a day is read again (`onChanged`) and where
 * "show in the note" leads.
 */
export interface JournalActionsDeps {
  /** `null` while no vault is open — every action is a no-op then. */
  files: JournalFiles | null;
  heading: string;
  failureText: (reason: JournalWriteFailure) => string;
  /** A note was changed (or a change was refused because it moved on): read that day again. */
  onChanged: (path: string) => void;
  onShowInNote: (day: Pick<JournalDay, "path">, entry: JournalEntry) => void;
}

export interface JournalEditDraft { path: string; line: number; text: string; asTask: boolean }

export interface JournalActions {
  editing: JournalEditDraft | null;
  setEditing: (next: JournalEditDraft | null | ((prev: JournalEditDraft | null) => JournalEditDraft | null)) => void;
  /** The row's capabilities, in the vocabulary of `journalRowActions`. */
  capsOf: (day: Pick<JournalDay, "path">, entry: JournalEntry) => JournalRowCaps;
  toggle: (day: Pick<JournalDay, "path">, entry: JournalEntry) => void;
  /** Writes the open draft; the editor closes once the entry carries it. */
  saveEdit: (day: Pick<JournalDay, "path">, entry: JournalEntry) => void;
}

type Day = Pick<JournalDay, "path">;

export function useJournalActions(deps: JournalActionsDeps): JournalActions {
  const { t } = useTranslation();
  const { files, heading, failureText, onChanged, onShowInNote } = deps;
  const [editing, setEditing] = useState<JournalEditDraft | null>(null);

  const run = useCallback(async (day: Day, change: (files: JournalFiles) => Promise<JournalWriteResult>, done?: (result: Extract<JournalWriteResult, { ok: true }>) => void) => {
    if (!files) return;
    try {
      const result = await change(files);
      onChanged(day.path);
      if (!result.ok) {
        toast.error(failureText(result.reason));
        return;
      }
      done?.(result);
    } catch (error) {
      toast.error(errorText(error));
    }
  }, [files, failureText, onChanged]);

  const target = useCallback((day: Day, entry: JournalEntry) => ({ path: day.path, entry, heading }), [heading]);

  const toggle = useCallback((day: Day, entry: JournalEntry) => {
    void run(day, (f) => toggleJournalEntryTask(f, target(day, entry)));
  }, [run, target]);

  const capsOf = useCallback((day: Day, entry: JournalEntry): JournalRowCaps => ({
    isTask: entry.task !== null,
    done: entry.task === "done" || entry.task === "cancelled",
    toggle: () => toggle(day, entry),
    edit: () => setEditing({ path: day.path, line: entry.line, text: entry.text, asTask: entry.task !== null }),
    copy: () => {
      void navigator.clipboard.writeText(entry.text).then(() => toast.info(t("journal.copied"))).catch((error) => toast.error(errorText(error)));
    },
    toTask: () => void run(day, (f) => setJournalEntryTaskState(f, target(day, entry), "open")),
    toEntry: () => void run(day, (f) => setJournalEntryTaskState(f, target(day, entry), null)),
    showInNote: () => onShowInNote(day, entry),
    delete: () => void run(day, (f) => deleteJournalEntry(f, target(day, entry)), (result) => {
      const token = result.undo;
      const writer = files;
      toast.success(t("journal.deleted"), token && writer ? {
        label: t("common.undo"),
        run: () => {
          void undoJournalChange(writer, token, heading)
            .then((ok) => { if (ok) onChanged(day.path); else toast.error(t("journal.undoFailed")); })
            .catch((error) => toast.error(errorText(error)));
        },
      } : undefined);
    }),
  }), [files, heading, onChanged, onShowInNote, run, t, target, toggle]);

  const saveEdit = useCallback((day: Day, entry: JournalEntry) => {
    const draft = editing;
    if (!draft || !draft.text.trim()) return;
    void run(day, async (f) => {
      const edited = await editJournalEntry(f, target(day, entry), { text: draft.text });
      if (!edited.ok || draft.asTask === (entry.task !== null)) return edited;
      return setJournalEntryTaskState(f, target(day, edited.entry), draft.asTask ? "open" : null);
    }, () => setEditing(null));
  }, [editing, run, target]);

  return { editing, setEditing, capsOf, toggle, saveEdit };
}
