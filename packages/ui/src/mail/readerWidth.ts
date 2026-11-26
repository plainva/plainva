/**
 * The widths this device's mail readers show a mail in (plan Umsetzung 0.9.x, B7, review S2; review B7-2, H13): what
 * the assistant's engine pass measures a mail at, besides the gate's two widths (`engineVisibility.ts`).
 */
/** Where this device keeps the widths its mail readers showed a mail in, shared by every window of the app. */
const READER_WIDTH_KEY = "plainva.mailReaderWidths";
/** The narrowest and widest reader width taken as one (a frame not laid out yet says 0). */
export const READER_WIDTH_MIN = 200;
export const READER_WIDTH_MAX = 4000;
/** How many reader widths a pass measures at most, besides the gate's two: the readers on screen first, then the latest. */
export const READER_WIDTHS_MEASURED = 3;
/** How long a width kept on the device counts once its reader is gone. */
const READER_WIDTH_KEPT_MS = 30 * 24 * 60 * 60 * 1000;

/** The reader frames on screen in this window, with the width each was last fitted to. */
const live = new Map<object, number>();

type Kept = { width: number; at: number };

function kept(): Kept[] {
  try {
    const raw: unknown = JSON.parse(globalThis.localStorage?.getItem(READER_WIDTH_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter((entry): entry is Kept => typeof entry?.width === "number" && typeof entry?.at === "number" && entry.width >= READER_WIDTH_MIN && entry.width <= READER_WIDTH_MAX);
  } catch {
    return [];
  }
}

/**
 * A reader of this shell fitted a mail into `width` CSS pixels (B7, review S2): the desktop's `MailView` at every
 * fit and resize of its frame — the column is as wide as the person makes it —, the phone's `MailMessageScreen` at
 * every fit — portrait, landscape, split view, tablet. `frame`: the reader it was (review B7-2, H13) — while it is on
 * screen its width counts, beside every other reader of this window. Kept on the device for every window and across
 * restarts, so it holds for the mails the assistant reads before a reader opens again.
 */
export function noteMailReaderWidth(width: number, frame?: object): void {
  if (!Number.isFinite(width) || width < READER_WIDTH_MIN || width > READER_WIDTH_MAX) return;
  const rounded = Math.round(width);
  if (frame) live.set(frame, rounded);
  const now = Date.now();
  const list = [{ width: rounded, at: now }, ...kept().filter((entry) => entry.width !== rounded && now - entry.at < READER_WIDTH_KEPT_MS)].slice(0, READER_WIDTHS_MEASURED * 2);
  try {
    globalThis.localStorage?.setItem(READER_WIDTH_KEY, JSON.stringify(list));
  } catch {
    // silent: the readers on screen still count; the next fit writes it again.
  }
}

/** A reader frame left the screen: its width counts only as one kept on the device from now on. */
export function forgetMailReaderFrame(frame: object): void {
  live.delete(frame);
}

/**
 * The widths the readers of this device show a mail in, or would, at most `READER_WIDTHS_MEASURED`: the readers on
 * screen in this window (one still in the document), then the latest kept on the device by any window within 30
 * days — else, where no mail was ever shown here, the window's width (a reader takes at most the whole window).
 */
export function mailReaderWidths(): number[] {
  const out: number[] = [];
  for (const [frame, width] of live) {
    if ((frame as { isConnected?: boolean }).isConnected === false) {
      live.delete(frame);
      continue;
    }
    if (!out.includes(width)) out.push(width);
  }
  const now = Date.now();
  for (const entry of kept().sort((a, b) => b.at - a.at)) if (now - entry.at < READER_WIDTH_KEPT_MS && !out.includes(entry.width)) out.push(entry.width);
  if (out.length) return out.slice(0, READER_WIDTHS_MEASURED);
  const window = typeof globalThis.innerWidth === "number" ? globalThis.innerWidth : 0;
  return window >= READER_WIDTH_MIN && window <= READER_WIDTH_MAX ? [Math.round(window)] : [];
}

/** The width the reader of this device showed a mail in last, or would (the first of `mailReaderWidths`). */
export function mailReaderWidth(): number | null {
  return mailReaderWidths()[0] ?? null;
}

/** Forgets the readers' widths on this device (the app's data was forgotten; and for tests). */
export function forgetMailReaderWidth(): void {
  live.clear();
  try {
    globalThis.localStorage?.removeItem(READER_WIDTH_KEY);
  } catch {
    // silent: nothing kept, nothing to forget.
  }
}
