import { useRef } from "react";
import { haptics } from "../services/haptics";

/**
 * Long-press hook (M4/E7, generalized in R2): 500 ms hold fires the action;
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
    }, 500);
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
