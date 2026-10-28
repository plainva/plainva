import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Plus } from "lucide-react";
import {
  type AccountRepairNeed,
  accountServices,
  accountStateKey,
  accountStateOf,
  cx,
  isServiceOff,
  type CloudAccountRecord,
  type CloudServiceId,
  GroupCard,
  type GuidedAccountRepairPlan,
  ICON,
  IconButton,
  Row,
  RowList,
  SectionLabel,
  familyLabel,
  serviceLabel,
  toast,
} from "@plainva/ui";
import { accountMonogram, type CloudProviderFamily } from "@plainva/ui";
import { MAIL_CHANGED_EVENT } from "../services/mail/mailRuntime";
import { getActiveVaultEntry } from "../services/vaultRegistry";
import { loadAccountCards, type AccountCard } from "../services/cloudAccountCards";
import { backfillMobileCalendarIdentity, backfillMobileSyncIdentity } from "../services/cloudIdentityBackfill";
import {
  guideMobileAccountRepair,
  loadMobileAccountRepairNeeds,
} from "../services/accountRepair";
import { mConfirm } from "../services/mobileDialogs";
import { AppBar } from "../components/AppBar";
import { ConnectRunSummary } from "../components/ConnectRunFrame";
import { useConnectionRun } from "../hooks/useConnectionRun";

/**
 * Mobile Cloud-Konten overview (cloud-accounts plan, P4): the ACTIVE vault's
 * cloud accounts (package A / E1) — DERIVED from the existing stores, like the
 * desktop per-vault registry. Device-wide vault switching lives in the Vaults
 * screen, not here.
 *
 * One card per ACCOUNT, not per service (mobile rework N4.1). The screen used
 * to render one row per connected service out of three separate stores, so a
 * Google account with files, calendar and mail appeared three times, each row
 * titled with the SERVICE — the one thing the user already knows — while the
 * provider it belongs to was left to the monogram. Now the identity leads, the
 * provider family names it, and the services are one indented line underneath.
 *
 * Merging is the shared identity rule, not a guess: two entries fold into one
 * card only when they are the same family AND carry the same verified e-mail
 * (`identityKey`). Everything else stays its own card — the desktop registry
 * has auto-merged on exactly that condition since stage A, and a phone that
 * merged more eagerly would show a different account list than the desktop for
 * the same vault.
 *
 * Families and monograms come from the SHARED registry (H9). This screen used
 * to carry its own 13-value family union, its own provider maps and its own
 * monogram table, so a provider added to the catalog appeared on the desktop
 * and nowhere else — three of them (imap, Koofr, pCloud) already had.
 */

function Mark({ family }: { family: CloudProviderFamily }) {
  return (
    <span aria-hidden className={`m-acctmark m-acctmark--${family}`}>
      {accountMonogram(family)}
    </span>
  );
}

