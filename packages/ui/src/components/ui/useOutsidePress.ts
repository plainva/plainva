import { useEffect, type RefObject } from "react";
import { useStableHandler } from "../../lib/useStableHandler";

/**
 * Hears a press anywhere outside the given elements — how a menu or an
 * anchored popover knows it has been left.
 *
 * The press is heard at the window, as `pointerdown`, in the capture phase:
 *  - `pointerdown`, not `mousedown`. A handler that cancels `pointerdown` keeps
 *    the browser from sending `mousedown` at all, and whatever is dragged does
 *    exactly that — the head of a floating window, its resize grip. A press
 *    there was never heard, so a menu stayed open while the window beside it
 *    was moved.
 *  - at the window, capturing: nothing on the way can stop the event before it
 *    gets here.
 *
 * And it is HEARD, not caught: an element laid over the page to take the press
 * lies on a layer, and whatever lies on a higher one takes the press first. A
 * database's menus caught it that way below the floating windows, and a press
 * into the note preview never reached them.
 *
 * A FINGER is heard later, as it always was: once its tap has been made out,
 * by the `mousedown` the browser sends for it. That event names the element
 * the browser gives the tap to — which can be the row a finger landed a few
 * pixels beside — and a finger that goes on to scroll sends none. Its
 * `pointerdown` is the raw point, and comes before either is known.
 *
 * The listeners stay for as long as the surface is open, whatever its owner
 * renders in between: `onOutside` is usually a closure of that render, and a
 * listener put up anew with each one would forget, between a finger's press
 * and its tap, that a finger had come down. What is called is always the
 * closure of the render that is current.
 *
 * `inside` and `alsoInside` are what does not count as outside: the surface
 * itself and what opened it — a press on the trigger is the trigger's to
 * answer, or one press would close the surface and open it again.
 */
export function useOutsidePress(
  active: boolean,
  onOutside: () => void,
  inside: RefObject<Element | null> | undefined,
  alsoInside?: RefObject<Element | null>
): void {
  const heard = useStableHandler(onOutside);
  useEffect(() => {
    if (!active) return;
    const outside = (at: EventTarget | null) =>
      !(at instanceof Node && (inside?.current?.contains(at) || alsoInside?.current?.contains(at)));
    let finger = false;
    const onPointerDown = (e: PointerEvent) => {
      finger = e.pointerType === "touch";
      if (!finger && outside(e.target)) heard();
    };
    const onMouseDown = (e: MouseEvent) => {
      if (finger && outside(e.target)) heard();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("mousedown", onMouseDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("mousedown", onMouseDown, true);
    };
  }, [active, heard, inside, alsoInside]);
}
