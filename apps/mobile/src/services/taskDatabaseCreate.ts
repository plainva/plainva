import type { TFunction } from "i18next";
import { createTaskDatabase, errorText, taskDatabaseLabels, toast } from "@plainva/ui";
import { updateMobileSettings } from "./mobileSettings";
import { mPrompt } from "./mobileDialogs";
import type { MobileVault } from "./vaultService";

/**
 * "Create new database…" outside the settings: named, created and set as the
 * standard task database — the same steps as in Settings. Used where a hint
 * asks for one: the capture sheet of the Tasks tab, and a task list that
 * cannot reach any note without it (issue 172), on the Tasks tab and on the
 * account's page. Returns the new path, or null when nothing was created.
 */
export async function createStandardTaskDatabase(vault: MobileVault, t: TFunction): Promise<string | null> {
  const name = await mPrompt({
    title: t("settings.taskDatabaseCreate"),
    message: t("settings.taskDatabaseCreateName"),
    initial: t("settings.taskDatabaseDefaultName"),
  });
  if (name.cancelled || !name.value.trim()) return null;
  const path = await createTaskDatabase(vault.files, name.value, taskDatabaseLabels((key) => t(key))).catch((e: unknown) => {
    toast.error(t("writeFailed.newDatabase", { reason: errorText(e) }));
    return null;
  });
  if (!path) return null;
  await updateMobileSettings({ taskDatabase: path });
  // No watcher on the phone: the index is told, so the tab lists the database now.
  void vault.reindexPaths([path]);
  return path;
}
