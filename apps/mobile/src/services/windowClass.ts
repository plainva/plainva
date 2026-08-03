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

/** Pure, so the breakpoints are testable without a window. */
export function windowClassFor(width: number): WindowClass {
  if (width >= EXPANDED_MIN) return "expanded";
  if (width >= MEDIUM_MIN) return "medium";
  return "compact";
}

let current: WindowClass = "compact";
const listeners = new Set<() => void>();

export function getWindowClass(): WindowClass {
  return current;
}

export function subscribeWindowClass(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function apply(width: number): void {
  const next = windowClassFor(width);
  if (next === current) return;
  current = next;
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
  document.documentElement.setAttribute("data-window", "compact");
  apply(window.innerWidth);
  window.addEventListener("resize", () => apply(window.innerWidth), { passive: true });
  // A rotation reports the old size to `resize` on some Android WebViews.
  window.addEventListener("orientationchange", () => {
    setTimeout(() => apply(window.innerWidth), 0);
  });
}

/** Test seam: drives the store without a real window. */
export function setWindowClassForTest(width: number): void {
  apply(width);
}
