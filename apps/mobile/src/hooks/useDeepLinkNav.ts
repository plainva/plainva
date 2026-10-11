import { useEffect } from "react";

import { pushEntry, type NavState } from "../navigation";
import { leaveThen } from "../services/leaveQuestion";

/**
 * Deep links from a notice into the screen that can act on it.
 *
 * `m-open-security` comes from the encrypted-workspace sync error and jumps to
 * the pairing/recovery screen, so the "connect → join here" path is obvious.
 * `m-open-settings` comes from the "a new folder was created in the cloud"
 * notice (finding 2026-08-19) and jumps to the vault detail, where the folder
 * can be set — a notice is worth little if the way to act on it has to be
 * searched for.
 *
 * A notice can be tapped over ANY screen, also over one that holds unsaved
 * input — a message being written, credentials typed into a form. The screen it
 * opens takes that one off the screen, so it asks first (finding 2026-10-09).
 *
 * In its own module rather than in App.tsx because App.tsx is under a shrinking
 * line budget: feature blocks belong in their own files.
 */
export function useDeepLinkNav(setNav: (fn: (state: NavState) => NavState) => void): void {
  useEffect(() => {
    const openSecurity = () => leaveThen(() => setNav((s) => pushEntry(s, { kind: "settingsArea", path: "security" })));
    const openVault = () => leaveThen(() => setNav((s) => pushEntry(s, { kind: "vault", path: "" })));
    window.addEventListener("m-open-security", openSecurity);
    window.addEventListener("m-open-settings", openVault);
    return () => {
      window.removeEventListener("m-open-security", openSecurity);
      window.removeEventListener("m-open-settings", openVault);
    };
  }, [setNav]);
}