export function CloudAccountsScreen({
  onBack,
  onOpenAccount,
  onConnect,
  onFinishRun,
}: {
  onBack: () => void;
  /** "Done" at the end of an account setup: back to where the app was before it. */
  onFinishRun?: () => void;
  /** Opens THIS account's detail (E4) — never the list of all of a service. */
  onOpenAccount: (accountKey: string) => void;
  /** Opens the provider-first connect wizard (G4). */
  onConnect: () => void;
}) {
  const { t } = useTranslation();
  const connectRun = useConnectionRun();
  const [cards, setCards] = useState<AccountCard[]>([]);
  const [cloudRecords, setCloudRecords] = useState<CloudAccountRecord[]>([]);
  const [repairNeeds, setRepairNeeds] = useState<AccountRepairNeed[]>([]);
  const [repairBusy, setRepairBusy] = useState(false);

  const reload = useCallback(() => {
    void loadAccountCards()
      .then(({ cards: loaded, records }) => {
        setCards(loaded);
        setCloudRecords(records);
      })
      .catch(() => {
        setCards([]);
        setCloudRecords([]);
      });
    void getActiveVaultEntry()
      .then(async (entry) => {
        setRepairNeeds(await loadMobileAccountRepairNeeds(entry.id));
      })
      .catch(() => {
        setRepairNeeds([]);
      });
  }, []);

  // One attempt per screen, files first: a Google account split across two
  // cards needs BOTH sides to carry an identity before the reconcile is allowed
  // to fold them. Sequential because the second step reads what the first
  // persisted. Same shape as the desktop's CloudAccountsPage.
  const backfilled = useRef(false);
  useEffect(() => {
    if (backfilled.current) return;
    backfilled.current = true;
    void getActiveVaultEntry()
      .then(async (entry) => {
        const files = await backfillMobileSyncIdentity(entry.id);
        const calendar = await backfillMobileCalendarIdentity(entry.id);
        if (files || calendar) reload();
      })
      .catch(() => {});
  }, [reload]);

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

  const serviceNames = (services: readonly CloudServiceId[]) => services.map(serviceLabel).join(" · ");

  const repairAmbiguous = async (need: AccountRepairNeed, target: CloudAccountRecord) => {
    if (repairBusy) return;
    setRepairBusy(true);
    try {
      const vaultId = (await getActiveVaultEntry()).id;
      const confirm = async (plan: GuidedAccountRepairPlan) => {
        const sourceNames = plan.merges[0].sourceIds
          .map((id) => cloudRecords.find((record) => record.id === id)?.label || id)
          .join(", ");
        return mConfirm({
          title: t("cloudAccounts.repairConfirmTitle"),
          message: t("cloudAccounts.repairConfirmMessage", {
            target: target.label,
            sources: sourceNames,
            services: serviceNames(plan.merges[0].affectedServices),
          }),
          confirmLabel: t("cloudAccounts.repairConfirmAction"),
        });
      };
      const result = await guideMobileAccountRepair(
        vaultId,
        { accountIds: need.accountIds, targetId: target.id },
        confirm,
      );
      if (result.status === "repaired") {
        toast.success(t("cloudAccounts.repairDone"));
        reload();
      }
    } catch {
      toast.error(t("cloudAccounts.repairFailed"));
    } finally {
      setRepairBusy(false);
    }
  };

  // The end of an account setup is its summary, on its own (plan
  // "Verbinden-Assistent", E6) - not a banner over the list of accounts.
  if (connectRun && connectRun.pending.length === 0) {
    return (
      <div className="m-page">
        <ConnectRunSummary run={connectRun} onDone={onFinishRun ?? onBack} />
      </div>
    );
  }

  return (
    <div className="m-page">
      <AppBar
        onBack={onBack}
        title={t("settings.sectionCloudAccounts")}
        actions={
          <IconButton label={t("cloudAccounts.addAccount")} data-testid="cloudacct-connect" onClick={onConnect}>
            <Plus size={ICON.head} />
          </IconButton>
        }
      />

      <div className="m-settings">
      <p className="m-hint">{t("settings.pageDescCloudAccounts")}</p>

      {repairNeeds.length > 0 && (
        <>
          <SectionLabel>{t("cloudAccounts.repairTitle")}</SectionLabel>
          <p className="m-hint">{t("cloudAccounts.repairHint")}</p>
          <GroupCard tone="warn">
            <RowList>
              {repairNeeds.flatMap((need, needIndex) =>
                need.accountIds.map((accountId) => {
                  const record = cloudRecords.find((candidate) => candidate.id === accountId);
                  if (!record) return [];
                  return (
                    <Row
                      key={`${needIndex}:${accountId}`}
                      data-testid="cloudacct-repair-target"
                      icon={<Mark family={record.family} />}
                      title={record.label}
                      subtitle={`${serviceNames(accountServices(record))} · ${t("cloudAccounts.repairKeep")}`}
                      end={<ChevronRight className="m-chevron" size={ICON.ui} />}
                      disabled={repairBusy}
                      onClick={() => void repairAmbiguous(need, record)}
                    />
                  );
                }),
              )}
            </RowList>
          </GroupCard>
        </>
      )}

      <SectionLabel>{t("cloudAccounts.connectedGroup")}</SectionLabel>
      {cards.length === 0 && <p className="m-hint">{t("cloudAccounts.noneYet")}</p>}
      {cards.map((card) => {
        // ONE state per account, read from its own sign-in (plan "Verbinden", V2) - the
        // pill of the account page's head; the action lives there.
        const state = accountStateOf(card.signIn);
        return (
          <GroupCard key={card.key}>
            <RowList>
              <Row
                data-testid="cloudacct-row"
                icon={<Mark family={card.family} />}
                title={card.label}
                subtitle={card.subtitle ? `${familyLabel(card.family)} · ${card.subtitle}` : familyLabel(card.family)}
                end={
                  <>
                    {state && (
                      <span className={cx("pv-acct-state", `pv-acct-state--${state}`)} data-testid="cloudacct-row-state" data-state={state}>
                        {t(accountStateKey(state))}
                      </span>
                    )}
                    <ChevronRight className="m-chevron" size={ICON.ui} />
                  </>
                }
                onClick={() => onOpenAccount(card.key)}
              />
              {/* The services are the account's smallest fact, so they read like one:
                  the muted second-line type, indented under the identity. A service
                  switched off for the vault (E3) is not listed as running. */}
              <Row indent={1} title={<span className="m-acctsub">{serviceNames(card.services.filter((service) => !card.record || !isServiceOff(card.record, service)))}</span>} />
            </RowList>
          </GroupCard>
        );
      })}

      <p className="m-hint">{t("mobile.syncCreatesVaultHint")}</p>
      </div>

    </div>
  );
}
