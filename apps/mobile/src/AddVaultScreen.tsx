import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, Cloud, CloudOff, AlertTriangle } from "lucide-react";
import { Button, EmptyState, SelectField, TextInput } from "@plainva/ui";
import type { S3Credentials, WebDavCredentials } from "@plainva/core";
import {
  connectProvider,
  disconnectProvider,
  getStoredProvider,
  getSyncStatus,
  subscribeSyncStatus,
  syncNow,
  syncPossible,
  type MobileSyncProvider,
} from "./services/syncService";
import { beginOAuth, type OAuthProviderId } from "./services/oauthService";
import { LOCAL_VAULT_ID } from "./services/vaultRegistry";
import type { MobileVault } from "./services/vaultService";

type ProviderId = MobileSyncProvider["provider"];

const OAUTH_PROVIDERS: ReadonlySet<ProviderId> = new Set(["drive", "onedrive", "dropbox"]);

const PROVIDER_LABELS: Record<ProviderId, string> = {
  webdav: "WebDAV / Nextcloud",
  s3: "S3",
  drive: "Google Drive",
  onedrive: "OneDrive",
  dropbox: "Dropbox",
};

/**
 * Vault & Sync screen (M3/M3.5): connecting from the LOCAL vault creates a
 * fresh, isolated vault container for that connection (never mixing files
 * between providers); a connection vault shows status/sync/disconnect
 * only. WebDAV and S3 are form-based; Drive/OneDrive/Dropbox run the
 * system-browser OAuth flow (oauthService) and connect on redirect.
 */
export function SyncScreen({ vault, onBack }: { vault: MobileVault; onBack: () => void }) {
  const { t } = useTranslation();
  const status = useSyncExternalStore(subscribeSyncStatus, getSyncStatus);
  const isLocalVault = vault.vaultId === LOCAL_VAULT_ID;
  const [provider, setProvider] = useState<ProviderId>("webdav");
  const [stored, setStored] = useState<MobileSyncProvider | null>(null);
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
  const [remoteFolder, setRemoteFolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connected = status.status !== "off";

  useEffect(() => {
    if (isLocalVault) return;
    void getStoredProvider(vault.vaultId).then(setStored);
  }, [vault.vaultId, isLocalVault]);

  const connect = () => {
    setBusy(true);
    setError(null);
    if (OAUTH_PROVIDERS.has(provider)) {
      // Opens the system browser; the redirect handler finishes the connect
      // (which creates and activates the new vault).
      void beginOAuth(provider as OAuthProviderId, {
        clientId: driveClientId.trim() || undefined,
        clientSecret: driveClientSecret.trim() || undefined,
        rootFolderName: remoteFolder.trim() || undefined,
        rootPath: remoteFolder.trim() || undefined,
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
    void connectProvider(vault, p)
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false));
  };

  const disconnect = () => {
    setBusy(true);
    void disconnectProvider(vault).finally(() => setBusy(false));
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

  const statusLabel =
    status.status === "syncing"
      ? t("mobile.syncSyncing")
      : status.status === "error"
        ? t("mobile.syncError")
        : status.status === "idle"
          ? t("mobile.syncIdle")
          : t("mobile.syncDisconnect");

  return (
    <div className="m-page">
      <header className="m-header">
        <button aria-label="Back" className="m-iconbtn" onClick={onBack}>
          <ChevronLeft size={20} />
        </button>
        <h1>{t("mobile.sectionVaultSync")}</h1>
      </header>

      {!syncPossible(vault) ? (
        <EmptyState icon={<CloudOff size={20} />}>{t("mobile.comingSoon")}</EmptyState>
      ) : !isLocalVault ? (
        <div className="m-sync">
          <div className="m-row m-row--static">
            <span className="m-sync-status">
              {status.status === "error" ? (
                <AlertTriangle className="m-error" size={16} />
              ) : (
                <Cloud className={connected ? "m-accent" : "m-chevron"} size={16} />
              )}
              {statusLabel}
            </span>
            {connected && (
              <Button disabled={busy} onClick={() => syncNow()} size="sm" variant="ghost">
                {t("mobile.syncNow")}
              </Button>
            )}
          </div>
          {status.message && <p className="m-sync-error">{status.message}</p>}
          {stored ? (
            <>
              <div className="m-row m-row--static">
                <span>{PROVIDER_LABELS[stored.provider]}</span>
              </div>
              <div className="m-sync-actions">
                <Button disabled={busy} onClick={disconnect}>
                  {t("mobile.syncDisconnect")}
                </Button>
              </div>
            </>
          ) : (
            <EmptyState icon={<CloudOff size={20} />}>{t("mobile.vaultNotConnected")}</EmptyState>
          )}
        </div>
      ) : (
        <div className="m-sync">
          <p className="m-hint">{t("mobile.syncCreatesVaultHint")}</p>
          {error && <p className="m-sync-error">{error}</p>}

          <label className="m-field">
            <span>{t("mobile.syncProvider")}</span>
            <SelectField onChange={(e) => setProvider(e.target.value as ProviderId)} value={provider}>
              <option value="webdav">WebDAV / Nextcloud</option>
              <option value="s3">S3 (AWS / R2 / MinIO …)</option>
              <option value="drive">Google Drive</option>
              <option value="onedrive">OneDrive</option>
              <option value="dropbox">Dropbox</option>
            </SelectField>
          </label>

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
            <label className="m-field">
              <span>{t("mobile.syncFolder")}</span>
              <TextInput
                onChange={(e) => setRemoteFolder(e.target.value)}
                placeholder={provider === "dropbox" ? "/Apps/Plainva" : "Plainva"}
                value={remoteFolder}
              />
            </label>
          )}

          <div className="m-sync-actions">
            <Button disabled={busy || !canConnect} onClick={connect} variant="primary">
              {t("mobile.syncConnect")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
