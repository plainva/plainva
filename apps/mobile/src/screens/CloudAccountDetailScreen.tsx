import { useCallback, useEffect, useRef, useState } from "react";
import { devicePermissionKey } from "../services/pim/devicePermission";
import { devicePimAuthorization, devicePimHasReminders, isDevicePimSupported, openDevicePimSettings, type DevicePimStatus } from "../platform/devicePim";
import { useTranslation } from "react-i18next";
import { CalendarDays, ChevronRight, Folder, ListChecks, LogOut, Mail, RotateCw, Trash2 } from "lucide-react";
import {
  AccountPasswordChangePanel,
  accessLineText,
  accessProblemKey,
  isOwnClientRejected,
  passwordServicesOf,
  standardAccessAvailable,
  accountMonogram,
  Banner,
  Button,
  FAMILY_SERVICES,
  type CloudProviderFamily,
  type CloudServiceId,
  familyLabel,
  GroupCard,
  hasStoredAccountGrant,
  ICON,
  Row,
  RowList,
  SectionLabel,
  serviceLabel,
  signInActionKey,
  toast,
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
import { mConfirm } from "../services/mobileDialogs";
import { DeviceSignInBadge } from "../components/DeviceSignInRow";
import { AccountAccessSheet } from "../components/AccountAccessSheet";
import { AccountCheckSheet } from "../components/AccountCheckSheet";
import { AppBar } from "../components/AppBar";

/**
 * One cloud account (mobile rework N4.2, decision E4).
 *
 * The overview's chevron used to open the list of ALL calendar accounts or ALL
 * mailboxes — it promised THIS account and showed every one of them. This is
 * the destination it promises: the identity, the services this account
 * actually carries, and the state of its sign-in on this device.
 *
 * Each service still leads on to the screen that OWNS it (a files connection
 * is a vault, so its detail is the vault detail) — that is where connecting,
 * editing and removing live. What changes is that the account names the way
 * there instead of handing over a list.
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

export function CloudAccountDetailScreen({
  accountKey,
  onBack,
  onOpenVault,
  onOpenCalendarAccounts,
  onOpenMailAccounts,
  onAddService,
}: {
  accountKey: string;
  onBack: () => void;
  onOpenVault: (vaultId: string) => void;
  onOpenCalendarAccounts: (accountId?: string) => void;
  onOpenMailAccounts: (accountId?: string) => void;
  onAddService: (card: AccountCard, service: CloudServiceId) => void;
}) {
  const { t } = useTranslation();
  const [card, setCard] = useState<AccountCard | null>(null);
  const [unifiable, setUnifiable] = useState(false);
  /** The card's own sign-in is on this phone - what "sign out here" removes. */
  const [signedInHere, setSignedInHere] = useState(false);
  const [ready, setReady] = useState(false);
  const [loginVaultId, setLoginVaultId] = useState<string | null>(null);
  const [loginStatus, setLoginStatus] = useState<AccountLoginStatus | undefined>();
  const loadGeneration = useRef(0);

  const reload = useCallback(() => {
    const turn = ++loadGeneration.current;
    void loadAccountCards()
      .then(async ({ cards }) => {
        const found = cards.find((c) => c.key === accountKey) ?? null;
        let unifiable = false, shared = false;
        if (found?.record && found.recordVaultId) {
          const id = found.recordVaultId;
          unifiable = await canUnifyMobileAccount(id, found.record);
          // The grant, not its refresh token: Android's system sign-in holds none,
          // and the way out was missing for exactly those cards.
          shared = hasStoredAccountGrant(await getAccountToken(id, found.record.id).catch(() => null));
        }
        if (turn !== loadGeneration.current) return;
        setCard(found); setReady(true); setUnifiable(unifiable); setSignedInHere(shared);
        setLoginVaultId(found?.recordVaultId ?? null);
        setLoginStatus(found?.record && found.recordVaultId ? getAccountLoginStatus(found.recordVaultId, found.record.id) : undefined);
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

  /**
   * The one action that repairs an expired sign-in — and, when this device
   * holds no client id for the account, the form that asks for one instead of
   * a red toast the user cannot act on (Befund 2026-08-20).
   */
  const [needClient, setNeedClient] = useState<"google" | "microsoft" | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  /** "Check connection" open (plan E6). */
  const [checking, setChecking] = useState(false);

  // The device account's state is the system permission; read when the card shows.
  const [deviceStatus, setDeviceStatus] = useState<DevicePimStatus | null>(null);
  useEffect(() => {
    if (card?.family !== "device" || !isDevicePimSupported()) return;
    let alive = true;
    void devicePimAuthorization().then((st) => { if (alive) setDeviceStatus(st); }).catch(() => undefined);
    return () => { alive = false; };
  }, [card?.family]);

  /** Google and Microsoft cards sign in from here, once for every service. */
  const canSignIn = !!card?.record && !!loginVaultId && (card.record.family === "google" || card.record.family === "microsoft");

  /**
   * Which client this phone signs in with, named on the page (plan "Verbinden",
   * V0) - and whether the standard one could take over. An own client Google
   * had deleted signed in through the browser into "Error 401: deleted_client",
   * and the page did not say which client was in use.
   */
  const [access, setAccess] = useState<{ family: "google" | "microsoft"; line: string; standard: boolean } | null>(null);
  const [accessTurn, setAccessTurn] = useState(0);
  useEffect(() => {
    const family = card?.family === "google" || card?.family === "microsoft" ? card.family : null;
    if (!family) return;
    let alive = true;
    void (async () => {
      const vault = loginVaultId ?? undefined;
      const stored = await readDeviceAccess(family, vault);
      const resolved = await deviceAccess(family, vault);
      const env = import.meta.env as unknown as Record<string, unknown>;
      if (alive) setAccess({ family, line: accessLineText(resolved, (key, options) => t(key, options), accessProblemKey), standard: standardAccessAvailable(family, devicePlatform(), stored, env) });
    })().catch(() => undefined);
    return () => { alive = false; };
  }, [card?.family, loginVaultId, accessTurn, t]);
  const standardAvailable = !!access && access.family === card?.family && access.standard;

  /** "Use standard sign-in": this phone's access becomes the standard one, then the card signs in with it. */
  function switchToStandardSignIn() {
    const family = card?.family === "google" || card?.family === "microsoft" ? card.family : null;
    if (!family) return;
    void (async () => {
      await saveDeviceAccess(family, { source: "plainva" });
      setAccessTurn((turn) => turn + 1);
      signIn();
    })();
  }

  /** Signing in again is the one sign-in for everything the card carries (plan E2). */
  function signIn() {
    if (!card?.record || !loginVaultId) return;
    const family = card.record.family;
    if (family !== "google" && family !== "microsoft") return;
    void (async () => {
      setSigningIn(true);
      try {
        await beginMobileSignIn(loginVaultId, { family, cardId: card.record!.id, add: [] });
        setNeedClient(null);
      } catch (e) {
        // No usable access on this phone: the sheet asks for it, then signs in.
        if (e instanceof AccessUnavailableError) setNeedClient(e.family);
        // A refused own client is not retried: the way on is the standard sign-in.
        else if (isOwnClientRejected(e) && standardAvailable) toast.error(connectionFailureToast(e)[0], { label: t("accountAccess.useStandard"), run: switchToStandardSignIn });
        else toastConnectionFailure(e);
      } finally {
        setSigningIn(false);
      }
    })();
  }

  /**
   * "Sign out on this device" (plan "Verbinden", V0): this phone's sign-in for
   * the card goes - the card's grant and whatever a service still kept for
   * itself; the account, its services and settings and the other devices stay.
   * It replaces "reset shared sign-in", which left the services' own sign-ins
   * in place, was missing for Android's system sign-in and spoke of a time
   * before the one sign-in. No confirmation (E2): signing in again undoes it.
   */
  const signOutHere = () => {
    if (!card?.record || !loginVaultId) return;
    void (async () => {
      setSigningIn(true);
      try {
        await signOutMobileAccountHere(loginVaultId, card.record!, card);
        toast.success(t("cloudAccounts.signedOutHere"));
        reload();
      } catch (e) {
        toastConnectionFailure(e);
      } finally {
        setSigningIn(false);
      }
    })();
  };

  /** "Remove account" - as on the desktop: every service, the sign-in and the card leave the vault. */
  const removeAccount = () => {
    if (!card || !loginVaultId) return;
    void (async () => {
      const ok = await mConfirm({
        title: t("cloudAccounts.removeAccount"),
        message: t("cloudAccounts.removeAccountMsg"),
        confirmLabel: t("common.delete"),
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

  const openService = (service: CloudServiceId) => {
    if (service === "files") {
      if (card?.vaultId) onOpenVault(card.vaultId);
      return;
    }
    if (service === "calendar") onOpenCalendarAccounts(card?.pimAccountId ?? card?.record?.services.calendar?.pimAccountId);
    else onOpenMailAccounts(card?.mailAccountId ?? card?.record?.services.mail?.mailAccountId);
  };

  // An account can disappear while its detail is open — removing it happens on
  // the service's own screen, one push away. Saying so beats an empty page.
  if (ready && !card) {
    return (
      <div className="m-page">
        <AppBar onBack={onBack} title={t("settings.sectionCloudAccounts")} />
        <p className="m-hint">{t("cloudAccounts.noneYet")}</p>
      </div>
    );
  }

  return (
    <div className="m-page" data-testid="cloudacct-detail">
      <AppBar onBack={onBack} title={card?.label || t("settings.sectionCloudAccounts")} />
      <div className="m-settings">

      {card && (
        <>
          <GroupCard>
            <RowList>
              <Row
                icon={<Mark family={card.family} />}
                title={card.label}
                subtitle={card.subtitle ? `${familyLabel(card.family)} · ${card.subtitle}` : familyLabel(card.family)}
                end={card.signIn && card.signIn !== "active" && canSignIn
                  // The state that needs a sign-in IS the way to it (plan "Verbinden", V0):
                  // a yellow "anmelden" nobody could tap was the finding on build 144.
                  ? <Button size="sm" variant="primary" data-testid="cloudacct-signin" disabled={signingIn} onClick={() => signIn()}>{t(signInActionKey(card.signIn))}</Button>
                  : card.signIn ? <DeviceSignInBadge state={card.signIn} /> : undefined}
              />
            </RowList>
          </GroupCard>

          <SectionLabel>{t("cloudAccounts.servicesGroup")}</SectionLabel>
          {loginStatus?.message && (
            <Banner kind="warning" rounded actions={<Button size="sm" variant="secondary" disabled={signingIn} onClick={() => signIn()}>{t("cloudAccounts.reconnect")}</Button>}>
              {loginStatus.message}
            </Banner>
          )}
          <GroupCard>
            <RowList>
              {FAMILY_SERVICES[card.family].map((service) => {
                const Icon = SERVICE_ICON[service];
                return (
                  <Row
                    key={service}
                    data-testid={`cloudacct-service-${service}`}
                    icon={<Icon size={ICON.ui} />}
                    title={serviceLabel(service)}
                    subtitle={loginStatus?.services[service] ?? t(!card.services.includes(service) ? "connection.notConnected" : card.serviceStates?.[service] && card.serviceStates[service] !== "active" ? "connection.needsConsent" : "connection.connected")}
                    wrap
                    end={<Button size="sm" variant="tonal" onClick={() => card.services.includes(service) ? openService(service) : onAddService(card, service)}>{t(card.services.includes(service) ? "settings.title" : "connection.addService")}</Button>}
                  />
                );
              })}
            </RowList>
          </GroupCard>

          {/* This phone's access for the provider (plan E3): what signs in here,
              and the way to change it - not only when a sign-in fails. */}
          {(card.family === "google" || card.family === "microsoft") && (
            <GroupCard>
              <RowList>
                <Row
                  data-testid="cloudacct-access"
                  title={t("accountAccess.lineLabel")}
                  subtitle={access?.family === card.family ? access.line : t(card.family === "google" ? "accountAccess.title.google" : "accountAccess.title.microsoft")}
                  end={<ChevronRight className="m-chevron" size={ICON.ui} />}
                  onClick={() => setNeedClient(card.family as "google" | "microsoft")}
                />
              </RowList>
            </GroupCard>
          )}

          {card.record && loginVaultId && (
            <Button variant="secondary" data-testid="cloudacct-check-open" onClick={() => setChecking(true)}>
              {t("cloudAccounts.checkConnection")}
            </Button>
          )}
          {checking && card.record && loginVaultId && (
            <AccountCheckSheet
              vaultId={loginVaultId}
              record={card.record}
              card={card}
              canSignIn={canSignIn}
              standardAvailable={standardAvailable}
              onUseStandard={() => { setChecking(false); switchToStandardSignIn(); }}
              serviceLabel={serviceLabel}
              onSignInAgain={() => signIn()}
              onOpenService={(service) => { setChecking(false); openService(service); }}
              onClose={() => setChecking(false)}
            />
          )}

          {card.record && loginVaultId && passwordServicesOf(card.record).length > 0 && (
            <AccountPasswordChangePanel ports={mobilePasswordChangePorts(loginVaultId, card.record)} />
          )}

          {card.family === "device" && (
            <>
              <SectionLabel>{t("pim.devicePermissionRow")}</SectionLabel>
              <GroupCard>
                <RowList>
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
                </RowList>
              </GroupCard>
              <p className="m-hint">{t("pim.deviceDualHint")}</p>
              <p className="m-hint">{t("pim.deviceRemoveNote")}</p>
            </>
          )}

          {/* For a card still signed in per service; one with no sign-in here has "Sign in" above (plan "Verbinden", V0). */}
          {unifiable && card.record && card.signIn !== "signin" && (
            <>
              <SectionLabel>{t("cloudAccounts.unifyLogin")}</SectionLabel>
              <GroupCard>
                <RowList>
                  <Row
                    data-testid="cloudacct-detail-unify"
                    icon={<RotateCw className="m-accent" size={ICON.ui} />}
                    title={t("cloudAccounts.unifyLogin")}
                    end={<ChevronRight className="m-chevron" size={ICON.ui} />}
                    onClick={() => signIn()}
                  />
                </RowList>
              </GroupCard>
              <p className="m-hint">{t("cloudAccounts.unifyHintMobile")}</p>
            </>
          )}

          {/* The end of the page (plan "Verbinden", E2): sign in again - always
              there, as on the desktop -, sign out on this phone, remove. */}
          {canSignIn && (card.signIn === "active" || signedInHere) && (
            <GroupCard>
              <RowList>
                {card.signIn === "active" && (
                  <Row
                    data-testid="cloudacct-reconnect"
                    icon={<RotateCw className="m-accent" size={ICON.ui} />}
                    title={t("cloudAccounts.reconnect")}
                    disabled={signingIn}
                    onClick={() => signIn()}
                  />
                )}
                {signedInHere && (
                  <Row
                    data-testid="cloudacct-signout"
                    icon={<LogOut size={ICON.ui} />}
                    title={t("cloudAccounts.signOutHere")}
                    subtitle={t("cloudAccounts.signOutHereHint")}
                    wrap
                    disabled={signingIn}
                    onClick={signOutHere}
                  />
                )}
              </RowList>
            </GroupCard>
          )}
          <SectionLabel className="m-danger">{t("mobile.vaultGroupDanger")}</SectionLabel>
          <GroupCard tone="danger">
            <RowList>
              <Row
                data-testid="cloudacct-remove"
                icon={<Trash2 className="m-danger" size={ICON.ui} />}
                title={<span className="m-danger">{t("cloudAccounts.removeAccount")}</span>}
                onClick={removeAccount}
              />
            </RowList>
          </GroupCard>
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
