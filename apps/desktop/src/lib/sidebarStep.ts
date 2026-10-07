import { useCallback, useLayoutEffect, useState } from "react";

/**
 * How much room the right sidebar actually has (plan P3). Three named steps
 * instead of a scale, so every surface degrades at the SAME two widths and the
 * result stays describable: comfortable, compact, minimal.
 *
 * The step is the COLUMN's: it is read from the panel's border box, never from
 * its content. What is inside — a scrollbar, a long section — cannot change it.
 *
 * Measured with a ResizeObserver rather than a container query because one of
 * the steps is structural — the calendar switches from a month grid to a single
 * week row, which no stylesheet can do. The cosmetic parts hang off the
 * `data-side-step` attribute the hook feeds, so both halves react at one place.
 *
 * A container on the sidebar ROOT was deliberately avoided: it would clip the
 * fixed context menus that the calendar and the property rows open (the lesson
 * already noted at the `cal-grid` container).
 */
export type SidebarStep = "comfortable" | "compact" | "minimal";

/** Both thresholds in one place — the table in the plan reads off these. */
export const SIDEBAR_STEP_COMPACT = 280;
export const SIDEBAR_STEP_MINIMAL = 232;

// There is no step CONTEXT any more (2026-10-06). Its one reader was the date
// value, which shortened its format below "comfortable" because its button
// could not wrap. The date wraps now, and everything else that depends on the
// step reads the `data-side-step` attribute from a stylesheet — one mechanism.

/** The peek window's properties column: draggable since 2026-09-04. It used to
 * be a fixed 260 px — below the compact threshold, without the compact layout,
 * because the column was never measured. */
export const PEEK_SIDE_DEFAULT = 300;
export const PEEK_SIDE_MIN = SIDEBAR_STEP_MINIMAL;
const PEEK_SIDE_KEY = "plainva-peek-side-width";

/** Never below the minimal step, never more than half of the window body. */
export function clampPeekSideWidth(next: number, bodyWidth: number): number {
  const max = Math.max(PEEK_SIDE_MIN, Math.floor(bodyWidth / 2));
  return Math.round(Math.min(max, Math.max(PEEK_SIDE_MIN, next)));
}

export function readPeekSideWidth(storage: Pick<Storage, "getItem"> | null = typeof localStorage === "undefined" ? null : localStorage): number {
  try {
    const raw = storage?.getItem(PEEK_SIDE_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n >= PEEK_SIDE_MIN ? Math.round(n) : PEEK_SIDE_DEFAULT;
  } catch {
    return PEEK_SIDE_DEFAULT;
  }
}

export function writePeekSideWidth(width: number, storage: Pick<Storage, "setItem"> | null = typeof localStorage === "undefined" ? null : localStorage): void {
  try {
    storage?.setItem(PEEK_SIDE_KEY, String(Math.round(width)));
  } catch {
    /* not remembered: the default applies next time */
  }
}

export function sidebarStepFor(width: number): SidebarStep {
  if (width < SIDEBAR_STEP_MINIMAL) return "minimal";
  if (width < SIDEBAR_STEP_COMPACT) return "compact";
  return "comfortable";
}

/**
 * Measures whichever element the returned `ref` is put on.
 *
 * A CALLBACK ref, not a RefObject: the left panel mounts later than the hook
 * (the splash screen comes first, the sidebar only exists once a vault is
 * open). A RefObject-based effect runs once, finds `current === null` and gives
 * up for good — the panel then reports "comfortable" at every width. The
 * callback re-runs the moment the element appears or is swapped.
 */
export function useSidebarStep(): { step: SidebarStep; ref: (el: HTMLElement | null) => void } {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [step, setStep] = useState<SidebarStep>("comfortable");

  useLayoutEffect(() => {
    if (!node || typeof ResizeObserver === "undefined") return;
    const apply = (width: number) => setStep((prev) => {
      const next = sidebarStepFor(width);
      return next === prev ? prev : next;
    });
    apply(columnWidth(node));
    // The element is re-read rather than the entry's `contentRect`: that is the
    // CONTENT box, which a classic scrollbar narrows by its own width. A section
    // that opened and made the panel scroll took 11 px off the measurement and
    // tipped the whole column into the next step (finding 2026-10-06). The step
    // belongs to the column, so the column's border box is what is read.
    const ro = new ResizeObserver(() => apply(columnWidth(node)));
    ro.observe(node);
    return () => ro.disconnect();
  }, [node]);

  // Stable identity, so putting it on an element does not re-attach per render.
  // The step is set HERE, while the element is being attached: a ref callback
  // runs in the commit, so the update lands before the browser paints and the
  // first frame already has the right layout. Measuring in an effect painted
  // "comfortable" once and then jumped (finding 2026-10-06).
  const ref = useCallback((el: HTMLElement | null) => {
    setNode(el);
    if (el) {
      const width = columnWidth(el);
      if (width > 0) setStep(sidebarStepFor(width));
    }
  }, []);
  return { step, ref };
}

/** The panel's own width: its border box, scrollbar and padding included. */
export function columnWidth(el: Pick<HTMLElement, "getBoundingClientRect">): number {
  return el.getBoundingClientRect().width;
}

/**
 * The right panel's width for a window (decision E2, 2026-10-06).
 *
 * The default is 300 px — the comfortable step, name beside value. It used to
 * be 250, which is below the compact threshold, so nobody who left the panel
 * alone ever saw the layout it was designed in.
 *
 * "A width the user chose is kept" needs a way to tell a choice from the old
 * default, and there was none: the panel wrote its width back on every start,
 * so every window carries a stored 250 whether or not anyone dragged it. From
 * now on only a drag stores a width, together with a marker. A stored value
 * WITHOUT the marker is a choice unless it is exactly the old default.
 */
export const RIGHT_SIDEBAR_DEFAULT = 300;
export const RIGHT_SIDEBAR_LEGACY_DEFAULT = 250;
export const RIGHT_SIDEBAR_WIDTH_KEY = "plainva-right-sidebar-width";
export const RIGHT_SIDEBAR_CHOSEN_KEY = "plainva-right-sidebar-width-chosen";

export function rightSidebarWidthFrom(stored: string | null, chosen: boolean, min: number, max: number): number {
  const fallback = Math.max(min, Math.min(max, RIGHT_SIDEBAR_DEFAULT));
  if (stored === null || stored.trim() === "") return fallback;
  const value = Number(stored);
  if (!Number.isFinite(value) || value > max || value < min) return fallback;
  if (!chosen && value === RIGHT_SIDEBAR_LEGACY_DEFAULT) return fallback;
  return value;
}
