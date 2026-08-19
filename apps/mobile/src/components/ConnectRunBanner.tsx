import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Banner, Button, type CloudServiceId } from "@plainva/ui";

import { clearConnectQueue, loadConnectQueue, type ConnectQueue } from "../services/connectQueue";

/**
 * "Step 2 of 3 — calendar" on top of the form the run just opened (S0b2).
 *
 * Without it a multi-service run is indistinguishable from a single one: the
 * user taps "connect", lands on a mail form, and has no way to tell whether
 * that was the thing they asked for or the last of three. Worse on the way
 * out — after files the app switches vault and the navigation resets, so the
 * calendar form appears with no visible relation to what came before.
 *
 * It renders nothing when there is no run, which is the normal case: the direct
 * entry points ("connect with cloud" on the vault page, the accounts screens)
 * have no queue and must look exactly as they did.
 *
 * The banner also OWNS the way out. A run that is abandoned mid-way keeps
 * steering the screens it opens — it is what lets a calendar be created without
 * a consent of its own — and until now nothing called `clearConnectQueue`,
 * although it was written for exactly this (finding 2026-08-19). Leaving the
 * wizard is a decision, so it gets a control rather than a timeout.
 */
export function ConnectRunBanner({ service }: { service: CloudServiceId }) {
  const { t } = useTranslation();
  const [queue, setQueue] = useState<ConnectQueue | null>(null);

  useEffect(() => {
    let alive = true;
    void loadConnectQueue().then((q) => {
      if (alive) setQueue(q);
    });
    return () => {
      alive = false;
    };
  }, [service]);

  // Only for the service the run is actually waiting for. Reaching the mail
  // form directly while a calendar step is pending is not part of the run.
  if (!queue || queue.pending[0] !== service) return null;

  const total = queue.done.length + queue.pending.length;
  const step = queue.done.length + 1;
  const label =
    service === "files"
      ? t("cloudAccounts.serviceFiles")
      : service === "calendar"
        ? t("cloudAccounts.serviceCalendar")
        : t("cloudAccounts.serviceMail");

  return (
    <Banner kind="info" rounded>
      <span className="m-connectrun">
        {t("cloudAccounts.connectRunStep", { step, total, service: label })}
        <Button
          data-testid="connectrun-cancel"
          onClick={() => void clearConnectQueue().then(() => setQueue(null))}
          size="sm"
          variant="ghost"
        >
          {t("cloudAccounts.connectRunCancel")}
        </Button>
      </span>
    </Banner>
  );
}
