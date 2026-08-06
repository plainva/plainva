import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Plus, RotateCw } from "lucide-react";
import type { PimAccountRow } from "@plainva/core";
import {
  type AccountRepairNeed,
  accountServices,
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
import {
  accountMonogram,
  familyOfCalDavUrl,
  familyOfMailAccount,
  familyOfPimProvider,
  familyOfSyncProvider,
  identityKey,
  type CloudProviderFamily,
  type SyncProviderId,
} from "@plainva/ui";
import type { MailAccountConfig } from "@plainva/ui/mail";
import { mailAccountKind } from "@plainva/ui/mail";
import { getActiveVaultEntry, type VaultEntry } from "../services/vaultRegistry";
import { listPimAccounts } from "../services/pim/pimService";
import { listMobileMailAccounts, MAIL_CHANGED_EVENT } from "../services/mail/mailRuntime";
import { loadCloudAccounts } from "../services/cloudAccountsStore";
import { beginAccountLogin, canUnifyMobileAccount } from "../services/accountLogin";
import {
  guideMobileAccountRepair,
  loadMobileAccountRepairNeeds,
} from "../services/accountRepair";
import { accountRowState, deviceSignInStates, type DeviceSignInState } from "../services/deviceSignIn";
import { DeviceSignInBadge } from "../components/DeviceSignInRow";
import { mConfirm } from "../services/mobileDialogs";
import { AppBar } from "../components/AppBar";

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

/** One account, however many services it carries. */
type AccountCard = {
  key: string;
  family: CloudProviderFamily;
  /** The identity as the user knows it: the e-mail, or the vault's name. */
  label: string;
  services: CloudServiceId[];
  /** State of the sign-in ON THIS DEVICE, when the account can have one. */
  signIn?: DeviceSignInState;
  /** The account's own repair: an expired sign-in is fixed by signing in. */
  record?: CloudAccountRecord;
  open: () => void;
  testId: string;
};

export function CloudAccountsScreen({
  onBack,
  onOpenVault,
  onOpenCalendarAccounts,
  onOpenMailAccounts,
  onConnect,
}: {
  onBack: () => void;
  /** Opens a files connection's vault detail (rename / disconnect / remove). */
  onOpenVault: (vaultId: string) => void;
  /** Opens the existing PIM calendar-accounts screen (active vault). */
  onOpenCalendarAccounts: () => void;
  /** Opens the mail accounts screen (active vault). */
  onOpenMailAccounts: () => void;
  /** Opens the provider-first connect wizard (G4). */
  onConnect: () => void;
}) {
  const { t } = useTranslation();
  const [fileVaults, setFileVaults] = useState<VaultEntry[]>([]);
  const [pimAccounts, setPimAccounts] = useState<PimAccountRow[]>([]);
  const [mailAccounts, setMailAccounts] = useState<MailAccountConfig[]>([]);
  const [cloudRecords, setCloudRecords] = useState<CloudAccountRecord[]>([]);
  const [repairNeeds, setRepairNeeds] = useState<AccountRepairNeed[]>([]);
  const [repairBusy, setRepairBusy] = useState(false);
  const [pimSignIn, setPimSignIn] = useState<Map<string, DeviceSignInState>>(new Map());
  const [mailSignIn, setMailSignIn] = useState<Map<string, DeviceSignInState>>(new Map());
  /**
   * Accounts still holding one token per service. The desktop has offered to
   * merge them since stage B; the phone could not, so the same account followed
   * two different token models on two devices (Sammelplan C5).
   */
  const [unifiable, setUnifiable] = useState<CloudAccountRecord[]>([]);

  const reload = useCallback(() => {
    // Only the ACTIVE vault's cloud connection (package A / E1) — device-wide
    // switching lives in the Vaults screen. Symmetric with the calendar and
    // mail rows below (active-vault only) and the desktop per-vault registry.
    void getActiveVaultEntry()
      .then((entry) => setFileVaults(entry.provider ? [entry] : []))
      .catch(() => setFileVaults([]));
    void getActiveVaultEntry()
      .then(async (entry) => {
        const [pim, mail] = await Promise.all([listPimAccounts(), listMobileMailAccounts()]);
        setPimAccounts(pim);
        setMailAccounts(mail);
        const [pimStates, mailStates] = await Promise.all([
          deviceSignInStates("pim", entry.id, pim.map((a) => a.id)),
          deviceSignInStates("mail", entry.id, mail.map((a) => a.id)),
        ]);
        setPimSignIn(pimStates);
        setMailSignIn(mailStates);
      })
      .catch(() => {
        setPimAccounts([]);
        setMailAccounts([]);
        setPimSignIn(new Map());
        setMailSignIn(new Map());
      });
    void getActiveVaultEntry()
      .then(async (entry) => {
        const [records, needs] = await Promise.all([
          loadCloudAccounts(entry.id),
          loadMobileAccountRepairNeeds(entry.id),
        ]);
        setCloudRecords(records);
        setRepairNeeds(needs);
        const checked = await Promise.all(records.map(async (r) => ((await canUnifyMobileAccount(entry.id, r)) ? r : null)));
        setUnifiable(checked.filter((r): r is CloudAccountRecord => !!r));
      })
      .catch(() => {
        setCloudRecords([]);
        setRepairNeeds([]);
        setUnifiable([]);
      });
  }, []);

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

  /** Signing in again is the fix for an expired OAuth token; the record holds
   * everything the login needs, so the row that shows the problem carries it. */
  const signInAgain = (record: CloudAccountRecord) => {
    void (async () => {
      try {
        await beginAccountLogin((await getActiveVaultEntry()).id, record);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      }
    })();
  };

  const recordFor = (family: CloudProviderFamily, label: string) => {
    const identity = identityKey(label);
    return cloudRecords.find(
      (r) => r.family === family && (identity ? identityKey(r.label) === identity : r.label === label),
    );
  };

  // Fold the three stores into accounts. Order matters twice over: it decides
  // which destination a merged card opens (files first — the vault detail is
  // the one that can disconnect and remove), and it is the order the cards
  // appear in, which stays stable across reloads.
  const cards: AccountCard[] = [];
  const byKey = new Map<string, AccountCard>();
  const add = (card: AccountCard) => {
    const merged = byKey.get(card.key);
    if (merged) {
      for (const s of card.services) if (!merged.services.includes(s)) merged.services.push(s);
      // An expired sign-in outranks a working one: the card must show the
      // service that stopped, not the one that happens to be listed first.
      if (card.signIn === "expired") {
        merged.signIn = "expired";
        merged.record = merged.record ?? card.record;
      }
      return;
    }
    byKey.set(card.key, card);
    cards.push(card);
  };
  const keyOf = (family: CloudProviderFamily, label: string, fallback: string) =>
    `${family}|${identityKey(label) ?? `#${fallback}`}`;

  for (const v of fileVaults) {
    const family = v.provider ? familyOfSyncProvider(v.provider as SyncProviderId) : "webdav";
    add({
      key: keyOf(family, v.name ?? "", v.id),
      family,
      label: v.name || t("mobile.vaultLocal"),
      services: ["files"],
      open: () => onOpenVault(v.id),
      testId: "cloudacct-files-row",
    });
  }
  for (const a of pimAccounts) {
    // Catalog suite providers (Apple/Fastmail/…) are CalDAV accounts whose
    // server URL names the family — same detection as the desktop registry.
    const catalogFamily =
      a.provider === "caldav" && typeof a.config?.url === "string" ? familyOfCalDavUrl(a.config.url) : null;
    const family = catalogFamily ?? familyOfPimProvider(a.provider as "caldav" | "google" | "microsoft");
    const state = accountRowState(pimSignIn.get(a.id) ?? "signin");
    add({
      key: keyOf(family, a.label, a.id),
      family,
      label: a.label,
      services: ["calendar"],
      signIn: state,
      record: recordFor(family, a.label),
      open: onOpenCalendarAccounts,
      testId: "cloudacct-calendar-row",
    });
  }
  for (const a of mailAccounts) {
    const family = familyOfMailAccount({ kind: mailAccountKind(a), user: a.user, host: a.host });
    add({
      key: keyOf(family, a.label, a.id),
      family,
      label: a.label,
      services: ["mail"],
      signIn: mailSignIn.get(a.id) ?? "signin",
      record: recordFor(family, a.label),
      open: onOpenMailAccounts,
      testId: "cloudacct-mail-row",
    });
  }

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
      {cards.map((card) => (
        <GroupCard key={card.key}>
          <RowList>
            <Row
              data-testid={card.testId}
              icon={<Mark family={card.family} />}
              title={card.label}
              subtitle={familyLabel(card.family)}
              end={
                <>
                  {card.signIn && card.signIn !== "active" && <DeviceSignInBadge state={card.signIn} />}
                  <ChevronRight className="m-chevron" size={ICON.ui} />
                </>
              }
              onClick={card.open}
            />
            {/* The services are the account's smallest fact, so they read like one:
                the muted second-line type, indented under the identity. */}
            <Row indent={1} title={<span className="m-acctsub">{serviceNames(card.services)}</span>} />
            {/* The repair sits where the problem is stated. An expired token is
                fixed by signing in again — anywhere else the user would have to
                guess which of the screens behind the chevron holds the button. */}
            {card.signIn === "expired" && card.record && (
              <Row
                indent={1}
                data-testid="cloudacct-signin-again"
                icon={<RotateCw className="m-accent" size={ICON.ui} />}
                title={t("pim.signInAgain")}
                onClick={() => signInAgain(card.record!)}
              />
            )}
          </RowList>
        </GroupCard>
      ))}

      {unifiable.length > 0 && (
        <>
          <SectionLabel>{t("cloudAccounts.unifyLogin")}</SectionLabel>
          <GroupCard>
            <RowList>
              {unifiable.map((record) => (
                <Row
                  key={record.id}
                  data-testid="cloudacct-unify"
                  icon={<RotateCw className="m-accent" size={ICON.ui} />}
                  title={t("cloudAccounts.unifyLogin")}
                  subtitle={record.label || t("cloudAccounts.unifyAvailable")}
                  end={<ChevronRight className="m-chevron" size={ICON.ui} />}
                  onClick={() => signInAgain(record)}
                />
              ))}
            </RowList>
          </GroupCard>
          <p className="m-hint">{t("cloudAccounts.unifyHintMobile")}</p>
        </>
      )}

      <p className="m-hint">{t("mobile.syncCreatesVaultHint")}</p>
    </div>
  );
}
