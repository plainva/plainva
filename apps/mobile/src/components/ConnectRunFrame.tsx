import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, CalendarDays, FolderOpen, Info, Mail } from "lucide-react";
import {
  Button,
  GroupCard,
  ICON,
  Row,
  RowList,
  WizardSteps,
  accountMonogram,
  connectRunEnding,
  connectRunSteps,
  connectSkipLabelKey,
  connectStepLabelKey,
  cx,
  familyLabel,
  serviceConnectionFailure,
  serviceLabel,
  toast,
  type CloudServiceId,
  type ServiceConnectionOutcome,
} from "@plainva/ui";
import { AppBar } from "./AppBar";
import { clearConnectQueue, loadConnectQueue, runServices, skipConnectStep, type ConnectQueue } from "../services/connectQueue";
import { loadCloudAccounts } from "../services/cloudAccountsStore";
import { mConfirm } from "../services/mobileDialogs";
import { hasReceivedPimOAuthResult, resumePimOAuthResult } from "../services/pim/pimOAuth";

/**
 * The frame of every step of the account setup after the sign-in (plan
 * "Verbinden-Assistent", 2026-10-28; device finding 2026-10-28, TestFlight
 * 148). It replaces the banner the steps used to wear over the general
 * screens: one bar with "Cancel" (E2), one line saying who is signed in, the
 * steps of the whole way with the sign-in counted as done (E1), and ONE
 * question with its button. A failure stands where the question is, with its
 * sender (E7).
 *
 * The desktop's connect dialog draws the same steps with the same
 * `WizardSteps` and the same names; it binds the services on one page after
 * the sign-in, so it has no frame of its own per step (featureParity:
 * "connect-run-steps").
 */
