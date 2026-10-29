import { useEffect, useState } from "react";
import { isDevicePimSupported } from "../platform/devicePim";
import { hasDevicePimAccount } from "../services/pim/pimService";
import { useTranslation } from "react-i18next";
import { CalendarDays, ChevronRight, Folder, Mail } from "lucide-react";
import { accountMonogram, Button, Checkbox, type CloudAccountRecord, type CloudProviderFamily, type CloudServiceId, FAMILY_SERVICES, familyLabel, filesCarrier, GroupCard, ICON, Row, RowList, suiteProvider, Switch } from "@plainva/ui";
import { loadCloudAccounts } from "../services/cloudAccountsStore";
import { AppBar } from "../components/AppBar";
import { AccountAccessSheet } from "../components/AccountAccessSheet";
import { AccessUnavailableError, beginMobileSignIn } from "../services/accountSignIn";
import { getActiveVaultEntry } from "../services/vaultRegistry";
import { toastConnectionFailure } from "../services/connectionToast";
import type { OAuthFamily } from "@plainva/ui";

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
  onConnectDevice,
}: {
  onBack: () => void;
  /** The device's own calendars (EventKit plan E5): one tap asks the system, no form. */
  onConnectDevice?: () => void;
  /**
   * Starts the run for the ticked services (S0b1). Opening one sign-in surface
   * per service stays the shape — the caller queues the rest.
   */
  onPickServices: (services: CloudServiceId[], family: CloudProviderFamily) => void;
}) {
  const { t } = useTranslation();
  const [family, setFamily] = useState<CloudProviderFamily | null>(null);
  const [picked, setPicked] = useState<CloudServiceId[]>([]);
  /** Google/Microsoft without a usable access on this phone: the sheet asks for it. */
  const [accessFor, setAccessFor] = useState<OAuthFamily | null>(null);
  /**
   * "Other sign-in" (plan "Verbinden", E5): the own client id and - only when
   * mail is chosen - Gmail by app password, in a sheet; the step itself shows
   * the one button of the standard sign-in.
   */
  const [otherOpen, setOtherOpen] = useState(false);
  const [gmailByPassword, setGmailByPassword] = useState(false);
  const [starting, setStarting] = useState(false);
  // The device tile exists only on the native shells and only while no device
  // account exists (E7): the device is the source, not a login — one per phone.
  const [deviceTile, setDeviceTile] = useState(false);
  useEffect(() => {
    if (!isDevicePimSupported() || !onConnectDevice) return;
    let alive = true;
    void hasDevicePimAccount().then((has) => { if (alive) setDeviceTile(!has); });
    return () => { alive = false; };
  }, [onConnectDevice]);
  const tiles: CloudProviderFamily[] = deviceTile ? ["device", ...TILES] : TILES;
  // Files go through one account per vault: while one carries them, they are offered off, named.
  const [filesTakenBy, setFilesTakenBy] = useState<CloudAccountRecord | undefined>();
  useEffect(() => {
    let alive = true;
    void getActiveVaultEntry()
      .then((entry) => loadCloudAccounts(entry.id))
      .then((records) => { if (alive) setFilesTakenBy(filesCarrier(records)); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const start = async () => {
    if (!family) return;
    if (family !== "google" && family !== "microsoft") {
      onPickServices(picked, family);
      return;
    }
    setStarting(true);
    try {
      if (filesTakenBy && picked.includes("files")) return;
      // Gmail by app password goes outside the consent and on to the mail screen, bound to the card (E5).
      const outside: CloudServiceId[] = family === "google" && gmailByPassword && picked.includes("mail") ? ["mail"] : [];
      const out = await beginMobileSignIn((await getActiveVaultEntry()).id, { family, add: picked, ...(outside.length ? { outside } : {}) });
      // Only an app-password mailbox was ticked: no consent, the mail screen asks.
      if (out.kind === "nothingToAsk") onPickServices(picked, family);
    } catch (error) {
      if (error instanceof AccessUnavailableError) setAccessFor(error.family);
      else toastConnectionFailure(error);
    } finally {
      setStarting(false);
    }
  };

  const familyName = (f: CloudProviderFamily) => t(`cloudAccounts.family${f[0].toUpperCase()}${f.slice(1)}`);
  const serviceName = (s: CloudServiceId) =>
    s === "files" ? t("cloudAccounts.serviceFiles") : s === "calendar" ? t("cloudAccounts.serviceCalendar") : t("cloudAccounts.serviceMail");

  if (!family) {
    return (
      <div className="m-page">
        <AppBar onBack={onBack} title={t("cloudAccounts.addAccount")} />
        <div className="m-settings">
          <p className="m-hint">{t("cloudAccounts.pickProvider")}</p>
          <GroupCard>
            <RowList>
              {tiles.map((f) => (
                <Row
                  data-testid={`connect-family-${f}`}
                  end={<ChevronRight className="m-chevron" size={ICON.head} />}
                  icon={<span aria-hidden className={`m-acctmark m-acctmark--${f}`}>{accountMonogram(f)}</span>}
                  key={f}
                  onClick={() => {
                    // No services step for the device: it has one service and no form.
                    if (f === "device") { onConnectDevice?.(); return; }
                    setFamily(f); setPicked(FAMILY_SERVICES[f].length === 1 ? [...FAMILY_SERVICES[f]] : []); setGmailByPassword(false);
                  }}
                  subtitle={FAMILY_SERVICES[f].map(serviceName).join(" · ")}
                  title={familyName(f)}
                />
              ))}
            </RowList>
          </GroupCard>
        </div>
      </div>
    );
  }

  const suite = suiteProvider(family);
  const oauth = family === "google" || family === "microsoft";
  const offered = FAMILY_SERVICES[family];
  const toggle = (s: CloudServiceId) =>
    setPicked((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  return (
    <div className="m-page">
      <AppBar onBack={() => setFamily(null)} title={familyName(family)} />

      <div className="m-settings">
      <p className="m-hint">{t("cloudAccounts.pickServices")}</p>
      {/* Multi-select since S0b1. It used to be one choice per visit, so an
          account with files, calendar and mail meant walking this path three
          times — and re-picking the provider each time, because the family was
          dropped on the way out (S0a). Each service still signs in on its own
          screen; the queue is what threads them together. */}
      <GroupCard>
      <RowList>
        {offered.map((s) => {
          const Icon = SERVICE_ICON[s];
          const taken = s === "files" && !!filesTakenBy;
          return (
            <Row
              key={s}
              data-testid={`connect-service-${s}`}
              disabled={taken}
              end={<Checkbox aria-label={serviceName(s)} checked={picked.includes(s)} disabled={taken} readOnly tabIndex={-1} />}
              icon={<Icon className="m-accent" size={ICON.head} />}
              onClick={() => toggle(s)}
              subtitle={taken && filesTakenBy ? t("cloudAccounts.filesTakenDetail", { account: filesTakenBy.label || familyLabel(filesTakenBy.family, filesTakenBy.flavor) }) : undefined}
              title={serviceName(s)}
              wrap={taken}
            />
          );
        })}
      </RowList>
      </GroupCard>

      <Button
        data-testid="connect-start"
        disabled={picked.length === 0 || starting}
        onClick={() => void start()}
        variant="primary"
      >
        {oauth && !(family === "google" && gmailByPassword && picked.length === 1 && picked[0] === "mail")
          ? t(family === "google" ? "cloudAccounts.signInGoogle" : "cloudAccounts.signInMicrosoft")
          : t("cloudAccounts.connectServices", { count: picked.length })}
      </Button>
      {oauth && (
        <GroupCard>
          <RowList>
            <Row
              data-testid="connect-other-signin"
              end={<ChevronRight className="m-chevron" size={ICON.ui} />}
              onClick={() => setOtherOpen(true)}
              subtitle={[t("cloudAccounts.otherSignInClient"), family === "google" && picked.includes("mail") ? t("cloudAccounts.mailByAppPassword") : null].filter(Boolean).join(" · ")}
              title={t("cloudAccounts.otherSignIn")}
            />
          </RowList>
        </GroupCard>
      )}

      {/* Apple is the honest special case: iCloud Drive has no third-party
          API, so "files" is absent from its row above rather than failing. */}
      {!FAMILY_SERVICES[family].includes("files") && <p className="m-hint">{t("cloudAccounts.noFilesForFamily")}</p>}
      {suite && <p className="m-hint">{t("cloudAccounts.appPasswordHint")}</p>}
      </div>
      {otherOpen && (family === "google" || family === "microsoft") && (
        <AccountAccessSheet
          family={family}
          title={t("cloudAccounts.otherSignIn")}
          onCancel={() => setOtherOpen(false)}
          onSaved={() => setOtherOpen(false)}
          extra={family === "google" && picked.includes("mail") ? (
            <GroupCard>
              <RowList>
                <Row
                  controls
                  end={<Switch checked={gmailByPassword} label={t("cloudAccounts.mailByAppPassword")} onChange={setGmailByPassword} testId="connect-gmail-by-password" />}
                  icon={<Mail className="m-accent" size={ICON.ui} />}
                  subtitle={t("cloudAccounts.mailByAppPasswordHint")}
                  title={t("cloudAccounts.mailByAppPassword")}
                  wrap
                />
              </RowList>
            </GroupCard>
          ) : undefined}
        />
      )}
      {accessFor && (
        <AccountAccessSheet
          family={accessFor}
          onCancel={() => setAccessFor(null)}
          onSaved={() => { setAccessFor(null); void start(); }}
        />
      )}
    </div>
  );
}
