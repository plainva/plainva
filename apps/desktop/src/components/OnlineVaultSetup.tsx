import React, { useCallback, useRef, useState } from "react";
import { ArrowRight, Check, Cloud, FolderOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { useVault } from "../contexts/VaultContext";
import { credentialManager } from "../services/CredentialManager";
import { authorizeDrive } from "../services/driveAuth";
import { authorizeOneDrive } from "../services/oneDriveAuth";
import { authorizeDropbox } from "../services/dropboxAuth";
import {
  buildDriveTarget,
  buildOneDriveTarget,
  buildDropboxTarget,
  buildS3Target,
  type S3TargetCreds,
} from "../services/syncTargets";
import { SyncFolderPickerModal } from "./SyncFolderPickerModal";
import { PLAINVA_ONEDRIVE_CLIENT_ID, PLAINVA_DROPBOX_APP_KEY } from "@plainva/ui";

type Provider = "drive" | "onedrive" | "dropbox" | "s3";

// The freshly authorized (OAuth) / entered (S3) credentials, held in memory
// until the local vault folder is chosen. refreshToken is mutable so a rotation
// during folder browsing (OneDrive/Dropbox) is carried into the final save.
type Connected =
  | { provider: "drive"; clientId: string; clientSecret: string; refreshToken: string }
  | { provider: "onedrive"; clientId: string; refreshToken: string }
  | { provider: "dropbox"; appKey: string; refreshToken: string }
  | { provider: "s3"; s3: S3TargetCreds };

interface Props {
  provider: Provider;
  onBack: () => void;
}

const inputStyle: React.CSSProperties = {
  padding: "0.75rem",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border-color)",
  background: "var(--bg-primary)",
  color: "var(--text-main)",
  width: "100%",
};

const providerLabelKey: Record<Provider, string> = {
  drive: "settings.providerDrive",
  onedrive: "settings.providerOneDrive",
  dropbox: "settings.providerDropbox",
  s3: "settings.providerS3",
};

/**
 * Splash online-vault setup for the OAuth/key providers. Mirrors the WebDAV
 * onboarding: 1) connect (OAuth or enter keys), 2) pick the folder in the cloud,
 * 3) pick/create the local folder and open. The OAuth token is authorized
 * BEFORE a local folder exists (authorizeX returns it in memory) and only bound
 * to the chosen local folder at the end — this is the whole point of the
 * OAuth-without-vault-path change.
 */
