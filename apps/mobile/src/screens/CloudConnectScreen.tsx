import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, ChevronRight, Folder, Mail } from "lucide-react";
import { accountMonogram, Button, Checkbox, type CloudProviderFamily, type CloudServiceId, FAMILY_SERVICES, ICON, Row, RowList, suiteProvider } from "@plainva/ui";
import { AppBar } from "../components/AppBar";

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
  onPickServices,
}: {
  onBack: () => void;
  /**
   * Starts the run for the ticked services (S0b1). Opening one sign-in surface
   * per service stays the shape — the caller queues the rest.
   */
  onPickServices: (services: CloudServiceId[], family: CloudProviderFamily) => void;
}) {
  const { t } = useTranslation();
  const [family, setFamily] = useState<CloudProviderFamily | null>(null);
  const [picked, setPicked] = useState<CloudServiceId[]>([]);

  const familyName = (f: CloudProviderFamily) => t(`cloudAccounts.family${f[0].toUpperCase()}${f.slice(1)}`);
  const serviceName = (s: CloudServiceId) =>
    s === "files" ? t("cloudAccounts.serviceFiles") : s === "calendar" ? t("cloudAccounts.serviceCalendar") : t("cloudAccounts.serviceMail");

  if (!family) {
    return (
      <div className="m-page">
        <AppBar onBack={onBack} title={t("cloudAccounts.addAccount")} />
        <p className="m-hint">{t("cloudAccounts.pickProvider")}</p>
        {TILES.map((f) => (
          <button className="m-row" data-testid={`connect-family-${f}`} key={f} onClick={() => { setFamily(f); setPicked(FAMILY_SERVICES[f].length === 1 ? [...FAMILY_SERVICES[f]] : []); }}>
            <span aria-hidden className={`m-acctmark m-acctmark--${f}`}>
              {accountMonogram(f)}
            </span>
            <span className="m-acctwho">
              <span className="m-acctname">{familyName(f)}</span>
              <span className="m-acctsub">{FAMILY_SERVICES[f].map(serviceName).join(" · ")}</span>
            </span>
            <ChevronRight className="m-chevron" size={ICON.head} />
          </button>
        ))}
      </div>
    );
  }

  const suite = suiteProvider(family);
  const offered = FAMILY_SERVICES[family];
  const toggle = (s: CloudServiceId) =>
    setPicked((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  return (
    <div className="m-page">
      <AppBar onBack={() => setFamily(null)} title={familyName(family)} />

      <p className="m-hint">{t("cloudAccounts.pickServices")}</p>
      {/* Multi-select since S0b1. It used to be one choice per visit, so an
          account with files, calendar and mail meant walking this path three
          times — and re-picking the provider each time, because the family was
          dropped on the way out (S0a). Each service still signs in on its own
          screen; the queue is what threads them together. */}
      <RowList>
        {offered.map((s) => {
          const Icon = SERVICE_ICON[s];
          return (
            <Row
              key={s}
              data-testid={`connect-service-${s}`}
              end={<Checkbox aria-label={serviceName(s)} checked={picked.includes(s)} readOnly tabIndex={-1} />}
              icon={<Icon className="m-accent" size={ICON.head} />}
              onClick={() => toggle(s)}
              title={serviceName(s)}
            />
          );
        })}
      </RowList>

      <Button
        data-testid="connect-start"
        disabled={picked.length === 0}
        onClick={() => onPickServices(picked, family)}
        variant="primary"
      >
        {t("cloudAccounts.connectServices", { count: picked.length })}
      </Button>

      {/* Apple is the honest special case: iCloud Drive has no third-party
          API, so "files" is absent from its row above rather than failing. */}
      {!FAMILY_SERVICES[family].includes("files") && <p className="m-hint">{t("cloudAccounts.noFilesForFamily")}</p>}
      {suite && <p className="m-hint">{t("cloudAccounts.appPasswordHint")}</p>}
    </div>
  );
}
