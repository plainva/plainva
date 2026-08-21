/**
 * The window class the shell is currently in (S13, M3 Canonical Layouts).
 *
 * Plainva already owns a surface for every class — a navigator, a working
 * surface, a context surface. On the phone they stand one AFTER the other,
 * on the desktop side BY side. The only thing missing was the layer that
 * decides which of the two a given window is: without it, a tablet renders a
 * blown-up phone, which is exactly what the redesign set out to end.
 *
 * The breakpoints are Material's, in CSS pixels:
 *   compact  < 600   one surface at a time — the phone
 *   medium   600-839 navigation rail, one surface
 *   expanded >= 840  navigator and working surface side by side
 *
 * The class is published on the document root as `data-window` so stylesheets
 * can react without a component subscribing, and through a store so layout
 * decisions that are structural (which surfaces mount at all) stay in React.
 */

export type WindowClass = "compact" | "medium" | "expanded";

export const MEDIUM_MIN = 600;
export const EXPANDED_MIN = 840;
/**
 * From here a THIRD column fits (finding 2026-08-21).
 *
 * "expanded" is about two surfaces, not three. At 840 px the rail, a navigator
 * of at least 280 and a context column of at least 300 already claim 668 px,
 * and what is left is not a working surface — the maintainer's tablet showed
 * three squeezed columns and a page that scrolled sideways. The context column
 * is therefore gated on its own, wider number AND on the user having asked for
 * it; below this the same button opens the sheet, exactly as on a phone.
 */
export const DOCK_MIN = 1024;

/**
 * Pure, so the breakpoints are testable without a window.
 *
 * `height` is what keeps a ROTATED PHONE out of the tablet layout. A modern
 * phone in landscape is 800-930 CSS px wide and under 450 tall, so on width
 * alone it reaches "expanded" and gets the navigator permanently beside the
 * working surface — two columns in 400 px of height, which is the tablet
 * layout on a device that is not one (Gesamtplan § 3.7).
 *
 * Side-by-side needs BOTH edges: the shorter one caps the class at "medium",
 * where a landscape phone belongs — a rail instead of a bottom bar, still one
 * surface at a time. Omitting the height means "the height does not
 * constrain", which is what a caller that only knows a width is really saying.
 */
export function windowClassFor(width: number, height = Number.POSITIVE_INFINITY): WindowClass {
  if (width >= EXPANDED_MIN && Math.min(width, height) >= MEDIUM_MIN) return "expanded";
  if (width >= MEDIUM_MIN) return "medium";
  return "compact";
}

let current: WindowClass = "compact";
let canDock = false;
const listeners = new Set<() => void>();

export function getWindowClass(): WindowClass {
  return current;
}

/**
 * Whether this window is wide enough for a docked context column.
 *
 * A boolean rather than the raw width on purpose: `useSyncExternalStore` needs
 * a snapshot that is stable between renders, and a pixel count changes on every
 * resize frame while the answer this drives changes twice.
 */
export function getCanDock(): boolean {
  return canDock;
}

export function subscribeWindowClass(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function apply(width: number, height?: number): void {
  const next = windowClassFor(width, height);
  const nextDock = next === "expanded" && width >= DOCK_MIN;
  if (next === current && nextDock === canDock) return;
  current = next;
  canDock = nextDock;
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-window", next);
  }
  for (const fn of listeners) fn();
}

/** Called once at boot; the listener lives as long as the app does. */
export function initWindowClass(): void {
  if (typeof window === "undefined") return;
  // The initial value has to be published even when it is the default, or a
  // stylesheet keyed on the attribute finds nothing on the very first paint.
  current = "compact";
  canDock = false;
  document.documentElement.setAttribute("data-window", "compact");
  apply(window.innerWidth, window.innerHeight);
  window.addEventListener("resize", () => apply(window.innerWidth, window.innerHeight), { passive: true });
  // A rotation reports the old size to `resize` on some Android WebViews.
  window.addEventListener("orientationchange", () => {
    setTimeout(() => apply(window.innerWidth, window.innerHeight), 0);
  });
}

/** Test seam: drives the store without a real window. */
export function setWindowClassForTest(width: number, height?: number): void {
  apply(width, height);
}
