import { useEffect, useRef } from "react";
import type { IVaultAdapter } from "@plainva/core";
import type { RenameReindexer } from "./fileActions";
import { sweepDesktopPinboardDrafts } from "./pinboardDrafts";

/**
 * Finishes what an app that was closed or killed during a pinboard entry left
 * behind (plan Befunde 2026-09-24, E15), once per opened vault: an empty
 * draft goes the way closing its window would have taken it, anything that
 * changed since Plainva wrote it stays, and a draft that is open right now is
 * left alone. The main window only — it holds the adapter chain and the index
 * every other window delegates to (VaultContext). The phone runs the same
 * clean-up from its shell (`usePinboardDraftSweep` there).
 */
export function usePinboardDraftSweep(opts: {
  /** The main window; a secondary window never sweeps. */
  owner: boolean;
  /** The vault has finished opening. */
  ready: boolean;
  vaultPath: string | null;
  adapter: IVaultAdapter | null;
  indexer: RenameReindexer | null;
  /** Told which files went, so the views refresh. */
  onRemoved?: (paths: string[]) => void;
}): void {
  const { owner, ready, vaultPath, adapter, indexer } = opts;
  const onRemoved = useRef(opts.onRemoved);
  useEffect(() => { onRemoved.current = opts.onRemoved; });
  const sweptFor = useRef<string | null>(null);
  useEffect(() => {
    if (!owner || !ready || !vaultPath || !adapter) return;
    if (sweptFor.current === vaultPath) return;
    sweptFor.current = vaultPath;
    void sweepDesktopPinboardDrafts(vaultPath, adapter, indexer)
      .then((swept) => {
        if (swept.removed.length > 0) onRemoved.current?.(swept.removed);
      })
      .catch((e) => console.warn("[pinboard] finishing drafts failed", e));
  }, [owner, ready, vaultPath, adapter, indexer]);
}
