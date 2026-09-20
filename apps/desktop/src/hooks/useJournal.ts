import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { normalizeJournalHeading, type JournalEntry } from "@plainva/core";
import {
  appendJournalEntry,
  ensureDailyNote,
  errorText,
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
import { getSettingsStore } from "../services/settingsStore";

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

/**
 * Capture with the toast every entry point shares: "Entry saved · Undo".
 * Resolves with the entry, or `null` when nothing was written — the caller
 * keeps the typed text in that case.
 */
export function useJournalCapture(): (input: JournalCaptureInput) => Promise<{ path: string; entry: JournalEntry } | null> {
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

  return useStableHandler(async ({ text, task, date }: JournalCaptureInput) => {
    if (!files || !vaultPath) return null;
    try {
      const heading = await readJournalHeading(vaultPath);
      const result = await appendJournalEntry(files, { date: date ?? new Date(), text, heading, task });
      if (!result.ok) {
        // An empty text is not an error worth a sentence; the field simply stays.
        if (result.reason !== "empty") toast.error(t(journalFailureKey(result.reason)));
        return null;
      }
      const token = result.undo;
      toast.success(t("journal.saved"), token ? { label: t("common.undo"), run: () => void undo(token, heading) } : undefined);
      return { path: result.path, entry: result.entry };
    } catch (error) {
      toast.error(errorText(error));
      return null;
    }
  });
}
