import type { TFunction } from "i18next";
import { createTaskDatabase, errorText, taskDatabaseLabels, toast } from "@plainva/ui";
import { getMobileSettings, updateMobileSettings } from "./mobileSettings";
import { mPrompt } from "./mobileDialogs";
import type { MobileVault } from "./vaultService";

/**
 * "Create new database…" outside the settings: named, created and set as the
 * standard task database — the same steps as in Settings. Used where a hint
 * asks for one: the capture sheet of the Tasks tab, and a task list that
 * cannot reach any note without it (issue 172), on the Tasks tab and on the
 * account's page. Returns the new path, or null when nothing was created.
 *
 * A database set meanwhile — picked in the settings, by the settings sync —
 * wins: then nothing is created and nothing overwritten, and its path is
 * returned (review of issue 172). Asked before the name, again after it,
 * since the prompt can stay open for as long as it likes, and once more after
 * the file is written, right before the setting is.
 */
export async function createStandardTaskDatabase(vault: MobileVault, t: TFunction): Promise<string | null> {
  const already = getMobileSettings().taskDatabase.trim();
  if (already) return already;
  const name = await mPrompt({
    title: t("settings.taskDatabaseCreate"),
    message: t("settings.taskDatabaseCreateName"),
    initial: t("settings.taskDatabaseDefaultName"),
  });
  if (name.cancelled || !name.value.trim()) return null;
  const meanwhile = getMobileSettings().taskDatabase.trim();
  if (meanwhile) return meanwhile;
  const path = await createTaskDatabase(vault.files, name.value, taskDatabaseLabels((key) => t(key))).catch((e: unknown) => {
    toast.error(t("writeFailed.newDatabase", { reason: errorText(e) }));
    return null;
  });
  if (!path) return null;
  // No watcher on the phone: the index is told, so the tab lists the database now.
  void vault.reindexPaths([path]);
  // Set while the file was written: that one stays the standard, and the new
  // file is an ordinary database in the vault, never deleted again.
  const during = getMobileSettings().taskDatabase.trim();
  if (during) return during;
  await updateMobileSettings({ taskDatabase: path });
  return path;
}
