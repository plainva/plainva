import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { indexBuildState, subscribeIndexBuild } from "../lib/indexBuild";

/**
 * Counts the moments the index of `vaultId` became whole (fourth review of
 * 11.11.). A surface that read its rows while the index was built reads them
 * again then: a warm scan that changed nothing bumps no tree version, and the
 * rows of the build stayed on screen — a database view of half the notes,
 * after the index was whole. Mirrored windows hear the same moment.
 */
export function useIndexWholeEpoch(vaultId: string | null | undefined): number {
  const read = useCallback(() => (vaultId ? indexBuildState(vaultId).kind : "whole"), [vaultId]);
  const kind = useSyncExternalStore(subscribeIndexBuild, read);
  const [epoch, setEpoch] = useState(0);
  const last = useRef(kind);
  useEffect(() => {
    if (kind === "whole" && last.current !== "whole") setEpoch((n) => n + 1);
    last.current = kind;
  }, [kind]);
  return epoch;
}
