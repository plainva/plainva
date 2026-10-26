import { useCallback, useEffect, useRef, useState } from "react";
import { devicePermissionKey } from "../services/pim/devicePermission";
import { devicePimAuthorization, devicePimHasReminders, isDevicePimSupported, openDevicePimSettings, type DevicePimStatus } from "../platform/devicePim";
import { useTranslation } from "react-i18next";
import { Activity, CalendarDays, ChevronRight, Folder, KeyRound, ListChecks, LogOut, Mail, Merge, Server, Trash2, User } from "lucide-react";
import {
  AccountPasswordChangePanel,
  accessLineText,
  accessProblemKey,
  accountMonogram,
  accountPageModel,
  accountStateKey,
  manualMergeCandidates,
  Banner,
  Button,
  cx,
  familyLabel,
  GroupCard,
  hasStoredAccountGrant,
  ICON,
  isOwnClientRejected,
  passwordServicesOf,
  removeAccountConfirm,
  Row,
  RowList,
  SectionLabel,
  serviceLabel,
  standardAccessAvailable,
  Switch,
  toast,
  type CloudAccountRecord,
  type CloudProviderFamily,
  type CloudServiceId,
  type ServiceCheck,
} from "@plainva/ui";
import { MAIL_CHANGED_EVENT } from "../services/mail/mailRuntime";
import { loadAccountCards, type AccountCard } from "../services/cloudAccountCards";
import { mobilePasswordChangePorts } from "../services/accountPassword";
import { canUnifyMobileAccount, getAccountLoginStatus, ACCOUNT_LOGIN_STATUS_EVENT, type AccountLoginStatus } from "../services/accountLogin";
import { AccessUnavailableError, beginMobileSignIn, deviceAccess, readDeviceAccess, saveDeviceAccess } from "../services/accountSignIn";
import { connectionFailureToast, toastConnectionFailure } from "../services/connectionToast";
import { devicePlatform } from "../services/devicePlatform";
import { getAccountToken } from "../services/accountBroker";
import { removeMobileAccount, signOutMobileAccountHere } from "../services/accountSignOut";
import { ensureCardRecord, readMobileAccountFacts, setMobileAppKey, setMobileServiceOff, type MobileAccountFacts } from "../services/accountPageFacts";
import { mConfirm, mPrompt, mTargets } from "../services/mobileDialogs";
import { guideMobileAccountRepair } from "../services/accountRepair";
import { loadCloudAccounts } from "../services/cloudAccountsStore";
import { AccountAccessSheet } from "../components/AccountAccessSheet";
import { AccountCheckSheet } from "../components/AccountCheckSheet";
import { AppBar } from "../components/AppBar";

/**
 * One account (plan "Verbinden", V2) - the same five sections in the same
 * order for every provider, as on the desktop: the head with ONE state and at
 * most one button, the services with their switch and the way to this
 * account's settings of each, how this phone signs in, "Check connection",
 * and the end - "Sign out on this device" and "Remove account". What a
 * provider cannot do is missing; it is never placed somewhere else.
 *
 * The model of the page is shared (`accountPageModel`); this screen draws it.
 */

const SERVICE_ICON: Record<CloudServiceId, typeof Folder> = {
  files: Folder,
  calendar: CalendarDays,
  mail: Mail,
};

function Mark({ family }: { family: CloudProviderFamily }) {
  return (
    <span aria-hidden className={`m-acctmark m-acctmark--${family}`}>
      {accountMonogram(family)}
    </span>
  );
}

/** The last check per card in this session, for the line of section 4. */
const lastChecks = new Map<string, { time: string; ok: boolean }>();

