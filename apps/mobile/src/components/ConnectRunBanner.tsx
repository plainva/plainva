import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Banner, Button, serviceConnectionMessage, serviceLabel, toast, type CloudServiceId } from "@plainva/ui";
import { clearConnectQueue, confirmConnectSelection } from "../services/connectQueue";
import { useConnectionRun } from "../hooks/useConnectionRun";
import { hasReceivedPimOAuthResult, resumePimOAuthResult } from "../services/pim/pimOAuth";

/** Setup actions stay with the focused form, never below general settings. */
export function ConnectRunBanner({ service, selectionPending = false, onCancel }: { service: CloudServiceId; selectionPending?: boolean; onCancel?: () => void }) {
  const { t } = useTranslation();
  const queue = useConnectionRun();
  const [retrySaved, setRetrySaved] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setRetrySaved(false);
    if (queue?.context) void hasReceivedPimOAuthResult(queue.context, service).then(value => { if (active) setRetrySaved(value); }).catch(() => {});
    return () => { active = false; };
  }, [queue, service]);
  if (!queue || queue.pending[0] !== service) return null;
  const outcome = queue.outcomes[service];
  const selecting = service === "calendar" && outcome && "bindingId" in outcome;
  // The step and what it says stack in one column, the buttons wrap below it:
  // side by side, a long message squeezed the step label until it broke
  // letter by letter (device finding 2026-10-27, 375 px).
  return <Banner kind="info" rounded>
    <div className="m-connectrun" data-testid="connectrun-banner">
      <div className="m-connectrun-text">
        <span className="m-connectrun-step" data-testid="connectrun-step">{t(selecting ? "connection.selectResources" : "cloudAccounts.connectRunStep", { step: queue.done.length + 1, total: queue.done.length + queue.pending.length, service: serviceLabel(service) })}</span>
        {outcome && (outcome.state === "failed" || outcome.state === "needsConsent") && <span role="status" data-testid="connectrun-outcome">{serviceConnectionMessage(outcome.message ?? outcome.state, t)}</span>}
        {/* A step that ends without going on says why, a cancel too (device finding 2026-10-27). */}
        {outcome?.state === "cancelled" && <span role="status" data-testid="connectrun-outcome">{service === "files" ? t("connection.transferCancelled") : serviceConnectionMessage("cancelled", t)}</span>}
      </div>
      <div className="m-connectrun-actions">
      {retrySaved && <Button variant="primary" disabled={busy} onClick={() => { setBusy(true); void resumePimOAuthResult().catch(e => toast.error(serviceConnectionMessage(e, t))).finally(() => setBusy(false)); }}>{t("connection.retrySaved")}</Button>}
      {selecting && <Button variant="primary" disabled={selectionPending} data-testid="connectrun-next" onClick={() => void confirmConnectSelection()}>{t("common.next")}</Button>}
      <Button data-testid="connectrun-cancel" onClick={() => void clearConnectQueue().then(onCancel).catch(e => toast.error(serviceConnectionMessage(e, t)))} size="sm" variant="ghost">{t("cloudAccounts.connectRunCancel")}</Button>
      </div>
    </div>
  </Banner>;
}

export function ConnectRunSummary() {
  const { t } = useTranslation();
  const queue = useConnectionRun();
  if (!queue || queue.pending.length) return null;
  return <Banner kind="success" rounded>
    <div className="m-connect-summary" data-testid="connectrun-summary">
      <strong>{t("cloudAccounts.connectRunDone")}</strong>
      <span>{queue.done.map(serviceLabel).join(" · ")}</span>
      <Button variant="primary" onClick={() => void clearConnectQueue()}>{t("common.close")}</Button>
    </div>
  </Banner>;
}
