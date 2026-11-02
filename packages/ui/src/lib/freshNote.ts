/**
 * Notes created on this device in this session (wish from TestFlight,
 * 2026-10-19): a note you have just made opens to be written in, whatever the
 * default view says. With "Read mode" (desktop) or "Reading view" (phone) as
 * the default, a new, empty note used to open for reading, and the first
 * thing to do in it was to switch.
 *
 * Every place that creates a note and opens it marks it here - through
 * `parkTemplateCaret`, which every template-built note passes, and directly
 * where a note is built without a template (a link to a note that does not
 * exist yet). Each shell asks when it decides how to open a note: the desktop
 * in `resolveViewModeForPath`, the phone in its note screen. A choice the
 * user makes in the note afterwards wins, and the phone forgets the mark then.
 *
 * Kept for the session, by path: reopening a note made a minute ago opens it
 * to write again; after a restart it is a note like any other.
 */
const fresh = new Set<string>();

export function markFreshNote(path: string | null | undefined): void {
  if (path) fresh.add(path);
}

export function isFreshNote(path: string | null | undefined): boolean {
  return !!path && fresh.has(path);
}

export function forgetFreshNote(path: string | null | undefined): void {
  if (path) fresh.delete(path);
}

/**
 * A note made a minute ago stays one when it is renamed or moved (Sammelplan
 * § 3.140 Nr. 1): the mark hung on the old path, so a new database entry
 * renamed in its window - the title is one of the two things that window opens
 * for - opened in the reading view where that is the default, and could not be
 * written in there. A folder takes the notes in it along.
 *
 * Asked by the one announcement every move of both shells makes
 * (`notifyFileOps`), so no rename, drag or move can leave it out.
 */
export function followFreshNoteMove(from: string, to: string, isFolder = false): void {
  if (isFolder) {
    const prefix = from.endsWith("/") ? from : `${from}/`;
    const target = to.endsWith("/") ? to : `${to}/`;
    for (const path of [...fresh]) {
      if (!path.startsWith(prefix)) continue;
      fresh.delete(path);
      fresh.add(target + path.slice(prefix.length));
    }
    return;
  }
  if (!fresh.delete(from)) return;
  fresh.add(to);
}

/** Test-only. */
export function resetFreshNotesForTests(): void {
  fresh.clear();
}
