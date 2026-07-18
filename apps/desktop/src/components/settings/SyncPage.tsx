import React from "react";
import { useTranslation } from "react-i18next";
import { Button, SettingCard, SettingCardNote, SettingRow, PLAINVA_ONEDRIVE_CLIENT_ID, PLAINVA_DROPBOX_APP_KEY } from "@plainva/ui";
import { Select } from "../Select";
import { AreaHead } from "./AppPages";
import { GDRIVE_BYO_GUIDE, ONEDRIVE_DROPBOX_BYO_GUIDE, userGuideUrl } from "../../services/docsLinks";
import { MIN_SYNC_INTERVAL_SECONDS } from "../../contexts/VaultContext";
import { syncStatusStore } from "../../services/syncStatusStore";

/**
 * The Sync settings page (redesign 2026-07-18, P2). Pure layout: every state
 * value and handler stays in SettingsModal (the persistence contract — keychain
 * writes, XOR clearing, OAuth flows — is untouched); this file only arranges
 * the existing rows into the quiet-cards structure (provider / connection /
 * behavior groups). Text fields render as WIDE rows (label above the input).
 */

export type SyncProvider = "none" | "webdav" | "drive" | "onedrive" | "dropbox" | "s3";

// BYO marker + handbook deep link for provider forms (P3.12): rendered while
// providerDefaults ship empty (no central app registration yet). Mirrors the
// splash badge, plus the guide the splash cannot link.
const ByoBadgeRow: React.FC<{ guidePage: string }> = ({ guidePage }) => {
  const { t } = useTranslation();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
      <span style={{ fontSize: "0.72rem", fontWeight: 600, padding: "2px 8px", borderRadius: "var(--radius-pill)", background: "var(--warning-bg)", color: "var(--warning-text)", border: "1px solid var(--warning-border)", whiteSpace: "nowrap" }}>
        {t("splash.providerByoBadge")}
      </span>
      <a
        href="#"
        onClick={(e) => { e.preventDefault(); void import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(userGuideUrl(guidePage))); }}
        style={{ color: "var(--accent-color)", fontSize: "0.8rem", textDecoration: "underline" }}
      >
        {t("settings.byoGuideLink", { defaultValue: "Registrierungs-Anleitung öffnen" })}
      </a>
    </div>
  );
};

/** Wide text-field row: label above a full-width input. */
const FieldRow: React.FC<{ label: string; desc?: string; children: React.ReactNode }> = ({ label, desc, children }) => (
  <SettingRow label={label} desc={desc} wide>
    {children}
  </SettingRow>
);

/** Button strip + status line at the bottom of the connection card. */
const FormFooter: React.FC<{ buttons: React.ReactNode; status?: React.ReactNode; statusColor?: string }> = ({ buttons, status, statusColor }) => (
  <SettingCardNote>
    <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", flexWrap: "wrap" }}>{buttons}</div>
    {status != null && (
      <span style={{ fontSize: "0.8rem", color: statusColor ?? "var(--text-muted)", marginTop: "0.5rem", display: "block" }}>{status}</span>
    )}
  </SettingCardNote>
);

export interface WebDavFormProps {
  url: string; setUrl: (v: string) => void;
  user: string; setUser: (v: string) => void;
  pass: string; setPass: (v: string) => void;
  saving: boolean;
  onBrowse: () => void;
  onSave: () => void;
  onDisconnect: () => void;
}

export interface DriveFormProps {
  clientId: string; setClientId: (v: string) => void;
  clientSecret: string; setClientSecret: (v: string) => void;
  folderName: string;
  connected: boolean;
  saving: boolean;
  error: string | null;
  onBrowse: () => void;
  onAuthorize: () => void;
  onSave: () => void;
  onDisconnect: () => void;
}

export interface OneDriveFormProps {
  clientId: string; setClientId: (v: string) => void;
  showId: boolean; setShowId: (v: boolean) => void;
  folderName: string;
  connected: boolean;
  saving: boolean;
  error: string | null;
  onBrowse: () => void;
  onAuthorize: () => void;
  onSave: () => void;
  onDisconnect: () => void;
}

