import { updateVaultText } from "@plainva/core";
import { TemplateKeysNotice as SharedTemplateKeysNotice, errorText, toast, useTemplateKeyCleanup } from "@plainva/ui";
import { useVault } from "../../contexts/VaultContext";
import { appConfirm } from "../../services/appDialogs";

/**
 * "Keys taken over from templates" in the tasks view (open-items plan 3.136
 * no. 1, decision E2) — the desktop's wiring of the shared hook and notice;
 * the phone's twin is `apps/mobile/src/components/TemplateKeysNotice`. A note
 * is changed through the vault's one entry for a change (`updateVaultText`):
 * the open editor follows, an open conflict takes the change in both versions.
 */
export function TemplateKeysNotice({ reloadKey, templateFolder, onChanged }: { reloadKey: unknown; templateFolder: string; onChanged: () => void }) {
  const { queryService, vaultAdapter, vaultPath } = useVault();
  const state = useTemplateKeyCleanup({
    vault: vaultAdapter ? vaultPath : null,
    reloadKey,
    queryService: vaultAdapter ? (queryService ?? null) : null,
    templateFolder,
    updateTextFile: async (path, change) => {
      const update = await updateVaultText(vaultAdapter!, path, change);
      // The chain does not announce its own write: an open editor follows on this.
      window.dispatchEvent(new CustomEvent("plainva-external-update", { detail: { path } }));
      return update;
    },
    onChanged,
    onError: (e) => {
      console.error("[TemplateKeysNotice]", e);
      toast.error(errorText(e));
    },
  });
  return <SharedTemplateKeysNotice state={state} className="pv-names-notice--inset" confirm={(o) => appConfirm({ ...o, kind: "warning" })} />;
}
