import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast, type CloudServiceId } from "@plainva/ui";

import { advanceOnAccountsChanged } from "../services/connectQueue";
import { MAIL_CHANGED_EVENT } from "../services/mail/mailRuntime";
import { pushEntry, type NavState } from "../navigation";
import { screenForService } from "../routes";

/**
 * Keeps a connect run moving (S0b2).
 *
 * The services of one account each sign in on their own screen, so something
 * has to open the next one. It cannot be the screens: connecting FILES calls
 * `switchVault`, and the shell's handler for that throws the whole navigation
 * away — a callback inside the files form would be talking to a stack that no
 * longer exists. So the run lives up here, listens for the events the account
 * lists already fire, and lets the queue decide whether the change was the
 * sign-in it was waiting for (a list that GREW) or just a delete or an edit.
 *
 * It sits in its own module rather than in App.tsx because App.tsx is under a
 * shrinking line budget — feature blocks belong in their own files, and this is
 * one.
 */
export function useConnectRun(setNav: (fn: (state: NavState) => NavState) => void): void {
  const { t } = useTranslation();

  useEffect(() => {
    const advance = (service: CloudServiceId) => () => {
      void advanceOnAccountsChanged(service).then(({ advanced, next }) => {
        if (!advanced) return;
        if (next) setNav((st) => pushEntry(st, { kind: screenForService(next), path: "" }));
        // The run is over — say so, rather than leaving the last form standing
        // with no sign that anything concluded.
        else toast.success(t("cloudAccounts.connectRunDone"));
      });
    };
    const onFiles = advance("files");
    const onCalendar = advance("calendar");
    const onMail = advance("mail");
    window.addEventListener("m-vault-switched", onFiles);
    window.addEventListener("m-pim-changed", onCalendar);
    window.addEventListener(MAIL_CHANGED_EVENT, onMail);
    return () => {
      window.removeEventListener("m-vault-switched", onFiles);
      window.removeEventListener("m-pim-changed", onCalendar);
      window.removeEventListener(MAIL_CHANGED_EVENT, onMail);
    };
  }, [setNav, t]);
}
