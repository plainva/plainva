import { isPlainvaManagedIndex } from "../okf-index.js";
import { isSystemJunkName } from "./systemJunk.js";

/**
 * What the start of a vault shows (plan Oberfläche, O8):
 *
 * - `"empty"` — nothing the person wrote yet: the "write your first note" prompt;
 * - `"fetching"` — nothing here YET, and the first pull of its cloud folder is
 *   still running: the vault is being loaded, not empty;
 * - `"content"` — everything else, and every case that could not be decided.
 */
export type VaultEmptiness = "content" | "empty" | "fetching";

/** The two reads the rule needs — any vault adapter has them. */
export interface VaultRootReader {
  listDir(path: string): Promise<ReadonlyArray<{ name: string; isDirectory: boolean }>>;
  readTextFile(path: string): Promise<string>;
}

/**
 * ONE rule for both shells: the desktop's empty editor pane and the phone's
 * Home ask the same question and must give the same answer.
 *
 * Decided from the root: a new vault without a template holds only the
 * `index.md` Plainva generated for it, so the Files pane showed that overview
 * as if it were content and the prompt never came. What counts as nothing:
 *
 * - an `index.md` that carries Plainva's marker (`isPlainvaManagedIndex`) —
 *   read to be sure: an `index.md` without the marker is the person's own
 *   (an Obsidian home note) and a note like any other. So is a `log.md`:
 *   Plainva never writes one into a new vault (review of O8, 2026-11-17 —
 *   the prompt replaced the phone's whole Home over such a vault, and its one
 *   note could no longer be reached);
 * - dot entries (`.plainva/`, `.obsidian/`, `.trash/`) — hidden everywhere;
 * - operating-system bookkeeping (`.DS_Store`, `Thumbs.db`, …).
 *
 * Anything else is content — a note, a database, an attachment, a folder
 * (even an empty one: the person made it on purpose). A root or an `index.md`
 * that cannot be read is content too: a prompt over a vault full of notes
 * would be the one wrong thing this can show.
 */
export async function readVaultEmptiness(
  vault: VaultRootReader,
  options: { firstPullPending?: boolean } = {},
): Promise<VaultEmptiness> {
  let entries: ReadonlyArray<{ name: string; isDirectory: boolean }>;
  try {
    entries = await vault.listDir("");
  } catch {
    return "content";
  }
  const left = entries.filter((e) => !e.name.startsWith(".") && !isSystemJunkName(e.name));
  // The listing decides first; a file is read only when it alone is in doubt.
  if (left.some((e) => e.isDirectory || e.name.toLowerCase() !== "index.md")) return "content";
  for (const e of left) {
    try {
      if (!isPlainvaManagedIndex(await vault.readTextFile(e.name))) return "content";
    } catch {
      return "content";
    }
  }
  return options.firstPullPending ? "fetching" : "empty";
}

/**
 * Whether the first pull of a syncing vault is running or about to start — the
 * one rule both shells ask before they call an empty vault "being loaded"
 * (second review of O8, 2026-11-17).
 *
 * `firstPullDone` is `false` only from the moment a sync worker exists until
 * its first cycle has finished, `true` after it, and absent (`null` or
 * `undefined`) while no worker runs — a folder held back for a decision, a
 * vault that does not sync, a stopped sync. Only `false` is "loading": a
 * status that names a provider proves nothing about a pull. A failed pull is
 * not pending either: the ordinary start shows, and the status bar says what
 * went wrong. A worker that is retrying is still about to fetch.
 */
export function isFirstPullPending(s: { firstPullDone?: boolean | null; status: string }): boolean {
  return s.firstPullDone === false && s.status !== "error" && s.status !== "off";
}
