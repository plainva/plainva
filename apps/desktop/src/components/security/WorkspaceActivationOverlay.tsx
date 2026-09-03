import React from "react";
import { Banner, Button, Modal } from "@plainva/ui";
import { useTranslation } from "react-i18next";
import { useWorkspaceActivation, workspaceActivationStore } from "../../services/workspaceActivationStore";

/**
 * The progress of a running conversion, mounted at app level (K8).
 *
 * It sits ABOVE the settings modal on purpose: the wizard that starts the
 * sweep lives inside a settings page, and a settings page can be hidden or
 * unmounted by a single click. The conversion cannot — it keeps writing until
 * the queue stands — so the thing that shows it must outlive the page. The
 * window has no close control while the sweep runs; it goes away by itself
 * once the vault has been reloaded with its new status.
 */
export const WorkspaceActivationOverlay: React.FC = () => {
  const { t } = useTranslation();
  const activation = useWorkspaceActivation();
  if (activation.phase === "idle") return null;
  const running = activation.phase === "running";
  return (
    <Modal
      title={t("workspaceSecurity.activationTitle")}
      onClose={() => { if (!running) workspaceActivationStore.dismiss(); }}
      size="sm"
      hideClose={running}
      closeOnOverlay={false}
      testId="workspace-activation"
    >
      <div className="pv-security-wizard">
        {running ? (
          <>
            <Banner kind="info" rounded>{t("workspaceSecurity.activating")}</Banner>
            <div
              className="pv-security-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={activation.total}
              aria-valuenow={activation.done}
            >
              {activation.total > 0 ? (
                <div className="pv-security-progress-bar" style={{ width: `${(activation.done / activation.total) * 100}%` }} />
              ) : (
                <div className="indeterminate-progress pv-security-progress-bar" />
              )}
            </div>
            {activation.total > 0 && (
              <div className="pv-security-progress-label">{t("workspaceSecurity.activatingProgress", { done: activation.done, total: activation.total })}</div>
            )}
            <span className="pv-security-progress-label">{t("workspaceSecurity.activationStays")}</span>
          </>
        ) : (
          <>
            <Banner kind="error" rounded>{t("workspaceSecurity.activationFailed")}</Banner>
            <span className="pv-security-progress-label">{activation.message}</span>
            <div className="pv-security-actions">
              <Button variant="primary" onClick={() => workspaceActivationStore.dismiss()}>{t("common.close")}</Button>
            </div>
          </>
        )}
        <span className="pv-security-vault">{activation.vaultPath}</span>
      </div>
    </Modal>
  );
};
