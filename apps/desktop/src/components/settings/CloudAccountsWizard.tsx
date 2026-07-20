import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, CircleAlert, Clock } from "lucide-react";
import {
  Button,
  TextInput,
  Checkbox,
  SettingCard,
  SettingCardNote,
  SettingRow,
  ICON,
  cx,
  FAMILY_SERVICES,
  nextcloudEndpoints,
  toast,
  type CloudAccountRecord,
  type CloudProviderFamily,
  type CloudServiceId,
} from "@plainva/ui";
import { Select } from "../Select";
import { MAIL_PRESETS, presetById, presetForEmail } from "../../services/mail/mailPresets";
import {
  runConnectSequence,
  bindConnectResult,
  listSyncFoldersFromSlots,
  getSyncRootFolder,
  saveSyncRootFolder,
  type ConnectRequest,
  type ConnectResult,
  type ServiceRunStatus,
} from "../../services/cloudAccountsActions";
import type { PimRuntime } from "../../services/pim/pimRuntime";
import { SyncFolderPickerModal } from "../SyncFolderPickerModal";
import { AccountMark, SERVICE_ICONS, familyLabel, serviceLabel } from "./cloudAccountsShared";

/**
 * The "Konto verbinden" flow (mockup screens 2–3): provider tiles → service
 * checks (the selection drives which permissions get requested) → sign-in with
 * an honest per-service status. Runs inline on the Cloud-Konten page.
 */

interface WizardProps {
  vaultPath: string;
  runtime: PimRuntime | null;
  records: CloudAccountRecord[];
  onDone: (records: CloudAccountRecord[]) => void;
  onCancel: () => void;
}

interface ProviderTileDef {
  key: string;
  family: CloudProviderFamily;
  flavor?: "nextcloud";
}

const TILES: ProviderTileDef[] = [
  { key: "microsoft", family: "microsoft" },
  { key: "google", family: "google" },
  { key: "nextcloud", family: "webdav", flavor: "nextcloud" },
  { key: "dropbox", family: "dropbox" },
  { key: "s3", family: "s3" },
  { key: "webdav", family: "webdav" },
  { key: "imap", family: "imap" },
];

const SERVICE_ORDER: CloudServiceId[] = ["files", "calendar", "mail"];

