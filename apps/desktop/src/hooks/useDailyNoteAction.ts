import { useTranslation } from "react-i18next";
import { errorText, toast, useStableHandler } from "@plainva/ui";
import { useVault } from "../contexts/VaultContext";
import { makeDailyPathProvider, resolveOrCreateDailyNote } from "../services/dailyNotes";
import { notifyFileOps } from "../services/indexMdAutoUpdate";
import { applyTemplateInteractive, pokeTemplateCaret } from "../services/templateInteractive";

/** Calendar and sidebar use the same template-aware action in every window. */
export function useDailyNoteAction(onOpenPath: (path: string) => void) {
  const { vaultPath, vaultAdapter, indexer, triggerFileTreeUpdate } = useVault();
  const { t } = useTranslation();
  return useStableHandler(async (date: Date) => {
    if (!vaultPath || !vaultAdapter) return;
    try {
      const path = await resolveOrCreateDailyNote(date, {
        vaultPath,
        adapter: vaultAdapter,
        // A client window writes through the owner adapter, which indexes it.
        onIndex: async () => { await indexer?.indexVaultFull("daily note"); },
        confirmCreate: false,
        onCreated: (createdPath) => notifyFileOps([{ type: "create", path: createdPath }]),
        resolveTemplate: async (raw, ctx) => applyTemplateInteractive(raw, {
          ...ctx,
          vaultName: vaultPath.split(/[/\\]/).filter(Boolean).pop() ?? "",
          dailyPath: await makeDailyPathProvider(vaultPath, ctx.now),
        }, t("templatePicker.answersTitle")),
      });
      if (path) {
        triggerFileTreeUpdate();
        onOpenPath(path);
        pokeTemplateCaret(path);
      }
    } catch (error) {
      toast.error(errorText(error));
    }
  });
}
