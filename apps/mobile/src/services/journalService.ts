import { journalTimeOf, normalizeJournalHeading, type JournalEntry } from "@plainva/core";
import {
  appendJournalEntry,
  appendPlannedJournalEntry as appendPlannedEntry,
  buildDailyNotePath,
  errorText,
  localIsoKey,
  toast,
  undoJournalChange,
  type JournalFiles,
  type JournalUndo,
  type JournalWriteFailure,
  type PlannedJournalEntry,
} from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { getMobileSettings } from "./mobileSettings";
import { syncSoon } from "./syncService";
import { vaultOps, type MobileVault } from "./vaultService";

/**
 * The journal on the phone (plan Journal, J2/J4): the shared write path with
 * this shell's one way of writing — `vaultOps.save` (own-write marking, index)
 * and a sync nudge afterwards. The desktop's twin is `hooks/useJournal.ts`.
 */

/** The vault's journal heading (setting, default "Journal"). */
export const journalHeading = (): string => normalizeJournalHeading(getMobileSettings().journalHeading);

/** Listeners of "a daily note changed through the journal" — the open views read that day again. */
const listeners = new Set<(path: string) => void>();
export function onJournalWrite(listener: (path: string) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function journalFiles(vault: MobileVault): JournalFiles {
  return {
    // Headless (decision E4): a capture never stops for the template's questions.
    ensureDailyNote: (date) => vaultOps.ensureDailyNote(vault, date, "headless"),
    readTextFile: (path) => vaultOps.read(vault, path),
    writeTextFile: async (path, content) => {
      await vaultOps.save(vault, path, content);
      syncSoon();
      // An open editor of this note adopts the line (its pending save was
      // flushed before the read); the app's own write is never reported as
      // a change from outside.
      window.dispatchEvent(new CustomEvent("m-external-update", { detail: { path } }));
      listeners.forEach((listener) => listener(path));
    },
  };
}

const FAILURE_KEY: Record<JournalWriteFailure, string> = {
  empty: "journal.failedMissing",
  time: "journal.failedUnplaceable",
  missing: "journal.failedMissing",
  unplaceable: "journal.failedUnplaceable",
  "no-note": "journal.failedNoNote",
  changed: "journal.failedChanged",
};

/** The sentence for a change that was refused. */
export const journalFailureText = (reason: JournalWriteFailure): string => i18n.t(FAILURE_KEY[reason]);

async function undo(vault: MobileVault, token: JournalUndo, heading: string): Promise<void> {
  try {
    const done = await undoJournalChange(journalFiles(vault), token, heading);
    if (done) toast.info(i18n.t("journal.undone"));
    else toast.error(i18n.t("journal.undoFailed"));
  } catch (error) {
    toast.error(errorText(error));
  }
}

/** Day, time, heading and daily note a share that goes "into the journal" is planned with. */
export function planSharedJournalEntry(now: Date = new Date()): { date: string; time: string; heading: string; notePath: string } {
  const ms = getMobileSettings();
  return {
    date: localIsoKey(now),
    time: journalTimeOf(now),
    heading: journalHeading(),
    notePath: buildDailyNotePath(now, ms.dailyFormat || "YYYY-MM-DD", ms.dailyFolder).fullPath,
  };
}

/**
 * Writes a PLANNED entry (the share target, plan Journal J4) and resolves with
 * the note it went to. Idempotent: the plan fixed day, time and text, so a retry
 * after a crash finds its own entry and writes nothing.
 */
export async function appendPlannedJournalEntry(vault: MobileVault, planned: PlannedJournalEntry): Promise<string> {
  // The rule — and what makes it idempotent — lives in the shared write path.
  const path = await appendPlannedEntry(journalFiles(vault), planned);
  if (!path) throw new Error("SHARE_WRITE_FAILED");
  return path;
}

/**
 * Capture with the toast every entry point shares: "Entry saved · Undo".
 * Resolves with the entry, or `null` when nothing was written — the caller
 * keeps the typed text in that case.
 */
export async function captureJournalEntry(vault: MobileVault, input: { text: string; task: boolean; date?: Date }): Promise<{ path: string; entry: JournalEntry } | null> {
  try {
    const heading = journalHeading();
    const result = await appendJournalEntry(journalFiles(vault), { date: input.date ?? new Date(), text: input.text, heading, task: input.task });
    if (!result.ok) {
      // An empty text is not an error worth a sentence; the field simply stays.
      if (result.reason !== "empty") toast.error(journalFailureText(result.reason));
      return null;
    }
    const token = result.undo;
    toast.success(i18n.t("journal.saved"), token ? { label: i18n.t("common.undo"), run: () => void undo(vault, token, heading) } : undefined);
    return { path: result.path, entry: result.entry };
  } catch (error) {
    toast.error(errorText(error));
    return null;
  }
}
