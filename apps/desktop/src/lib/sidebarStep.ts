import { useCallback, useEffect, useState } from "react";

/**
 * How much room the right sidebar actually has (plan P3). Three named steps
 * instead of a scale, so every surface degrades at the SAME two widths and the
 * result stays describable: comfortable, compact, minimal.
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

  useEffect(() => {
    if (!node || typeof ResizeObserver === "undefined") return;
    const apply = (width: number) => setStep((prev) => {
      const next = sidebarStepFor(width);
      return next === prev ? prev : next;
    });
    apply(node.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) apply(entry.contentRect.width);
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, [node]);

  // Stable identity, so putting it on an element does not re-attach per render.
  const ref = useCallback((el: HTMLElement | null) => setNode(el), []);
  return { step, ref };
}
