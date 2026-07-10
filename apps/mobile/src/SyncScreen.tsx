import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, Cloud, CloudOff, AlertTriangle } from "lucide-react";
import { Button, EmptyState, TextInput } from "@plainva/ui";
import type { WebDavCredentials } from "@plainva/core";
import {
  connectWebDav,
  disconnectWebDav,
  getSyncStatus,
  getWebDavCredentials,
  subscribeSyncStatus,
  syncNow,
  syncPossible,
} from "./services/syncService";
import type { MobileVault } from "./services/vaultService";

/** Vault & Sync screen (M3): WebDAV/Nextcloud first — form, status, sync-now. */
export function SyncScreen({ vault, onBack }: { vault: MobileVault; onBack: () => void }) {
  const { t } = useTranslation();
  const status = useSyncExternalStore(subscribeSyncStatus, getSyncStatus);
  const [url, setUrl] = useState("");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connected = status.status !== "off";

  useEffect(() => {
    void getWebDavCredentials().then((c) => {
      if (!c) return;
      setUrl(c.url);
      setUser(c.user);
      setPass(c.pass);
    });
  }, []);

  const connect = () => {
    const creds: WebDavCredentials = { url: url.trim(), user, pass };
    setBusy(true);
    setError(null);
    void connectWebDav(vault, creds)
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false));
  };

  const disconnect = () => {
    setBusy(true);
    void disconnectWebDav().finally(() => setBusy(false));
  };

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
            <span>{t("mobile.syncUrl")}</span>
            <TextInput
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://cloud.example.com/remote.php/dav/files/user/vault"
              value={url}
            />
          </label>
          <label className="m-field">
            <span>{t("mobile.syncUser")}</span>
            <TextInput onChange={(e) => setUser(e.target.value)} value={user} />
          </label>
          <label className="m-field">
            <span>{t("mobile.syncPassword")}</span>
            <TextInput onChange={(e) => setPass(e.target.value)} type="password" value={pass} />
          </label>

          <div className="m-sync-actions">
            <Button disabled={busy || !url.trim()} onClick={connect} variant="primary">
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
