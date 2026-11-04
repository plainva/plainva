import { useEffect, useState } from "react";
import { getMobileSettings } from "../services/mobileSettings";

/**
 * Whether the chrome steps aside while scrolling down - the device setting
 * "Hide bars while scrolling" (stored as `readerAutoHide`, its first name,
 * when it covered only the note's bar). Since the wishes of 2026-10-25 (W3)
 * it covers the app bar of a note, the bottom bar and the "+" button alike.
 */
export function useAutoHideChrome(): boolean {
  const [enabled, setEnabled] = useState(() => getMobileSettings().readerAutoHide);
  useEffect(() => {
    const read = () => setEnabled(getMobileSettings().readerAutoHide);
    window.addEventListener("m-settings-changed", read);
    return () => window.removeEventListener("m-settings-changed", read);
  }, []);
  return enabled;
}
