/**
 * Mail column widths (findings round P8.1).
 *
 * The three columns were fixed at 210 / 320 / rest. A long folder name was cut
 * off with no way to widen it, and on a wide screen the reader got everything
 * while the list stayed narrow. Two drag handles fix that — the arithmetic lives
 * here so the minimums are one decision instead of one per drag event.
 *
 * The pure part is the clamp: whatever the pointer says, all three columns keep a
 * usable width. Without a reader minimum a drag could push the message itself off
 * screen — the panel the other two exist for.
 */

export interface MailColumns {
  /** Accounts + mailboxes. */
  folders: number;
  /** Envelope list. */
  list: number;
}

/** Below these a column stops being usable rather than just being narrow. */
export const MAIL_MIN_FOLDERS = 150;
export const MAIL_MIN_LIST = 240;
export const MAIL_MIN_READER = 320;
export const MAIL_DEFAULT_COLUMNS: MailColumns = { folders: 210, list: 360 };

/**
 * Width at which the filter row above the list can still spell out its buttons.
 *
 * Three labelled toggles ("Ungelesen", "Markiert", "Konversationen") measure
 * ~350px in German with their icons, gaps and the row's padding — more than the
 * old 320px default, so the third one hung over the reader before anyone even
 * touched a handle (maintainer finding 2026-07-30). Below this the row keeps the
 * icons and drops the words; the accessible name and the tooltip stay, so
 * nothing becomes unnameable, only shorter.
 */
export const MAIL_LABEL_MIN_LIST = 360;

/** Whether the list is wide enough for the filter row to spell itself out. */
export function showListLabels(list: number): boolean {
  return list >= MAIL_LABEL_MIN_LIST;
}

/** Width of one drag handle, in the grid and in the arithmetic below. */
export const MAIL_HANDLE_WIDTH = 5;

/**
 * Clamps a width pair so every column keeps its minimum inside `available`
 * (the container width MINUS the two handles). Pure.
 *
 * `available <= 0` happens on the first render before layout: nothing is known
 * yet, so the pair passes through untouched rather than being clamped against a
 * width of zero.
 */
export function clampMailColumns(cols: MailColumns, available: number): MailColumns {
  const folders = Math.max(MAIL_MIN_FOLDERS, Math.round(cols.folders));
  const list = Math.max(MAIL_MIN_LIST, Math.round(cols.list));
  if (available <= 0) return { folders, list };
  // The reader gets what is left; when that is not enough, the list gives back
  // first (it can still show a sender and a subject), then the folder rail.
  const overflow = folders + list + MAIL_MIN_READER - available;
  if (overflow <= 0) return { folders, list };
  const shrunkList = Math.max(MAIL_MIN_LIST, list - overflow);
  const stillOver = folders + shrunkList + MAIL_MIN_READER - available;
  if (stillOver <= 0) return { folders, list: shrunkList };
  return { folders: Math.max(MAIL_MIN_FOLDERS, folders - stillOver), list: shrunkList };
}

/** The grid template for a clamped pair. */
export function mailGridTemplate(cols: MailColumns): string {
  return `${cols.folders}px ${MAIL_HANDLE_WIDTH}px ${cols.list}px ${MAIL_HANDLE_WIDTH}px minmax(0, 1fr)`;
}

/** localStorage key — per vault, because a vault is what a window shows. */
export function mailColumnsKey(vaultPath: string): string {
  return `plainva-mail-cols-${vaultPath}`;
}

/** Whether the list groups messages into conversations (findings P9.3). Also
 *  per vault, and OFF by default: today's behaviour stays the default. */
export function mailThreadsKey(vaultPath: string): string {
  return `plainva-mail-threads-${vaultPath}`;
}

/**
 * Reads a stored pair. Anything unparseable (hand-edited, older format, another
 * app's key) falls back to the defaults rather than throwing on a mail screen.
 */
export function parseMailColumns(raw: string | null): MailColumns {
  if (!raw) return { ...MAIL_DEFAULT_COLUMNS };
  try {
    const parsed = JSON.parse(raw) as Partial<MailColumns> | null;
    const folders = Number(parsed?.folders);
    const list = Number(parsed?.list);
    if (!Number.isFinite(folders) || !Number.isFinite(list)) return { ...MAIL_DEFAULT_COLUMNS };
    return clampMailColumns({ folders, list }, 0);
  } catch {
    return { ...MAIL_DEFAULT_COLUMNS };
  }
}
