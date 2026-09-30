import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { ICON } from "@plainva/ui";

/**
 * The ONE mark of a choice on the phone (findings 2026-09-22 and 2026-09-24,
 * E20/E21).
 *
 * Round is one, square is several — the distinction Plainva already makes
 * between an option and a checkbox, and the one the eye reads before the first
 * tap. The multiple choice used to wear the round slot too, so "only these
 * calendars" looked like a list that would take one answer; a relation that
 * takes one note wore a tick instead, a fifth spelling. Every mark of a choice
 * is this component now, and `choiceSurfaces.test.tsx` keeps the class name out
 * of every other file.
 *
 * A mark belongs to a CHOICE only. A list of places (areas, views, vaults) or
 * of actions (insert, open) carries no mark at all — see `Row`'s `current`,
 * `mTargets` and `mActions`.
 */
export function ChoiceMark({ on, multiple }: { on: boolean; multiple?: boolean }) {
  return (
    <span aria-hidden className={`m-slotmark${multiple ? " m-slotmark--box" : ""}${on ? " is-on" : ""}`}>
      {multiple && on && <Check size={ICON.meta} />}
    </span>
  );
}

/** How long a single choice shows its new mark before the sheet closes (E21). */
export const CHOICE_BEAT_MS = 300;

/**
 * A single choice closes its sheet — but only after the mark has visibly
 * moved (E21, the 22.09. mockup's case a).
 *
 * Closing on the tap itself meant nobody ever saw what they had picked: the
 * sheet was gone before the dot jumped, which is exactly the "was that right?"
 * the mockup set out to remove. The first tap decides; the value is handed on
 * after the beat. A sheet that is closed in the meantime (backdrop, back
 * gesture) delivers nothing — that close was the answer.
 */
export function useChoiceBeat<T>(deliver: (value: T) => void): { picked: { value: T } | null; pick: (value: T) => void } {
  const [picked, setPicked] = useState<{ value: T } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef(deliver);
  useEffect(() => {
    latest.current = deliver;
  });
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const pick = (value: T) => {
    if (timer.current !== undefined) return;
    setPicked({ value });
    timer.current = window.setTimeout(() => latest.current(value), CHOICE_BEAT_MS);
  };
  return { picked, pick };
}
