/**
 * What the command palette can ask the open note to do, and how the request
 * reaches it.
 *
 * The palette IS the search screen, and the shell renders one surface at a
 * time: while the palette is up, the note it was opened over is not mounted.
 * A bare window event therefore fired into nothing — the three note commands
 * the phone had (rename, reading/editing, export) were built, never listed
 * (the search screen was "the top", so no note counted as open) and would not
 * have arrived if they had been. So a request is PARKED under the note's path
 * and announced; the note screen takes it when it can serve it, whether it was
 * mounted all along or comes back a render later. Same shape as the "New …"
 * requests (`pendingNew` in the shared package), for the same reason.
 */
export type NoteCommand =
  | "rename"
  | "toggle-edit"
  | "export"
  | "toggle-source"
  | "insert-template"
  | "save-as-template"
  | "mailto"
  | "compose-mail"
  | "history";

export const NOTE_COMMAND_EVENT = "m-note-command";

/**
 * How long a parked request stays valid. It is taken within a render or two;
 * the limit only keeps a request whose note never came back (deleted in the
 * meantime, vault switched) from firing at some later visit.
 */
const MAX_AGE_MS = 10_000;

let pending: { path: string; command: NoteCommand; at: number } | null = null;

/** Parks the request for `path` and tells a mounted note screen at once. */
export function requestNoteCommand(path: string | null, command: NoteCommand): void {
  if (path === null) return;
  pending = { path, command, at: Date.now() };
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(NOTE_COMMAND_EVENT));
}

/** The request waiting for this note, once; `null` when none (or a stale one) waits. */
export function takeNoteCommand(path: string): NoteCommand | null {
  if (!pending || pending.path !== path) return null;
  const { command, at } = pending;
  pending = null;
  return Date.now() - at <= MAX_AGE_MS ? command : null;
}

/**
 * Subscribes the note screen: runs `handle` now if a request waits, and again
 * whenever one arrives. `ready` is false until the note's text is loaded and
 * its editor exists — source mode and the template picker are the editor's,
 * and a request taken before that would be lost exactly like the event was.
 */
export function consumeNoteCommands(path: string, handle: (command: NoteCommand) => void, ready: boolean): () => void {
  if (!ready) return () => {};
  const run = () => {
    const command = takeNoteCommand(path);
    if (command) handle(command);
  };
  run();
  window.addEventListener(NOTE_COMMAND_EVENT, run);
  return () => window.removeEventListener(NOTE_COMMAND_EVENT, run);
}
