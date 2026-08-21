import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLeaveGuard } from "./hooks/useLeaveGuard";
import { ChevronRight, CloudOff } from "lucide-react";
import { Banner, Button, EmptyState, filesTargetForFamily, ICON, TextInput, familyLabel, getVaultTemplates, isInsecurePublicUrl, type CloudProviderFamily } from "@plainva/ui";
import { mSelect } from "./services/mobileDialogs";
import type { S3Credentials, WebDavCredentials } from "@plainva/core";
import {
  connectProvider,
  createProviderFolder,
  createProviderVault,
  listProviderFolders,
  syncPossible,
  type MobileSyncProvider,
} from "./services/syncService";
import { CloudFolderPickerSheet } from "./components/CloudFolderPickerSheet";
import { beginOAuth, type OAuthProviderId } from "./services/oauthService";
import { reloadActiveMobileVault, type MobileVault } from "./services/vaultService";
import { AppBar } from "./components/AppBar";
import { ConnectRunBanner } from "./components/ConnectRunBanner";
import { rememberConnectSecrets } from "./services/connectSecrets";
import { loadConnectQueue, runServices } from "./services/connectQueue";
import { runConsentScope } from "./services/connectConsent";

type ProviderId = MobileSyncProvider["provider"];

const OAUTH_PROVIDERS: ReadonlySet<ProviderId> = new Set(["drive", "onedrive", "dropbox"]);

const PROVIDER_OPTIONS: Array<{ value: ProviderId; label: string }> = [
  { value: "webdav", label: "WebDAV / Nextcloud" },
  { value: "s3", label: "S3 (AWS / R2 / MinIO …)" },
  { value: "drive", label: "Google Drive" },
  { value: "onedrive", label: "OneDrive" },
  { value: "dropbox", label: "Dropbox" },
];

/**
 * "Add cloud vault" screen (M3.6 vault-management rework): pure connect
 * form. Connecting creates a fresh, isolated vault container for that
 * cloud location and switches to it; per-vault actions (rename, pause,
 * delete) live on the vault detail screen.
 *
 * Create mode (2026-07-13, `createTemplateId` set — "" = empty vault): same
 * form, but the fresh container is scaffolded with the pre-picked structure
 * template before the first sync uploads it into the (new) cloud folder.
 */
