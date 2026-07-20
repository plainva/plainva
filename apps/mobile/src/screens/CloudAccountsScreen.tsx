import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { PimAccountRow } from "@plainva/core";
import { familyOfCalDavUrl } from "@plainva/ui";
import { listVaults, type VaultEntry } from "../services/vaultRegistry";
import { listPimAccounts } from "../services/pim/pimService";

/**
 * Mobile Cloud-Konten overview (cloud-accounts plan, P4): ONE list of every
 * cloud sign-in this device carries — DERIVED from the existing stores, like
 * the desktop registry. Files connections are vault containers (the mobile
 * isolation model), so each provider vault appears as an account row that
 * leads into its vault detail; the active vault's calendar accounts lead into
 * the existing PIM accounts screen. Mail does not exist on mobile yet, so no
 * mail rows appear (mockup rule: only chosen services are visible).
 */

/** Desktop AccountMark's family → chip-pair mapping, mirrored as m- classes. */
type Family =
  | "microsoft"
  | "google"
  | "webdav"
  | "dropbox"
  | "s3"
  | "apple"
  | "yahoo"
  | "aol"
  | "yandex"
  | "mailru"
  | "zoho"
  | "fastmail"
  | "mailboxorg";

const SYNC_FAMILY: Record<string, Family> = {
  drive: "google",
  onedrive: "microsoft",
  dropbox: "dropbox",
  s3: "s3",
  webdav: "webdav",
};

const PIM_FAMILY: Record<string, Family> = {
  google: "google",
  microsoft: "microsoft",
  caldav: "webdav",
};

const MONOGRAM: Record<Family, string> = {
  apple: "A",
  yahoo: "Y!",
  aol: "AOL",
  yandex: "Я",
  mailru: "MR",
  zoho: "Z",
  fastmail: "F",
  mailboxorg: "MB",
  microsoft: "M",
  google: "G",
  webdav: "W",
  dropbox: "D",
  s3: "S3",
};

function Mark({ family }: { family: Family }) {
  return (
    <span aria-hidden className={`m-acctmark m-acctmark--${family}`}>
      {MONOGRAM[family]}
    </span>
  );
}

export function CloudAccountsScreen({
  onBack,
  onOpenVault,
  onOpenCalendarAccounts,
  onAddVault,
}: {
  onBack: () => void;
  /** Opens a files connection's vault detail (rename / disconnect / remove). */
  onOpenVault: (vaultId: string) => void;
  /** Opens the existing PIM calendar-accounts screen (active vault). */
  onOpenCalendarAccounts: () => void;
  /** Opens the connect screen — a files connection creates its own vault. */
  onAddVault: () => void;
}) {
  const { t } = useTranslation();
  const [fileVaults, setFileVaults] = useState<VaultEntry[]>([]);
  const [pimAccounts, setPimAccounts] = useState<PimAccountRow[]>([]);

  const reload = useCallback(() => {
    void listVaults()
      .then((vs) => setFileVaults(vs.filter((v) => !!v.provider)))
      .catch(() => setFileVaults([]));
    void listPimAccounts()
      .then(setPimAccounts)
      .catch(() => setPimAccounts([]));
  }, []);

  useEffect(() => {
    reload();
    window.addEventListener("m-vaults-changed", reload);
    window.addEventListener("m-pim-changed", reload);
    return () => {
      window.removeEventListener("m-vaults-changed", reload);
      window.removeEventListener("m-pim-changed", reload);
    };
  }, [reload]);

  const empty = fileVaults.length === 0 && pimAccounts.length === 0;

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
        const family = SYNC_FAMILY[v.provider ?? ""] ?? "webdav";
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
          a.provider === "caldav" && typeof a.config?.url === "string"
            ? (familyOfCalDavUrl(a.config.url) as Family | null)
            : null;
        const family = catalogFamily ?? PIM_FAMILY[a.provider] ?? "webdav";
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

      <p className="m-sectionlabel">{t("cloudAccounts.addAccount")}</p>
      <button className="m-row" data-testid="cloudacct-add-files" onClick={onAddVault}>
        <Plus className="m-accent" size={18} />
        <span className="m-acctwho">
          <span className="m-acctname">{t("mobile.vaultAdd")}</span>
          <span className="m-acctsub">{t("cloudAccounts.serviceFiles")}</span>
        </span>
        <ChevronRight className="m-chevron" size={18} />
      </button>
      <p className="m-hint">{t("mobile.syncCreatesVaultHint")}</p>
      <button className="m-row" data-testid="cloudacct-add-calendar" onClick={onOpenCalendarAccounts}>
        <Plus className="m-accent" size={18} />
        <span className="m-acctwho">
          <span className="m-acctname">{t("pim.addAccount", { defaultValue: "Konto hinzufügen…" })}</span>
          <span className="m-acctsub">{t("cloudAccounts.serviceCalendar")}</span>
        </span>
        <ChevronRight className="m-chevron" size={18} />
      </button>
    </div>
  );
}
