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
import type { MobileVault } from "./services/vaultService";

/**
 * Vault & Sync screen (M3): one active provider (desktop XOR rule).
 * WebDAV/Nextcloud and S3 are form-based; the OAuth providers
 * (Drive/OneDrive/Dropbox) are still open M3 work and join this select
 * once the @capacitor/browser flow lands.
 */
export function SyncScreen({ vault, onBack }: { vault: MobileVault; onBack: () => void }) {
  const { t } = useTranslation();
  const status = useSyncExternalStore(subscribeSyncStatus, getSyncStatus);
  const [provider, setProvider] = useState<"webdav" | "s3">("webdav");
  const [webdav, setWebdav] = useState<WebDavCredentials>({ url: "", user: "", pass: "" });
  const [s3, setS3] = useState<S3Credentials>({
    endpoint: "",
    region: "",
    bucket: "",
    accessKeyId: "",
    secretAccessKey: "",
    prefix: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connected = status.status !== "off";

  useEffect(() => {
    void getStoredProvider().then((stored) => {
      if (!stored) return;
      setProvider(stored.provider);
      if (stored.provider === "webdav") setWebdav(stored.creds);
      else setS3({ prefix: "", ...stored.creds });
    });
  }, []);

  const connect = () => {
    const p: MobileSyncProvider =
      provider === "webdav"
        ? { provider, creds: { ...webdav, url: webdav.url.trim() } }
        : {
            provider,
            creds: {
              ...s3,
              endpoint: s3.endpoint.trim(),
              region: s3.region.trim() || "us-east-1",
              bucket: s3.bucket.trim(),
              prefix: s3.prefix?.trim() || undefined,
            },
          };
    setBusy(true);
    setError(null);
    void connectProvider(vault, p)
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false));
  };

  const disconnect = () => {
    setBusy(true);
    void disconnectProvider().finally(() => setBusy(false));
  };

  const canConnect =
    provider === "webdav"
      ? webdav.url.trim().length > 0
      : s3.endpoint.trim().length > 0 &&
        s3.bucket.trim().length > 0 &&
        s3.accessKeyId.length > 0 &&
        s3.secretAccessKey.length > 0;

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
      ) : (
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
          {error && <p className="m-sync-error">{error}</p>}

          <label className="m-field">
            <span>{t("mobile.syncProvider")}</span>
            <SelectField
              onChange={(e) => setProvider(e.target.value as "webdav" | "s3")}
              value={provider}
            >
              <option value="webdav">WebDAV / Nextcloud</option>
              <option value="s3">S3 (AWS / R2 / MinIO …)</option>
            </SelectField>
          </label>

          {provider === "webdav" ? (
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
          ) : (
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

          <div className="m-sync-actions">
            <Button disabled={busy || !canConnect} onClick={connect} variant="primary">
              {t("mobile.syncConnect")}
            </Button>
            {connected && (
              <Button disabled={busy} onClick={disconnect}>
                {t("mobile.syncDisconnect")}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