export const CloudAccountsWizard: React.FC<WizardProps> = ({ vaultPath, runtime, records, onDone, onCancel }) => {
  const { t } = useTranslation();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [tile, setTile] = useState<ProviderTileDef | null>(null);
  const [svc, setSvc] = useState<Record<CloudServiceId, boolean>>({ files: false, calendar: false, mail: false });
  const [byoOpen, setByoOpen] = useState(false);
  const [byoId, setByoId] = useState("");
  const [googleSecret, setGoogleSecret] = useState("");
  const [wd, setWd] = useState({ base: "", user: "", pass: "", advanced: false, filesUrl: "", caldavUrl: "" });
  const [s3, setS3] = useState({ endpoint: "", region: "", bucket: "", accessKeyId: "", secretKey: "", prefix: "", pathStyle: true });
  const [imap, setImap] = useState({ email: "", presetId: "custom", host: "", port: "993", smtpHost: "", smtpPort: "587", pass: "" });
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<Partial<Record<CloudServiceId, ServiceRunStatus>>>({});
  const [result, setResult] = useState<ConnectResult>({});
  const [bound, setBound] = useState<CloudAccountRecord[] | null>(null);
  const [rootFolder, setRootFolder] = useState("");
  const [showFolderPicker, setShowFolderPicker] = useState(false);

  const family = tile?.family ?? null;
  const available = family ? FAMILY_SERVICES[family] : [];
  const filesTakenBy = records.find((r) => r.services.files);
  const selected = SERVICE_ORDER.filter((s) => svc[s] && available.includes(s));
  const allDone = selected.length > 0 && selected.every((s) => status[s]?.state === "ok");
  const failed = selected.some((s) => status[s]?.state === "error");

  const pickTile = (def: ProviderTileDef) => {
    setTile(def);
    const services = FAMILY_SERVICES[def.family];
    setSvc({
      files: services.includes("files") && !filesTakenBy,
      calendar: services.includes("calendar") && !!runtime,
      mail: services.includes("mail"),
    });
    setWd((w) => ({ ...w, advanced: def.family === "webdav" && !def.flavor }));
    if (def.family === "google") setImap((m) => ({ ...m, presetId: "gmail", host: "imap.gmail.com", port: "993", smtpHost: "smtp.gmail.com", smtpPort: "587" }));
    setStep(2);
  };

  const applyMailPreset = (id: string, email: string) => {
    const preset = id === "custom" ? presetForEmail(email) : presetById(id);
    setImap((m) => ({
      ...m,
      presetId: preset ? preset.id : "custom",
      host: preset ? preset.host : m.host,
      port: preset ? String(preset.port) : m.port,
      smtpHost: preset ? preset.smtpHost : m.smtpHost,
      smtpPort: preset ? String(preset.smtpPort) : m.smtpPort,
    }));
  };

  const buildRequest = (services: CloudServiceId[]): ConnectRequest => {
    const endpoints = wd.advanced ? { files: wd.filesUrl.trim(), caldav: wd.caldavUrl.trim() } : nextcloudEndpoints(wd.base, wd.user) ?? { files: "", caldav: "" };
    return {
      family: family!,
      flavor: tile?.flavor,
      services,
      byoClientId: byoOpen || family === "google" ? byoId.trim() || undefined : undefined,
      googleClientSecret: family === "google" ? googleSecret : undefined,
      webdav: family === "webdav" ? { filesUrl: endpoints.files, caldavUrl: endpoints.caldav, user: wd.user.trim(), pass: wd.pass } : undefined,
      s3:
        family === "s3"
          ? {
              endpoint: s3.endpoint.trim(),
              region: s3.region.trim() || "us-east-1",
              bucket: s3.bucket.trim(),
              accessKeyId: s3.accessKeyId.trim(),
              secretAccessKey: s3.secretKey,
              prefix: s3.prefix.trim() || undefined,
              forcePathStyle: s3.pathStyle,
            }
          : undefined,
      imap:
        family === "imap" || (family === "google" && services.includes("mail"))
          ? {
              email: imap.email.trim(),
              host: imap.host.trim(),
              port: Number(imap.port) || 993,
              smtpHost: imap.smtpHost.trim() || undefined,
              smtpPort: Number(imap.smtpPort) || undefined,
              pass: imap.pass,
            }
          : undefined,
    };
  };

  const run = async () => {
    // Retry semantics: only services that are not OK yet run (again).
    const todo = selected.filter((s) => status[s]?.state !== "ok");
    if (todo.length === 0) return;
    setRunning(true);
    const merged: ConnectResult = { ...result };
    try {
      const req = buildRequest(todo);
      const res = await runConnectSequence(vaultPath, runtime, req, (service, st) => setStatus((prev) => ({ ...prev, [service]: st })));
      Object.assign(merged, res);
    } catch (err) {
      const partial = (err as { partialResult?: ConnectResult }).partialResult;
      if (partial) Object.assign(merged, partial);
    } finally {
      setResult(merged);
      // Bind whatever connected — a half-finished wizard must not lose services.
      if (merged.filesProvider || merged.pimAccountId || merged.mailAccountId) {
        try {
          const next = await bindConnectResult(vaultPath, runtime, buildRequest(selected), merged);
          setBound(next);
          if (merged.filesProvider && merged.filesProvider !== "webdav") {
            setRootFolder(await getSyncRootFolder(vaultPath, merged.filesProvider));
          }
          if (merged.pimAccountId && runtime) {
            const cals = await runtime.cache.listCalendars(merged.pimAccountId);
            setStatus((prev) =>
              prev.calendar?.state === "ok"
                ? { ...prev, calendar: { state: "ok", detail: t("cloudAccounts.calendarsFound", { count: cals.length }) } }
                : prev
            );
          }
        } catch (err) {
          toast.error(err instanceof Error ? err.message : String(err));
        }
      }
      setRunning(false);
    }
  };

  const finish = () => {
    if (bound) onDone(bound);
    else onCancel();
  };

  const stepChip = (n: 1 | 2 | 3, label: string) => (
    <span className={cx("pv-wizstep", step === n && "is-active", step > n && "is-done")}>
      <span className="pv-wizstep-num">{step > n ? "✓" : n}</span>
      {label}
    </span>
  );

  const steps = (
    <div className="pv-wizsteps" style={{ marginBottom: "var(--space-3)" }}>
      {stepChip(1, tile ? familyLabel(tile.family, tile.flavor) : t("cloudAccounts.stepProvider"))}
      <span className="pv-wizstep-arrow">›</span>
      {stepChip(2, t("cloudAccounts.stepServices"))}
      <span className="pv-wizstep-arrow">›</span>
      {stepChip(3, t("cloudAccounts.stepSignIn"))}
    </div>
  );

  /* ---------- step 1: provider tiles ---------- */
  if (step === 1) {
    return (
      <div>
        {steps}
        <div className="pv-provtile-grid">
          {TILES.map((def) => (
            <button
              key={def.key}
              type="button"
              className={cx("pv-provtile", tile?.key === def.key && "is-active")}
              onClick={() => pickTile(def)}
              data-testid={`cloudacct-provider-${def.key}`}
            >
              <AccountMark family={def.family} flavor={def.flavor} small />
              <span className="pv-provtile-name">{familyLabel(def.family, def.flavor)}</span>
              <span className="pv-provtile-caps">
                {FAMILY_SERVICES[def.family].map((s) => {
                  const Icon = SERVICE_ICONS[s];
                  return <Icon key={s} size={ICON.meta} />;
                })}
              </span>
            </button>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
          <Button variant="ghost" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
        </div>
      </div>
    );
  }

  /* ---------- step 2: service selection ---------- */
  if (step === 2 && family) {
    return (
      <div>
        {steps}
        <SettingCard>
          {available.map((service) => {
            const Icon = SERVICE_ICONS[service];
            const takenByOther = service === "files" && !!filesTakenBy;
            const needsRuntime = service === "calendar" && !runtime;
            const disabled = takenByOther || needsRuntime;
            return (
              <div key={service} className={cx("pv-svcline", disabled && "is-off")}>
                <span className="pv-svcline-icon">
                  <Icon size={ICON.ui} />
                </span>
                <div className="pv-svcline-main">
                  <div className="pv-svcline-title">
                    {serviceLabel(service)}
                    {takenByOther && (
                      <span className="pv-svcchip pv-svcchip--off">
                        {t("cloudAccounts.filesTaken", { account: filesTakenBy!.label || familyLabel(filesTakenBy!.family, filesTakenBy!.flavor) })}
                      </span>
                    )}
                    {service === "mail" && family === "google" && <span className="pv-svcchip pv-svcchip--off">{t("cloudAccounts.appPasswordBadge")}</span>}
                  </div>
                  <div className="pv-svcline-desc">
                    {takenByOther
                      ? t("cloudAccounts.filesTakenDetail", { account: filesTakenBy!.label || familyLabel(filesTakenBy!.family, filesTakenBy!.flavor) })
                      : needsRuntime
                        ? t("pim.openVaultFirst")
                        : service === "files"
                          ? t("cloudAccounts.svcFilesDesc")
                          : service === "calendar"
                            ? t("cloudAccounts.svcCalendarDesc")
                            : t("cloudAccounts.svcMailDesc")}
                  </div>
                </div>
                <div className="pv-svcline-ctrl">
                  <Checkbox
                    checked={svc[service]}
                    disabled={disabled}
                    onChange={(e) => setSvc((prev) => ({ ...prev, [service]: e.target.checked }))}
                    aria-label={serviceLabel(service)}
                    data-testid={`cloudacct-svc-${service}`}
                  />
                </div>
              </div>
            );
          })}
          {family === "google" && svc.mail && <SettingCardNote>{t("cloudAccounts.gmailHint")}</SettingCardNote>}
          <SettingCardNote>{t("cloudAccounts.servicesHint")}</SettingCardNote>
        </SettingCard>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
          <Button variant="ghost" onClick={() => setStep(1)}>
            {t("cloudAccounts.back")}
          </Button>
          <Button variant="primary" disabled={selected.length === 0} onClick={() => setStep(3)} data-testid="cloudacct-to-signin">
            {t("cloudAccounts.stepSignIn")}
          </Button>
        </div>
      </div>
    );
  }

  /* ---------- step 3: sign in / connect ---------- */
  const endpoints = !wd.advanced ? nextcloudEndpoints(wd.base, wd.user) : null;
  const oauthFamily = family === "microsoft" || family === "dropbox";
  const needsImapForm = family === "imap" || (family === "google" && svc.mail);
  const connectDisabled =
    running ||
    (family === "google" && (!byoId.trim() || !googleSecret.trim())) ||
    (family === "webdav" && (wd.advanced ? !(svc.files ? wd.filesUrl.trim() : true) || !(svc.calendar ? wd.caldavUrl.trim() : true) : !wd.base.trim()) ) ||
    (family === "webdav" && (!wd.user.trim() || !wd.pass)) ||
    (family === "s3" && (!s3.endpoint.trim() || !s3.bucket.trim() || !s3.accessKeyId.trim() || !s3.secretKey)) ||
    (needsImapForm && (!imap.email.trim() || !imap.host.trim() || !imap.pass));

  return (
    <div>
      {steps}
      {/* family-specific inputs */}
      {family === "google" && (
        <SettingCard>
          <SettingRow label={t("settings.clientId")} wide>
            <TextInput value={byoId} onChange={(e) => setByoId(e.target.value)} data-testid="cloudacct-google-id" />
          </SettingRow>
          <SettingRow label={t("settings.clientSecret")} wide>
            <TextInput type="password" value={googleSecret} onChange={(e) => setGoogleSecret(e.target.value)} />
          </SettingRow>
          <SettingCardNote>{t("pim.googleByoHint")}</SettingCardNote>
        </SettingCard>
      )}
      {family === "webdav" && (
        <SettingCard>
          {!wd.advanced && (
            <SettingRow label={t("cloudAccounts.serverAddress")} wide>
              <TextInput value={wd.base} onChange={(e) => setWd({ ...wd, base: e.target.value })} placeholder="https://cloud.example.com" data-testid="cloudacct-wd-base" />
            </SettingRow>
          )}
          {wd.advanced && svc.files && (
            <SettingRow label={t("cloudAccounts.endpointFiles")} wide>
              <TextInput value={wd.filesUrl} onChange={(e) => setWd({ ...wd, filesUrl: e.target.value })} />
            </SettingRow>
          )}
          {wd.advanced && svc.calendar && (
            <SettingRow label={t("cloudAccounts.endpointCalendar")} wide>
              <TextInput value={wd.caldavUrl} onChange={(e) => setWd({ ...wd, caldavUrl: e.target.value })} />
            </SettingRow>
          )}
          <SettingRow label={t("settings.username")} wide>
            <TextInput value={wd.user} onChange={(e) => setWd({ ...wd, user: e.target.value })} data-testid="cloudacct-wd-user" />
          </SettingRow>
          <SettingRow label={t("pim.davPass")} wide>
            <TextInput type="password" value={wd.pass} onChange={(e) => setWd({ ...wd, pass: e.target.value })} data-testid="cloudacct-wd-pass" />
          </SettingRow>
          {!wd.advanced && endpoints && (
            <>
              {svc.files && (
                <div className="pv-svcstat pv-svcstat--ok">
                  <span className="pv-svcstat-icon"><Check size={ICON.ui} /></span>
                  <span className="pv-svcstat-label">{t("cloudAccounts.endpointFiles")}</span>
                  <span className="pv-svcstat-sub">{t("cloudAccounts.endpointAuto")}</span>
                </div>
              )}
              {svc.calendar && (
                <div className="pv-svcstat pv-svcstat--ok">
                  <span className="pv-svcstat-icon"><Check size={ICON.ui} /></span>
                  <span className="pv-svcstat-label">{t("cloudAccounts.endpointCalendar")}</span>
                  <span className="pv-svcstat-sub">{t("cloudAccounts.endpointAuto")}</span>
                </div>
              )}
            </>
          )}
          <SettingCardNote>
            <button type="button" className="pv-linkbtn" onClick={() => setWd({ ...wd, advanced: !wd.advanced })}>
              {wd.advanced ? t("cloudAccounts.simpleEndpoints") : t("cloudAccounts.advancedEndpoints")}
            </button>
          </SettingCardNote>
        </SettingCard>
      )}
      {family === "s3" && (
        <SettingCard>
          <SettingRow label={t("settings.s3Endpoint")} wide>
            <TextInput value={s3.endpoint} onChange={(e) => setS3({ ...s3, endpoint: e.target.value })} />
          </SettingRow>
          <SettingRow label={t("settings.s3Bucket")} wide>
            <TextInput value={s3.bucket} onChange={(e) => setS3({ ...s3, bucket: e.target.value })} />
          </SettingRow>
          <SettingRow label={t("settings.s3Region")} wide>
            <TextInput value={s3.region} onChange={(e) => setS3({ ...s3, region: e.target.value })} />
          </SettingRow>
          <SettingRow label={t("settings.s3AccessKeyId")} wide>
            <TextInput value={s3.accessKeyId} onChange={(e) => setS3({ ...s3, accessKeyId: e.target.value })} />
          </SettingRow>
          <SettingRow label={t("settings.s3SecretAccessKey")} wide>
            <TextInput type="password" value={s3.secretKey} onChange={(e) => setS3({ ...s3, secretKey: e.target.value })} />
          </SettingRow>
          <SettingRow label={t("settings.s3Prefix")} wide>
            <TextInput value={s3.prefix} onChange={(e) => setS3({ ...s3, prefix: e.target.value })} />
          </SettingRow>
          <SettingRow label={t("settings.s3PathStyle")}>
            <Checkbox checked={s3.pathStyle} onChange={(e) => setS3({ ...s3, pathStyle: e.target.checked })} aria-label={t("settings.s3PathStyle")} />
          </SettingRow>
        </SettingCard>
      )}
      {needsImapForm && (
        <SettingCard>
          <SettingRow label={t("mail.emailAddress")} wide>
            <TextInput
              value={imap.email}
              onChange={(e) => {
                const email = e.target.value;
                setImap((m) => ({ ...m, email }));
                if (family !== "google") applyMailPreset("custom", email);
              }}
              data-testid="cloudacct-imap-email"
            />
          </SettingRow>
          {family !== "google" && (
            <SettingRow label={t("mail.provider")}>
              <Select
                value={imap.presetId}
                onChange={(v) => applyMailPreset(v, imap.email)}
                options={[...MAIL_PRESETS.map((p) => ({ value: p.id, label: p.label })), { value: "custom", label: t("mail.customProvider") }]}
                ariaLabel={t("mail.provider")}
              />
            </SettingRow>
          )}
          {family !== "google" && (
            <>
              <SettingRow label={t("cloudAccounts.imapHost")} wide>
                <TextInput value={imap.host} onChange={(e) => setImap({ ...imap, host: e.target.value })} />
              </SettingRow>
              <SettingRow label={t("mail.imapPort")}>
                <TextInput value={imap.port} onChange={(e) => setImap({ ...imap, port: e.target.value })} style={{ width: 90 }} />
              </SettingRow>
              <SettingRow label={t("cloudAccounts.smtpHost")} wide>
                <TextInput value={imap.smtpHost} onChange={(e) => setImap({ ...imap, smtpHost: e.target.value })} />
              </SettingRow>
              <SettingRow label={t("mail.smtpPort")}>
                <TextInput value={imap.smtpPort} onChange={(e) => setImap({ ...imap, smtpPort: e.target.value })} style={{ width: 90 }} />
              </SettingRow>
            </>
          )}
          <SettingRow label={t("pim.davPass")} wide>
            <TextInput type="password" value={imap.pass} onChange={(e) => setImap({ ...imap, pass: e.target.value })} data-testid="cloudacct-imap-pass" />
          </SettingRow>
          {family === "google" && <SettingCardNote>{t("cloudAccounts.gmailHint")}</SettingCardNote>}
        </SettingCard>
      )}

      {/* per-service status */}
      {selected.length > 0 && (
        <SettingCard className="pv-setgroup">
          {selected.map((service) => {
            const st = status[service];
            const kind = st?.state === "ok" ? "ok" : st?.state === "error" ? "err" : "wait";
            const Icon = kind === "ok" ? Check : kind === "err" ? CircleAlert : Clock;
            return (
              <div key={service} className={`pv-svcstat pv-svcstat--${kind}`} data-testid={`cloudacct-status-${service}`}>
                <span className="pv-svcstat-icon">
                  <Icon size={ICON.ui} />
                </span>
                <span className="pv-svcstat-label">{serviceLabel(service)}</span>
                <span className="pv-svcstat-sub">
                  {st?.state === "ok"
                    ? (st.detail ?? t("cloudAccounts.statusConnected"))
                    : st?.state === "error"
                      ? st.detail
                      : st?.state === "pending"
                        ? t("pim.connecting")
                        : t("cloudAccounts.statusWaiting")}
                </span>
              </div>
            );
          })}
          {allDone && result.filesProvider && result.filesProvider !== "webdav" && (
            <SettingRow label={t("cloudAccounts.cloudFolder")} desc={t("cloudAccounts.cloudFolderHint")}>
              <TextInput value={rootFolder} readOnly style={{ width: 160 }} />
              <Button variant="secondary" onClick={() => setShowFolderPicker(true)}>
                {t("settings.browseFolders")}
              </Button>
            </SettingRow>
          )}
          {allDone && svc.calendar && <SettingCardNote>{t("cloudAccounts.calendarNext")}</SettingCardNote>}
        </SettingCard>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
        {!allDone && (
          <Button variant="ghost" disabled={running} onClick={() => setStep(2)}>
            {t("cloudAccounts.back")}
          </Button>
        )}
        {!allDone && (
          <Button variant="primary" disabled={connectDisabled} onClick={() => void run()} data-testid="cloudacct-connect">
            {running
              ? t("pim.connecting")
              : failed
                ? t("cloudAccounts.retry")
                : oauthFamily
                  ? family === "microsoft"
                    ? t("cloudAccounts.signInMicrosoft")
                    : t("cloudAccounts.signInDropbox")
                  : family === "google" && (svc.files || svc.calendar)
                    ? t("cloudAccounts.signInGoogle")
                    : t("pim.connect")}
          </Button>
        )}
        {allDone && (
          <Button variant="primary" onClick={finish} data-testid="cloudacct-finish">
            {t("cloudAccounts.finish")}
          </Button>
        )}
      </div>

      {oauthFamily && !allDone && (
        <SettingCardNote>
          <button type="button" className="pv-linkbtn" onClick={() => setByoOpen((v) => !v)}>
            {t("settings.useOwnAppId")}
          </button>
          {byoOpen && (
            <div style={{ marginTop: "var(--space-2)", maxWidth: 360 }}>
              <TextInput
                value={byoId}
                onChange={(e) => setByoId(e.target.value)}
                placeholder={family === "dropbox" ? t("settings.appKey") : t("settings.clientId")}
              />
            </div>
          )}
        </SettingCardNote>
      )}
      {!allDone && <SettingCardNote>{t("cloudAccounts.sequenceHint")}</SettingCardNote>}

      {showFolderPicker && result.filesProvider && (
        <SyncFolderPickerModal
          listFolders={(p) => listSyncFoldersFromSlots(vaultPath, result.filesProvider!, p)}
          rootLabel={familyLabel(family!, tile?.flavor)}
          allowRoot={result.filesProvider === "s3"}
          onSelect={(picked) => {
            setShowFolderPicker(false);
            void saveSyncRootFolder(vaultPath, result.filesProvider!, picked).then(() =>
              getSyncRootFolder(vaultPath, result.filesProvider!).then(setRootFolder)
            );
          }}
          onCancel={() => setShowFolderPicker(false)}
        />
      )}
    </div>
  );
};
