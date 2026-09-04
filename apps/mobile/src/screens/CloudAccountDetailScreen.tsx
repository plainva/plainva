import { useCallback, useEffect, useState } from "react";
import { devicePermissionKey } from "../services/pim/devicePermission";
import { devicePimAuthorization, devicePimHasReminders, isDevicePimSupported, openDevicePimSettings, type DevicePimStatus } from "../platform/devicePim";
import { useTranslation } from "react-i18next";
import { CalendarDays, ChevronRight, Folder, ListChecks, Mail, RotateCw, Unlink } from "lucide-react";
import {
  accountMonogram,
  type CloudProviderFamily,
  type CloudServiceId,
  familyLabel,
  GroupCard,
  ICON,
  Row,
  RowList,
  SectionLabel,
  serviceLabel,
  toast,
} from "@plainva/ui";
import { MAIL_CHANGED_EVENT } from "../services/mail/mailRuntime";
import { getActiveVaultEntry } from "../services/vaultRegistry";
import { loadAccountCards, type AccountCard } from "../services/cloudAccountCards";
import { beginAccountLogin, canUnifyMobileAccount } from "../services/accountLogin";
import { clearAccountToken, getAccountToken } from "../services/accountBroker";
import { mConfirm } from "../services/mobileDialogs";
import { DeviceSignInBadge, DeviceSignInCard } from "../components/DeviceSignInRow";
import { AccountClientIdSheet } from "../components/AccountClientIdSheet";
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
}: {
  accountKey: string;
  onBack: () => void;
  onOpenVault: (vaultId: string) => void;
  onOpenCalendarAccounts: () => void;
  onOpenMailAccounts: () => void;
}) {
  const { t } = useTranslation();
  const [card, setCard] = useState<AccountCard | null>(null);
  const [unifiable, setUnifiable] = useState(false);
  const [sharedLogin, setSharedLogin] = useState(false);
  const [ready, setReady] = useState(false);

  const reload = useCallback(() => {
    void loadAccountCards()
      .then(async ({ cards }) => {
        const found = cards.find((c) => c.key === accountKey) ?? null;
        setCard(found);
        setReady(true);
        if (found?.record) {
          const entry = await getActiveVaultEntry();
          setUnifiable(await canUnifyMobileAccount(entry.id, found.record));
          setSharedLogin(!!(await getAccountToken(entry.id, found.record.id).catch(() => null))?.refreshToken);
        } else {
          setUnifiable(false);
          setSharedLogin(false);
        }
      })
      .catch(() => {
        setCard(null);
        setReady(true);
      });
  }, [accountKey]);

  useEffect(() => {
    reload();
    window.addEventListener("m-vaults-changed", reload);
    window.addEventListener("m-pim-changed", reload);
    window.addEventListener(MAIL_CHANGED_EVENT, reload);
    return () => {
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

  // The device account's state is the system permission; read when the card shows.
  const [deviceStatus, setDeviceStatus] = useState<DevicePimStatus | null>(null);
  useEffect(() => {
    if (card?.family !== "device" || !isDevicePimSupported()) return;
    let alive = true;
    void devicePimAuthorization().then((st) => { if (alive) setDeviceStatus(st); }).catch(() => undefined);
    return () => { alive = false; };
  }, [card?.family]);

  const signIn = (fallback?: { clientId: string; clientSecret?: string }) => {
    if (!card?.record) return;
    void (async () => {
      setSigningIn(true);
      try {
        const out = await beginAccountLogin((await getActiveVaultEntry()).id, card.record!, fallback);
        setNeedClient(out.kind === "needsClientId" ? out.family : null);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        setSigningIn(false);
      }
    })();
  };

  /**
   * The way out of a shared sign-in that no longer works.
   *
   * `clearAccountToken` has existed since stage B and had no caller on the
   * phone — so a token that covered the wrong services could not be removed
   * from the app at all: every service kept reading it, and re-authorising a
   * service wrote to a slot nobody read (finding 2026-08-19). Clearing it does
   * not sign anything out at the provider; it makes the services fall back to
   * their own sign-in, which is what "Ein Login für alle Dienste" then rebuilds.
   */
  const resetSharedLogin = () => {
    if (!card?.record) return;
    void (async () => {
      const ok = await mConfirm({
        title: t("cloudAccounts.resetSharedLogin"),
        message: t("cloudAccounts.resetSharedLoginConfirm"),
        confirmLabel: t("cloudAccounts.resetSharedLogin"),
        danger: true,
      });
      if (!ok) return;
      try {
        const entry = await getActiveVaultEntry();
        await clearAccountToken(entry.id, card.record!.id);
        toast.success(t("cloudAccounts.sharedLoginCleared"));
        reload();
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
    if (service === "calendar") onOpenCalendarAccounts();
    else onOpenMailAccounts();
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
                end={card.signIn ? <DeviceSignInBadge state={card.signIn} /> : undefined}
              />
            </RowList>
          </GroupCard>

          {card.signIn === "expired" && card.record && (
            <DeviceSignInCard
              accountLabel={card.label}
              onSignIn={() => signIn()}
              oauth
              providerLabel={familyLabel(card.family)}
              state="expired"
            />
          )}

          <SectionLabel>{t("cloudAccounts.servicesGroup")}</SectionLabel>
          <GroupCard>
            <RowList>
              {card.services.map((service) => {
                const Icon = SERVICE_ICON[service];
                return (
                  <Row
                    key={service}
                    data-testid={`cloudacct-service-${service}`}
                    icon={<Icon size={ICON.ui} />}
                    title={serviceLabel(service)}
                    end={<ChevronRight className="m-chevron" size={ICON.ui} />}
                    onClick={() => openService(service)}
                  />
                );
              })}
            </RowList>
          </GroupCard>

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

          {unifiable && card.record && (
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

          {sharedLogin && card.record && (
            <>
              <SectionLabel>{t("cloudAccounts.sharedLoginGroup")}</SectionLabel>
              <GroupCard>
                <RowList>
                  <Row
                    data-testid="cloudacct-detail-reset-shared"
                    icon={<Unlink className="m-danger" size={ICON.ui} />}
                    onClick={resetSharedLogin}
                    title={t("cloudAccounts.resetSharedLogin")}
                  />
                </RowList>
              </GroupCard>
              <p className="m-hint">{t("cloudAccounts.resetSharedLoginHint")}</p>
            </>
          )}
        </>
      )}
    </div>

      {needClient && (
        <AccountClientIdSheet
          busy={signingIn}
          family={needClient}
          onCancel={() => setNeedClient(null)}
          onSubmit={(client) => signIn(client)}
        />
      )}
      </div>
  );
}