export function ConnectRunFrame({
  run,
  service,
  heading,
  hint,
  onLeave,
  failure,
  hideOutcome = false,
  onRetry,
  onSignIn,
  children,
}: {
  run: ConnectQueue;
  /** The step on screen; absent on the summary. */
  service?: CloudServiceId;
  heading: string;
  hint?: string;
  /** After the run was given up: back to where the setup started. */
  onLeave: () => void;
  /** A failure of this step that the screen itself caught (it shows before the run's own outcome). */
  failure?: unknown;
  /** While the step shows its review or its progress, an earlier outcome is past. */
  hideOutcome?: boolean;
  onRetry?: () => void;
  onSignIn?: () => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const [account, setAccount] = useState("");
  useEffect(() => {
    let alive = true;
    void loadCloudAccounts(run.context.vaultId).then((records) => {
      if (alive) setAccount(records.find((r) => r.id === run.context.cloudAccountId)?.label ?? "");
    }).catch(() => {});
    return () => { alive = false; };
  }, [run.context.vaultId, run.context.cloudAccountId]);

  const provider = familyLabel(run.family, run.flavor);
  const steps = connectRunSteps(run).map((step) => ({ key: step.id, label: t(connectStepLabelKey(step.id)), state: step.state }));
  const finished = !service;

  const leave = async () => {
    if (finished) { onLeave(); return; }
    const { notSetUp } = connectRunEnding(run);
    const ok = await mConfirm({
      title: t("connectRun.cancelTitle"),
      message: t("connectRun.cancelMessage", { provider, missing: notSetUp.map((s) => serviceLabel(s)).join(", ") }),
      confirmLabel: t("connectRun.cancelConfirm"),
      cancelLabel: t("connectRun.cancelKeep"),
    });
    if (!ok) return;
    try {
      // A destination prepared for the files step and never made a vault goes first (third review 2026-10-28).
      await abandonPrepared();
      await clearConnectQueue();
      onLeave();
    } catch (error) {
      toast.error(serviceConnectionFailure(error, t, { provider }).text);
    }
  };

  return (
    <>
      <AppBar
        onBack={() => void leave()}
        title={t("connectRun.title")}
        actions={finished ? undefined : <Button variant="ghost" data-testid="connectrun-cancel" onClick={() => void leave()}>{t("connectRun.cancelConfirm")}</Button>}
      />
      <div className="m-connectrun" data-testid="connectrun-frame" data-step={service ?? "summary"}>
        <div className="m-connectrun-account" data-testid="connectrun-account">
          <span aria-hidden className={`m-acctmark m-acctmark--${run.family}`}>{accountMonogram(run.family, run.flavor)}</span>
          <span className="m-connectrun-who">
            <strong>{provider}</strong>
            {account && <span>{account}</span>}
          </span>
          {/* Only after a sign-in that took place (settings plan 2026-10-29, § 5.1). */}
          {run.signedIn !== false && <span className={cx("pv-acct-state", "pv-acct-state--connected")} data-testid="connectrun-signed-in">{t("connectRun.signedIn")}</span>}
        </div>
        <WizardSteps steps={steps} layout="stacked" label={t("connectRun.stepsLabel")} testId="connectrun-steps" />
        <h2 className="m-connectrun-heading" data-testid="connectrun-heading">{heading}</h2>
        {hint && <p className="m-hint">{hint}</p>}
        {service && !hideOutcome && <StepFailure provider={provider} failure={failure} outcome={run.outcomes[service]} service={service} onRetry={onRetry} onSignIn={onSignIn} />}
        {children}
      </div>
    </>
  );
}

/** What went wrong in this step, with its sender: the screen's own catch first, else the run's recorded outcome. */
function StepFailure({ provider, failure, outcome, service, onRetry, onSignIn }: {
  provider: string;
  failure: unknown;
  outcome: ServiceConnectionOutcome | undefined;
  service: CloudServiceId;
  onRetry?: () => void;
  onSignIn?: () => void;
}) {
  const { t } = useTranslation();
  const subject = failure !== undefined && failure !== null
    ? failure
    : outcome && (outcome.state === "failed" || outcome.state === "needsConsent" || outcome.state === "cancelled")
      ? (outcome.state === "failed" ? outcome.message ?? outcome.state : outcome.state)
      : null;
  if (subject === null) return null;
  // A copy the person stopped is no failure: it says so, and what to do.
  if (subject === "cancelled" && service === "files") {
    return <p className="m-connectrun-note" role="status" data-testid="connectrun-outcome"><Info size={ICON.ui} aria-hidden="true" /><span>{t("connection.transferCancelled")}</span></p>;
  }
  const view = serviceConnectionFailure(subject, t, { provider });
  const signIn = view.signIn && onSignIn;
  return (
    <div className={cx("m-connectrun-note", view.title && "m-connectrun-note--error")} role={view.title ? "alert" : "status"} data-testid="connectrun-outcome" data-source={view.source}>
      {view.title ? <AlertCircle size={ICON.ui} aria-hidden="true" /> : <Info size={ICON.ui} aria-hidden="true" />}
      <span className="m-connectrun-note-text">
        {view.title && <strong>{view.title}</strong>}
        <span>{view.text}</span>
        {view.raw && <code className="m-connectrun-raw">{view.raw}</code>}
      </span>
      {(signIn || onRetry) && (
        <span className="m-connectrun-note-actions">
          {signIn
            ? <Button size="sm" variant="tonal" data-testid="connectrun-signin" onClick={onSignIn}>{t("cloudAccounts.reconnect")}</Button>
            : <Button size="sm" variant="tonal" data-testid="connectrun-retry" onClick={onRetry}>{t("cloudAccounts.retry")}</Button>}
        </span>
      )}
    </div>
  );
}

/**
 * The step's buttons: its one action, and leaving this service out (E6). A
 * sign-in that came back while the app was gone is offered first, as the
 * banner before it did.
 */
export function ConnectRunFooter({ run, service, primary, disabled = false }: { run: ConnectQueue; service: CloudServiceId; primary?: ReactNode; disabled?: boolean }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [retrySaved, setRetrySaved] = useState(false);
  useEffect(() => {
    let alive = true;
    setRetrySaved(false);
    void hasReceivedPimOAuthResult(run.context, service).then((value) => { if (alive) setRetrySaved(value); }).catch(() => {});
    return () => { alive = false; };
  }, [run, service]);
  const provider = familyLabel(run.family, run.flavor);
  return (
    <div className="m-connectrun-foot">
      {retrySaved && (
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => { setBusy(true); void resumePimOAuthResult().catch((error) => toast.error(serviceConnectionFailure(error, t, { provider }).text)).finally(() => setBusy(false)); }}
        >
          {t("connection.retrySaved")}
        </Button>
      )}
      {primary}
      <Button
        variant="ghost"
        disabled={busy || disabled}
        data-testid="connectrun-skip"
        onClick={() => {
          setBusy(true);
          void (service === "files" ? abandonPrepared() : Promise.resolve("released" as const))
            // A copy that went through in the meantime is done, not skipped: the run goes on by itself.
            .then((left) => (left === "connected" ? undefined : skipConnectStep(service)))
            .catch((error) => toast.error(serviceConnectionFailure(error, t, { provider }).text))
            .finally(() => setBusy(false));
        }}
      >
        {t(connectSkipLabelKey(service))}
      </Button>
    </div>
  );
}

