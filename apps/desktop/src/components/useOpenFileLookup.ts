import { useEffect, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { adoptExternalMove, movedFolderLabel, toast, useMissingFile, vaultDisplayName, type MissingFile } from "@plainva/ui";
import { useVault } from "../contexts/VaultContext";
import { retargetDesktopBookmarks } from "../services/bookmarks";
import { applyIndexChanges } from "../services/fileActions";

export interface OpenFileLookupOptions {
  /** False where the surface is not the file's own place: a database embedded in a note follows its link. */
  enabled: boolean;
  /**
   * Takes along what the surface holds that never reached the disk, before it
   * follows the file to `to`. Resolves false when that failed; the surface
   * then stays and offers the file.
   */
  carry?(to: string): Promise<boolean>;
  /** Tab retargeting — the same the rename in Plainva uses. */
  onRenamed?(from: string, to: string): void;
  /** A surface without tabs of its own (the peek, an auxiliary window) opens the file where it lives now. */
  onOpenPath?(path: string, newTab: boolean): void;
}

/**
 * The desktop's lookup for an open database or image whose file is not where
 * its tab says (issue 110, E9) — the shared `useMissingFile` with this shell's
 * index, bookmark store and navigation. It also hears the vanish itself: the
 * watcher, a reconcile or sync report the old path as an external update
 * (VaultContext), and a file still missing a moment later is looked for. The
 * moment lets a rename made in Plainva retarget the tab first.
 */
export function useOpenFileLookup(path: string, opts: OpenFileLookupOptions): MissingFile {
  const { t } = useTranslation();
  const { vaultAdapter, queryService, indexer, vaultPath, triggerFileTreeUpdate } = useVault();
  const db = queryService?.db;
  const missing = useMissingFile(path, {
    deps: opts.enabled && vaultAdapter && indexer && db ? { exists: (p) => vaultAdapter.exists(p), db, indexer } : null,
    scope: vaultPath ?? "",
    // What a move made in Plainva carries along — bookmarks, pinboard places,
    // the file operation — for a move made elsewhere. Links in other notes
    // stay as they are.
    adopt: async (from, to) => {
      if (!vaultAdapter) return;
      await adoptExternalMove({
        retargetBookmarks: (f, target) => retargetDesktopBookmarks(vaultAdapter, f, target),
        pinboard: { adapter: vaultAdapter, queryService },
        reindex: async (paths) => { if (indexer) await applyIndexChanges(indexer, { added: paths }); },
      }, from, to);
    },
    carry: opts.carry,
    // A surface that cannot navigate offers the file instead of following it.
    follow: opts.onRenamed || opts.onOpenPath ? (to) => {
      toast.info(t("editor.movedFileFollowed", {
        defaultValue: "Moved outside Plainva. The tab now shows the file in {{folder}}.",
        folder: movedFolderLabel(to, vaultDisplayName(vaultPath ?? "")),
      }));
      if (opts.onRenamed) opts.onRenamed(path, to);
      else opts.onOpenPath?.(to, false);
    } : undefined,
    onIndexChanged: () => triggerFileTreeUpdate(),
  });

  const { look, lookup } = missing;
  const shownRef = useRef(false);
  useLayoutEffect(() => {
    shownRef.current = lookup !== null;
  });
  useEffect(() => {
    if (!opts.enabled || !vaultAdapter) return;
    let alive = true;
    let timer: number | null = null;
    const onUpdate = (e: Event) => {
      if ((e as CustomEvent).detail?.path !== path) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        void vaultAdapter.exists(path).then((present) => {
          if (alive && !present && !shownRef.current) look();
        }, () => { /* the disk cannot answer; nothing is decided */ });
      }, 400);
    };
    window.addEventListener("plainva-external-update", onUpdate);
    return () => {
      alive = false;
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener("plainva-external-update", onUpdate);
    };
  }, [path, vaultAdapter, opts.enabled, look]);

  return missing;
}
