import React from "react";
import { useTranslation } from "react-i18next";
import { Check, CircleAlert, Clock } from "lucide-react";
import {
  Banner,
  Button,
  Switch,
  ICON,
  MAIL_PRESETS,
  SettingCard,
  SettingCardNote,
  SettingRow,
  TextInput,
  getPlatformServices,
  isInsecurePublicUrl,
  serviceConnectionFailure,
  type CloudProviderFamily,
  type CloudServiceId,
  type ConnectAccessPlan,
  type ConnectField,
  type ConnectFieldId,
  type ConnectText,
} from "@plainva/ui";
import { Select } from "../Select";
import type { ServiceRunStatus } from "../../services/cloudAccountsActions";
import { AccountMark, serviceLabel } from "./cloudAccountsShared";

/**
 * The parts of the sign-in step every provider shares on the desktop
 * (settings plan 2026-10-29, § 5): the head that says what is asked for and
 * how, the form an access kind needs, "Other sign-in" at one place and the
 * status line per service. The settings wizard and the start screen's
 * "vault in the cloud" draw the step from these and from `connectAccessPlan`.
 */

export type ConnectValues = Partial<Record<ConnectFieldId, string>>;

/** A field's value: what was typed, else what the catalog knows. */
export function connectValue(values: ConnectValues, field: Pick<ConnectField, "id" | "prefill">): string {
  return values[field.id] ?? field.prefill ?? "";
}

type T = (key: string, options?: Record<string, unknown>) => string;

const say = (t: T, text: ConnectText) => t(text.key, text.values);

/** A failure with its sender - device, provider, network, Plainva (plan "Verbinden-Assistent", E7). */
export function failedServiceStatus(err: unknown, t: T, provider: string): ServiceRunStatus {
  const view = serviceConnectionFailure(err, t, { provider, platform: "desktop" });
  return { state: "error", ...(view.title ? { title: view.title } : {}), detail: view.text, ...(view.raw ? { raw: view.raw } : {}) };
}

/** The head: the provider's mark, the chosen services, one line on how the sign-in goes. */
export const ConnectSummaryCard: React.FC<{ family: CloudProviderFamily; flavor?: "nextcloud"; services: readonly CloudServiceId[]; line: string }> = ({ family, flavor, services, line }) => (
  <SettingCard>
    <div className="pv-acct-head" data-testid="cloudacct-signin-summary">
      <AccountMark family={family} flavor={flavor} />
      <div className="pv-acct-who">
        <div className="pv-acct-name">{services.map(serviceLabel).join(" · ")}</div>
        <div className="pv-acct-id" data-testid="cloudacct-signin-line">{line}</div>
      </div>
    </div>
  </SettingCard>
);

/** "Other sign-in" for every provider at the same place; folded, it says what it holds. */
export const ConnectOtherCard: React.FC<{ plan: ConnectAccessPlan; open: boolean; onToggle: () => void; disabled?: boolean }> = ({ plan, open, onToggle, disabled }) => {
  const { t } = useTranslation();
  if (!plan.other) return null;
  return (
    <SettingCard>
      <SettingCardNote>
        <Button variant="ghost" size="sm" aria-expanded={open} disabled={disabled} onClick={onToggle} data-testid="cloudacct-other-signin">
          {t(plan.other.labelKey)}
        </Button>
        {!open && plan.other.contents.length > 0 && <> · {plan.other.contents.map((key) => t(key)).join(" · ")}</>}
      </SettingCardNote>
    </SettingCard>
  );
};

