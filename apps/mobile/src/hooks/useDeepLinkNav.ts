import { useEffect } from "react";

import { pushEntry, type NavState } from "../navigation";
import { draftPath } from "../screens/mail/mailNavRefs";
import { leaveThen } from "../services/leaveQuestion";
import { setRefusedSendOpener } from "../services/mail/refusedSend";

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
 * The third is not an event: a message the mail server refused is kept
 * (`refusedSend.ts`), and the "Open again" of its notice pushes the composer,
 * which reads the message by the id in its path.
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
    const openVault = () => leaveThen(() => setNav((s) => pushEntry(s, { kind: "vaultsync", path: "" })));
    window.addEventListener("m-open-security", openSecurity);
    window.addEventListener("m-open-settings", openVault);
    // The other fields of such a draft are empty and are not read: the screen
    // takes the message from where it is held.
    setRefusedSendOpener((id) =>
      leaveThen(() => setNav((s) => pushEntry(s, { kind: "mailcompose", path: draftPath({ accountId: "", to: "", subject: "", body: "", refused: id }) }))),
    );
    return () => {
      window.removeEventListener("m-open-security", openSecurity);
      window.removeEventListener("m-open-settings", openVault);
      setRefusedSendOpener(null);
    };
  }, [setNav]);
}
