import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, CloudOff } from "lucide-react";
import { EmptyState, TextInput } from "@plainva/ui";
import { mSelect } from "./services/mobileDialogs";
import type { S3Credentials, WebDavCredentials } from "@plainva/core";
import { connectProvider, listProviderFolders, syncPossible, type MobileSyncProvider } from "./services/syncService";
import { CloudFolderPickerSheet } from "./components/CloudFolderPickerSheet";
import { beginOAuth, type OAuthProviderId } from "./services/oauthService";
import type { MobileVault } from "./services/vaultService";

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
 */
export function AddVaultScreen({ vault, onBack }: { vault: MobileVault; onBack: () => void }) {
  const { t } = useTranslation();
  const [provider, setProvider] = useState<ProviderId>("webdav");
  const [webdav, setWebdav] = useState<WebDavCredentials>({ url: "", user: "", pass: "" });
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
  const [driveClientSecret, setDriveClientSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Direct providers (WebDAV/S3) browse the cloud folder BEFORE connecting
  // (package I; the desktop 3-step flow). OAuth keeps its redirect picker.
  const [pickFor, setPickFor] = useState<MobileSyncProvider | null>(null);

  const connect = () => {
    setBusy(true);
    setError(null);
    if (OAUTH_PROVIDERS.has(provider)) {
      // Opens the system browser; the redirect handler finishes the connect
      // (which creates and activates the new vault).
      // The cloud folder is chosen AFTER the browser returns a token (#10),
      // via the folder picker — there is no token to browse with beforehand.
      void beginOAuth(provider as OAuthProviderId, {
        clientId: driveClientId.trim() || undefined,
        clientSecret: driveClientSecret.trim() || undefined,
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
    const withRoot: MobileSyncProvider =
      p.provider === "webdav"
        ? {
            provider: "webdav",
            creds: {
              ...p.creds,
              url: folder ? p.creds.url.replace(/\/+$/, "") + "/" + folder : p.creds.url,
            },
          }
        : p.provider === "s3"
          ? { provider: "s3", creds: { ...p.creds, prefix: folder || p.creds.prefix } }
          : p;
    void connectProvider(vault, withRoot)
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false));
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
      <header className="m-header">
        <button aria-label="Back" className="m-iconbtn" onClick={onBack}>
          <ChevronLeft size={20} />
        </button>
        <h1>{t("mobile.vaultAdd")}</h1>
      </header>

      {!syncPossible(vault) ? (
        <EmptyState icon={<CloudOff size={20} />}>{t("mobile.comingSoon")}</EmptyState>
      ) : (
        <div className="m-sync">
          <p className="m-hint">{t("mobile.syncCreatesVaultHint")}</p>
          {error && <p className="m-sync-error">{error}</p>}

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
            <ChevronRight className="m-chevron" size={18} />
          </button>

          {provider === "webdav" && (
            <>
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

          {OAUTH_PROVIDERS.has(provider) && (
            <p className="m-hint">{t("mobile.syncFolderAfterConnect")}</p>
          )}

          <div className="m-sync-actions">
            <button className="m-btn m-btn--filled" disabled={busy || !canConnect} onClick={connect}>
              {t("mobile.syncConnect")}
            </button>
          </div>
        </div>
      )}

      {pickFor && (
        <CloudFolderPickerSheet
          listFolders={(path) => listProviderFolders(pickFor, path)}
          onClose={() => setPickFor(null)}
          onPick={(folder) => connectAt(pickFor, folder)}
          title={t("settings.browseFolders")}
        />
      )}
    </div>
  );
}
