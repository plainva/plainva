import { useEffect, useState } from "react";
import { buildWikiTargetSet, type WikiTargetSet } from "@plainva/ui";
import type { MobileVault } from "../services/vaultService";

/**
 * The vault's link targets for a list that draws links — a task's title on
 * the Tasks and Today screens: a link to a note that does not exist yet reads
 * as unresolved there, as it does in the editor (`TaskTitle`). The desktop's
 * twin is `useWikiResolver`.
 *
 * Read once per `reloadKey` (the screen's index bump) and kept with the query
 * service it came from, so another vault never shows this one's answer. null
 * while it loads, without an index, or when the read failed — every link then
 * counts as resolved (`isWikiTargetResolved`), never flashes as missing.
 */
export function useLinkTargetLookup(vault: MobileVault, reloadKey: unknown): WikiTargetSet | null {
  const qs = vault.queryService ?? null;
  const [state, setState] = useState<{ source: NonNullable<MobileVault["queryService"]>; lookup: WikiTargetSet | null } | null>(null);
  useEffect(() => {
    if (!qs) return;
    let stale = false;
    // Asked inside the chain: a read that throws at once fails like one that rejects.
    void Promise.resolve()
      .then(() => qs.linkTargets())
      .then((files) => {
        if (!stale) setState({ source: qs, lookup: buildWikiTargetSet(files) });
      })
      .catch(() => {
        if (!stale) setState({ source: qs, lookup: null });
      });
    return () => {
      stale = true;
    };
  }, [qs, reloadKey]);
  return state && state.source === qs ? state.lookup : null;
}
