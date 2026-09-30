/**
 * What a move or rename really did, told honestly (issue 113, V3/V4). Both
 * shells move through the same two rules:
 *
 * 1. Unsaved text lands first, or nothing moves. A save that fails before the
 *    path changes would otherwise leave the text addressed to a file that is
 *    no longer there — the note moved, the edit stayed behind in the editor.
 *    The move is refused with {@link MoveBlockedError} and the user is told why.
 * 2. Once the file is at its destination the move HAPPENED, whatever fails
 *    after it (the sync queue, bookmarks, the index, link rewrites). Reporting
 *    that as "move failed" made people look for a note that was already
 *    elsewhere, and left the open tab on a path that no longer existed. The
 *    move counts, the tab follows, and the message names what went wrong.
 */

/** A move or rename refused because the unsaved text of `path` could not be saved first. */
export class MoveBlockedError extends Error {
  constructor(
    readonly path: string,
    readonly reason: unknown,
  ) {
    super(`Unsaved changes of ${path} could not be saved before the move`);
    this.name = "MoveBlockedError";
  }
}

/** Minimal file-system surface: both shells' adapters satisfy it. */
export interface ExistsProbe {
  exists(path: string): Promise<boolean>;
}

/**
 * After an error: is the item nevertheless at its destination and gone from
 * its source? Only then does the move count as done. An unreadable answer is
 * "no" — the caller then reports a failed move, which is what it was before.
 */
export async function landedAtDestination(fs: ExistsProbe, from: string, to: string): Promise<boolean> {
  try {
    return (await fs.exists(to)) && !(await fs.exists(from));
  } catch {
    return false;
  }
}

/** The last path segment — how a message names the moved item. */
export function moveItemName(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path;
}
