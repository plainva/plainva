import React from "react";
import { Banner, Button, Modal, Radio, SettingCard, SettingCardNote, SettingRow } from "@plainva/ui";
import type { TFunction } from "i18next";
import { WORKSPACE_ROLES, roleName, type Diagnostics } from "./securityForms";

/**
 * Explaining surfaces for the security centre (plan P5, findings B9 + B10).
 *
 * Three jobs: say once what the six roles may do, show a running rekey where it
 * can be seen instead of inside a collapsed block, and ask HOW someone is
 * removed before the click rather than behind two differently coloured buttons.
 */

/**
 * The six roles against what they allow - in one place (P5).
 *
 * Roles are also chosen in the assign dialog, where every option carries its
 * own one-line description; this is the reference that explains the whole set,
 * including the sentence that provider permissions never replace encryption.
 * Saying that once beats repeating half of it per dialog.
 */
export const RoleMatrix: React.FC<{ t: TFunction }> = ({ t }) => (
  <SettingCardNote>
    <details className="pv-security-tech">
      <summary>{t("workspaceSecurity.roleMatrix")}</summary>
      <dl className="pv-security-details">
        {WORKSPACE_ROLES.map((role) => (
          <React.Fragment key={role}>
            <dt>{roleName(t, role)}</dt>
            <dd>{t(`workspaceSecurity.roleDesc.${role}`, { defaultValue: "" })}</dd>
          </React.Fragment>
        ))}
      </dl>
      <p>{t("workspaceSecurity.roleProviderNote")}</p>
    </details>
  </SettingCardNote>
);

/**
 * Machine values, out of the reading line (P5).
 *
 * Hex IDs and key epochs belong to the protocol, not to the sentence a person
 * reads about a colleague. They stay reachable - a support question needs the
 * full ID - but one disclosure per area instead of a suffix per row.
 */
export const TechDetails: React.FC<{ t: TFunction; entries: readonly (readonly [string, string])[] }> = ({ t, entries }) => {
  if (entries.length === 0) return null;
  return (
    <SettingCardNote>
      <details className="pv-security-tech">
        <summary>{t("workspaceSecurity.technicalDetails")}</summary>
        <dl className="pv-security-details">
          {entries.map(([term, value], index) => (
            <React.Fragment key={`${term}-${index}`}>
              <dt>{term}</dt>
              <dd><code className="pv-security-code">{value}</code></dd>
            </React.Fragment>
          ))}
        </dl>
      </details>
    </SettingCardNote>
  );
};

/**
 * A running rekey, where it can be seen (P5, finding B9).
 *
 * A full rotation rewrites every readable object and can run for a long time;
 * until now its only trace was one line inside a details block that starts
 * closed. The cursor is durable (`resumeWorkspaceRekey`), so the card says so:
 * closing Plainva does not lose the run.
 */
export const RekeyProgressCard: React.FC<{ t: TFunction; diagnostics: Diagnostics | null }> = ({ t, diagnostics }) => {
  const job = diagnostics?.meta?.rekeyJob;
  if (!job || job.phase === "complete") return null;
  const percent = job.total > 0 ? Math.round((job.completed / job.total) * 100) : 0;
  const title = t("workspaceSecurity.rekeyCard");
  return (
    <SettingCard label={title}>
      <SettingRow
        label={t(`workspaceSecurity.rekeyPhase.${job.phase}`, { defaultValue: job.phase })}
        desc={t("workspaceSecurity.rekeyResumes")}
      >
        <span>{`${job.completed}/${job.total}`}</span>
      </SettingRow>
      <SettingCardNote>
        <div className="pv-security-progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={title}>
          <div className="pv-security-progress-bar" style={{ width: `${percent}%` }} />
        </div>
      </SettingCardNote>
      {job.lastError && <Banner kind="error" rounded>{job.lastError}</Banner>}
    </SettingCard>
  );
};

export type RevokeSubject = { kind: "member" | "device"; id: string; displayName: string };

/**
 * Removing someone explains its consequences BEFORE the click (P5, B9).
 *
 * The two modes differ fundamentally - an epoch change against rewriting every
 * object - and used to be two differently coloured buttons whose difference was
 * explained only in the confirmation that followed them. Here the choice IS the
 * explanation; both descriptions are the same sentences the confirmations used,
 * now readable while deciding instead of after deciding.
 */
export const RevokeDialog: React.FC<{
  t: TFunction;
  subject: RevokeSubject;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (mode: "future" | "full") => void;
}> = ({ t, subject, busy, onCancel, onConfirm }) => {
  const [mode, setMode] = React.useState<"future" | "full">("future");
  return (
    <Modal
      onClose={onCancel}
      size="md"
      testId="workspace-revoke-dialog"
      title={subject.kind === "member" ? t("workspaceSecurity.revokeMember") : t("workspaceSecurity.revokeDevice")}
      footer={<>
        <Button variant="ghost" onClick={onCancel}>{t("common.cancel")}</Button>
        <Button variant="danger" disabled={busy} onClick={() => onConfirm(mode)} data-testid="workspace-revoke-confirm">
          {t("workspaceSecurity.revokeConfirm")}
        </Button>
      </>}
    >
      <p>{t("workspaceSecurity.revokeIntro", { name: subject.displayName })}</p>
      <div className="pv-security-choices" role="radiogroup" aria-label={t("workspaceSecurity.revokeMode")}>
        <Radio
          name="pv-revoke-mode"
          checked={mode === "future"}
          onChange={() => setMode("future")}
          label={<>
            <strong>{t("workspaceSecurity.futureOnly")}</strong>
            <span>{t("workspaceSecurity.revokeFutureQuestion")}</span>
          </>}
        />
        <Radio
          name="pv-revoke-mode"
          checked={mode === "full"}
          onChange={() => setMode("full")}
          label={<>
            <strong>{t("workspaceSecurity.fullRekey")}</strong>
            <span>{t("workspaceSecurity.revokeFullQuestion")}</span>
          </>}
        />
      </div>
    </Modal>
  );
};
