import { isReservedOkfName } from "../okf-conversion.js";
import { isSystemJunkName } from "./systemJunk.js";

/**
 * Whether a vault holds nothing the user wrote yet (plan Oberfläche, O8).
 *
 * Decided from the root listing alone: a new vault without a template holds
 * only its managed `index.md` (and maybe a `log.md`), so the Files pane showed
 * that one overview as if it were content, and the "write your first note"
 * prompt never came. What counts as nothing:
 *
 * - the OKF overviews `index.md` / `log.md` — the app writes them, not the user;
 * - dot entries (`.plainva/`, `.obsidian/`, `.trash/`) — hidden everywhere;
 * - operating-system bookkeeping (`.DS_Store`, `Thumbs.db`, …).
 *
 * Anything else is content: a note, a database, an attachment, and also a
 * folder — even an empty one, because the user made it on purpose and the
 * prompt would hide the tree it sits in.
 *
 * ONE rule for both shells: the desktop's empty editor pane and the phone's
 * Home ask the same question and must give the same answer. A listing that
 * could not be read is never "empty" — callers pass `null` then.
 */
export function isEmptyVaultListing(
  entries: ReadonlyArray<{ name: string; isDirectory: boolean }> | null,
): boolean {
  if (entries === null) return false;
  return entries.every((e) =>
    e.name.startsWith(".") ||
    isSystemJunkName(e.name) ||
    (!e.isDirectory && isReservedOkfName(e.name)),
  );
}
