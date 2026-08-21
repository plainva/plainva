import { useEffect } from "react";
import { createIndexAutoUpdater, type FileOp } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import type { MobileVault } from "./vaultService";

/**
 * Keeps Plainva-managed index.md overviews current on the phone (P6).
 *
 * It is the same updater the desktop runs, not a second one — which is the
 * whole point: a vault edited on the phone used to drift out of date until a
 * desktop opened it, so the two shells disagreed about a file they both write.
 *
 * Operation-driven, not watcher-driven. `vaultOps` names what happened
 * (create/delete/move) after its reindex; the updater debounces per batch and
 * rewrites only listings that already exist, carry the managed marker and sit
 * in an OKF-active vault. Structurally loop-free: writing an index.md is a
 * reserved-name path and never queues another refresh.
 *
 * Deliberately NOT hooked to the indexer's new-file callback, which would look
 * tempting because it catches every path: it also fires for every file of a
 * cold full pass, so a fresh install would rewrite every overview it has and
 * queue a sync push for each one.
 */
export function useIndexAutoUpdate(vault: MobileVault | null, vaultName: string): void {
  useEffect(() => {
    if (!vault?.queryService) return;
    const updater = createIndexAutoUpdater({
      adapter: vault.files,
      queryService: vault.queryService,
      vaultName: () => vaultName,
      subfoldersHeading: () => i18n.t("indexMd.subfoldersHeading"),
      onWritten: (indexPath) => {
        // The listing changed on disk; a note screen showing it reloads, and
        // the tree picks up a file that may have just been created.
        window.dispatchEvent(new CustomEvent("m-external-update", { detail: { path: indexPath } }));
        window.dispatchEvent(new CustomEvent("m-vault-changed"));
      },
    });
    const onOps = (e: Event) => {
      const ops = (e as CustomEvent).detail?.ops as FileOp[] | undefined;
      if (Array.isArray(ops) && ops.length > 0) updater.notify(ops);
    };
    window.addEventListener("plainva-file-ops", onOps);
    return () => {
      window.removeEventListener("plainva-file-ops", onOps);
      updater.dispose();
    };
  }, [vault, vaultName]);
}