export interface DropboxFormProps {
  appKey: string; setAppKey: (v: string) => void;
  showKey: boolean; setShowKey: (v: boolean) => void;
  rootPath: string;
  connected: boolean;
  saving: boolean;
  error: string | null;
  onBrowse: () => void;
  onAuthorize: () => void;
  onSave: () => void;
  onDisconnect: () => void;
}

export interface S3FormProps {
  endpoint: string; setEndpoint: (v: string) => void;
  region: string; setRegion: (v: string) => void;
  bucket: string; setBucket: (v: string) => void;
  accessKeyId: string; setAccessKeyId: (v: string) => void;
  secretKey: string; setSecretKey: (v: string) => void;
  prefix: string; setPrefix: (v: string) => void;
  pathStyle: boolean; setPathStyle: (v: boolean) => void;
  saving: boolean;
  onBrowse: () => void;
  onSave: () => void;
  onDisconnect: () => void;
}

export interface SyncQueueItem { operation: string; file_path: string; retry_count: number }

export interface SyncPageProps {
  provider: SyncProvider;
  activeProvider: SyncProvider;
  onProviderChange: (p: SyncProvider) => void;
  onDisableSync: () => void;
  webdav: WebDavFormProps;
  drive: DriveFormProps;
  oneDrive: OneDriveFormProps;
  dropbox: DropboxFormProps;
  s3: S3FormProps;
  intervalSec: string;
  onIntervalChange: (raw: string) => void;
  onIntervalBlur: () => void;
  /** Queue insight rows are gated to the OPEN vault (worker required). */
  isActiveVault: boolean;
  hasSyncWorker: boolean;
  syncQueueSnapshot: { total: number; items: SyncQueueItem[] } | null;
  onLoadQueue: () => void;
}