export function AddVaultScreen({
  vault,
  onBack,
  createTemplateId,
  family,
}: {
  vault: MobileVault;
  onBack: () => void;
  createTemplateId?: string;
  /**
   * Set when the user came through the connect wizard and already picked a
   * provider there (S0a). The provider row then SHOWS that family instead of
   * asking again — the reported bug was that this screen started on "webdav"
   * regardless, so choosing Google led straight to a WebDAV form.
   */
  family?: CloudProviderFamily;
}) {
  const { t, i18n } = useTranslation();
  const createMode = createTemplateId !== undefined;
  // A family that cannot carry files never reaches this screen (the wizard only
  // offers the services FAMILY_SERVICES lists), so a null target here means the
  // user came in directly and picks the provider as before.
  const preset = family ? filesTargetForFamily(family) : null;
  const [runScope, setRunScope] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void loadConnectQueue().then((q) => {
      if (!alive || !q) return;
      setRunScope(runConsentScope(q.family, runServices(q)));
    });
    return () => {
      alive = false;
    };
  }, []);
  const [provider, setProvider] = useState<ProviderId>(preset?.provider ?? "webdav");
  const [webdav, setWebdav] = useState<WebDavCredentials>({ url: preset?.webdavUrl ?? "", user: "", pass: "" });
  const [s3, setS3] = useState<S3Credentials>({
    endpoint: "",
    region: "",
    bucket: "",
    accessKeyId: "",
    secretAccessKey: "",
    prefix: "",
  });
  // OAuth extras: folders for all three, BYO client for Google Drive.
  const [driveClientId, setDriveClientId] = useState("");
  // Dropbox and OneDrive ship with a central Plainva registration, so this
  // stays optional — unlike Drive, where it is the only way in.
  const [ownAppId, setOwnAppId] = useState("");
  const [driveClientSecret, setDriveClientSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Direct providers (WebDAV/S3) browse the cloud folder BEFORE connecting
  // (package I; the desktop 3-step flow). OAuth keeps its redirect picker.
  const [pickFor, setPickFor] = useState<MobileSyncProvider | null>(null);

  // Credentials typed here are not stored until "connect"; a tap on the
  // navigation bar used to discard them — including a pasted S3 secret.
  useLeaveGuard(
    "vault-connect",
    !!(webdav.url || webdav.user || webdav.pass || s3.bucket || s3.accessKeyId || s3.secretAccessKey || driveClientId || driveClientSecret || ownAppId),
    t("mobile.leaveCredentials", { defaultValue: "Die eingegebenen Zugangsdaten gehen verloren." }),
  );

  const connect = () => {
    setBusy(true);
    setError(null);
    if (OAUTH_PROVIDERS.has(provider)) {
      // Opens the system browser; the redirect handler finishes the connect
      // (which creates and activates the new vault).
      // The cloud folder is chosen AFTER the browser returns a token (#10),
      // via the folder picker — there is no token to browse with beforehand.
      // In create mode the template id travels in the persisted transaction,
      // so it survives a cold start during consent.
      // Inside a multi-service run this ONE consent covers the whole account
      // (S0b3), so the services after it need none. Outside a run — the direct
      // "connect with cloud" entry — `runScope` is null and the provider's own
      // default scope applies, exactly as before.
      void beginOAuth(provider as OAuthProviderId, {
        clientId: (provider === "drive" ? driveClientId.trim() : ownAppId.trim()) || undefined,
        clientSecret: driveClientSecret.trim() || undefined,
        ...(runScope ? { scope: runScope } : {}),
        ...(createMode ? { createTemplateId } : {}),
      })
        .catch((e) => setError(String(e)))
        .finally(() => setBusy(false));
      return;
    }
    const p: MobileSyncProvider =
      provider === "webdav"
        ? { provider: "webdav", creds: { ...webdav, url: webdav.url.trim() } }
        : {
            provider: "s3",
            creds: {
              ...s3,
              endpoint: s3.endpoint.trim(),
              region: s3.region.trim() || "us-east-1",
              bucket: s3.bucket.trim(),
              prefix: s3.prefix?.trim() || undefined,
            },
          };
    setBusy(false);
    setPickFor(p);
  };

  const connectAt = (p: MobileSyncProvider, folder: string) => {
    setPickFor(null);
    setBusy(true);
    // A suite (Nextcloud, Fastmail, …) asks for the same credentials at every
    // step of the run. Carried in memory only, never persisted (E4); the later
    // screens read it only when they were opened BY the run (they carry a
    // family), so a direct visit never sees a stale prefill.
    if (p.provider === "webdav") {
      rememberConnectSecrets({ baseUrl: p.creds.url, user: p.creds.user, password: p.creds.pass });
    }
    const withRoot: MobileSyncProvider =
      p.provider === "webdav"
        ? {
            provider: "webdav",
            creds: {
              ...p.creds,
              url: folder
                ? p.creds.url.replace(/\/+$/, "") + "/" + folder.split("/").map(encodeURIComponent).join("/")
                : p.creds.url,
            },
          }
        : p.provider === "s3"
          ? { provider: "s3", creds: { ...p.creds, prefix: folder || p.creds.prefix } }
          : p;
    const run = createMode
      ? createProviderVault(vault, withRoot, {
          template: getVaultTemplates(i18n.language).find((d) => d.id === createTemplateId) ?? null,
          vaultName: folder.split("/").pop() || "Plainva",
          subfoldersHeading: t("indexMd.subfoldersHeading"),
        })
      : connectProvider(vault, withRoot);
    void run.catch((e) => setError(String(e))).finally(() => setBusy(false));
  };

  const canConnect =
    provider === "webdav"
      ? webdav.url.trim().length > 0
      : provider === "s3"
        ? s3.endpoint.trim().length > 0 &&
          s3.bucket.trim().length > 0 &&
          s3.accessKeyId.length > 0 &&
          s3.secretAccessKey.length > 0
        : provider === "drive"
          ? driveClientId.trim().length > 0
          : true;

  return (
    <div className="m-page">
      <AppBar onBack={onBack} title={createMode ? t("mobile.vaultCreateOnlineTitle") : t("mobile.vaultAdd")} />
      <ConnectRunBanner service="files" />

      {!syncPossible(vault) ? (
        /* NOT "coming in a later step": sync is shipped. The offline queue and
           the sync state live in the same index database, so a failed index
           build is what takes connecting with it (N7). */
        <EmptyState
          action={
            <Button data-testid="addvault-needs-index-retry" onClick={() => void reloadActiveMobileVault()} variant="tonal">
              {t("sync.retryNow")}
            </Button>
          }
          icon={<CloudOff size={ICON.head} />}
        >
          {t("mobile.needsIndex")}
        </EmptyState>
      ) : (
        <div className="m-settings">
          <p className="m-hint">{t("mobile.syncCreatesVaultHint")}</p>
          {error && <Banner kind="error" rounded>{error}</Banner>}

          {/* Came through the wizard: the provider is settled, so this states it
              rather than asking a second time. Suite families (Fastmail, Koofr,
              …) technically bind WebDAV, but the row names the FAMILY — showing
              "WebDAV" after someone tapped the Fastmail tile would be the same
              break in a quieter form. */}
          {family ? (
            <div className="m-row" data-testid="sync-provider-fixed">
              <span>{t("mobile.syncProvider")}</span>
              <span className="m-prop-val">{familyLabel(family)}</span>
            </div>
          ) : (
            <button
              className="m-row"
              onClick={() =>
                void mSelect({
                  title: t("mobile.syncProvider"),
                  options: PROVIDER_OPTIONS,
                  value: provider,
                }).then((v) => {
                  if (v !== null) setProvider(v as ProviderId);
                })
              }
            >
              <span>{t("mobile.syncProvider")}</span>
              <span className="m-prop-val">
                {PROVIDER_OPTIONS.find((o) => o.value === provider)?.label}
              </span>
              <ChevronRight className="m-chevron" size={ICON.head} />
            </button>
          )}

          {provider === "webdav" && (
            <>
              {isInsecurePublicUrl(webdav.url) && (
                <Banner kind="warning">{t("settings.insecureUrlWarning")}</Banner>
              )}
              <label className="m-field">
                <span>{t("mobile.syncUrl")}</span>
                <TextInput
                  onChange={(e) => setWebdav({ ...webdav, url: e.target.value })}
                  placeholder="https://cloud.example.com/remote.php/dav/files/user/vault"
                  value={webdav.url}
                />
              </label>
              <label className="m-field">
                <span>{t("mobile.syncUser")}</span>
                <TextInput
                  onChange={(e) => setWebdav({ ...webdav, user: e.target.value })}
                  value={webdav.user}
                />
              </label>
              <label className="m-field">
                <span>{t("mobile.syncPassword")}</span>
                <TextInput
                  onChange={(e) => setWebdav({ ...webdav, pass: e.target.value })}
                  type="password"
                  value={webdav.pass}
                />
              </label>
            </>
          )}

          {provider === "s3" && (
            <>
              {isInsecurePublicUrl(s3.endpoint) && (
                <Banner kind="warning">{t("settings.insecureUrlWarning")}</Banner>
              )}
              <label className="m-field">
                <span>{t("mobile.s3Endpoint")}</span>
                <TextInput
                  onChange={(e) => setS3({ ...s3, endpoint: e.target.value })}
                  placeholder="https://<account>.r2.cloudflarestorage.com"
                  value={s3.endpoint}
                />
              </label>
              <label className="m-field">
                <span>{t("mobile.s3Region")}</span>
                <TextInput
                  onChange={(e) => setS3({ ...s3, region: e.target.value })}
                  placeholder="us-east-1 / auto"
                  value={s3.region}
                />
              </label>
              <label className="m-field">
                <span>{t("mobile.s3Bucket")}</span>
                <TextInput
                  onChange={(e) => setS3({ ...s3, bucket: e.target.value })}
                  value={s3.bucket}
                />
              </label>
              <label className="m-field">
                <span>{t("mobile.s3AccessKeyId")}</span>
                <TextInput
                  onChange={(e) => setS3({ ...s3, accessKeyId: e.target.value })}
                  value={s3.accessKeyId}
                />
              </label>
              <label className="m-field">
                <span>{t("mobile.s3SecretAccessKey")}</span>
                <TextInput
                  onChange={(e) => setS3({ ...s3, secretAccessKey: e.target.value })}
                  type="password"
                  value={s3.secretAccessKey}
                />
              </label>
              <label className="m-field">
                <span>{t("mobile.s3Prefix")}</span>
                <TextInput
                  onChange={(e) => setS3({ ...s3, prefix: e.target.value })}
                  value={s3.prefix ?? ""}
                />
              </label>
            </>
          )}

          {provider === "drive" && (
            <>
              <label className="m-field">
                <span>{t("mobile.syncClientId")}</span>
                <TextInput onChange={(e) => setDriveClientId(e.target.value)} value={driveClientId} />
              </label>
              <label className="m-field">
                <span>{t("mobile.syncClientSecret")}</span>
                <TextInput
                  onChange={(e) => setDriveClientSecret(e.target.value)}
                  type="password"
                  value={driveClientSecret}
                />
              </label>
            </>
          )}

          {(provider === "dropbox" || provider === "onedrive") && (
            <label className="m-field">
              <span>{provider === "dropbox" ? t("mobile.syncOwnAppKey") : t("mobile.syncOwnClientId")}</span>
              <TextInput onChange={(e) => setOwnAppId(e.target.value)} value={ownAppId} />
              <small className="m-hint">{t("mobile.syncOwnAppIdHint")}</small>
            </label>
          )}

          {OAUTH_PROVIDERS.has(provider) && (
            <p className="m-hint">{t("mobile.syncFolderAfterConnect")}</p>
          )}

          <div className="m-sync-actions">
            <Button variant="primary" disabled={busy || !canConnect} onClick={connect}>
              {t("mobile.syncConnect")}
            </Button>
          </div>
        </div>
      )}

      {pickFor && (
        <CloudFolderPickerSheet
          listFolders={(path) => listProviderFolders(pickFor, path)}
          createFolder={(path) => createProviderFolder(pickFor, path)}
          onClose={() => setPickFor(null)}
          onPick={(folder) => connectAt(pickFor, folder)}
          title={t("settings.browseFolders")}
        />
      )}
    </div>
  );
}
