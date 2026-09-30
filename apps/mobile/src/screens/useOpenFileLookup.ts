import { useEffect, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { adoptExternalMove, movedFolderLabel, renameBookmarksOnDisk, toast, useMissingFile, type MissingFile } from "@plainva/ui";
import { getVaultEntry } from "../services/vaultRegistry";
import type { MobileVault } from "../services/vaultService";

export interface OpenFileLookupOptions {
  /**
   * Takes along what the screen holds that never reached the disk, before it
   * follows the file to `to`. Resolves false when that failed; the screen
   * then stays and offers the file.
   */
  carry?(to: string): Promise<boolean>;
  /** Puts the screen on the file's new path — the same the rename in Plainva does. */
  onRenamed?(to: string): void;
}

/**
 * The phone's lookup for an open database or image whose file is not where
 * the screen says (issue 110, E9) — the shared `useMissingFile` with this
 * shell's index, bookmark store and navigation. It also hears the vanish
 * itself: a return to the app, a pull-to-refresh or sync re-read the vault
 * and report the old path as an external update (vaultService), and a file
 * still missing a moment later is looked for.
 */
export function useOpenFileLookup(vault: MobileVault, path: string, opts: OpenFileLookupOptions): MissingFile {
  const { t } = useTranslation();
  const missing = useMissingFile(path, {
    deps: vault.indexer && vault.db ? { exists: (p) => vault.adapter.exists(p), db: vault.db, indexer: vault.indexer } : null,
    scope: vault.vaultId,
    // What a move made in Plainva carries along — bookmarks, pinboard places,
    // the file operation — for a move made elsewhere. Links in other notes
    // stay as they are.
    adopt: async (from, to) => {
      await adoptExternalMove({
        retargetBookmarks: (f, target) => renameBookmarksOnDisk(vault.adapter, f, target),
        pinboard: { adapter: vault.files, queryService: vault.queryService },
        reindex: (paths) => vault.reindexPaths(paths),
      }, from, to);
      window.dispatchEvent(new CustomEvent("m-vault-changed"));
    },
    carry: opts.carry,
    // A screen that cannot navigate offers the file instead of following it.
    follow: opts.onRenamed ? (to) => {
      void getVaultEntry(vault.vaultId).catch(() => null).then((entry) => {
        toast.info(t("mobile.fileMovedFollowed", { folder: movedFolderLabel(to, entry?.name || t("mobile.vaultLocal")) }));
      });
      opts.onRenamed?.(to);
    } : undefined,
    onIndexChanged: () => window.dispatchEvent(new CustomEvent("m-vault-changed")),
  });

  const { look, lookup } = missing;
  const shownRef = useRef(false);
  useLayoutEffect(() => {
    shownRef.current = lookup !== null;
  });
  useEffect(() => {
    let alive = true;
    let timer: number | null = null;
    const onUpdate = (e: Event) => {
      const detail = (e as CustomEvent<{ path?: string; vaultId?: string }>).detail;
      if (detail?.path !== path || (detail.vaultId && detail.vaultId !== vault.vaultId)) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        void vault.adapter.exists(path).then((present) => {
          if (alive && !present && !shownRef.current) look();
        }, () => { /* the disk cannot answer; nothing is decided */ });
      }, 400);
    };
    window.addEventListener("m-external-update", onUpdate);
    return () => {
      alive = false;
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener("m-external-update", onUpdate);
    };
  }, [vault, path, look]);

  return missing;
}
