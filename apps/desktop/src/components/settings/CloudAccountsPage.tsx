import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Check, ChevronRight, CircleAlert, Clock, Plus, RotateCw, Trash2, Users } from "lucide-react";
import {
  Button,
  IconButton,
  Switch,
  TextInput,
  EmptyState,
  SettingCard,
  SettingCardNote,
  SettingRow,
  ICON,
  cx,
  FAMILY_SERVICES,
  accountServices,
  looksLikeNextcloud,
  nextcloudEndpoints,
  suiteProvider,
  toast,
  type AccountRepairNeed,
  type CloudAccountRecord,
  type CloudServiceId,
  type GuidedAccountRepairPlan,
} from "@plainva/ui";
import { useVault } from "../../contexts/VaultContext";
import { appConfirm } from "../../services/appDialogs";
import { credentialManager } from "../../services/CredentialManager";
import { accountSignedInHere } from "../../services/deviceSignIn";
import { getPimCredentials } from "../../services/pim/pimCredentials";
import {
  CLOUD_ACCOUNTS_EVENT,
  backfillSyncIdentity,
  backfillCalendarIdentity,
  loadCloudAccounts,
  refreshCloudAccounts,
  saveCloudAccounts,
} from "../../services/cloudAccounts";
import {
  bindConnectResult,
  disableAccountService,
  googleByoFromSlots,
  removeCloudAccount,
  rerunAccountAuth,
  canUnifyAccountLogin,
  unifyAccountLogin,
  passwordServicesOf,
  updateAccountPassword,
  runConnectSequence,
  type ConnectRequest,
  type ServiceRunStatus,
} from "../../services/cloudAccountsActions";
import { brokerFamily } from "../../services/accountBroker";
import {
  guideDesktopAccountRepair,
  loadDesktopAccountRepairNeeds,
} from "../../services/accountRepair";
import { getSettingsStore } from "../../services/settingsStore";
import { AreaHead } from "./AppPages";
import { CloudAccountsWizard } from "./CloudAccountsWizard";
import { AccountMark, SERVICE_ICONS, ServiceChip, accountTitle, familyLabel, serviceLabel } from "./cloudAccountsShared";

/**
 * The "Cloud-Konten" vault area (mockup screens 1 + 4): the ONE place where
 * providers are connected and their services are chosen. Service behavior
 * stays in the per-service areas (sync / calendar / mail).
 */

type Mode = { kind: "list" } | { kind: "wizard" } | { kind: "detail"; id: string };