export const SyncPage: React.FC<SyncPageProps> = (p) => {
  const { t, i18n } = useTranslation();
  const providerLabel = (prov: SyncProvider) =>
    prov === "webdav" ? t("settings.providerWebDav")
      : prov === "drive" ? t("settings.providerDrive")
        : prov === "onedrive" ? t("settings.providerOneDrive")
          : prov === "dropbox" ? t("settings.providerDropbox")
            : prov === "s3" ? t("settings.providerS3")
              : t("settings.providerNone");

  return (
    <div>
      <AreaHead areaId="sync" />

      <SettingCard label={t("settings.groupProvider", { defaultValue: "Anbieter" })}>
        <SettingRow label={t("settings.provider")} desc={`${t("settings.activeSync")}: ${providerLabel(p.activeProvider)}`}>
          <div style={{ width: "100%" }}>
            <Select
              ariaLabel={t("settings.provider")}
              value={p.provider}
              onChange={(v) => p.onProviderChange(v as SyncProvider)}
              options={[
                { value: "none", label: t("settings.providerNone") },
                { value: "webdav", label: t("settings.providerWebDav") },
                { value: "drive", label: t("settings.providerDrive") },
                { value: "onedrive", label: t("settings.providerOneDrive") },
                { value: "dropbox", label: t("settings.providerDropbox") },
                { value: "s3", label: t("settings.providerS3") },
              ]}
            />
          </div>
        </SettingRow>
        {p.provider !== p.activeProvider && p.activeProvider !== "none" && (
          <SettingCardNote>{t("settings.activeSyncHint")}</SettingCardNote>
        )}
        {p.provider !== "none" && (
          <SettingCardNote>
            <span style={{ color: "var(--text-faint)" }}>{t("settings.providerSaveHint")}</span>
          </SettingCardNote>
        )}
      </SettingCard>

      <SettingCard label={t("settings.groupConnection", { defaultValue: "Verbindung" })}>
        {p.provider === "none" && (
          <SettingCardNote>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <span>{t("sync.none")}</span>
              {p.activeProvider !== "none" && (
                <button onClick={p.onDisableSync} className="pv-btn pv-btn--danger-soft" style={{ alignSelf: "flex-start" }}>{t("sync.disconnect")}</button>
              )}
            </div>
          </SettingCardNote>
        )}

        {p.provider === "webdav" && (
          <>
            <FieldRow label={t("settings.serverUrl")}>
              <input autoComplete="off" value={p.webdav.url} onChange={(e) => p.webdav.setUrl(e.target.value)} placeholder="https://nextcloud.example.com/remote.php/webdav" className="pv-field" style={{ width: "100%" }} />
            </FieldRow>
            <FieldRow label={t("settings.username")}>
              <input autoComplete="off" value={p.webdav.user} onChange={(e) => p.webdav.setUser(e.target.value)} className="pv-field" style={{ width: "100%" }} />
            </FieldRow>
            <FieldRow label={t("settings.password")}>
              <input type="password" autoComplete="new-password" value={p.webdav.pass} onChange={(e) => p.webdav.setPass(e.target.value)} className="pv-field" style={{ width: "100%" }} />
            </FieldRow>
            <FormFooter
              buttons={
                <>
                  <button onClick={p.webdav.onBrowse} disabled={p.webdav.saving || !p.webdav.url || !p.webdav.user || !p.webdav.pass} className="pv-btn pv-btn--secondary">{t("settings.browseServer")}</button>
                  <button onClick={p.webdav.onSave} disabled={p.webdav.saving} className="pv-btn pv-btn--primary">{t("settings.save")}</button>
                  <button onClick={p.webdav.onDisconnect} className="pv-btn pv-btn--danger-soft">{t("settings.disconnect")}</button>
                </>
              }
            />
          </>
        )}

        {p.provider === "drive" && (
          <>
            <SettingCardNote>
              <div style={{ lineHeight: 1.5 }}>{t("settings.driveByoDesc")}</div>
              <div style={{ marginTop: "0.5rem" }}><ByoBadgeRow guidePage={GDRIVE_BYO_GUIDE} /></div>
            </SettingCardNote>
            <FieldRow label={t("settings.clientId")}>
              <input autoComplete="off" value={p.drive.clientId} onChange={(e) => p.drive.setClientId(e.target.value)} placeholder="xxxxxxxx.apps.googleusercontent.com" className="pv-field" style={{ width: "100%" }} />
            </FieldRow>
            <FieldRow label={t("settings.clientSecret")}>
              <input type="password" autoComplete="new-password" value={p.drive.clientSecret} onChange={(e) => p.drive.setClientSecret(e.target.value)} className="pv-field" style={{ width: "100%" }} />
            </FieldRow>
            <FieldRow label={t("settings.driveFolder")} desc={t("settings.driveFolderDesc")}>
              <input autoComplete="off" readOnly value={p.drive.folderName} placeholder="Plainva" className="pv-field" style={{ width: "100%" }} />
            </FieldRow>
            <FormFooter
              buttons={
                <>
                  <button onClick={p.drive.onBrowse} disabled={p.drive.saving || !p.drive.connected} title={!p.drive.connected ? t("settings.pickerConnectFirst") : undefined} className="pv-btn pv-btn--secondary">{t("settings.browseFolders")}</button>
                  <button onClick={p.drive.onAuthorize} disabled={p.drive.saving || !p.drive.clientId || !p.drive.clientSecret} className="pv-btn pv-btn--primary">{p.drive.connected ? t("settings.reconnectGoogle") : t("settings.connectGoogle")}</button>
                  <button onClick={p.drive.onSave} disabled={p.drive.saving} className="pv-btn pv-btn--secondary">{t("settings.save")}</button>
                  <button onClick={p.drive.onDisconnect} className="pv-btn pv-btn--danger-soft">{t("settings.disconnect")}</button>
                </>
              }
              status={
                p.drive.saving
                  ? t("settings.driveAuthProgress")
                  : p.drive.error
                    ? t("settings.error", { error: p.drive.error })
                    : p.drive.connected
                      ? t("settings.driveConnected")
                      : t("settings.driveAuthHint")
              }
              statusColor={p.drive.error ? "var(--error-text)" : undefined}
            />
          </>
        )}

        {p.provider === "onedrive" && (
          <>
            <SettingCardNote>
              <div style={{ lineHeight: 1.5 }}>{t("settings.oneDriveDesc")}</div>
              {!PLAINVA_ONEDRIVE_CLIENT_ID && <div style={{ marginTop: "0.5rem" }}><ByoBadgeRow guidePage={ONEDRIVE_DROPBOX_BYO_GUIDE} /></div>}
            </SettingCardNote>
            {!PLAINVA_ONEDRIVE_CLIENT_ID || p.oneDrive.showId ? (
              <FieldRow label={t("settings.clientId")} desc={t("settings.oneDriveClientIdDesc")}>
                <input autoComplete="off" value={p.oneDrive.clientId} onChange={(e) => p.oneDrive.setClientId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" className="pv-field" style={{ width: "100%" }} />
              </FieldRow>
            ) : (
              <SettingCardNote>
                <button type="button" onClick={() => p.oneDrive.setShowId(true)} className="pv-linkbtn" style={{ padding: 0 }}>{t("settings.useOwnAppId")}</button>
              </SettingCardNote>
            )}
            <FieldRow label={t("settings.oneDriveFolder")} desc={t("settings.oneDriveFolderDesc")}>
              <input autoComplete="off" readOnly value={p.oneDrive.folderName} placeholder="Plainva" className="pv-field" style={{ width: "100%" }} />
            </FieldRow>
            <FormFooter
              buttons={
                <>
                  <button onClick={p.oneDrive.onBrowse} disabled={p.oneDrive.saving || !p.oneDrive.connected} title={!p.oneDrive.connected ? t("settings.pickerConnectFirst") : undefined} className="pv-btn pv-btn--secondary">{t("settings.browseFolders")}</button>
                  <button onClick={p.oneDrive.onAuthorize} disabled={p.oneDrive.saving || !(p.oneDrive.clientId || PLAINVA_ONEDRIVE_CLIENT_ID)} className="pv-btn pv-btn--primary">{p.oneDrive.connected ? t("settings.reconnectOneDrive") : t("settings.connectOneDrive")}</button>
                  <button onClick={p.oneDrive.onSave} disabled={p.oneDrive.saving} className="pv-btn pv-btn--secondary">{t("settings.save")}</button>
                  <button onClick={p.oneDrive.onDisconnect} className="pv-btn pv-btn--danger-soft">{t("settings.disconnect")}</button>
                </>
              }
              status={
                p.oneDrive.saving
                  ? t("settings.oneDriveAuthProgress")
                  : p.oneDrive.error
                    ? t("settings.error", { error: p.oneDrive.error })
                    : p.oneDrive.connected
                      ? t("settings.oneDriveConnected")
                      : t("settings.oneDriveAuthHint")
              }
              statusColor={p.oneDrive.error ? "var(--error-text)" : undefined}
            />
          </>
        )}

        {p.provider === "dropbox" && (
          <>
            <SettingCardNote>
              <div style={{ lineHeight: 1.5 }}>{t("settings.dropboxDesc")}</div>
              {!PLAINVA_DROPBOX_APP_KEY && <div style={{ marginTop: "0.5rem" }}><ByoBadgeRow guidePage={ONEDRIVE_DROPBOX_BYO_GUIDE} /></div>}
            </SettingCardNote>
            {!PLAINVA_DROPBOX_APP_KEY || p.dropbox.showKey ? (
              <FieldRow label={t("settings.appKey")} desc={t("settings.dropboxAppKeyDesc")}>
                <input autoComplete="off" value={p.dropbox.appKey} onChange={(e) => p.dropbox.setAppKey(e.target.value)} className="pv-field" style={{ width: "100%" }} />
              </FieldRow>
            ) : (
              <SettingCardNote>
                <button type="button" onClick={() => p.dropbox.setShowKey(true)} className="pv-linkbtn" style={{ padding: 0 }}>{t("settings.useOwnAppId")}</button>
              </SettingCardNote>
            )}
            <FieldRow label={t("settings.dropboxRootPath")} desc={t("settings.dropboxRootPathDesc")}>
              <input autoComplete="off" readOnly value={p.dropbox.rootPath} placeholder="/Plainva" className="pv-field" style={{ width: "100%" }} />
            </FieldRow>
            <FormFooter
              buttons={
                <>
                  <button onClick={p.dropbox.onBrowse} disabled={p.dropbox.saving || !p.dropbox.connected} title={!p.dropbox.connected ? t("settings.pickerConnectFirst") : undefined} className="pv-btn pv-btn--secondary">{t("settings.browseFolders")}</button>
                  <button onClick={p.dropbox.onAuthorize} disabled={p.dropbox.saving || !(p.dropbox.appKey || PLAINVA_DROPBOX_APP_KEY)} className="pv-btn pv-btn--primary">{p.dropbox.connected ? t("settings.reconnectDropbox") : t("settings.connectDropbox")}</button>
                  <button onClick={p.dropbox.onSave} disabled={p.dropbox.saving} className="pv-btn pv-btn--secondary">{t("settings.save")}</button>
                  <button onClick={p.dropbox.onDisconnect} className="pv-btn pv-btn--danger-soft">{t("settings.disconnect")}</button>
                </>
              }
              status={
                p.dropbox.saving
                  ? t("settings.dropboxAuthProgress")
                  : p.dropbox.error
                    ? t("settings.error", { error: p.dropbox.error })
                    : p.dropbox.connected
                      ? t("settings.dropboxConnected")
                      : t("settings.dropboxAuthHint")
              }
              statusColor={p.dropbox.error ? "var(--error-text)" : undefined}
            />
          </>
        )}

        {p.provider === "s3" && (
          <>
            <SettingCardNote>
              <div style={{ lineHeight: 1.5 }}>{t("settings.s3Desc")}</div>
            </SettingCardNote>
            <FieldRow label={t("settings.s3Endpoint")} desc={t("settings.s3EndpointDesc")}>
              <input autoComplete="off" value={p.s3.endpoint} onChange={(e) => p.s3.setEndpoint(e.target.value)} placeholder="https://s3.eu-central-1.amazonaws.com" className="pv-field" style={{ width: "100%" }} />
            </FieldRow>
            <FieldRow label={t("settings.s3Bucket")}>
              <input autoComplete="off" value={p.s3.bucket} onChange={(e) => p.s3.setBucket(e.target.value)} className="pv-field" style={{ width: "100%" }} />
            </FieldRow>
            <FieldRow label={t("settings.s3Region")} desc={t("settings.s3RegionDesc")}>
              <input autoComplete="off" value={p.s3.region} onChange={(e) => p.s3.setRegion(e.target.value)} placeholder="us-east-1" className="pv-field" style={{ width: "100%" }} />
            </FieldRow>
            <FieldRow label={t("settings.s3AccessKeyId")}>
              <input autoComplete="off" value={p.s3.accessKeyId} onChange={(e) => p.s3.setAccessKeyId(e.target.value)} className="pv-field" style={{ width: "100%" }} />
            </FieldRow>
            <FieldRow label={t("settings.s3SecretAccessKey")}>
              <input type="password" autoComplete="new-password" value={p.s3.secretKey} onChange={(e) => p.s3.setSecretKey(e.target.value)} className="pv-field" style={{ width: "100%" }} />
            </FieldRow>
            <FieldRow label={t("settings.s3Prefix")} desc={t("settings.s3PrefixDesc")}>
              <input autoComplete="off" value={p.s3.prefix} onChange={(e) => p.s3.setPrefix(e.target.value)} placeholder="vault" className="pv-field" style={{ width: "100%" }} />
            </FieldRow>
            <SettingRow label={t("settings.s3PathStyle")} desc={t("settings.s3PathStyleDesc")}>
              <input type="checkbox" checked={p.s3.pathStyle} onChange={(e) => p.s3.setPathStyle(e.target.checked)} style={{ width: "18px", height: "18px", accentColor: "var(--accent-color)" }} />
            </SettingRow>
            <FormFooter
              buttons={
                <>
                  <button onClick={p.s3.onBrowse} disabled={p.s3.saving || !p.s3.endpoint || !p.s3.bucket || !p.s3.accessKeyId || !p.s3.secretKey} className="pv-btn pv-btn--secondary">{t("settings.browseFolders")}</button>
                  <button onClick={p.s3.onSave} disabled={p.s3.saving || !p.s3.endpoint || !p.s3.bucket || !p.s3.accessKeyId || !p.s3.secretKey} className="pv-btn pv-btn--primary">{t("settings.save")}</button>
                  <button onClick={p.s3.onDisconnect} className="pv-btn pv-btn--danger-soft">{t("settings.disconnect")}</button>
                </>
              }
            />
          </>
        )}
      </SettingCard>

      {p.provider !== "none" && (
        <SettingCard label={t("settings.groupSyncBehavior", { defaultValue: "Verhalten" })}>
          <SettingRow label={t("settings.syncInterval")} desc={t("settings.syncIntervalDesc", { min: MIN_SYNC_INTERVAL_SECONDS })}>
            <input type="number" min={MIN_SYNC_INTERVAL_SECONDS} value={p.intervalSec} onChange={(e) => p.onIntervalChange(e.target.value)} onBlur={p.onIntervalBlur} className="pv-field" style={{ flex: 1, minWidth: 0 }} />
          </SettingRow>
          {p.isActiveVault && p.hasSyncWorker && (
            <SettingRow
              label={t("settings.syncQueue", { defaultValue: "Ausstehende Übertragungen" })}
              desc={t("settings.syncQueueDesc", { defaultValue: "Zeigt, was noch zur Cloud übertragen wird (älteste zuerst)." })}
            >
              <Button variant="secondary" size="sm" onClick={p.onLoadQueue}>
                {t("settings.perfMetricsRefresh", { defaultValue: "Anzeigen/Aktualisieren" })}
              </Button>
            </SettingRow>
          )}
          {p.isActiveVault && p.syncQueueSnapshot && (
            <SettingCardNote>
              {p.syncQueueSnapshot.total === 0
                ? t("settings.syncQueueEmpty", { defaultValue: "Nichts ausstehend — alles übertragen." })
                : (
                  <>
                    <div style={{ marginBottom: "0.3rem" }}>
                      {t("settings.syncQueueCount", { defaultValue: "{{n}} Operation(en) ausstehend:", n: p.syncQueueSnapshot.total })}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem", maxHeight: 140, overflowY: "auto", border: "1px solid var(--border-color-light)", borderRadius: "var(--radius-sm)", padding: "0.4rem 0.6rem" }}>
                      {p.syncQueueSnapshot.items.map((it, i) => (
                        <div key={`${it.file_path}-${i}`} style={{ overflowWrap: "anywhere" }}>
                          <span style={{ color: "var(--text-faint)" }}>{it.operation}</span>{" "}
                          {it.file_path}
                          {it.retry_count > 0 ? ` (${t("settings.syncQueueRetries", { defaultValue: "Versuch {{n}}", n: it.retry_count + 1 })})` : ""}
                        </div>
                      ))}
                    </div>
                  </>
                )}
            </SettingCardNote>
          )}
          {p.isActiveVault && syncStatusStore.getErrorHistory().length > 0 && (
            <SettingCardNote>
              <div style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--text-main)", marginBottom: "0.3rem" }}>{t("settings.syncErrorHistory")}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem", maxHeight: 140, overflowY: "auto", border: "1px solid var(--border-color-light)", borderRadius: "var(--radius-sm)", padding: "0.4rem 0.6rem" }}>
                {[...syncStatusStore.getErrorHistory()].reverse().map((e, i) => (
                  <div key={`${e.ts}-${i}`} style={{ fontSize: "0.76rem", color: "var(--text-muted)", overflowWrap: "anywhere" }}>
                    <span style={{ color: "var(--text-faint)" }}>{new Intl.DateTimeFormat(i18n.language, { dateStyle: "short", timeStyle: "medium" }).format(new Date(e.ts))}</span>{" — "}{e.message}
                  </div>
                ))}
              </div>
            </SettingCardNote>
          )}
        </SettingCard>
      )}
    </div>
  );
};
