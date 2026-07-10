import { useEffect, useRef } from "react";

/**
 * Traps Tab focus inside a container while active.
 *
 * `initialFocus` decides where focus lands on mount:
 *  - "first" (default): the first focusable element — right for palettes whose
 *    first control IS the search input (QuickSwitcher, CommandPalette, …).
 *  - "container": the container itself (needs tabIndex={-1}) — right for
 *    dialogs, where auto-focusing the first control (usually the X close
 *    button) painted it in its hover/focus look on open (maintainer report
 *    2026-07-06). Tab from the container enters the first control.
 */
export function useFocusTrap(isActive: boolean, initialFocus: "first" | "container" = "first") {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isActive) return;

    const container = containerRef.current;
    if (!container) return;

    const focusableSelectors = [
      'a[href]',
      'button:not([disabled])',
      'textarea:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(",");

    const focusableElements = container.querySelectorAll<HTMLElement>(focusableSelectors);
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (initialFocus === "container") {
      container.focus();
    } else if (firstElement) {
      firstElement.focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;

      // Focus parked on the container (dialog just opened): enter the ring
      // at its start/end instead of letting focus escape behind the overlay.
      if (document.activeElement === container) {
        e.preventDefault();
        (e.shiftKey ? lastElement : firstElement)?.focus();
        return;
      }

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement?.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };

    container.addEventListener("keydown", handleKeyDown);
    return () => container.removeEventListener("keydown", handleKeyDown);
  }, [isActive, initialFocus]);

  return containerRef;
}
