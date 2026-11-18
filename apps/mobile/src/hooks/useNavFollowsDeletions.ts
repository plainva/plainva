import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { FileOp } from "@plainva/ui";
import { withoutDeleted, type NavState } from "../navigation";

/**
 * What a deletion took leaves the navigation (review 18.11.): a deleted note,
 * a deleted folder and everything under it, wherever it stands in a stack —
 * the desktop closes their tabs. Every deletion in the app says itself as
 * `plainva-file-ops` (`notifyFileOps`); this reads the deletions of it.
 */
export function useNavFollowsDeletions(setNav: Dispatch<SetStateAction<NavState>>): void {
  useEffect(() => {
    const onOps = (event: Event) => {
      const ops = (event as CustomEvent).detail?.ops as FileOp[] | undefined;
      const deleted = (ops ?? []).flatMap((op) => (op.type === "delete" ? [{ path: op.path, isFolder: op.isFolder === true }] : []));
      if (deleted.length > 0) setNav((state) => withoutDeleted(state, deleted));
    };
    window.addEventListener("plainva-file-ops", onOps);
    return () => window.removeEventListener("plainva-file-ops", onOps);
  }, [setNav]);
}
