import { useRef } from "react";
import { haptics } from "../services/haptics";

/**
 * How long a hold takes anywhere in the app (S12). It was 350 ms on a board
 * card, 450 ms on the navigation bar and 500 ms on a list row — three numbers
 * for one gesture, so the same movement felt like a different thing depending
 * on what was under the finger. The drag arms below cannot use the hook (they
 * work on raw pointer events over a canvas of cards), but they use this.
 */
export const LONG_PRESS_MS = 500;

/**
 * Long-press hook (M4/E7, generalized in R2): the hold fires the action;
 * `clicked()` tells the tap handler whether the press already consumed the
 * gesture. Callers pass whatever context they need to `start`.
 */
export function useLongPress<T>(onLongPress: (arg: T) => void) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);
  const start = (arg: T) => {
    firedRef.current = false;
    timerRef.current = setTimeout(() => {
      firedRef.current = true;
      // A long-press can start a native text selection in the WebView (some
      // Android versions ignore user-select for the selection handles); clear
      // it so the opened sheet doesn't show marked text.
      window.getSelection?.()?.removeAllRanges();
      haptics.medium();
      onLongPress(arg);
    }, LONG_PRESS_MS);
  };
  const clear = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };
  const clicked = () => {
    const fired = firedRef.current;
    firedRef.current = false;
    return !fired;
  };
  return { start, clear, clicked };
}
