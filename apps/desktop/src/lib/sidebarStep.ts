import { useEffect, useState, type RefObject } from "react";

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

export function useSidebarStep(ref: RefObject<HTMLElement | null>): SidebarStep {
  const [step, setStep] = useState<SidebarStep>("comfortable");
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const apply = (width: number) => setStep((prev) => {
      const next = sidebarStepFor(width);
      return next === prev ? prev : next;
    });
    apply(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) apply(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return step;
}