/** The form of an access kind: the fields on screen, the step to create the secret, the guide, what must be done first. */
export const ConnectFieldsCard: React.FC<{
  plan: ConnectAccessPlan;
  fields: readonly ConnectField[];
  values: ConnectValues;
  onChange: (id: ConnectFieldId, value: string) => void;
  disabled?: boolean;
  /** The note points to the tile the address belongs to (Outlook → Microsoft). */
  onUseTile?: (family: CloudProviderFamily) => void;
}> = ({ plan, fields, values, onChange, disabled, onUseTile }) => {
  const { t } = useTranslation();
  if (fields.length === 0 && !plan.step && plan.notes.length === 0) return null;
  const insecure = fields.some((field) => field.input === "address" && isInsecurePublicUrl(connectValue(values, field)));
  const openGuide = () => { if (plan.guide) void getPlatformServices().openExternal(plan.guide.url); };
  return (
    <SettingCard>
      {insecure && (
        <SettingCardNote>
          <Banner kind="warning">{t("settings.insecureUrlWarning")}</Banner>
        </SettingCardNote>
      )}
      {fields.map((field) => {
        const value = connectValue(values, field);
        const testId = `connect-field-${field.id}`;
        if (field.input === "switch") {
          return (
            <SettingRow key={field.id} label={t(field.labelKey)}>
              <Switch checked={value !== "off"} disabled={disabled} onChange={(on) => onChange(field.id, on ? "on" : "off")} label={t(field.labelKey)} testId={testId} />
            </SettingRow>
          );
        }
        if (field.input === "preset") {
          return (
            <SettingRow key={field.id} label={t(field.labelKey)}>
              <Select
                value={value || "custom"}
                onChange={(next) => onChange(field.id, next)}
                options={[...MAIL_PRESETS.map((preset) => ({ value: preset.id, label: preset.label })), { value: "custom", label: t("mail.customProvider") }]}
                ariaLabel={t(field.labelKey)}
                data-testid={testId}
              />
            </SettingRow>
          );
        }
        const port = field.input === "port";
        return (
          <SettingRow key={field.id} label={t(field.labelKey)} wide={!port}>
            <TextInput
              type={field.input === "secret" ? "password" : field.input === "email" ? "email" : "text"}
              purpose={field.input === "address" ? "address" : field.input === "keyId" ? "secret" : undefined}
              autoComplete={field.input === "secret" ? "new-password" : "off"}
              value={value}
              placeholder={field.placeholder}
              disabled={disabled}
              onChange={(event) => onChange(field.id, event.target.value)}
              style={port ? { width: 90 } : undefined}
              aria-label={t(field.labelKey)}
              data-testid={testId}
            />
          </SettingRow>
        );
      })}
      {plan.notes.map((note) => (
        <SettingCardNote key={note.key}>
          {say(t, note)}
          {plan.useTileInstead && note.key === "cloudAccounts.presetUseMicrosoft" && onUseTile && (
            <>
              {" "}
              <button type="button" className="pv-linkbtn" onClick={() => onUseTile(plan.useTileInstead!)} data-testid="cloudacct-open-microsoft">
                {t("cloudAccounts.presetOpenMicrosoft")}
              </button>
            </>
          )}
        </SettingCardNote>
      ))}
      {(plan.step || plan.guide) && !plan.useTileInstead && (
        <SettingCardNote>
          {plan.step && <span data-testid="connect-step-line">{say(t, plan.step)} </span>}
          {plan.guide && (
            <button type="button" className="pv-linkbtn" onClick={openGuide} data-testid="connect-guide">
              {say(t, plan.guide.label)}
            </button>
          )}
        </SettingCardNote>
      )}
    </SettingCard>
  );
};

/** One line per chosen service: waiting, connecting, connected - or the failure with its sender. */
export const ServiceStatusCard: React.FC<{
  services: readonly CloudServiceId[];
  status: Partial<Record<CloudServiceId, ServiceRunStatus>>;
  waitingKey: string;
  children?: React.ReactNode;
}> = ({ services, status, waitingKey, children }) => {
  const { t } = useTranslation();
  if (services.length === 0) return null;
  return (
    <SettingCard className="pv-setgroup">
      {services.map((service) => {
        const st = status[service];
        const kind = st?.state === "ok" ? "ok" : st?.state === "error" ? "err" : "wait";
        const Icon = kind === "ok" ? Check : kind === "err" ? CircleAlert : Clock;
        return (
          <div key={service} className={`pv-svcstat pv-svcstat--${kind}`} data-testid={`cloudacct-status-${service}`} data-state={st?.state ?? "idle"}>
            <span className="pv-svcstat-icon">
              <Icon size={ICON.ui} />
            </span>
            <span className="pv-svcstat-label">{serviceLabel(service)}</span>
            <span className="pv-svcstat-sub">
              {st?.state === "error" && st.title && <strong>{st.title}: </strong>}
              {st?.state === "ok"
                ? (st.detail ?? t("cloudAccounts.statusConnected"))
                : st?.state === "error"
                  ? st.detail
                  : st?.state === "pending"
                    ? t("pim.connecting")
                    : t(waitingKey)}
              {st?.state === "error" && st.raw && <code className="pv-svcstat-raw">{st.raw}</code>}
            </span>
          </div>
        );
      })}
      {children}
    </SettingCard>
  );
};

/** A failure of the whole page, with its sender, where a toast used to say it alone (account page). */
export const FailureBanner: React.FC<{ failure: ServiceRunStatus | null; onDismiss?: () => void; action?: { label: string; run: () => void } }> = ({ failure, onDismiss, action }) => {
  const { t } = useTranslation();
  if (!failure || failure.state !== "error") return null;
  const actions = action || onDismiss ? (
    <>
      {action && <Button size="sm" variant="secondary" onClick={action.run} data-testid="cloudacct-failure-action">{action.label}</Button>}
      {onDismiss && <Button size="sm" variant="ghost" onClick={onDismiss}>{t("common.close")}</Button>}
    </>
  ) : undefined;
  return (
    <Banner kind="error" rounded actions={actions}>
      <span data-testid="cloudacct-failure">
        {failure.title && <strong>{failure.title}: </strong>}
        {failure.detail}
        {failure.raw && <code className="pv-svcstat-raw">{failure.raw}</code>}
      </span>
    </Banner>
  );
};