export const OnlineVaultSetup: React.FC<Props> = ({ provider, onBack }) => {
  const { t } = useTranslation();
  const { openVault } = useVault();

  // Form state (only the fields this provider needs are shown/read).
  const [driveClientId, setDriveClientId] = useState("");
  const [driveClientSecret, setDriveClientSecret] = useState("");
  const [oneDriveClientId, setOneDriveClientId] = useState("");
  const [dropboxAppKey, setDropboxAppKey] = useState("");
  const [s3Endpoint, setS3Endpoint] = useState("");
  const [s3Bucket, setS3Bucket] = useState("");
  const [s3Region, setS3Region] = useState("");
  const [s3AccessKeyId, setS3AccessKeyId] = useState("");
  const [s3SecretKey, setS3SecretKey] = useState("");
  const [s3PathStyle, setS3PathStyle] = useState(true);

  // A ref, not state: the folder-listing rotation callback mutates it without a
  // re-render, and the final save reads the latest value.
  const credsRef = useRef<Connected | null>(null);
  const [connected, setConnected] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cloudFolder, setCloudFolder] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const providerName = t(providerLabelKey[provider]);

  const canConnect = (() => {
    if (provider === "drive") return !!driveClientId && !!driveClientSecret;
    if (provider === "onedrive") return !!(oneDriveClientId || PLAINVA_ONEDRIVE_CLIENT_ID);
    if (provider === "dropbox") return !!(dropboxAppKey || PLAINVA_DROPBOX_APP_KEY);
    return !!s3Endpoint && !!s3Bucket && !!s3AccessKeyId && !!s3SecretKey;
  })();

  // Step 1: connect (OAuth) or gather keys (S3), then open the cloud folder picker.
  const handleConnect = async () => {
    setBusy(true);
    setError(null);
    try {
      if (provider === "drive") {
        const creds = await authorizeDrive({ clientId: driveClientId.trim(), clientSecret: driveClientSecret.trim() });
        credsRef.current = { provider, ...creds };
      } else if (provider === "onedrive") {
        const creds = await authorizeOneDrive({ clientId: (oneDriveClientId || PLAINVA_ONEDRIVE_CLIENT_ID).trim() });
        credsRef.current = { provider, ...creds };
      } else if (provider === "dropbox") {
        const creds = await authorizeDropbox({ appKey: (dropboxAppKey || PLAINVA_DROPBOX_APP_KEY).trim() });
        credsRef.current = { provider, ...creds };
      } else {
        credsRef.current = {
          provider: "s3",
          s3: {
            endpoint: s3Endpoint.trim(),
            region: s3Region.trim() || "us-east-1",
            bucket: s3Bucket.trim(),
            accessKeyId: s3AccessKeyId.trim(),
            secretAccessKey: s3SecretKey,
            forcePathStyle: s3PathStyle,
          },
        };
      }
      setConnected(true);
      setPickerOpen(true); // open the cloud folder picker right away (WebDAV parity)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Cloud folder listing for the picker, from the in-memory credentials. A
  // OneDrive/Dropbox token rotation during browsing updates credsRef in place.
  const listFolders = useCallback((path: string): Promise<string[]> => {
    const c = credsRef.current;
    if (!c) return Promise.resolve([]);
    if (c.provider === "drive") return buildDriveTarget(c).listFolders(path);
    if (c.provider === "onedrive") {
      return buildOneDriveTarget(c, (refreshToken) => { credsRef.current = { ...c, refreshToken }; }).listFolders(path);
    }
    if (c.provider === "dropbox") {
      return buildDropboxTarget(c, (refreshToken) => { credsRef.current = { ...c, refreshToken }; }).listFolders(path);
    }
    return buildS3Target(c.s3).listFolders(path);
  }, []);

  // Step 3: pick/create the local folder, bind the credentials to it, open.
  const handlePickLocalAndOpen = async () => {
    const c = credsRef.current;
    if (!c) return;
    const localDir = await open({ directory: true, multiple: false, title: t("splash.selectLocalFolderTitle") });
    if (!localDir || typeof localDir !== "string") return;
    setBusy(true);
    setError(null);
    try {
      const folder = cloudFolder?.trim() || undefined;
      if (c.provider === "drive") {
        await credentialManager.saveDriveCredentials(localDir, { clientId: c.clientId, clientSecret: c.clientSecret, refreshToken: c.refreshToken, rootFolderName: folder });
      } else if (c.provider === "onedrive") {
        await credentialManager.saveOneDriveCredentials(localDir, { clientId: c.clientId, refreshToken: c.refreshToken, rootFolderName: folder });
      } else if (c.provider === "dropbox") {
        await credentialManager.saveDropboxCredentials(localDir, { appKey: c.appKey, refreshToken: c.refreshToken, rootPath: folder ? `/${folder.replace(/^\/+/, "")}` : undefined });
      } else {
        await credentialManager.saveS3Credentials(localDir, { ...c.s3, prefix: folder });
      }
      window.dispatchEvent(new CustomEvent("plainva-credentials-saved", { detail: { isNewConnection: true } }));
      await openVault(localDir);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const rootLabel =
    provider === "drive" ? "Google Drive" : provider === "onedrive" ? "OneDrive" : provider === "dropbox" ? "Dropbox" : (s3Bucket.trim() || "S3");

  return (
    <>
      <h2 style={{ fontSize: "1.4rem", marginBottom: "0.5rem" }}>{t("splash.connectToProvider", { provider: providerName })}</h2>
      <p style={{ color: "var(--text-muted)", marginBottom: "1.5rem", fontSize: "0.9rem" }}>{t("splash.connectProviderSteps")}</p>

      {error && (
        <div style={{ padding: "0.75rem", background: "var(--error-bg)", color: "var(--error-text)", border: "1px solid var(--error-border)", borderRadius: "var(--radius-md)", marginBottom: "1rem", wordBreak: "break-word", fontSize: "0.85rem" }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "1rem", background: "var(--bg-secondary)", padding: "1.5rem", borderRadius: "var(--radius-xl)", border: "1px solid var(--border-color)" }}>
        {!connected ? (
          <>
            {/* Step 1 — connect / enter credentials */}
            {provider === "drive" && (
              <>
                <Field label={t("settings.clientId")}>
                  <input autoComplete="off" value={driveClientId} onChange={(e) => setDriveClientId(e.target.value)} placeholder="xxxxxxxx.apps.googleusercontent.com" style={inputStyle} />
                </Field>
                <Field label={t("settings.clientSecret")}>
                  <input type="password" autoComplete="new-password" value={driveClientSecret} onChange={(e) => setDriveClientSecret(e.target.value)} style={inputStyle} />
                </Field>
              </>
            )}
            {provider === "onedrive" && !PLAINVA_ONEDRIVE_CLIENT_ID && (
              <Field label={t("settings.clientId")}>
                <input autoComplete="off" value={oneDriveClientId} onChange={(e) => setOneDriveClientId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" style={inputStyle} />
              </Field>
            )}
            {provider === "dropbox" && !PLAINVA_DROPBOX_APP_KEY && (
              <Field label={t("settings.appKey")}>
                <input autoComplete="off" value={dropboxAppKey} onChange={(e) => setDropboxAppKey(e.target.value)} style={inputStyle} />
              </Field>
            )}
            {provider === "s3" && (
              <>
                <Field label={t("settings.s3Endpoint")}>
                  <input autoComplete="off" value={s3Endpoint} onChange={(e) => setS3Endpoint(e.target.value)} placeholder="https://s3.eu-central-1.amazonaws.com" style={inputStyle} />
                </Field>
                <Field label={t("settings.s3Bucket")}>
                  <input autoComplete="off" value={s3Bucket} onChange={(e) => setS3Bucket(e.target.value)} style={inputStyle} />
                </Field>
                <Field label={t("settings.s3Region")}>
                  <input autoComplete="off" value={s3Region} onChange={(e) => setS3Region(e.target.value)} placeholder="us-east-1" style={inputStyle} />
                </Field>
                <Field label={t("settings.s3AccessKeyId")}>
                  <input autoComplete="off" value={s3AccessKeyId} onChange={(e) => setS3AccessKeyId(e.target.value)} style={inputStyle} />
                </Field>
                <Field label={t("settings.s3SecretAccessKey")}>
                  <input type="password" autoComplete="new-password" value={s3SecretKey} onChange={(e) => setS3SecretKey(e.target.value)} style={inputStyle} />
                </Field>
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}>
                  <input type="checkbox" checked={s3PathStyle} onChange={(e) => setS3PathStyle(e.target.checked)} style={{ width: 18, height: 18, accentColor: "var(--accent-color)" }} />
                  {t("settings.s3PathStyle")}
                </label>
              </>
            )}
            <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem" }}>
              <button onClick={onBack} disabled={busy} style={{ flex: 1, padding: "0.75rem", background: "transparent", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", color: "var(--text-main)", cursor: "pointer" }}>
                {t("splash.back")}
              </button>
              <button onClick={handleConnect} disabled={busy || !canConnect}
                style={{ flex: 1, padding: "0.75rem", background: "var(--accent-color)", border: "none", borderRadius: "var(--radius-md)", color: "var(--accent-on)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem", opacity: (busy || !canConnect) ? 0.5 : 1 }}>
                {busy ? t("splash.connecting") : provider === "s3" ? t("splash.continue") : t("splash.connect")} <ArrowRight size={16} />
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Steps 2 + 3 — pick the cloud folder, then the local folder */}
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--success-text, var(--accent-color))", fontSize: "0.9rem", fontWeight: 600 }}>
              <Check size={16} /> {t("splash.connectedTo", { provider: providerName })}
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", padding: "0.75rem", background: "var(--bg-primary)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{t("splash.cloudFolderLabel")}</div>
                <div style={{ fontSize: "0.9rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {cloudFolder ? `${rootLabel} / ${cloudFolder}` : t("splash.cloudFolderRoot", { root: rootLabel })}
                </div>
              </div>
              <button onClick={() => setPickerOpen(true)} disabled={busy}
                style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.5rem 0.75rem", background: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", color: "var(--text-main)", cursor: "pointer", fontSize: "0.85rem" }}>
                <Cloud size={15} /> {t("settings.browseFolders")}
              </button>
            </div>

            <button onClick={handlePickLocalAndOpen} disabled={busy}
              style={{ padding: "0.75rem", background: "var(--accent-color)", border: "none", borderRadius: "var(--radius-md)", color: "var(--accent-on)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem", opacity: busy ? 0.5 : 1, fontWeight: 700 }}>
              <FolderOpen size={16} /> {t("splash.pickLocalAndOpen")}
            </button>
            <button onClick={onBack} disabled={busy} style={{ padding: "0.6rem", background: "transparent", border: "none", borderRadius: "var(--radius-md)", color: "var(--text-muted)", cursor: "pointer", fontSize: "0.85rem" }}>
              {t("common.cancel")}
            </button>
          </>
        )}
      </div>

      {pickerOpen && (
        <SyncFolderPickerModal
          listFolders={listFolders}
          rootLabel={rootLabel}
          allowRoot
          onSelect={(picked) => { setCloudFolder(picked); setPickerOpen(false); }}
          onCancel={() => setPickerOpen(false)}
        />
      )}
    </>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
    <label style={{ fontSize: "0.85rem", fontWeight: 500 }}>{label}</label>
    {children}
  </div>
);
