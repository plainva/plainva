import { useRef, type RefObject } from "react";
import { useOutsidePress } from "./useOutsidePress";

/**
 * The invisible element a dialog-like popover lays over the page: a press
 * beside the popover closes it and goes nowhere else (colour, emoji, date
 * jump, a selection's "set a value" form). Render it BEFORE its popover — the
 * two share the menus' layer.
 *
 * A catcher takes only what reaches it. What lies in FRONT of it takes the
 * press first — and that is not only what stands on a higher layer: a popover
 * opened inside something that forms a stacking context of its own has its
 * catcher's layer counted inside that context alone. A database embedded in a
 * note is the case (the editor's scroller is such a context): a floating
 * window then lies in front of the catcher, whatever layer the catcher names.
 * So the catcher also HEARS the press it does not get, at the window. That
 * press closes the popover as well, and lands where it was made.
 *
 * This is the one place `.pv-click-catch` is drawn: no catcher goes without
 * the listener, and none sets a layer of its own (the class carries it).
 */
export function ClickCatch({
  onPress,
  popover,
  on = "click",
}: {
  /** The popover is left. */
  onPress: () => void;
  /** The popover this catcher belongs to: a press in it is not a press beside it. */
  popover: RefObject<Element | null>;
  /** What of a caught press closes: its click, or its mousedown already. */
  on?: "click" | "mousedown";
}) {
  const ref = useRef<HTMLDivElement>(null);
  useOutsidePress(true, onPress, popover, ref);
  return (
    <div
      ref={ref}
      className="pv-click-catch"
      onClick={on === "click" ? onPress : undefined}
      onMouseDown={on === "mousedown" ? onPress : undefined}
    />
  );
}
