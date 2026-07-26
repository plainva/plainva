import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { PimAccountRow } from "@plainva/core";
import {
  accountMonogram,
  familyOfCalDavUrl,
  familyOfMailAccount,
  familyOfPimProvider,
  familyOfSyncProvider,
  type CloudProviderFamily,
  type SyncProviderId,
} from "@plainva/ui";
import type { MailAccountConfig } from "@plainva/ui/mail";
import { mailAccountKind } from "@plainva/ui/mail";
import { getActiveVaultEntry, type VaultEntry } from "../services/vaultRegistry";
import { listPimAccounts } from "../services/pim/pimService";
import { listMobileMailAccounts, MAIL_CHANGED_EVENT } from "../services/mail/mailRuntime";

/**
 * Mobile Cloud-Konten overview (cloud-accounts plan, P4): the ACTIVE vault's
 * cloud accounts (package A / E1) — DERIVED from the existing stores, like the
 * desktop per-vault registry. The active vault's files connection appears as
 * an account row leading into its vault detail; its calendar accounts lead
 * into the existing PIM accounts screen, its mailboxes into the mail accounts
 * screen. Device-wide vault switching lives in the Vaults screen, not here.
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

  const reload = useCallback(() => {
    // Only the ACTIVE vault's cloud connection (package A / E1) — device-wide
    // switching lives in the Vaults screen. Symmetric with the calendar and
    // mail rows below (active-vault only) and the desktop per-vault registry.
    void getActiveVaultEntry()
      .then((entry) => setFileVaults(entry.provider ? [entry] : []))
      .catch(() => setFileVaults([]));
    void listPimAccounts()
      .then(setPimAccounts)
      .catch(() => setPimAccounts([]));
    void listMobileMailAccounts()
      .then(setMailAccounts)
      .catch(() => setMailAccounts([]));
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

  const empty = fileVaults.length === 0 && pimAccounts.length === 0 && mailAccounts.length === 0;

  return (
    <div className="m-page">
      <header className="m-header">
        <button aria-label={t("common.back", { defaultValue: "Zurück" })} className="m-iconbtn" onClick={onBack}>
          <ChevronLeft size={20} />
        </button>
        <h1>{t("settings.sectionCloudAccounts")}</h1>
      </header>

      <p className="m-hint">{t("settings.pageDescCloudAccounts")}</p>

      <p className="m-sectionlabel">{t("cloudAccounts.connectedGroup")}</p>
      {empty && <p className="m-hint">{t("cloudAccounts.noneYet")}</p>}
      {fileVaults.map((v) => {
        const family = v.provider ? familyOfSyncProvider(v.provider as SyncProviderId) : "webdav";
        return (
          <button className="m-row" data-testid="cloudacct-files-row" key={v.id} onClick={() => onOpenVault(v.id)}>
            <Mark family={family} />
            <span className="m-acctwho">
              <span className="m-acctname">{v.name || t("mobile.vaultLocal")}</span>
              <span className="m-acctsub">{t("cloudAccounts.serviceFiles")}</span>
            </span>
            <ChevronRight className="m-chevron" size={18} />
          </button>
        );
      })}
      {pimAccounts.map((a) => {
        // Catalog suite providers (Apple/Fastmail/…) are CalDAV accounts whose
        // server URL names the family — same detection as the desktop registry.
        const catalogFamily =
          a.provider === "caldav" && typeof a.config?.url === "string" ? familyOfCalDavUrl(a.config.url) : null;
        const family =
          catalogFamily ?? familyOfPimProvider(a.provider as "caldav" | "google" | "microsoft");
        return (
          <button className="m-row" data-testid="cloudacct-calendar-row" key={a.id} onClick={onOpenCalendarAccounts}>
            <Mark family={family} />
            <span className="m-acctwho">
              <span className="m-acctname">{a.label}</span>
              <span className="m-acctsub">{t("cloudAccounts.serviceCalendar")}</span>
            </span>
            <ChevronRight className="m-chevron" size={18} />
          </button>
        );
      })}

      {mailAccounts.map((a) => (
        <button className="m-row" data-testid="cloudacct-mail-row" key={a.id} onClick={onOpenMailAccounts}>
          <Mark family={familyOfMailAccount({ kind: mailAccountKind(a), user: a.user, host: a.host })} />
          <span className="m-acctwho">
            <span className="m-acctname">{a.label}</span>
            <span className="m-acctsub">{t("cloudAccounts.serviceMail")}</span>
          </span>
          <ChevronRight className="m-chevron" size={18} />
        </button>
      ))}

      {/* One door, provider first (G4). The three service-shaped rows that
          used to sit here asked the question backwards: nobody has "a
          calendar account", they have a Fastmail account. */}
      <p className="m-sectionlabel">{t("cloudAccounts.addAccount")}</p>
      <button className="m-row" data-testid="cloudacct-connect" onClick={onConnect}>
        <Plus className="m-accent" size={18} />
        <span className="m-acctwho">
          <span className="m-acctname">{t("cloudAccounts.addAccount")}</span>
          <span className="m-acctsub">
            {[t("cloudAccounts.serviceFiles"), t("cloudAccounts.serviceCalendar"), t("cloudAccounts.serviceMail")].join(" · ")}
          </span>
        </span>
        <ChevronRight className="m-chevron" size={18} />
      </button>
      <p className="m-hint">{t("mobile.syncCreatesVaultHint")}</p>
    </div>
  );
}
