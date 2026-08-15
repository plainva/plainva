import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, ChevronRight, Folder, Mail, RotateCw } from "lucide-react";
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
import { DeviceSignInBadge, DeviceSignInCard } from "../components/DeviceSignInRow";
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
        } else setUnifiable(false);
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

  const signIn = () => {
    if (!card?.record) return;
    void (async () => {
      try {
        await beginAccountLogin((await getActiveVaultEntry()).id, card.record!);
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
                subtitle={familyLabel(card.family)}
                end={card.signIn ? <DeviceSignInBadge state={card.signIn} /> : undefined}
              />
            </RowList>
          </GroupCard>

          {card.signIn === "expired" && card.record && (
            <DeviceSignInCard
              accountLabel={card.label}
              onSignIn={signIn}
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
                    onClick={signIn}
                  />
                </RowList>
              </GroupCard>
              <p className="m-hint">{t("cloudAccounts.unifyHintMobile")}</p>
            </>
          )}
        </>
      )}
    </div>
      </div>
  );
}