export const CloudAccountsPage: React.FC<{ selectedVault: string; initialProvider?: string }> = ({
  selectedVault,
  initialProvider,
}) => {
  const { t } = useTranslation();
  const { dbAdapter, pimRuntime, vaultPath } = useVault();
  const isActiveVault = selectedVault === vaultPath;
  const runtime = isActiveVault ? pimRuntime : null;
  const [records, setRecords] = useState<CloudAccountRecord[]>([]);
  const [repairNeeds, setRepairNeeds] = useState<AccountRepairNeed[]>([]);
  // The splash "open an online vault" path deep-links here with the provider
  // the user already picked — land in the wizard on that tile, not on the list.
  const [mode, setMode] = useState<Mode>(initialProvider ? { kind: "wizard" } : { kind: "list" });
  const [reconStatus, setReconStatus] = useState<Partial<Record<CloudServiceId, ServiceRunStatus>>>({});
  const [busy, setBusy] = useState(false);
  const [newPass, setNewPass] = useState("");
  /** Accounts that still hold one refresh token per service (stage B offer). */
  const [unifiable, setUnifiable] = useState<Set<string>>(new Set());
  const backfilled = useRef(false);

  const reload = useCallback(async () => {
    const store = await getSettingsStore();
    const [next, needs] = await Promise.all([
      isActiveVault ? refreshCloudAccounts(selectedVault, runtime) : loadCloudAccounts(selectedVault),
      loadDesktopAccountRepairNeeds(store, selectedVault),
    ]);
    setRecords(next);
    setRepairNeeds(needs);
  }, [selectedVault, isActiveVault, runtime]);

  useEffect(() => {
    void reload();
    const onChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail as { vaultPath?: string } | undefined;
      if (!detail?.vaultPath || detail.vaultPath === selectedVault) void reload();
    };
    window.addEventListener(CLOUD_ACCOUNTS_EVENT, onChanged);
    return () => window.removeEventListener(CLOUD_ACCOUNTS_EVENT, onChanged);
  }, [reload, selectedVault]);

  useEffect(() => {
    if (!isActiveVault || backfilled.current) return;
    backfilled.current = true;
    // Files first, then the calendar-only card. A Google account split across two
    // cards needs BOTH sides to carry an identity before the reconcile is allowed
    // to fold them. Sequential on purpose: each step persists, and the second
    // reads what the first wrote.
    void backfillSyncIdentity(selectedVault)
      .then((next) => {
        if (next) setRecords(next);
        return backfillCalendarIdentity(selectedVault);
      })
      .then((next) => {
        if (next) setRecords(next);
      });
  }, [isActiveVault, selectedVault]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all(records.map(async (r) => ((await canUnifyAccountLogin(selectedVault, r)) ? r.id : null)))
      .then((ids) => {
        if (!cancelled) setUnifiable(new Set(ids.filter((x): x is string => !!x)));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [records, selectedVault]);

  // P2: which accounts hold a credential on THIS device. `null` entries stay
  // out of the map — a files-only account keeps its credential in the
  // provider's own slot, and the sync status answers that better than a chip.
  const [signedIn, setSignedIn] = useState<Map<string, boolean>>(new Map());
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      records.map(async (r) => [r.id, await accountSignedInHere(selectedVault, r)] as const),
    )
      .then((pairs) => {
        if (cancelled) return;
        setSignedIn(new Map(pairs.filter((p): p is readonly [string, boolean] => p[1] !== null)));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [records, selectedVault]);

  const filesAccount = records.find((r) => r.services.files);
  const detail = mode.kind === "detail" ? records.find((r) => r.id === mode.id) : undefined;

  /** Headless service enable from the detail toggles, where slots allow it. */
  const enableService = async (record: CloudAccountRecord, service: CloudServiceId) => {
    // Consent for everything this card carries, connect only what is being
    // repaired: the two families that share one account token would otherwise
    // lose the other services' access on every single-service repair
    // (finding 2026-07-30). Gmail is never part of it — it is IMAP.
    const carried = (["files", "calendar", "mail"] as CloudServiceId[]).filter(
      (s) => (s === service || record.services[s]) && !(record.family === "google" && s === "mail"),
    );
    const req: ConnectRequest = {
      family: record.family,
      flavor: record.flavor,
      services: [service],
      consentServices: brokerFamily(record.family) ? carried : [service],
      byoClientId: record.byoClientId,
    };
    if (record.family === "google") {
      const byo = await googleByoFromSlots(selectedVault, record);
      if (!byo || service === "mail") {
        toast.info(t("cloudAccounts.useWizardHint"));
        return;
      }
      req.byoClientId = byo.clientId;
      req.googleClientSecret = byo.clientSecret;
    } else if (record.family === "webdav") {
      // Derive the missing endpoint from the stored files slot (same server).
      const creds = await credentialManager.getWebDavCredentials(selectedVault);
      if (!creds || !looksLikeNextcloud(creds.url)) {
        toast.info(t("cloudAccounts.useWizardHint"));
        return;
      }
      const endpoints = nextcloudEndpoints(creds.url, creds.user);
      if (!endpoints) {
        toast.info(t("cloudAccounts.useWizardHint"));
        return;
      }
      req.webdav = { filesUrl: endpoints.files, caldavUrl: endpoints.caldav, user: creds.user, pass: creds.pass };
    } else if (suiteProvider(record.family)) {
      // App-password suites: reuse the ONE credential from an already
      // connected service of this suite (files slot or CalDAV slot) against
      // the catalog endpoints — that is the suite promise. No reusable
      // credential = wizard.
      const sd = suiteProvider(record.family)!;
      let user = "";
      let pass = "";
      if (record.services.files) {
        const creds = await credentialManager.getWebDavCredentials(selectedVault);
        if (creds) {
          user = creds.user;
          pass = creds.pass;
        }
      }
      if (!pass && record.services.calendar) {
        const pc = await getPimCredentials(selectedVault, record.services.calendar.pimAccountId);
        if (pc?.kind === "caldav") {
          user = pc.user;
          pass = pc.pass;
        }
      }
      if (!pass) {
        toast.info(t("cloudAccounts.useWizardHint"));
        return;
      }
      req.webdav = { filesUrl: sd.endpoints.webdavUrl ?? "", caldavUrl: sd.endpoints.caldavUrl ?? "", user, pass };
      if (service === "mail") {
        req.imap = {
          email: user,
          host: sd.endpoints.imapHost ?? "",
          port: sd.endpoints.imapPort ?? 993,
          smtpHost: sd.endpoints.smtpHost,
          smtpPort: sd.endpoints.smtpPort,
          pass,
        };
      }
    } else if (record.family === "imap") {
      toast.info(t("cloudAccounts.useWizardHint"));
      return;
    }
    setBusy(true);
    try {
      const result = await runConnectSequence(selectedVault, runtime, req, () => undefined);
      const { records: next } = await bindConnectResult(selectedVault, runtime, req, result, record.id);
      setRecords(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const disableService = async (record: CloudAccountRecord, service: CloudServiceId) => {
    const ok = await appConfirm({
      title: serviceLabel(service),
      message: t("cloudAccounts.serviceOffMsg", { service: serviceLabel(service) }),
      confirmLabel: t("common.confirm"),
      kind: "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      setRecords(await disableAccountService(selectedVault, runtime, record, service));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (record: CloudAccountRecord) => {
    const ok = await appConfirm({
      title: t("cloudAccounts.removeAccount"),
      message: t("cloudAccounts.removeAccountMsg"),
      confirmLabel: t("common.delete"),
      kind: "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      setRecords(await removeCloudAccount(selectedVault, runtime, record));
      setMode({ kind: "list" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const reconnect = async (record: CloudAccountRecord) => {
    setReconStatus({});
    setBusy(true);
    try {
      await rerunAccountAuth(selectedVault, runtime, record, (service, st) => setReconStatus((prev) => ({ ...prev, [service]: st })));
      toast.success(t("pim.connected"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      void reload();
    }
  };

  /**
   * Rotates the app password across EVERY password-backed service of the
   * account. Before this existed, a rotated Nextcloud/Fastmail password meant
   * removing the account and connecting each service again.
   */
  const changePassword = async (record: CloudAccountRecord) => {
    setReconStatus({});
    setBusy(true);
    try {
      await updateAccountPassword(selectedVault, runtime, record, newPass, (service, st) =>
        setReconStatus((prev) => ({ ...prev, [service]: st }))
      );
      setNewPass("");
      toast.success(t("cloudAccounts.passwordUpdated"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      void reload();
    }
  };

  /** E8: migrating to the shared broker is an OFFER, never forced. */
  const unifyLogin = async (record: CloudAccountRecord) => {
    setReconStatus({});
    setBusy(true);
    try {
      await unifyAccountLogin(selectedVault, runtime, record, (service, st) =>
        setReconStatus((prev) => ({ ...prev, [service]: st }))
      );
      toast.success(t("cloudAccounts.loginUnified"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      void reload();
    }
  };

  const persistByoId = async (record: CloudAccountRecord, value: string) => {
    const next = records.map((r) => (r.id === record.id ? { ...r, byoClientId: value.trim() || undefined } : r));
    await saveCloudAccounts(selectedVault, next);
    setRecords(next);
  };

  const serviceNames = (services: readonly CloudServiceId[]) => services
    .map((service) => serviceLabel(service))
    .join(", ");

  const confirmRepair = async (
    plan: GuidedAccountRepairPlan,
    target: CloudAccountRecord,
  ): Promise<boolean> => {
    const sourceNames = plan.merges[0].sourceIds
      .map((id) => records.find((record) => record.id === id)?.label || id)
      .join(", ");
    return appConfirm({
      title: t("cloudAccounts.repairConfirmTitle"),
      message: t("cloudAccounts.repairConfirmMessage", {
        target: target.label || familyLabel(target.family, target.flavor),
        sources: sourceNames,
        services: serviceNames(plan.merges[0].affectedServices),
      }),
      confirmLabel: t("cloudAccounts.repairConfirmAction"),
      kind: "warning",
    });
  };

  const repairAmbiguous = async (need: AccountRepairNeed, target: CloudAccountRecord) => {
    if (!isActiveVault || !runtime || !dbAdapter) return;
    setBusy(true);
    try {
      const store = await getSettingsStore();
      const result = await guideDesktopAccountRepair(
        store,
        selectedVault,
        { accountIds: need.accountIds, targetId: target.id },
        (plan) => confirmRepair(plan, target),
        runtime.cache,
        dbAdapter,
      );
      if (result.status === "repaired") {
        toast.success(t("cloudAccounts.repairDone"));
        await reload();
      }
    } catch {
      toast.error(t("cloudAccounts.repairFailed"));
    } finally {
      setBusy(false);
    }
  };

  /* ---------- wizard ---------- */
  if (mode.kind === "wizard") {
    return (
      <div>
        <AreaHead areaId="cloudAccounts" />
        <CloudAccountsWizard
          initialFamily={initialProvider}
          vaultPath={selectedVault}
          runtime={runtime}
          records={records}
          onDone={(next) => {
            setRecords(next);
            setMode({ kind: "list" });
          }}
          onCancel={() => setMode({ kind: "list" })}
        />
      </div>
    );
  }

  /* ---------- account detail (mockup screen 4) ---------- */
  if (detail) {
    const { name, identity } = accountTitle(detail);
    const available = FAMILY_SERVICES[detail.family];
    const oauthFamily = detail.family === "microsoft" || detail.family === "google" || detail.family === "dropbox";
    const hasByo = oauthFamily;
    const passwordServices = passwordServicesOf(detail);
    return (
      <div>
        <AreaHead areaId="cloudAccounts" />
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
          <IconButton label={t("cloudAccounts.back")} onClick={() => setMode({ kind: "list" })} data-testid="cloudacct-detail-back">
            <ArrowLeft size={ICON.ui} />
          </IconButton>
          <AccountMark family={detail.family} flavor={detail.flavor} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="pv-acct-name">{name}</div>
            {identity && <div className="pv-acct-id">{identity}</div>}
          </div>
          {unifiable.has(detail.id) && (
            <Button
              variant="secondary"
              icon={<RotateCw size={ICON.meta} />}
              disabled={busy || !isActiveVault}
              onClick={() => void unifyLogin(detail)}
              data-testid="cloudacct-unify"
            >
              {t("cloudAccounts.unifyLogin")}
            </Button>
          )}
          {oauthFamily && !unifiable.has(detail.id) && (
            <Button variant="secondary" icon={<RotateCw size={ICON.meta} />} disabled={busy} onClick={() => void reconnect(detail)} data-testid="cloudacct-reconnect">
              {t("cloudAccounts.reconnect")}
            </Button>
          )}
          <Button variant="danger-soft" icon={<Trash2 size={ICON.meta} />} disabled={busy} onClick={() => void remove(detail)} data-testid="cloudacct-remove">
            {t("cloudAccounts.removeAccount")}
          </Button>
        </div>

        {Object.keys(reconStatus).length > 0 && (
          <SettingCard>
            {(Object.keys(reconStatus) as CloudServiceId[]).map((service) => {
              const st = reconStatus[service];
              const kind = st?.state === "ok" ? "ok" : st?.state === "error" ? "err" : "wait";
              const Icon = kind === "ok" ? Check : kind === "err" ? CircleAlert : Clock;
              return (
                <div key={service} className={`pv-svcstat pv-svcstat--${kind}`}>
                  <span className="pv-svcstat-icon">
                    <Icon size={ICON.ui} />
                  </span>
                  <span className="pv-svcstat-label">{serviceLabel(service)}</span>
                  <span className="pv-svcstat-sub">{st?.state === "ok" ? t("cloudAccounts.statusConnected") : (st?.detail ?? t("pim.connecting"))}</span>
                </div>
              );
            })}
          </SettingCard>
        )}

        <SettingCard label={t("cloudAccounts.servicesGroup")}>
          {available.map((service) => {
            const Icon = SERVICE_ICONS[service];
            const active = accountServices(detail).includes(service);
            const takenElsewhere = service === "files" && !active && !!filesAccount;
            const needsRuntime = service === "calendar" && !runtime;
            const disabled = busy || takenElsewhere || needsRuntime || !isActiveVault;
            return (
              <div key={service} className={cx("pv-svcline", (takenElsewhere || (!active && needsRuntime)) && "is-off")}>
                <span className="pv-svcline-icon">
                  <Icon size={ICON.ui} />
                </span>
                <div className="pv-svcline-main">
                  <div className="pv-svcline-title">{serviceLabel(service)}</div>
                  <div className="pv-svcline-desc">
                    {takenElsewhere
                      ? t("cloudAccounts.filesTakenDetail", { account: filesAccount!.label || familyLabel(filesAccount!.family, filesAccount!.flavor) })
                      : needsRuntime && !active
                        ? t("pim.openVaultFirst")
                        : active
                          ? service === "files"
                            ? t("cloudAccounts.svcConfigureSync")
                            : service === "calendar"
                              ? t("cloudAccounts.calendarNext")
                              : t("cloudAccounts.svcConfigureMail")
                          : service === "files"
                            ? t("cloudAccounts.svcFilesDesc")
                            : service === "calendar"
                              ? t("cloudAccounts.svcCalendarDesc")
                              : t("cloudAccounts.svcMailDesc")}
                  </div>
                </div>
                <div className="pv-svcline-ctrl">
                  <Switch
                    checked={active}
                    disabled={disabled}
                    label={serviceLabel(service)}
                    onChange={(checked) => {
                      if (checked) void enableService(detail, service);
                      else void disableService(detail, service);
                    }}
                  />
                </div>
              </div>
            );
          })}
        </SettingCard>

        {passwordServices.length > 0 && (
          <SettingCard label={t("cloudAccounts.credentialsGroup")}>
            <SettingRow label={t("cloudAccounts.newPassword")} desc={t("cloudAccounts.newPasswordDesc")}>
              <div style={{ display: "flex", gap: "var(--space-2)" }}>
                <TextInput
                  type="password"
                  value={newPass}
                  onChange={(e) => setNewPass(e.target.value)}
                  placeholder={t("settings.password")}
                  style={{ width: 220 }}
                  data-testid="cloudacct-new-password"
                />
                <Button
                  variant="secondary"
                  disabled={busy || !newPass.trim() || !isActiveVault}
                  onClick={() => void changePassword(detail)}
                  data-testid="cloudacct-update-password"
                >
                  {t("cloudAccounts.updatePassword")}
                </Button>
              </div>
            </SettingRow>
          </SettingCard>
        )}

        {hasByo && (
          <SettingCard label={t("cloudAccounts.appRegGroup")}>
            {/* Google has NO central Plainva app — BYO is required, not optional. */}
            <SettingRow
              label={t("settings.useOwnAppId")}
              desc={detail.family === "google" ? t("cloudAccounts.byoAccountHintGoogle") : t("cloudAccounts.byoAccountHint")}
            >
              <TextInput
                defaultValue={detail.byoClientId ?? ""}
                placeholder={detail.family === "dropbox" ? t("settings.appKey") : t("settings.clientId")}
                onBlur={(e) => void persistByoId(detail, e.target.value)}
                style={{ width: 220 }}
                data-testid="cloudacct-byo-id"
              />
            </SettingRow>
          </SettingCard>
        )}
      </div>
    );
  }

  /* ---------- account list (mockup screen 1) ---------- */
  return (
    <div>
      <AreaHead areaId="cloudAccounts" />
      {!isActiveVault && <SettingCardNote className="pv-setrow--note">{t("pim.openVaultFirst")}</SettingCardNote>}
      {repairNeeds.length > 0 && (
        <SettingCard label={t("cloudAccounts.repairTitle")}>
          <SettingCardNote>{t("cloudAccounts.repairHint")}</SettingCardNote>
          {repairNeeds.flatMap((need, needIndex) =>
            need.accountIds.map((accountId) => {
              const record = records.find((candidate) => candidate.id === accountId);
              if (!record) return [];
              return (
                <SettingRow
                  key={`${needIndex}:${accountId}`}
                  label={record.label || familyLabel(record.family, record.flavor)}
                  desc={serviceNames(accountServices(record))}
                >
                  <Button
                    variant="secondary"
                    disabled={busy || !isActiveVault || !runtime || !dbAdapter}
                    onClick={() => void repairAmbiguous(need, record)}
                    data-testid="cloudacct-repair-target"
                  >
                    {t("cloudAccounts.repairKeep")}
                  </Button>
                </SettingRow>
              );
            }),
          )}
        </SettingCard>
      )}
      <SettingCard label={t("cloudAccounts.connectedGroup")}>
        {records.length === 0 && (
          <EmptyState title={t("cloudAccounts.noneYet")} icon={<Users size={ICON.empty} />}>
            {t("settings.pageDescCloudAccounts")}
          </EmptyState>
        )}
        {records.map((record) => {
          const { name, identity } = accountTitle(record);
          return (
            <button
              key={record.id}
              type="button"
              className="pv-acct"
              onClick={() => {
                setReconStatus({});
                setMode({ kind: "detail", id: record.id });
              }}
              data-testid="cloudacct-row"
            >
              <AccountMark family={record.family} flavor={record.flavor} />
              <div className="pv-acct-who">
                <div className="pv-acct-name">{name}</div>
                <div className="pv-acct-id">{identity ?? familyLabel(record.family, record.flavor)}</div>
              </div>
              <span className="pv-svcchip-row">
                {accountServices(record).map((s) => (
                  <ServiceChip key={s} service={s} />
                ))}
                {/* Until now this offer only existed inside the account detail,
                    so nobody found it who was not already looking. An account
                    holding one token per service is the one that goes half-dead
                    when a single renewal happens (finding 2026-07-28). */}
                {unifiable.has(record.id) && (
                  <span className="pv-svcchip" data-testid="cloudacct-unify-hint">
                    {t("cloudAccounts.unifyAvailable")}
                  </span>
                )}
                {/* P2: an account that arrived over the settings sync looks
                    complete while nothing behind it works — its sign-in never
                    travels. Saying so here is what turns a puzzling empty
                    calendar into one obvious next step. */}
                {signedIn.get(record.id) === false && (
                  <span className="pv-svcchip" data-testid="cloudacct-signin-hint">
                    {t("deviceSignIn.notSignedIn")}
                  </span>
                )}
              </span>
              <span className="pv-acct-chevron">
                <ChevronRight size={ICON.ui} />
              </span>
            </button>
          );
        })}
        {filesAccount && (
          <SettingCardNote>
            {t("cloudAccounts.filesXorNote", { account: filesAccount.label || familyLabel(filesAccount.family, filesAccount.flavor) })}
          </SettingCardNote>
        )}
      </SettingCard>
      <div style={{ marginTop: "var(--space-3)" }}>
        <Button
          variant="primary"
          icon={<Plus size={ICON.meta} />}
          disabled={!isActiveVault}
          onClick={() => setMode({ kind: "wizard" })}
          data-testid="cloudacct-add"
        >
          {t("cloudAccounts.addAccount")}
        </Button>
      </div>
    </div>
  );
};
