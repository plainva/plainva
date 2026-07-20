import React, { useCallback, useRef, useState } from "react";
import { ArrowRight, Check, Cloud, FolderOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { useVault } from "../contexts/VaultContext";
import { credentialManager } from "../services/CredentialManager";
import { authorizeDrive } from "../services/driveAuth";
import { authorizeOneDrive } from "../services/oneDriveAuth";
import { authorizeDropbox } from "../services/dropboxAuth";
import { appConfirm } from "../services/appDialogs";
import {
  buildWebDavTarget,
  buildDriveTarget,
  buildOneDriveTarget,
  buildDropboxTarget,
  buildS3Target,
  type S3TargetCreds,
} from "../services/syncTargets";
import { SyncFolderPickerModal } from "./SyncFolderPickerModal";
import { TauriVaultAdapter } from "../adapters/TauriVaultAdapter";
import { ICON, PLAINVA_DROPBOX_APP_KEY, PLAINVA_ONEDRIVE_CLIENT_ID } from "@plainva/ui";
import {
  scaffoldVaultTemplate,
  applyVaultTemplateSettings,
  isVaultFolderEmpty,
  type VaultTemplateDefinition,
} from "../services/vaultTemplates";

export type OnlineProvider = "webdav" | "drive" | "onedrive" | "dropbox" | "s3";

// The freshly authorized (OAuth) / entered (WebDAV, S3) credentials, held in
// memory until the local vault folder is chosen. refreshToken is mutable so a
// rotation during folder browsing (OneDrive/Dropbox) is carried into the save.
type Connected =
  | { provider: "webdav"; url: string; user: string; pass: string }
  | { provider: "drive"; clientId: string; clientSecret: string; refreshToken: string }
  | { provider: "onedrive"; clientId: string; refreshToken: string }
  | { provider: "dropbox"; appKey: string; refreshToken: string }
  | { provider: "s3"; s3: S3TargetCreds };

interface Props {
  provider: OnlineProvider;
  /**
   * "open" (default) connects to an EXISTING cloud vault; "create" additionally
   * scaffolds `template` into the chosen local folder BEFORE the credentials
   * are bound — the first sync cycle then uploads the fresh structure into the
   * (new) cloud folder (`enqueueLocalOnlyFiles` after the empty first pull).
   */
  mode?: "open" | "create";
  /** Create mode only: the structure template chosen up front (null = empty vault). */
  template?: VaultTemplateDefinition | null;
  onBack: () => void;
}

const providerLabelKey: Record<OnlineProvider, string> = {
  webdav: "settings.providerWebDav",
  drive: "settings.providerDrive",
  onedrive: "settings.providerOneDrive",
  dropbox: "settings.providerDropbox",
  s3: "settings.providerS3",
};

/**
 * Splash online-vault setup for ALL five providers (WebDAV joined the unified
 * assistant with the create-online-vault work, 2026-07-13): 1) connect (OAuth
 * or enter credentials), 2) pick — or newly create — the folder in the cloud,
 * 3) pick/create the local folder and open. OAuth tokens are authorized BEFORE
 * a local folder exists (in memory) and only bound to the chosen local folder
 * at the end.
 */
export const OnlineVaultSetup: React.FC<Props> = ({ provider, mode = "open", template = null, onBack }) => {
  const { t } = useTranslation();
  const { openVault } = useVault();

  // Form state (only the fields this provider needs are shown/read).
  const [webdavUrl, setWebdavUrl] = useState("");
  const [webdavUser, setWebdavUser] = useState("");
  const [webdavPass, setWebdavPass] = useState("");
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
  const getBasename = (path: string) => path.split(/[/\\]/).pop() || path;

  const canConnect = (() => {
    if (provider === "webdav") return !!webdavUrl.trim() && !!webdavUser.trim() && !!webdavPass;
    if (provider === "drive") return !!driveClientId && !!driveClientSecret;
    if (provider === "onedrive") return !!(oneDriveClientId || PLAINVA_ONEDRIVE_CLIENT_ID);
    if (provider === "dropbox") return !!(dropboxAppKey || PLAINVA_DROPBOX_APP_KEY);
    return !!s3Endpoint && !!s3Bucket && !!s3AccessKeyId && !!s3SecretKey;
  })();

  // Step 1: connect (OAuth), test the credentials (WebDAV) or gather keys (S3),
  // then open the cloud folder picker.
  const handleConnect = async () => {
    setBusy(true);
    setError(null);
    try {
      if (provider === "webdav") {
        const creds = { url: webdavUrl.trim(), user: webdavUser.trim(), pass: webdavPass };
        // Connection probe: a wrong host/credential pair (401, network, HTML
        // landing page) must surface HERE, not in the picker.
        await buildWebDavTarget(creds).listFolders("");
        credsRef.current = { provider, ...creds };
      } else if (provider === "drive") {
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
      setPickerOpen(true); // open the cloud folder picker right away
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
    if (c.provider === "webdav") return buildWebDavTarget(c).listFolders(path);
    if (c.provider === "drive") return buildDriveTarget(c).listFolders(path);
    if (c.provider === "onedrive") {
      return buildOneDriveTarget(c, (refreshToken) => { credsRef.current = { ...c, refreshToken }; }).listFolders(path);
    }
    if (c.provider === "dropbox") {
      return buildDropboxTarget(c, (refreshToken) => { credsRef.current = { ...c, refreshToken }; }).listFolders(path);
    }
    return buildS3Target(c.s3).listFolders(path);
  }, []);

  // The picker's "new folder" row (2026-07-13) — the create flow's way to give
  // the fresh vault its own cloud folder; available while opening too (E6).
  const createFolderAt = useCallback((path: string): Promise<void> => {
    const c = credsRef.current;
    if (!c) return Promise.resolve();
    if (c.provider === "webdav") return buildWebDavTarget(c).createFolder(path);
    if (c.provider === "drive") return buildDriveTarget(c).createFolder(path);
    if (c.provider === "onedrive") {
      return buildOneDriveTarget(c, (refreshToken) => { credsRef.current = { ...c, refreshToken }; }).createFolder(path);
    }
    if (c.provider === "dropbox") {
      return buildDropboxTarget(c, (refreshToken) => { credsRef.current = { ...c, refreshToken }; }).createFolder(path);
    }
    return buildS3Target(c.s3).createFolder(path);
  }, []);

  // Step 3: pick/create the local folder, scaffold in create mode, bind the
  // credentials to it, open. Scaffolding runs BEFORE the credentials exist on
  // disk, so no sync can observe a half-written structure.
  const handlePickLocalAndOpen = async () => {
    const c = credsRef.current;
    if (!c) return;
    const localDir = await open({ directory: true, multiple: false, title: t("splash.selectLocalFolderTitle") });
    if (!localDir || typeof localDir !== "string") return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "create") {
        if (!(await isVaultFolderEmpty(localDir))) {
          const proceed = await appConfirm({
            title: t("splash.newVault"),
            message: t("splash.folderNotEmptyConfirm", { name: getBasename(localDir) }),
            kind: "warning",
          });
          if (!proceed) return;
        }
        const adapter = new TauriVaultAdapter(localDir);
        await adapter.initialize();
        await scaffoldVaultTemplate({
          adapter,
          template,
          vaultName: getBasename(localDir),
          subfoldersHeading: t("indexMd.subfoldersHeading"),
        });
        await applyVaultTemplateSettings(localDir, template);
      }
      const folder = cloudFolder?.trim() || undefined;
      if (c.provider === "webdav") {
        const base = c.url.replace(/\/+$/, "");
        const url = folder ? `${base}/${folder.split("/").map(encodeURIComponent).join("/")}` : c.url;
        await credentialManager.saveWebDavCredentials(localDir, { url, user: c.user, pass: c.pass });
      } else if (c.provider === "drive") {
        await credentialManager.saveDriveCredentials(localDir, { clientId: c.clientId, clientSecret: c.clientSecret, refreshToken: c.refreshToken, rootFolderName: folder });
      } else if (c.provider === "onedrive") {
        await credentialManager.saveOneDriveCredentials(localDir, { clientId: c.clientId, refreshToken: c.refreshToken, rootFolderName: folder });
      } else if (c.provider === "dropbox") {
        await credentialManager.saveDropboxCredentials(localDir, { appKey: c.appKey, refreshToken: c.refreshToken, rootPath: folder ? `/${folder.replace(/^\/+/, "")}` : undefined });
      } else {
        await credentialManager.saveS3Credentials(localDir, { ...c.s3, prefix: folder });
      }
      window.dispatchEvent(new CustomEvent("plainva-credentials-saved", { detail: { isNewConnection: true } }));
      // Register the connection as a cloud account (files service) so the new
      // vault gates/greets correctly without visiting the settings first.
      await import("../services/cloudAccounts")
        .then((m) => m.refreshCloudAccounts(localDir, null))
        .catch(() => undefined);
      await openVault(localDir);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const rootLabel = (() => {
    if (provider === "webdav") {
      try {
        return new URL(webdavUrl).host || "WebDAV";
      } catch {
        return "WebDAV";
      }
    }
    return provider === "drive" ? "Google Drive" : provider === "onedrive" ? "OneDrive" : provider === "dropbox" ? "Dropbox" : (s3Bucket.trim() || "S3");
  })();

  return (
    <>
      <h2 style={{ fontSize: "var(--text-headline)", marginBottom: "0.5rem" }}>{t("splash.connectToProvider", { provider: providerName })}</h2>
      <p style={{ color: "var(--text-muted)", marginBottom: "1.5rem", fontSize: "var(--text-md)" }}>{t("splash.connectProviderSteps")}</p>

      {error && (
        <div style={{ padding: "0.75rem", background: "var(--error-bg)", color: "var(--error-text)", border: "1px solid var(--error-border)", borderRadius: "var(--radius-md)", marginBottom: "1rem", wordBreak: "break-word", fontSize: "var(--text-md)" }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "1rem", background: "var(--bg-secondary)", padding: "1.5rem", borderRadius: "var(--radius-xl)", border: "1px solid var(--border-color)" }}>
        {!connected ? (
          <>
            {/* Step 1 — connect / enter credentials */}
            {provider === "webdav" && (
              <>
                <Field label={t("splash.serverUrl")}>
                  <input autoComplete="off" value={webdavUrl} onChange={(e) => setWebdavUrl(e.target.value)} placeholder="https://nextcloud.example.com/remote.php/webdav" className="pv-field" />
                </Field>
                <Field label={t("splash.username")}>
                  <input autoComplete="off" value={webdavUser} onChange={(e) => setWebdavUser(e.target.value)} className="pv-field" />
                </Field>
                <Field label={t("splash.password")}>
                  <input type="password" autoComplete="new-password" value={webdavPass} onChange={(e) => setWebdavPass(e.target.value)} className="pv-field" />
                </Field>
              </>
            )}
            {provider === "drive" && (
              <>
                <Field label={t("settings.clientId")}>
                  <input autoComplete="off" value={driveClientId} onChange={(e) => setDriveClientId(e.target.value)} placeholder="xxxxxxxx.apps.googleusercontent.com" className="pv-field" />
                </Field>
                <Field label={t("settings.clientSecret")}>
                  <input type="password" autoComplete="new-password" value={driveClientSecret} onChange={(e) => setDriveClientSecret(e.target.value)} className="pv-field" />
                </Field>
              </>
            )}
            {provider === "onedrive" && !PLAINVA_ONEDRIVE_CLIENT_ID && (
              <Field label={t("settings.clientId")}>
                <input autoComplete="off" value={oneDriveClientId} onChange={(e) => setOneDriveClientId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" className="pv-field" />
              </Field>
            )}
            {provider === "dropbox" && !PLAINVA_DROPBOX_APP_KEY && (
              <Field label={t("settings.appKey")}>
                <input autoComplete="off" value={dropboxAppKey} onChange={(e) => setDropboxAppKey(e.target.value)} className="pv-field" />
              </Field>
            )}
            {provider === "s3" && (
              <>
                <Field label={t("settings.s3Endpoint")}>
                  <input autoComplete="off" value={s3Endpoint} onChange={(e) => setS3Endpoint(e.target.value)} placeholder="https://s3.eu-central-1.amazonaws.com" className="pv-field" />
                </Field>
                <Field label={t("settings.s3Bucket")}>
                  <input autoComplete="off" value={s3Bucket} onChange={(e) => setS3Bucket(e.target.value)} className="pv-field" />
                </Field>
                <Field label={t("settings.s3Region")}>
                  <input autoComplete="off" value={s3Region} onChange={(e) => setS3Region(e.target.value)} placeholder="us-east-1" className="pv-field" />
                </Field>
                <Field label={t("settings.s3AccessKeyId")}>
                  <input autoComplete="off" value={s3AccessKeyId} onChange={(e) => setS3AccessKeyId(e.target.value)} className="pv-field" />
                </Field>
                <Field label={t("settings.s3SecretAccessKey")}>
                  <input type="password" autoComplete="new-password" value={s3SecretKey} onChange={(e) => setS3SecretKey(e.target.value)} className="pv-field" />
                </Field>
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "var(--text-md)" }}>
                  <input type="checkbox" checked={s3PathStyle} onChange={(e) => setS3PathStyle(e.target.checked)} className="pv-check" />
                  {t("settings.s3PathStyle")}
                </label>
              </>
            )}
            <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem" }}>
              <button onClick={onBack} disabled={busy} className="pv-btn pv-btn--secondary pv-btn--lg" style={{ flex: 1 }}>
                {t("splash.back")}
              </button>
              <button onClick={handleConnect} disabled={busy || !canConnect}
                className="pv-btn pv-btn--primary pv-btn--lg" style={{ flex: 1 }}>
                {busy ? t("splash.connecting") : provider === "s3" ? t("splash.continue") : t("splash.connect")} <ArrowRight size={ICON.ui} />
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Steps 2 + 3 — pick the cloud folder, then the local folder */}
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--success-text, var(--accent-color))", fontSize: "var(--text-md)", fontWeight: 600 }}>
              <Check size={ICON.ui} /> {t("splash.connectedTo", { provider: providerName })}
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", padding: "0.75rem", background: "var(--bg-primary)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{t("splash.cloudFolderLabel")}</div>
                <div style={{ fontSize: "var(--text-md)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {cloudFolder ? `${rootLabel} / ${cloudFolder}` : t("splash.cloudFolderRoot", { root: rootLabel })}
                </div>
              </div>
              <button onClick={() => setPickerOpen(true)} disabled={busy}
                className="pv-btn pv-btn--secondary pv-btn--sm" style={{ flexShrink: 0 }}>
                <Cloud size={ICON.ui} /> {t("settings.browseFolders")}
              </button>
            </div>

            {mode === "create" && (
              <div style={{ fontSize: "var(--text-ui)", color: "var(--text-muted)" }}>
                {t("splash.createTemplateHint", { name: template?.name ?? t("splash.emptyVault") })}
              </div>
            )}

            <button onClick={handlePickLocalAndOpen} disabled={busy}
              className="pv-btn pv-btn--primary pv-btn--lg">
              <FolderOpen size={ICON.ui} /> {t("splash.pickLocalAndOpen")}
            </button>
            <button onClick={onBack} disabled={busy} className="pv-btn pv-btn--ghost">
              {t("common.cancel")}
            </button>
          </>
        )}
      </div>

      {pickerOpen && (
        <SyncFolderPickerModal
          listFolders={listFolders}
          createFolder={createFolderAt}
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
    <label style={{ fontSize: "var(--text-md)", fontWeight: 500 }}>{label}</label>
    {children}
  </div>
);
