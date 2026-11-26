/**
 * The width this device's mail reader shows a mail in (plan Umsetzung 0.9.x, B7, review S2): what the assistant's
 * engine pass measures a mail at, besides the gate's two widths (`engineVisibility.ts`).
 */
/** Where this device keeps the width its mail reader last showed a mail in. */
const READER_WIDTH_KEY = "plainva.mailReaderWidth";
/** The narrowest and widest reader width taken as one (a frame not laid out yet says 0). */
const READER_WIDTH_MIN = 200;
const READER_WIDTH_MAX = 4000;
let readerWidth: number | null = null;

/**
 * The reader of this shell fitted a mail into `width` CSS pixels (B7, review S2): the desktop's `MailView` at every
 * fit and resize of its frame — the column is as wide as the person makes it —, the phone's `MailMessageScreen` at
 * every fit — portrait, landscape, split view, tablet. Kept on the device, so it holds for the mails the assistant
 * reads before a reader opens again.
 */
export function noteMailReaderWidth(width: number): void {
  if (!Number.isFinite(width) || width < READER_WIDTH_MIN || width > READER_WIDTH_MAX) return;
  readerWidth = Math.round(width);
  try {
    globalThis.localStorage?.setItem(READER_WIDTH_KEY, String(readerWidth));
  } catch {
    // silent: kept in memory for this run of the app; the next fit writes it again.
  }
}

/**
 * The width the reader of this device shows a mail in, or would: the last fit — kept across restarts —, else, where no
 * mail was ever shown on this device, the window's width (the reader takes at most the whole window).
 */
export function mailReaderWidth(): number | null {
  if (readerWidth !== null) return readerWidth;
  try {
    const kept = Number(globalThis.localStorage?.getItem(READER_WIDTH_KEY));
    if (Number.isFinite(kept) && kept >= READER_WIDTH_MIN && kept <= READER_WIDTH_MAX) return (readerWidth = kept);
  } catch {
    // silent: no storage — the window's width stands in.
  }
  const window = typeof globalThis.innerWidth === "number" ? globalThis.innerWidth : 0;
  return window >= READER_WIDTH_MIN && window <= READER_WIDTH_MAX ? Math.round(window) : null;
}


/** Forgets the reader's width on this device (the app's data was forgotten; and for tests). */
export function forgetMailReaderWidth(): void {
  readerWidth = null;
  try {
    globalThis.localStorage?.removeItem(READER_WIDTH_KEY);
  } catch {
    // silent: nothing kept, nothing to forget.
  }
}
