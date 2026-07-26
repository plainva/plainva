import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, ChevronLeft, ChevronRight, Folder, Mail } from "lucide-react";
import {
  FAMILY_SERVICES,
  accountMonogram,
  suiteProvider,
  type CloudProviderFamily,
  type CloudServiceId,
} from "@plainva/ui";

/**
 * Connecting an account, provider first (mail feinplan G4).
 *
 * The mobile overview used to offer three service-shaped doors ("add files",
 * "add calendar", "add mailbox"), which is backwards: a user has a Fastmail
 * account, not a calendar. Same order as the desktop wizard — provider, then
 * services, then the sign-in — with one difference the phone forces: each
 * service still signs in on its own screen, so this screen ROUTES rather than
 * holding one combined form. It never invents a provider list of its own: the
 * families and what each can carry come from the shared registry, so a
 * provider added to the catalog shows up here without a second edit (H9).
 */

/** Families offered as tiles, most widely used first (desktop tile order). */
const TILES: CloudProviderFamily[] = [
  "google",
  "microsoft",
  "webdav",
  "dropbox",
  "apple",
  "fastmail",
  "mailboxorg",
  "zoho",
  "yahoo",
  "aol",
  "yandex",
  "mailru",
  "koofr",
  "pcloud",
  "s3",
  "imap",
];

const SERVICE_ICON = { files: Folder, calendar: CalendarDays, mail: Mail } as const;

export function CloudConnectScreen({
  onBack,
  onPickService,
}: {
  onBack: () => void;
  /** Opens the sign-in surface of that service (files / calendar / mail). */
  onPickService: (service: CloudServiceId, family: CloudProviderFamily) => void;
}) {
  const { t } = useTranslation();
  const [family, setFamily] = useState<CloudProviderFamily | null>(null);

  const familyName = (f: CloudProviderFamily) => t(`cloudAccounts.family${f[0].toUpperCase()}${f.slice(1)}`);
  const serviceName = (s: CloudServiceId) =>
    s === "files" ? t("cloudAccounts.serviceFiles") : s === "calendar" ? t("cloudAccounts.serviceCalendar") : t("cloudAccounts.serviceMail");

  if (!family) {
    return (
      <div className="m-page">
        <header className="m-header">
          <button aria-label={t("common.back", { defaultValue: "Zurück" })} className="m-iconbtn" onClick={onBack}>
            <ChevronLeft size={20} />
          </button>
          <h1>{t("cloudAccounts.addAccount")}</h1>
        </header>
        <p className="m-hint">{t("cloudAccounts.pickProvider")}</p>
        {TILES.map((f) => (
          <button className="m-row" data-testid={`connect-family-${f}`} key={f} onClick={() => setFamily(f)}>
            <span aria-hidden className={`m-acctmark m-acctmark--${f}`}>
              {accountMonogram(f)}
            </span>
            <span className="m-acctwho">
              <span className="m-acctname">{familyName(f)}</span>
              <span className="m-acctsub">{FAMILY_SERVICES[f].map(serviceName).join(" · ")}</span>
            </span>
            <ChevronRight className="m-chevron" size={18} />
          </button>
        ))}
      </div>
    );
  }

  const suite = suiteProvider(family);
  return (
    <div className="m-page">
      <header className="m-header">
        <button aria-label={t("common.back", { defaultValue: "Zurück" })} className="m-iconbtn" onClick={() => setFamily(null)}>
          <ChevronLeft size={20} />
        </button>
        <h1>{familyName(family)}</h1>
      </header>

      <p className="m-hint">{t("cloudAccounts.pickService")}</p>
      {FAMILY_SERVICES[family].map((s) => {
        const Icon = SERVICE_ICON[s];
        return (
          <button className="m-row" data-testid={`connect-service-${s}`} key={s} onClick={() => onPickService(s, family)}>
            <Icon className="m-accent" size={18} />
            <span>{serviceName(s)}</span>
            <ChevronRight className="m-chevron" size={18} />
          </button>
        );
      })}

      {/* Apple is the honest special case: iCloud Drive has no third-party
          API, so "files" is absent from its row above rather than failing. */}
      {!FAMILY_SERVICES[family].includes("files") && <p className="m-hint">{t("cloudAccounts.noFilesForFamily")}</p>}
      {suite && <p className="m-hint">{t("cloudAccounts.appPasswordHint")}</p>}
    </div>
  );
}
