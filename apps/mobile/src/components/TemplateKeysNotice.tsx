import { TemplateKeysNotice as SharedTemplateKeysNotice, errorText, toast, useTemplateKeyCleanup } from "@plainva/ui";
import { mConfirm } from "../services/mobileDialogs";
import { syncSoon } from "../services/syncService";
import { vaultOps, type MobileVault } from "../services/vaultService";

/**
 * "Keys taken over from templates" on the phone (open-items plan 3.136 no. 1,
 * decision E2) — the twin of the desktop's TemplateKeysNotice, on the same
 * shared hook and notice. A note is changed through the phone's one entry for
 * a change (`vaultOps.update`: the sync chain, the index), and an open editor
 * is told.
 */
export function TemplateKeysNotice({ vault, reloadKey, templateFolder, onChanged }: { vault: MobileVault; reloadKey: unknown; templateFolder: string; onChanged: () => void }) {
  const state = useTemplateKeyCleanup({
    vault: vault.vaultId,
    reloadKey,
    queryService: vault.queryService ?? null,
    templateFolder,
    updateTextFile: async (path, change) => {
      const update = await vaultOps.update(vault, path, change);
      window.dispatchEvent(new CustomEvent("m-external-update", { detail: { path, vaultId: vault.vaultId } }));
      return update;
    },
    onChanged: () => {
      onChanged();
      syncSoon();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  return <SharedTemplateKeysNotice state={state} className="m-names-notice" confirm={(o) => mConfirm(o)} />;
}
