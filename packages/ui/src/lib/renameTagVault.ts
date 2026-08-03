/**
 * Renaming a tag across the whole vault (S32).
 *
 * The rewriting itself is core's `renameTagInText`. What lives here is the part
 * that was hand-written in the desktop's tag tree and would otherwise be
 * hand-written a second time on the phone: which notes to touch, what to do
 * when one of them cannot be read, and what to report afterwards.
 *
 * Two decisions in particular are worth not re-deciding:
 *
 *  - A note that fails is SKIPPED, not fatal. Half a vault renamed is better
 *    than none, and the alternative — abort on the first locked or unreadable
 *    file — leaves the vault in exactly the same split state anyway, minus the
 *    work that did succeed.
 *  - The count reported is notes CHANGED, not notes examined. `findNotesWithTag`
 *    is an index lookup and the index can be a moment stale; a note that no
 *    longer carries the tag must not inflate the number the user is told.
 */

export interface RenameTagDeps {
  /** Index lookup: notes that carry the tag (or one of its children). */
  findNotesWithTag(tag: string): Promise<readonly string[]>;
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, content: string): Promise<void>;
  /** core's `renameTagInText`. */
  rename(content: string, from: string, to: string): { changed: boolean; content: string };
}

export interface RenameTagResult {
  /** Notes actually rewritten. */
  notes: number;
  /** Notes that could not be read or written; the rest still applied. */
  failed: number;
}

export async function renameTagAcrossVault(
  deps: RenameTagDeps,
  fullTag: string,
  newName: string,
): Promise<RenameTagResult> {
  const candidates = await deps.findNotesWithTag(fullTag);
  let notes = 0;
  let failed = 0;
  for (const path of candidates) {
    try {
      // Read fresh rather than trusting the index's copy: the rename writes the
      // file back whole, so a stale read would silently revert edits made since
      // the index last ran.
      const fresh = await deps.readTextFile(path);
      const res = deps.rename(fresh, fullTag, newName);
      if (res.changed && res.content !== fresh) {
        await deps.writeTextFile(path, res.content);
        notes += 1;
      }
    } catch {
      failed += 1;
    }
  }
  return { notes, failed };
}

/**
 * Is this a rename worth doing at all? Same answer on both shells: strip a
 * leading `#` the user may have typed, refuse the empty and the unchanged.
 * The name's own validity is core's `isValidTagName`, passed in.
 */
export function normalizeRenameTarget(
  input: string,
  fullTag: string,
  isValid: (name: string) => boolean,
): string | null {
  const name = input.replace(/^#/, "").trim();
  if (!name || name === fullTag || !isValid(name)) return null;
  return name;
}
