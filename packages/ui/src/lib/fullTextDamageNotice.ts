import { useEffect, useState } from "react";
import { readFullTextDamage, type FullTextDamage, type SqlStatements } from "@plainva/core";
import type { IndexDatabaseWorkspace } from "./indexDatabase";

/**
 * What the search says when it met a damaged full-text index, in both shells:
 *
 *  - noted, waiting for the next open (`errors.fullTextDamaged`): the next
 *    open makes the full-text index anew;
 *  - that open's attempt failed (`errors.fullTextRebuildFailed`): only setting
 *    the whole index database aside helps — offered at once, the way of the
 *    start's "Rebuild index" (`indexDatabaseRebuildOffered`);
 *  - failed in an encrypted workspace, or where that cannot be told
 *    (`errors.fullTextRebuildFailedWorkspace`): never offered, as at the
 *    start — its queue, revisions and comment outbox live in that database.
 */
export interface FullTextDamageNotice {
  textKey: "errors.fullTextDamaged" | "errors.fullTextRebuildFailed" | "errors.fullTextRebuildFailedWorkspace";
  offerRebuild: boolean;
}

export function fullTextDamageNotice(damage: FullTextDamage, workspace: IndexDatabaseWorkspace): FullTextDamageNotice {
  if (damage.state !== "rebuild-failed") return { textKey: "errors.fullTextDamaged", offerRebuild: false };
  if (workspace === false) return { textKey: "errors.fullTextRebuildFailed", offerRebuild: true };
  return { textKey: "errors.fullTextRebuildFailedWorkspace", offerRebuild: false };
}

/**
 * The notice for a search that failed on a damaged full-text index
 * (`useSearchPages`'s `damaged`): read from the index database's note and
 * the vault's workspace state once the search says so; null before.
 */
export function useFullTextDamageNotice(
  db: SqlStatements | null | undefined,
  damaged: boolean,
  readWorkspace: () => Promise<IndexDatabaseWorkspace>,
): FullTextDamageNotice | null {
  const [notice, setNotice] = useState<FullTextDamageNotice | null>(null);
  useEffect(() => {
    if (!damaged) {
      setNotice(null);
      return;
    }
    let live = true;
    // Until the note is read, the sentence that promises least.
    setNotice({ textKey: "errors.fullTextDamaged", offerRebuild: false });
    void (async () => {
      const damage = db ? await readFullTextDamage(db) : ({ state: "none" } as const);
      const workspace = damage.state === "rebuild-failed" ? await readWorkspace().catch((): IndexDatabaseWorkspace => "unknown") : "unknown";
      if (live) setNotice(fullTextDamageNotice(damage, workspace));
    })();
    return () => {
      live = false;
    };
    // `readWorkspace` is asked again only with a new search failure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, damaged]);
  return notice;
}
