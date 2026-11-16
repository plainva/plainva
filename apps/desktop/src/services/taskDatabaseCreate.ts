import type { TFunction } from "i18next";
import type { IVaultAdapter } from "@plainva/core";
import { errorText, taskDatabaseLabels, toast } from "@plainva/ui";
import { taskDatabaseKey } from "../contexts/VaultContext";
import { appPrompt } from "./appDialogs";
import { applyIndexChanges } from "./fileActions";
import { getSettingsStore } from "./settingsStore";
import { createTaskDatabase, getTaskDatabasePath } from "./taskDatabase";

/**
 * "Create new database…" outside the settings: named, created and set as the
 * vault's standard task database — the same steps as in Settings. Used where
 * a hint asks for one: the capture in the Tasks view, and a task list that
 * cannot reach any note without it (issue 172), in the Tasks view and on the
 * account's page. Returns the new path, or null when nothing was created.
 *
 * A database set meanwhile — picked in the settings, on another window, by
 * the settings sync — wins: then nothing is created and nothing overwritten,
 * and its path is returned (review of issue 172). Asked before the name and
 * again after it, since the prompt can stay open for as long as it likes.
 */
export async function createStandardTaskDatabase(deps: {
  vaultAdapter: IVaultAdapter;
  vaultPath: string;
  indexer: Parameters<typeof applyIndexChanges>[0] | null | undefined;
  triggerFileTreeUpdate: (paths?: string[]) => void;
  t: TFunction;
}): Promise<string | null> {
  const { vaultAdapter, vaultPath, indexer, triggerFileTreeUpdate, t } = deps;
  const already = await getTaskDatabasePath(vaultPath);
  if (already) return already;
  const name = await appPrompt({
    title: t("settings.taskDatabaseCreate"),
    message: t("settings.taskDatabaseCreateName"),
    initial: t("settings.taskDatabaseDefaultName"),
  });
  if (name === null) return null;
  const meanwhile = await getTaskDatabasePath(vaultPath);
  if (meanwhile) return meanwhile;
  try {
    const path = await createTaskDatabase(vaultAdapter, name, taskDatabaseLabels((key) => t(key)));
    if (!path) return null;
    const store = await getSettingsStore();
    await store.set(taskDatabaseKey(vaultPath), path);
    await store.save();
    if (indexer) await applyIndexChanges(indexer, { added: [path] }).catch(() => undefined);
    triggerFileTreeUpdate([path]);
    // Every view that shows the setting reads it again (useTaskDatabaseSetting).
    window.dispatchEvent(new CustomEvent("plainva-features-saved"));
    return path;
  } catch (e) {
    toast.error(t("writeFailed.newDatabase", { reason: errorText(e) }));
    return null;
  }
}
