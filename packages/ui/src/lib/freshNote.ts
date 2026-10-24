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

/** Test-only. */
export function resetFreshNotesForTests(): void {
  fresh.clear();
}
