/**
 * How far the surface below the chrome has scrolled, and in which direction
 * (S11). Two pieces of chrome react to it and they sit in different subtrees:
 * the app bar raises itself, the navigation bar draws itself in.
 *
 * The app bar is the one that finds the scrolling element (it is inside it), so
 * it publishes here and the bar subscribes. One listener, two readers — better
 * than a second listener that would have to guess the same element.
 */

export interface ChromeScroll {
  /** Content has moved under the chrome — the bar raises itself. */
  scrolled: boolean;
  /** Reading downwards: the navigation bar retreats until the user comes back. */
  away: boolean;
  source?: string;
  /**
   * When the surface last moved UP (ms). The note's chrome uses it while the
   * keyboard is open (F8): the bar went with the keyboard, and pulling the
   * text down brings it back.
   */
  upAt?: number;
}

let state: ChromeScroll = { scrolled: false, away: false };
const listeners = new Set<() => void>();

export function getChromeScroll(): ChromeScroll {
  return state;
}

export function subscribeChromeScroll(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setChromeScroll(next: ChromeScroll): void {
  if (next.scrolled === state.scrolled && next.away === state.away && next.source === state.source && next.upAt === state.upAt) return;
  state = next;
  for (const fn of listeners) fn();
}

/** A new surface starts at the top — otherwise it inherits the last one's state. */
export function resetChromeScroll(): void {
  setChromeScroll({ scrolled: false, away: false });
}


/** The hide threshold stays above the former 21 px layout correction. */
export const CHROME_SCROLL_DEAD_ZONE = 24;
export const readerScrollSource = (vaultId: string, path: string) => `${vaultId}:${path}`;
/** An upward move counts once per this long, so a slow pull does not re-render every frame. */
const UP_STAMP_MS = 250;
/**
 * Publishes one scrolling surface. `atEnd` (the last pixel is in view) brings
 * the chrome back like moving up does: at the end of a list there is nothing
 * left to make room for, and the bar is where the next step is (W3).
 */
export function chromeScrollPublisher(source?: string, now: () => number = Date.now) {
  let lastTop = 0, anchor = 0, away = false, upAt: number | undefined;
  return (rawTop: number, restore = false, atEnd = false) => {
    const top = Math.max(0, rawTop), delta = top - lastTop;
    if (delta < -0.5 && !restore) {
      const t = now();
      if (upAt === undefined || t - upAt >= UP_STAMP_MS) upAt = t;
    }
    if (restore || top <= 2 || delta < -0.5 || atEnd) { away = false; anchor = top; }
    else if (top - anchor > CHROME_SCROLL_DEAD_ZONE) { away = top > 48; anchor = top; }
    lastTop = top;
    setChromeScroll({ scrolled: top > 2, away, source, upAt });
  };
}

/** The clock the chrome state is dated with; one name, so a test can read it. */
export const chromeNow = (): number => Date.now();

/**
 * Whether a note's bar steps aside while writing (F8, S3): only in writing
 * mode with the keyboard up and the setting on. It goes when the keyboard
 * comes, comes back when the text is pulled down (an upward move after the
 * keyboard opened) and goes again once the text scrolls on downwards.
 */
export function noteChromeTucked(input: {
  editing: boolean;
  enabled: boolean;
  keyboard: boolean;
  keyboardAt: number;
  active: boolean;
  blocked: boolean;
  scroll: ChromeScroll;
}): boolean {
  const { editing, enabled, keyboard, keyboardAt, active, blocked, scroll } = input;
  if (!editing || !enabled || !keyboard || blocked) return false;
  const pulledDown = active && (scroll.upAt ?? 0) > keyboardAt;
  return !pulledDown || (active && scroll.away);
}

/** Whether a scrolled element shows its last pixel (a little slack for rounding). */
export function scrolledToEnd(el: { scrollTop: number; scrollHeight: number; clientHeight: number }): boolean {
  return el.scrollHeight > el.clientHeight + 2 && el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
}
