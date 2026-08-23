import { useEffect, useState, useSyncExternalStore } from "react";
import { getMobileSettings, updateMobileSettings } from "../services/mobileSettings";
import { getWindowClass, subscribeWindowClass } from "../services/windowClass";

/**
 * Whether the shell stands two columns, and whether the reader wants it to.
 *
 * Both answers live here rather than in the shell because they are one
 * question asked twice: the layout needs it to decide what to render, and the
 * rail needs it to decide whether to offer the fold switch at all. Answered
 * separately they drift, and the drift is visible — a rail offering to fold a
 * column that is not there, or a column with no way out.
 *
 * `splitPossible` is the room; `twoColumn` is the room AND the wish. Folding
 * the navigator away leaves exactly the medium layout (rail plus one surface),
 * which is why nothing downstream needs to know the switch exists.
 */
export function useAdaptiveSplit(onboarded: boolean): {
  splitPossible: boolean;
  twoColumn: boolean;
  navCollapsed: boolean;
  toggleNav: () => void;
} {
  const windowClass = useSyncExternalStore(subscribeWindowClass, getWindowClass);
  // Device-local: a layout preference belongs to the screen it is about, so it
  // deliberately does not travel through the settings sync.
  const [navCollapsed, setNavCollapsed] = useState(getMobileSettings().navSidebarCollapsed);
  useEffect(() => {
    const onChanged = () => setNavCollapsed(getMobileSettings().navSidebarCollapsed);
    window.addEventListener("m-settings-changed", onChanged);
    return () => window.removeEventListener("m-settings-changed", onChanged);
  }, []);

  // Room for both, and something to navigate: while the welcome screen is up
  // there is no vault yet, so a navigator column would stand there empty.
  const splitPossible = windowClass === "expanded" && onboarded;
  return {
    splitPossible,
    twoColumn: splitPossible && !navCollapsed,
    navCollapsed,
    toggleNav: () => void updateMobileSettings({ navSidebarCollapsed: !navCollapsed }),
  };
}