export function CloudAccountDetailScreen({
  accountKey,
  onBack,
  onOpenService,
  onAddService,
  onReconnectVault,
  onAppPassword,
}: {
  accountKey: string;
  onBack: () => void;
  /** Level 3: one service page of THIS account. */
  onOpenService: (card: AccountCard, service: CloudServiceId) => void;
  onAddService: (card: AccountCard, service: CloudServiceId) => void;
  /** Signs a Dropbox vault in again through the provider. */
  onReconnectVault: (vaultId: string) => void;
  /** Gmail through an app password, where Google refuses it (E7). */
  onAppPassword: (card: AccountCard) => void;
}) {
  const { t } = useTranslation();
  const [card, setCard] = useState<AccountCard | null>(null);
  const [unifiable, setUnifiable] = useState(false);
  /** This phone holds a sign-in for the card it could drop. */
  const [signedInHere, setSignedInHere] = useState(false);
  /** The other cards of this provider the person may name "the same account" (E3/E6). */
  const [mergeCandidates, setMergeCandidates] = useState<CloudAccountRecord[]>([]);
  const [facts, setFacts] = useState<MobileAccountFacts | null>(null);
  const [ready, setReady] = useState(false);
  const [loginVaultId, setLoginVaultId] = useState<string | null>(null);
  const [loginStatus, setLoginStatus] = useState<AccountLoginStatus | undefined>();
  const [busy, setBusy] = useState(false);
  const loadGeneration = useRef(0);

  const reload = useCallback(() => {
    const turn = ++loadGeneration.current;
    void loadAccountCards()
      .then(async ({ cards }) => {
        const found = cards.find((c) => c.key === accountKey) ?? null;
        let unifiable = false, here = false;
        const vaultId = found?.recordVaultId ?? null;
        if (found && vaultId) {
          if (found.record && (found.record.family === "google" || found.record.family === "microsoft")) {
            unifiable = await canUnifyMobileAccount(vaultId, found.record);
            // The grant, not its refresh token: Android's system sign-in holds none.
            here = hasStoredAccountGrant(await getAccountToken(vaultId, found.record.id).catch(() => null));
          } else {
            here = found.family !== "device" && !!found.signIn && found.signIn !== "signin";
          }
        }
        const nextFacts = found && vaultId ? await readMobileAccountFacts(vaultId, found).catch(() => null) : null;
        if (turn !== loadGeneration.current) return;
        const others = found?.record && vaultId ? manualMergeCandidates(await loadCloudAccounts(vaultId).catch(() => []), found.record) : [];
        if (turn !== loadGeneration.current) return;
        setCard(found); setReady(true); setUnifiable(unifiable); setSignedInHere(here); setFacts(nextFacts); setMergeCandidates(others);
        setLoginVaultId(vaultId);
        setLoginStatus(found?.record && vaultId ? getAccountLoginStatus(vaultId, found.record.id) : undefined);
      })
      .catch(() => {
        if (turn !== loadGeneration.current) return;
        setCard(null);
        setLoginVaultId(null);
        setReady(true);
      });
  }, [accountKey]);

  useEffect(() => {
    const changed = (event: Event) => {
      const status = (event as CustomEvent<AccountLoginStatus>).detail;
      if (status.vaultId === loginVaultId && status.accountId === card?.record?.id) setLoginStatus(status);
    };
    window.addEventListener(ACCOUNT_LOGIN_STATUS_EVENT, changed);
    return () => window.removeEventListener(ACCOUNT_LOGIN_STATUS_EVENT, changed);
  }, [loginVaultId, card?.record?.id]);

  useEffect(() => {
    const token = loadGeneration;
    reload();
    window.addEventListener("m-vaults-changed", reload);
    window.addEventListener("m-pim-changed", reload);
    window.addEventListener(MAIL_CHANGED_EVENT, reload);
    return () => {
      token.current++;
      window.removeEventListener("m-vaults-changed", reload);
      window.removeEventListener("m-pim-changed", reload);
      window.removeEventListener(MAIL_CHANGED_EVENT, reload);
    };
  }, [reload]);

  /** No usable access on this phone for Google/Microsoft: the sheet asks for it, then signs in (Befund 2026-08-20). */
  const [needClient, setNeedClient] = useState<"google" | "microsoft" | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [checking, setChecking] = useState(false);
  /** The record the password entry of section 3 writes for - made on demand for a card without one. */
  const [passwordRecord, setPasswordRecord] = useState<CloudAccountRecord | null>(null);

  // The device account's state is the system permission; read when the card shows.
  const [deviceStatus, setDeviceStatus] = useState<DevicePimStatus | null>(null);
  useEffect(() => {
    if (card?.family !== "device" || !isDevicePimSupported()) return;
    let alive = true;
    void devicePimAuthorization().then((st) => { if (alive) setDeviceStatus(st); }).catch(() => undefined);
    return () => { alive = false; };
  }, [card?.family]);

  const oauthFamily = card?.family === "google" || card?.family === "microsoft" ? card.family : null;
  const model = card ? accountPageModel({
    family: card.family,
    services: card.services,
    off: card.record?.off,
    signIn: card.signIn,
    // Every provider signs in again from here, as on the desktop: OAuth
    // through the provider, Dropbox through its consent, a password account
    // through its password entry.
    canSignIn: !!loginVaultId && card.family !== "device" && (!oauthFamily || !!card.record),
    signedInHere,
    summaries: facts?.summaries,
  }) : null;

  /**
   * Which client this phone signs in with, named on the page (plan "Verbinden",
   * V0) - and whether the standard one could take over.
   */
  const [access, setAccess] = useState<{ family: "google" | "microsoft"; line: string; standard: boolean } | null>(null);
  const [accessTurn, setAccessTurn] = useState(0);
  useEffect(() => {
    if (!oauthFamily) return;
    let alive = true;
    void (async () => {
      const vault = loginVaultId ?? undefined;
      const stored = await readDeviceAccess(oauthFamily, vault);
      const resolved = await deviceAccess(oauthFamily, vault);
      const env = import.meta.env as unknown as Record<string, unknown>;
      if (alive) setAccess({ family: oauthFamily, line: accessLineText(resolved, (key, options) => t(key, options), accessProblemKey), standard: standardAccessAvailable(oauthFamily, devicePlatform(), stored, env) });
    })().catch(() => undefined);
    return () => { alive = false; };
  }, [oauthFamily, loginVaultId, accessTurn, t]);
  const standardAvailable = !!access && access.family === card?.family && access.standard;

  /** "Use standard sign-in": this phone's access becomes the standard one, then the card signs in with it. */
  function switchToStandardSignIn() {
    if (!oauthFamily) return;
    void (async () => {
      await saveDeviceAccess(oauthFamily, { source: "plainva" });
      setAccessTurn((turn) => turn + 1);
      signIn();
    })();
  }

  /** The one sign-in for everything a Google or Microsoft card carries (plan E2). */
  function signIn() {
    if (!card?.record || !loginVaultId || !oauthFamily) return;
    void (async () => {
      setSigningIn(true);
      try {
        await beginMobileSignIn(loginVaultId, { family: oauthFamily, cardId: card.record!.id, add: [] });
        setNeedClient(null);
      } catch (e) {
        if (e instanceof AccessUnavailableError) setNeedClient(e.family);
        // A refused own client is not retried: the way on is the standard sign-in.
        else if (isOwnClientRejected(e) && standardAvailable) toast.error(connectionFailureToast(e)[0], { label: t("accountAccess.useStandard"), run: switchToStandardSignIn });
        else toastConnectionFailure(e);
      } finally {
        setSigningIn(false);
      }
    })();
  }

  /** Section 3's password entry - and "Sign in" of a password account. */
  function openPassword() {
    if (!card || !loginVaultId) return;
    void ensureCardRecord(loginVaultId, card).then(setPasswordRecord).catch((e) => toast.error(e instanceof Error ? e.message : String(e)));
  }

  /** Dropbox: the account's own app key, as on the desktop (empty = Plainva's). */
  function editAppKey() {
    if (!card || !loginVaultId) return;
    void (async () => {
      const answer = await mPrompt({ title: t("settings.appKey"), message: t("cloudAccounts.byoAccountHint"), initial: card.record?.byoClientId ?? "", placeholder: t("settings.appKey") });
      if (answer.cancelled) return;
      try {
        await setMobileAppKey(loginVaultId, card, answer.value);
        reload();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      }
    })();
  }

  /** The head's one button, the same act for every provider. */
  function headSignIn() {
    if (!model) return;
    if (model.access.kind === "oauth") signIn();
    else if (model.access.kind === "appKey") { if (card?.vaultId) onReconnectVault(card.vaultId); }
    else if (model.access.kind === "password" || model.access.kind === "keys") openPassword();
  }

  /** "Sign out on this device" - no confirmation (E2): signing in again undoes it. */
  const signOutHere = () => {
    if (!card || !loginVaultId) return;
    void (async () => {
      setBusy(true);
      try {
        // This phone only: no vault-wide record is written for it (review finding 6).
        await signOutMobileAccountHere(loginVaultId, card.record?.id, card);
        toast.success(t("cloudAccounts.signedOutHere"));
        reload();
      } catch (e) {
        toastConnectionFailure(e);
      } finally {
        setBusy(false);
      }
    })();
  };

  /**
   * E3's fallback on the phone (E6, approved for both shells): two cards of
   * ONE account that cannot be folded automatically, because neither carries
   * a provider-confirmed identity. The person names the other card; the
   * guided repair says what moves before it does anything - the same flow as
   * the desktop's "Same account".
   */
  const mergeManually = () => {
    const target = card?.record;
    if (!target || !loginVaultId || mergeCandidates.length === 0) return;
    void (async () => {
      // The card to fold in is the target of an action (E20), not a value.
      const sourceId = await mTargets({
        title: t("cloudAccounts.mergeManualPick"),
        message: t("cloudAccounts.mergeManualHint"),
        options: mergeCandidates.map((record) => ({ value: record.id, label: record.label || familyLabel(record.family) })),
      });
      if (!sourceId) return;
      setBusy(true);
      try {
        const result = await guideMobileAccountRepair(loginVaultId, { accountIds: [sourceId, target.id], targetId: target.id }, (plan) => mConfirm({
          title: t("cloudAccounts.repairConfirmTitle"),
          message: t("cloudAccounts.repairConfirmMessage", {
            target: target.label || familyLabel(target.family),
            sources: plan.merges[0].sourceIds.map((id) => mergeCandidates.find((record) => record.id === id)?.label || id).join(", "),
            services: plan.merges[0].affectedServices.map(serviceLabel).join(" · "),
          }),
          confirmLabel: t("cloudAccounts.repairConfirmAction"),
        }));
        if (result.status === "repaired") {
          toast.success(t("cloudAccounts.repairDone"));
          onBack();
        }
      } catch {
        toast.error(t("cloudAccounts.repairFailed"));
      } finally {
        setBusy(false);
      }
    })();
  };

  /** "Remove account" - always asks, and says what goes and what stays (E2). */
  const removeAccount = () => {
    if (!card || !loginVaultId) return;
    void (async () => {
      const confirm = removeAccountConfirm(card.services);
      const ok = await mConfirm({
        title: t("cloudAccounts.removeConfirmTitle"),
        message: t("cloudAccounts.removeConfirmMsg", {
          account: card.label || familyLabel(card.family),
          goes: confirm.goes.map((key) => t(key)).join("; "),
          stays: confirm.stays.map((key) => t(key)).join("; "),
        }),
        confirmLabel: t("cloudAccounts.removeAccount"),
        danger: true,
      });
      if (!ok) return;
      try {
        await removeMobileAccount(loginVaultId, card.record, card);
        onBack();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      }
    })();
  };

  /** A service switch (E3): a carried service goes off or on for the vault, a missing one is added. */
  const switchService = (service: CloudServiceId, on: boolean) => {
    if (!card || !loginVaultId) return;
    if (on && !card.services.includes(service)) {
      onAddService(card, service);
      return;
    }
    void (async () => {
      setBusy(true);
      try {
        await setMobileServiceOff(loginVaultId, card, service, !on);
        reload();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    })();
  };

  // An account can disappear while its page is open. Saying so beats an empty page.
  if (ready && !card) {
    return (
      <div className="m-page">
        <AppBar onBack={onBack} title={t("settings.sectionCloudAccounts")} />
        <p className="m-hint">{t("cloudAccounts.noneYet")}</p>
      </div>
    );
  }

  const lastCheck = card ? lastChecks.get(card.key) : undefined;

  return (
    <div className="m-page" data-testid="cloudacct-detail">
      <AppBar onBack={onBack} title={card ? familyLabel(card.family) : t("settings.sectionCloudAccounts")} />
      <div className="m-settings">

      {card && model && (
        <>
          {/* 1 - the head: one state, at most one button. */}
          <SectionLabel>{t("cloudAccounts.accountGroup")}</SectionLabel>
          <GroupCard>
            <RowList>
              <Row
                icon={<Mark family={card.family} />}
                title={familyLabel(card.family)}
                subtitle={card.subtitle ? `${card.label} · ${card.subtitle}` : card.label}
                end={model.head.state ? (
                  <span className={cx("pv-acct-state", `pv-acct-state--${model.head.state}`)} data-testid="cloudacct-state" data-state={model.head.state}>
                    {t(accountStateKey(model.head.state))}
                  </span>
                ) : undefined}
              />
            </RowList>
          </GroupCard>
          {model.head.action && (
            <Button variant="primary" data-testid="cloudacct-signin" disabled={signingIn || busy} onClick={headSignIn}>
              {t(model.head.action.labelKey)}
            </Button>
          )}
          {unifiable && model.head.state === "connected" && <p className="m-hint">{t("cloudAccounts.legacySignIn")}</p>}
          {loginStatus?.message && (
            <Banner kind="warning" rounded actions={<Button size="sm" variant="secondary" disabled={signingIn} onClick={() => signIn()}>{t("cloudAccounts.reconnect")}</Button>}>
              {loginStatus.message}
            </Banner>
          )}

          {/* 2 - the services: switch, one line of state, the way to this account's settings. */}
          <SectionLabel>{t("cloudAccounts.servicesGroup")}</SectionLabel>
          <GroupCard>
            <RowList>
              {model.services.map((row) => {
                const Icon = SERVICE_ICON[row.service];
                return (
                  <Row
                    key={row.service}
                    data-testid={`cloudacct-service-${row.service}`}
                    data-on={row.on}
                    icon={<Icon size={ICON.ui} />}
                    title={serviceLabel(row.service)}
                    subtitle={loginStatus?.services[row.service] ?? row.summary ?? t(row.stateKey)}
                    wrap
                    controls
                    onClick={row.target ? () => onOpenService(card, row.service) : undefined}
                    end={
                      <>
                        <Switch checked={row.on} disabled={busy || !loginVaultId} label={serviceLabel(row.service)} onChange={(next) => switchService(row.service, next)} testId={`cloudacct-switch-${row.service}`} />
                        {row.target && <ChevronRight className="m-chevron" size={ICON.ui} />}
                      </>
                    }
                  />
                );
              })}
            </RowList>
          </GroupCard>

          {/* 3 - how this phone signs in: the same place for every provider. */}
          <SectionLabel>{t("cloudAccounts.accessGroup")}</SectionLabel>
          <GroupCard>
            <RowList>
              {model.access.kind === "oauth" && (
                <Row
                  data-testid="cloudacct-access"
                  icon={<KeyRound size={ICON.ui} />}
                  title={t("accountAccess.lineLabel")}
                  subtitle={access?.family === card.family ? access.line : t(card.family === "google" ? "accountAccess.title.google" : "accountAccess.title.microsoft")}
                  end={<ChevronRight className="m-chevron" size={ICON.ui} />}
                  onClick={() => setNeedClient(card.family as "google" | "microsoft")}
                />
              )}
              {model.access.kind === "appKey" && (
                <Row
                  data-testid="cloudacct-byo-id"
                  icon={<KeyRound size={ICON.ui} />}
                  title={t("settings.appKey")}
                  subtitle={card.record?.byoClientId ?? t("accountAccess.plainva")}
                  end={<ChevronRight className="m-chevron" size={ICON.ui} />}
                  onClick={editAppKey}
                />
              )}
              {(model.access.kind === "password" || model.access.kind === "keys") && (
                <>
                  {facts?.server && <Row icon={<Server size={ICON.ui} />} title={t("cloudAccounts.accessServer")} subtitle={facts.server} wrap />}
                  {model.access.kind === "keys"
                    ? facts?.accessKeyId && <Row icon={<User size={ICON.ui} />} title={t("cloudAccounts.accessKeyId")} subtitle={facts.accessKeyId} />
                    : facts?.user && <Row icon={<User size={ICON.ui} />} title={t("cloudAccounts.accessUser")} subtitle={facts.user} />}
                  <Row
                    data-testid="cloudacct-password-change"
                    icon={<KeyRound size={ICON.ui} />}
                    title={t(model.access.kind === "keys" ? "cloudAccounts.accessSecretKey" : model.access.appPassword ? "cloudAccounts.appPassword" : "settings.password")}
                    subtitle={card.signIn === "signin" ? t("deviceSignIn.needed") : "••••••••"}
                    end={<ChevronRight className="m-chevron" size={ICON.ui} />}
                    onClick={openPassword}
                  />
                </>
              )}
              {model.access.kind === "permission" && (
                <>
                  <Row
                    data-testid="cloudacct-device-events"
                    icon={<CalendarDays size={ICON.ui} />}
                    title={t("pim.devicePermissionRow")}
                    subtitle={deviceStatus ? t(devicePermissionKey(deviceStatus.events)) : undefined}
                    end={deviceStatus && deviceStatus.events !== "fullAccess" ? <ChevronRight className="m-chevron" size={ICON.ui} /> : undefined}
                    onClick={deviceStatus && deviceStatus.events !== "fullAccess" ? () => void openDevicePimSettings() : undefined}
                  />
                  {devicePimHasReminders() ? (
                    <Row
                      data-testid="cloudacct-device-reminders"
                      icon={<ListChecks size={ICON.ui} />}
                      title={t("pim.deviceRemindersRow")}
                      subtitle={deviceStatus ? t(devicePermissionKey(deviceStatus.reminders)) : undefined}
                      end={deviceStatus && deviceStatus.reminders !== "fullAccess" ? <ChevronRight className="m-chevron" size={ICON.ui} /> : undefined}
                      onClick={deviceStatus && deviceStatus.reminders !== "fullAccess" ? () => void openDevicePimSettings() : undefined}
                    />
                  ) : (
                    <Row icon={<ListChecks size={ICON.ui} />} title={t("pim.deviceRemindersRow")} subtitle={t("pim.deviceNoRemindersAndroid")} />
                  )}
                </>
              )}
            </RowList>
          </GroupCard>
          {model.access.kind === "permission" && <p className="m-hint">{t("pim.deviceDualHint")}</p>}
          {passwordRecord && loginVaultId && passwordServicesOf(passwordRecord).length > 0 && (
            <AccountPasswordChangePanel ports={mobilePasswordChangePorts(loginVaultId, passwordRecord, (status) => { if (status.phase === "complete") reload(); })} />
          )}

          {/* 4 - check connection: one row per service, the action that helps. */}
          {model.check && loginVaultId && (
            <>
              <SectionLabel>{t("cloudAccounts.checkConnection")}</SectionLabel>
              <GroupCard>
                <RowList>
                  <Row
                    data-testid="cloudacct-check-open"
                    icon={<Activity className="m-accent" size={ICON.ui} />}
                    title={t("cloudAccounts.checkConnection")}
                    subtitle={lastCheck ? `${t("cloudAccounts.checkLast", { time: lastCheck.time })} · ${t(lastCheck.ok ? "cloudAccounts.checkAllOk" : "cloudAccounts.checkSomeFailed")}` : t("cloudAccounts.checkHint")}
                    end={<ChevronRight className="m-chevron" size={ICON.ui} />}
                    onClick={() => setChecking(true)}
                  />
                </RowList>
              </GroupCard>
            </>
          )}
          {checking && loginVaultId && (
            <AccountCheckSheet
              vaultId={loginVaultId}
              record={card.record}
              card={card}
              canSignIn={!!model.head.action || model.access.kind !== "permission"}
              standardAvailable={standardAvailable}
              onUseStandard={() => { setChecking(false); switchToStandardSignIn(); }}
              serviceLabel={serviceLabel}
              onSignInAgain={() => { setChecking(false); headSignIn(); }}
              onAppPassword={() => { setChecking(false); onAppPassword(card); }}
              onOpenService={(service) => { setChecking(false); onOpenService(card, service); }}
              onChecked={(rows: ServiceCheck[]) => { lastChecks.set(card.key, { time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), ok: rows.every((row) => row.state === "ok") }); }}
              onClose={() => setChecking(false)}
            />
          )}

          {/* 5 - the end: sign out here, or remove from the vault. */}
          <SectionLabel>{t("cloudAccounts.endGroup")}</SectionLabel>
          <GroupCard>
            <RowList>
              {model.end.signOut && (
                <Row
                  data-testid="cloudacct-signout"
                  icon={<LogOut size={ICON.ui} />}
                  title={t("cloudAccounts.signOutHere")}
                  subtitle={t("cloudAccounts.signOutHereHint")}
                  wrap
                  disabled={busy || signingIn}
                  onClick={signOutHere}
                />
              )}
              <Row
                data-testid="cloudacct-remove"
                icon={<Trash2 className="m-danger" size={ICON.ui} />}
                title={<span className="m-danger">{t("cloudAccounts.removeAccount")}</span>}
                // The device's own calendars stay with the device; only the connection goes.
                subtitle={t(card.family === "device" ? "pim.deviceRemoveNote" : "cloudAccounts.removeHint")}
                wrap
                disabled={busy}
                onClick={removeAccount}
              />
            </RowList>
          </GroupCard>

          {/* E3's fallback, as on the desktop (E6): only where another card of the same provider can be named. */}
          {card.record && mergeCandidates.length > 0 && (
            <>
              <SectionLabel>{t("cloudAccounts.mergeManualGroup")}</SectionLabel>
              <GroupCard>
                <RowList>
                  <Row
                    data-testid="cloudacct-merge-manual"
                    icon={<Merge size={ICON.ui} />}
                    title={t("cloudAccounts.mergeManualAction")}
                    subtitle={t("cloudAccounts.mergeManualHint")}
                    wrap
                    disabled={busy}
                    end={<ChevronRight className="m-chevron" size={ICON.ui} />}
                    onClick={mergeManually}
                  />
                </RowList>
              </GroupCard>
            </>
          )}
        </>
      )}
    </div>

      {needClient && (
        <AccountAccessSheet
          family={needClient}
          onCancel={() => setNeedClient(null)}
          onSaved={() => { setNeedClient(null); setAccessTurn((turn) => turn + 1); signIn(); }}
        />
      )}
      </div>
  );
}
