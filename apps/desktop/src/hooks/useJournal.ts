import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { normalizeJournalHeading, type JournalEntry } from "@plainva/core";
import {
  appendJournalEntry,
  ensureDailyNote,
  errorText,
  journalToday,
  toast,
  undoJournalChange,
  useStableHandler,
  type JournalFiles,
  type JournalUndo,
  type JournalWriteFailure,
} from "@plainva/ui";
import { journalHeadingKey, useVault } from "../contexts/VaultContext";
import { dailyNoteFiles, makeDailyPathProvider, readDailyNoteConfig } from "../services/dailyNotes";
import { applyIndexChanges } from "../services/fileActions";
import { notifyFileOps } from "../services/indexMdAutoUpdate";
import { setQuickCaptureSink } from "../services/quickCapture";
import { getSettingsStore } from "../services/settingsStore";
import { isOwnerWindow } from "../services/windowContext";

/**
 * The journal on the desktop (plan Journal, J2/J4): the shared write path with
 * this shell's one way of writing — vault adapter, targeted index update, the
 * change notice an open editor merges in.
 */

/** The vault's journal heading (setting, default "Journal"). */
export async function readJournalHeading(vaultPath: string): Promise<string> {
  const store = await getSettingsStore();
  return normalizeJournalHeading(await store.get<string>(journalHeadingKey(vaultPath)));
}

/** What the shared write path needs from this shell; `null` while no vault is open. */
export function useJournalFiles(): JournalFiles | null {
  const { vaultPath, vaultAdapter, indexer, triggerFileTreeUpdate } = useVault();
  return useMemo(() => {
    if (!vaultPath || !vaultAdapter) return null;
    const written = async (path: string) => {
      // The views read the index; update it before telling them.
      if (indexer) await applyIndexChanges(indexer, { added: [path] }).catch(() => undefined);
      triggerFileTreeUpdate([path]);
    };
    return {
      ensureDailyNote: async (date) => {
        const now = new Date();
        // Headless (decision E4): a capture never stops for the template's questions.
        const ensured = await ensureDailyNote(date, await readDailyNoteConfig(vaultPath), dailyNoteFiles(vaultAdapter), {
          now,
          templateContext: {
            vaultName: vaultPath.split(/[/\\]/).filter(Boolean).pop() ?? "",
            dailyPath: await makeDailyPathProvider(vaultPath, date),
          },
        });
        if (ensured?.created) {
          notifyFileOps([{ type: "create", path: ensured.path }]);
          await written(ensured.path);
        }
        return ensured;
      },
      readTextFile: (path) => vaultAdapter.readTextFile(path),
      writeTextFile: async (path, content) => {
        await vaultAdapter.writeTextFile(path, content);
        await written(path);
        // An open editor of this note adopts the line (its pending save was
        // flushed before the read). The adapter counts this write as the app's
        // own, so no watcher would ever tell it.
        window.dispatchEvent(new CustomEvent("plainva-external-update", { detail: { path, vaultPath } }));
      },
    };
  }, [vaultPath, vaultAdapter, indexer, triggerFileTreeUpdate]);
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
export const journalFailureKey = (reason: JournalWriteFailure): string => FAILURE_KEY[reason];

export interface JournalCaptureInput { text: string; task: boolean; date?: Date }

/** What a capture came to. `message` is the sentence for a refusal; `null` = nothing worth a sentence (empty text). */
type CaptureOutcome = { ok: true; path: string; entry: JournalEntry } | { ok: false; message: string | null };

/**
 * One capture for every way in. A success answers with the toast all of them
 * share — "Entry saved · Undo" — and a refusal comes back as a sentence, so the
 * caller decides where it is said: as a toast in this window, or inside the
 * quick-capture window, where a toast over here would not be seen.
 */
function useCaptureWithOutcome(): (input: JournalCaptureInput) => Promise<CaptureOutcome> {
  const { vaultPath } = useVault();
  const files = useJournalFiles();
  const { t } = useTranslation();

  const undo = useStableHandler(async (token: JournalUndo, heading: string) => {
    if (!files) return;
    try {
      const done = await undoJournalChange(files, token, heading);
      if (done) toast.info(t("journal.undone"));
      else toast.error(t("journal.undoFailed"));
    } catch (error) {
      toast.error(errorText(error));
    }
  });

  return useStableHandler(async ({ text, task, date }: JournalCaptureInput): Promise<CaptureOutcome> => {
    if (!files || !vaultPath) return { ok: false, message: t("quickCapture.noVault") };
    try {
      const heading = await readJournalHeading(vaultPath);
      // `journalToday()`, not `new Date()`: with a day boundary set, an entry at
      // 01:30 joins yesterday's note — and is still stamped 01:30, because the
      // moment of writing travels separately (plan Journal-Erweiterungen, X1).
      const result = await appendJournalEntry(files, { date: date ?? journalToday(), text, heading, task });
      if (!result.ok) {
        // An empty text is not an error worth a sentence; the field simply stays.
        return { ok: false, message: result.reason === "empty" ? null : t(journalFailureKey(result.reason)) };
      }
      const token = result.undo;
      toast.success(t("journal.saved"), token ? { label: t("common.undo"), run: () => void undo(token, heading) } : undefined);
      return { ok: true, path: result.path, entry: result.entry };
    } catch (error) {
      return { ok: false, message: errorText(error) };
    }
  });
}

/**
 * Capture from inside this window. Resolves with the entry, or `null` when
 * nothing was written — the caller keeps the typed text in that case.
 */
export function useJournalCapture(): (input: JournalCaptureInput) => Promise<{ path: string; entry: JournalEntry } | null> {
  const capture = useCaptureWithOutcome();
  return useStableHandler(async (input: JournalCaptureInput) => {
    const outcome = await capture(input);
    if (outcome.ok) return { path: outcome.path, entry: outcome.entry };
    if (outcome.message) toast.error(outcome.message);
    return null;
  });
}

/**
 * The global quick capture's way in (plan Journal, J7): while a vault is open,
 * this shell takes what the capture window hands over. The refusal travels back
 * as a sentence — that window shows it and keeps the text.
 */
export function useQuickCaptureSink(): void {
  const { vaultPath } = useVault();
  const { t } = useTranslation();
  const capture = useCaptureWithOutcome();
  const sink = useStableHandler(async ({ text, task }: { text: string; task: boolean }) => {
    const outcome = await capture({ text, task });
    return outcome.ok ? ({ ok: true } as const) : ({ ok: false, message: outcome.message ?? t("quickCapture.failed") } as const);
  });
  // The central window only: the bus hands captures to it, and a full second
  // window - the same shell in client mode - has nothing to answer.
  useEffect(() => (vaultPath && isOwnerWindow() ? setQuickCaptureSink(sink) : undefined), [vaultPath, sink]);
}
