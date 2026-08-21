import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast, type CloudServiceId } from "@plainva/ui";

import { advanceOnAccountsChanged, runServices } from "../services/connectQueue";
import { bindRunTokenToAccount } from "../services/connectConsent";
import { getActiveVaultEntry } from "../services/vaultRegistry";
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
      void advanceOnAccountsChanged(service).then(async ({ advanced, next, queue }) => {
        if (!advanced) return;
        // The first service just brought a widened token home; from here the
        // account slot serves the rest, so nothing after this opens a consent
        // (S0b3). Best effort: a failure here costs an extra consent later, it
        // never costs the connection that was just made.
        if (queue) {
          const vault = await getActiveVaultEntry().catch(() => null);
          if (vault) {
            await bindRunTokenToAccount(vault.id, queue.family, runServices(queue)).catch(() => null);
          }
        }
        // The family travels with EVERY hop, not just the first (finding
        // 2026-08-21). The router set it when the run started
        // (`routes.tsx` → `c.replace({ …, family })`); dropping it here meant
        // every screen from step 2 on believed it had been opened directly:
        // the provider chooser folded back out, the Google form asked for the
        // client id again, and mail landed on the generic IMAP form instead of
        // the Gmail preset. `familyTarget.ts` — the prefill table — was never
        // reached, not because it is wrong, but because nothing told it which
        // provider this is.
        if (next) setNav((st) => pushEntry(st, { kind: screenForService(next), path: "", family: queue?.family }));
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