let summariesShown = 0;

/** Lets go of a destination the files step prepared; loaded on demand, the copy's module is large. */
async function abandonPrepared(): Promise<"connected" | "released"> {
  const { abandonPreparedFiles } = await import("../services/accountVaultTransfer");
  return abandonPreparedFiles();
}

/**
 * The end of the setup (E6): one line per service of the run - connected, or
 * skipped with the way to set it up later - and "Done".
 */
export function ConnectRunSummary({ run, onDone }: { run: ConnectQueue; onDone: () => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const provider = familyLabel(run.family, run.flavor);
  const services = runServices(run);
  // "Done", the back arrow and Android's back gesture all end the run: a
  // summary left without ending it would come back every time the accounts
  // are opened (second review 2026-10-28).
  // Ended only once no summary is on screen any more - React's development
  // check mounts it twice, and a remount must not end the run under it.
  const runId = run.id;
  useEffect(() => {
    summariesShown += 1;
    return () => {
      summariesShown -= 1;
      // Only this finished run: a new one started in the same moment is not ended under it.
      setTimeout(() => {
        if (summariesShown !== 0) return;
        void loadConnectQueue().then((q) => (q?.id === runId && q.pending.length === 0 ? clearConnectQueue() : undefined)).catch(() => {});
      }, 0);
    };
  }, [runId]);
  const finish = () => {
    setBusy(true);
    void clearConnectQueue().then(onDone).catch((error) => toast.error(serviceConnectionFailure(error, t, { provider }).text)).finally(() => setBusy(false));
  };
  const icon = (service: CloudServiceId) => service === "files" ? <FolderOpen size={ICON.ui} /> : service === "calendar" ? <CalendarDays size={ICON.ui} /> : <Mail size={ICON.ui} />;
  return (
    <>
      <ConnectRunFrame run={run} heading={t("connectRun.doneHeading", { provider })} onLeave={finish}>
        <GroupCard>
          <RowList>
            {services.map((service) => {
              const skipped = (run.skipped ?? []).includes(service);
              return (
                <Row
                  key={service}
                  icon={icon(service)}
                  title={serviceLabel(service)}
                  subtitle={skipped ? t("connectRun.laterOnAccountPage") : undefined}
                  end={<span className={cx("pv-acct-state", skipped ? "pv-acct-state--signin" : "pv-acct-state--connected")}>{t(skipped ? "connectRun.stateSkipped" : "connectRun.stateConnected")}</span>}
                  data-testid={`connectrun-summary-${service}`}
                  data-state={skipped ? "skipped" : "connected"}
                  wrap
                />
              );
            })}
          </RowList>
        </GroupCard>
        <div className="m-connectrun-foot">
          <Button
            variant="primary"
            disabled={busy}
            data-testid="connectrun-done"
            onClick={finish}
          >
            {t("cloudAccounts.finish")}
          </Button>
        </div>
      </ConnectRunFrame>
    </>
  );
}
