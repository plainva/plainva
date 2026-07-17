import React, { useState, useEffect, useRef } from "react";
import { getSettingsStore } from "../services/settingsStore";
import { listVaultFolders as sharedListVaultFolders } from "../services/vaultFolders";
import { open as openFolderDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "@plainva/ui";
import { mkdir } from "@tauri-apps/plugin-fs";
import { openPath } from "@tauri-apps/plugin-opener";
import { Cloud, Folder, Settings2, Keyboard } from "lucide-react";
import { DEFAULT_BACKUP_RETENTION } from "@plainva/core";
import {
  DEFAULT_ZIP_KEEP,
  backupMaxAgeDaysKey,
  backupMaxCountKey,
  backupSnapshotIntervalKey,
  backupZipDestKey,
  backupZipEnabledKey,
  backupZipKeepKey,
  defaultZipDestination,
  loadBackupRetentionSettings,
  loadZipBackupSettings,
} from "../services/backupPolicy";
import { credentialManager } from "../services/CredentialManager";
import { runDriveAuthorization } from "../services/driveAuth";
import { runOneDriveAuthorization } from "../services/oneDriveAuth";
import { runDropboxAuthorization } from "../services/dropboxAuth";
import { PLAINVA_ONEDRIVE_CLIENT_ID, PLAINVA_DROPBOX_APP_KEY } from "@plainva/ui";
import { GDRIVE_BYO_GUIDE, ONEDRIVE_DROPBOX_BYO_GUIDE, userGuideUrl } from "../services/docsLinks";
import { WebDavFolderPickerModal } from "./WebDavFolderPickerModal";
import { SyncFolderPickerModal } from "./SyncFolderPickerModal";
import { buildDriveTarget, buildOneDriveTarget, buildDropboxTarget, buildS3Target } from "../services/syncTargets";
import { ShortcutsModal } from "./ShortcutsModal";
import { PimAccountsSection } from "./pim/PimAccountsSection";
import { MailAccountsSection } from "./mail/MailAccountsSection";
import { useVault, DEFAULT_SYNC_INTERVAL_SECONDS, MIN_SYNC_INTERVAL_SECONDS, syncIntervalKey, dailyNotesFolderKey, dailyNotesFormatKey, templateFolderKey, dailyNoteTemplateKey, extendedDatabasesKey, taskDatabaseKey, SHOW_COMPATIBILITY_WARNING_KEY, defaultNoteTypeKey, dailyNoteTypeKey, DEFAULT_NOTE_TYPE, DEFAULT_DAILY_NOTE_TYPE } from "../contexts/VaultContext";
import { appPrompt } from "../services/appDialogs";
import { createTaskDatabase } from "../services/taskDatabase";
import { scanVaultOkf } from "../services/okfConversion";
import { OkfConversionModal } from "./OkfConversionModal";
import { OkfInfoModal } from "./OkfInfoModal";
import { IndexMdModal } from "./IndexMdModal";
import { ThemePref, getStoredThemePref, setStoredThemePref, setStoredThemeName, getThemeDef, isModePinned } from "../services/theme";
import { APP_LANGUAGES } from "@plainva/ui";
import { ThemePickerCards } from "./ThemePickerCards";
import { Select } from "./Select";
import { useTranslation } from "react-i18next";
import { changeAppLanguage } from "@plainva/ui/i18n";
import { Modal } from "@plainva/ui";
import { getStoredDensity, setStoredDensity, DEFAULT_DENSITY, type Density } from "../services/density";
import { getWeekStartSetting, setWeekStartSetting, type WeekStartSetting } from "../services/weekStart";
import { getStoredContentFont, setStoredContentFont, DEFAULT_CONTENT_FONT_SIZE, MIN_CONTENT_FONT_SIZE, MAX_CONTENT_FONT_SIZE, type ContentFontSettings, type ContentFontFamily } from "../services/contentFont";
import { getStoredUiZoom, setStoredUiZoom, DEFAULT_UI_ZOOM, MIN_UI_ZOOM, MAX_UI_ZOOM, UI_ZOOM_STEP } from "../services/uiZoom";
import { getStoredDefaultViewMode, setStoredDefaultViewMode, DEFAULT_VIEW_MODE, type EditorViewMode } from "../services/viewModeDefault";
import type { Update } from "@tauri-apps/plugin-updater";
import { checkForAppUpdate, downloadAndInstallUpdate, getAutoUpdateCheck, setAutoUpdateCheck } from "../services/appUpdate";
import { formatDiagnosticsExport } from "@plainva/ui";
import { syncStatusStore } from "../services/syncStatusStore";
import { Button, IconButton } from "@plainva/ui";

interface SettingsModalProps {
  onClose: () => void;
  /** Preselects a sync-provider form once (splash online-vault deep link). */
  initialProvider?: string;
}

const GENERAL = "general";

const basename = (p: string) => p.split(/[/\\]/).pop() || p;

const SettingRow: React.FC<{ label: string; desc?: string; children: React.ReactNode }> = ({ label, desc, children }) => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1.5rem", padding: "0.9rem 0", borderBottom: "1px solid var(--border-color-light)" }}>
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--text-main)" }}>{label}</div>
      {desc && <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "2px", maxWidth: "460px" }}>{desc}</div>}
    </div>
    <div style={{ flexShrink: 0, width: "300px", maxWidth: "46%", display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>{children}</div>
  </div>
);

// BYO marker + handbook deep link for provider forms (P3.12): rendered while
// providerDefaults ship empty (no central app registration yet). Mirrors the
// splash badge, plus the guide the splash cannot link.
const ByoBadgeRow: React.FC<{ guidePage: string }> = ({ guidePage }) => {
  const { t } = useTranslation();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", margin: "0.5rem 0 0.25rem", flexWrap: "wrap" }}>
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

export const SettingsModal: React.FC<SettingsModalProps> = ({ onClose, initialProvider }) => {
  const { vaultPath, recentVaults, vaultAdapter, queryService, autoOpenLastVault, setAutoOpenLastVault, syncWorker, refreshVault } = useVault();
  const [reindexRunning, setReindexRunning] = useState(false);
  const [syncQueueSnapshot, setSyncQueueSnapshot] = useState<{ total: number; items: Array<{ operation: string; file_path: string; retry_count: number }> } | null>(null);
  const initialProviderRef = useRef<string | null>(initialProvider ?? null);
  const { t, i18n } = useTranslation();

  const vaults = Array.from(new Set([vaultPath, ...recentVaults].filter(Boolean) as string[]));

  const [section, setSection] = useState<string>(vaultPath || GENERAL);
  // Which vault the VAULT areas show (two-worlds nav); the dropdown changes it.
  const [selectedVault, setSelectedVault] = useState<string>(vaultPath || vaults[0] || "");
  const [appLanguage, setAppLanguage] = useState<string>(i18n.language || "en");
  const [density, setDensity] = useState<Density>(DEFAULT_DENSITY);
  useEffect(() => { getStoredDensity().then(setDensity).catch(() => {}); }, []);
  const [weekStart, setWeekStart] = useState<WeekStartSetting>("monday");
  useEffect(() => { getWeekStartSetting().then(setWeekStart).catch(() => {}); }, []);
  const [defaultViewMode, setDefaultViewMode] = useState<EditorViewMode>(DEFAULT_VIEW_MODE);
  useEffect(() => { getStoredDefaultViewMode().then(setDefaultViewMode).catch(() => {}); }, []);
  const [contentFont, setContentFont] = useState<ContentFontSettings>({ size: DEFAULT_CONTENT_FONT_SIZE, family: "theme", customName: "" });
  useEffect(() => { getStoredContentFont().then(setContentFont).catch(() => {}); }, []);
  const [uiZoom, setUiZoom] = useState<number>(DEFAULT_UI_ZOOM);
  useEffect(() => { getStoredUiZoom().then(setUiZoom).catch(() => {}); }, []);
  const [themePref, setThemePref] = useState<ThemePref>("system");
  const [themeName, setThemeName] = useState<string>(() => document.documentElement.getAttribute("data-theme-name") || "petrol");
  const [intervalSec, setIntervalSec] = useState(String(DEFAULT_SYNC_INTERVAL_SECONDS));
  const [showCompatibilityWarning, setShowCompatibilityWarning] = useState(true);
  const [url, setUrl] = useState("");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [saving, setSaving] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  // Remote-folder picker for the cloud providers (2026-07-06) — which provider
  // form requested it; null = closed. WebDAV keeps its own modal above.
  const [syncPicker, setSyncPicker] = useState<"drive" | "onedrive" | "dropbox" | "s3" | null>(null);
  // In-vault folder picker for the daily-notes and template folders (2026-07-11):
  // reuses the sync picker UI with a listing that walks the OPEN vault, so the
  // browse buttons are gated to the active vault like the other vault actions.
  const [vaultFolderPicker, setVaultFolderPicker] = useState<"daily" | "templates" | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [configuredVaults, setConfiguredVaults] = useState<Set<string>>(new Set());

  // Google Drive BYO (ADR 0006). Authorization (refreshToken) is filled by the native
  // loopback OAuth flow (A1, maintainer-verified); the UI here is the BYO client entry.
  const [driveClientId, setDriveClientId] = useState("");
  const [driveClientSecret, setDriveClientSecret] = useState("");
  const [driveFolderName, setDriveFolderName] = useState("");
  const [driveConnected, setDriveConnected] = useState(false);
  const [driveSaving, setDriveSaving] = useState(false);
  const [driveError, setDriveError] = useState<string | null>(null);

  // OneDrive (public client, no secret; sync-provider plan 2026-07-04). This state holds
  // ONLY a user's own BYO client id; empty means "use the shipped PLAINVA_ONEDRIVE_CLIENT_ID".
  const [oneDriveClientId, setOneDriveClientId] = useState("");
  const [oneDriveFolderName, setOneDriveFolderName] = useState("");
  const [oneDriveConnected, setOneDriveConnected] = useState(false);
  const [oneDriveSaving, setOneDriveSaving] = useState(false);
  const [oneDriveError, setOneDriveError] = useState<string | null>(null);
  // Once an official client id ships (providerDefaults), the id field is hidden behind
  // an optional "use your own app id" toggle; only BYO users ever need to see it.
  const [oneDriveShowId, setOneDriveShowId] = useState(false);

  // Dropbox (public client, fixed loopback port; sync-provider plan 2026-07-04).
  const [dropboxAppKey, setDropboxAppKey] = useState("");
  const [dropboxRootPath, setDropboxRootPath] = useState("");
  const [dropboxConnected, setDropboxConnected] = useState(false);
  const [dropboxSaving, setDropboxSaving] = useState(false);
  const [dropboxError, setDropboxError] = useState<string | null>(null);
  const [dropboxShowKey, setDropboxShowKey] = useState(false);

  // S3-compatible object storage (key-based, no OAuth).
  const [s3Endpoint, setS3Endpoint] = useState("");
  const [s3Region, setS3Region] = useState("");
  const [s3Bucket, setS3Bucket] = useState("");
  const [s3AccessKeyId, setS3AccessKeyId] = useState("");
  const [s3SecretKey, setS3SecretKey] = useState("");
  const [s3Prefix, setS3Prefix] = useState("");
  const [s3PathStyle, setS3PathStyle] = useState(true);
  const [s3Saving, setS3Saving] = useState(false);

  // One sync provider per vault (XOR). `provider` is the form selection (which
  // config panel is shown); `activeProvider` reflects what is actually saved, so
  // the UI can show the real state even after the user picks a different option
  // in the dropdown without saving/disconnecting yet.
  type SyncProvider = "none" | "webdav" | "drive" | "onedrive" | "dropbox" | "s3";
  const [provider, setProvider] = useState<SyncProvider>("none");
  const [activeProvider, setActiveProvider] = useState<SyncProvider>("none");

  // Backup & versioning (Gesamtplan Backups & Versionierung 2026-07-05, P7).
  const [zipEnabled, setZipEnabled] = useState(true);
  const [zipKeep, setZipKeep] = useState(String(DEFAULT_ZIP_KEEP));
  const [zipDest, setZipDest] = useState("");
  const [zipDefaultDest, setZipDefaultDest] = useState("");
  const [zipLastRun, setZipLastRun] = useState(0);
  const [zipStatus, setZipStatus] = useState<{ state: "idle" | "running" | "done" | "error"; message?: string; fileCount?: number }>({ state: "idle" });
  const [snapshotIntervalSec, setSnapshotIntervalSec] = useState(String(DEFAULT_BACKUP_RETENTION.minSnapshotIntervalSeconds));
  const [versionMaxCount, setVersionMaxCount] = useState(String(DEFAULT_BACKUP_RETENTION.maxBackupsPerFile));
  const [versionMaxAgeDays, setVersionMaxAgeDays] = useState(String(DEFAULT_BACKUP_RETENTION.maxAgeDays));

  // Feature settings
  const [dailyNotesFolder, setDailyNotesFolder] = useState("");
  const [dailyNotesFormat, setDailyNotesFormat] = useState("YYYY-MM-DD");
  const [templateFolder, setTemplateFolder] = useState("Templates");
  const [dailyNoteTemplate, setDailyNoteTemplate] = useState("");
  const [templateFiles, setTemplateFiles] = useState<string[]>([]);
  const [extendedDatabases, setExtendedDatabases] = useState(true);
  // Standard task database (PIM plan 1a): the `.base` promoted tasks land in.
  const [taskDatabase, setTaskDatabase] = useState("");
  const [baseFiles, setBaseFiles] = useState<{ path: string; title: string }[]>([]);

  // OKF (Gesamtplan W8): default types for new notes + conversion entry point.
  // The conversion block is shown only while violations exist — it disappears
  // after a conversion and reappears when new non-conforming files show up.
  const [defaultNoteType, setDefaultNoteType] = useState(DEFAULT_NOTE_TYPE);
  const [dailyNoteType, setDailyNoteType] = useState(DEFAULT_DAILY_NOTE_TYPE);
  const [okfViolations, setOkfViolations] = useState<number | null>(null);
  const [showOkfWizard, setShowOkfWizard] = useState(false);
  const [showIndexManager, setShowIndexManager] = useState(false);
  const [showOkfInfo, setShowOkfInfo] = useState(false);

  const refreshOkfScan = React.useCallback(() => {
    if (!vaultPath || !vaultAdapter || !queryService) return;
    scanVaultOkf({ vaultPath, queryService, adapter: vaultAdapter })
      .then((result) => setOkfViolations(result.violations.length))
      .catch((e) => console.warn("[Settings] OKF scan failed", e));
  }, [vaultPath, vaultAdapter, queryService]);

  useEffect(() => {
    if (section === vaultPath) refreshOkfScan();
  }, [section, vaultPath, refreshOkfScan]);

  const contentRef = useRef<HTMLDivElement>(null);

  // Updater
  const [updateStatus, setUpdateStatus] = useState<string>("");
  const [updateAvailable, setUpdateAvailable] = useState<Update | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [autoUpdateCheckEnabled, setAutoUpdateCheckEnabled] = useState(true);
  useEffect(() => {
    let alive = true;
    void getAutoUpdateCheck().then((v) => { if (alive) setAutoUpdateCheckEnabled(v); });
    return () => { alive = false; };
  }, []);

  // About / diagnostics (P4): version block, log export, report-issue link.
  // The WebView version comes from the engine token in the user agent —
  // Chromium x = WebView2/Edge WebView, AppleWebKit x = WKWebView/WebKitGTK
  // (Tauri exposes no dedicated API for it).
  const webViewVersion = (() => {
    const ua = navigator.userAgent;
    const chrome = ua.match(/Chrome\/([\d.]+)/);
    if (chrome) return `Chromium ${chrome[1]}`;
    const webkit = ua.match(/AppleWebKit\/([\d.]+)/);
    return webkit ? `WebKit ${webkit[1]}` : "-";
  })();
  const [aboutInfo, setAboutInfo] = useState<{ appVersion: string; tauriVersion: string; os: string } | null>(null);
  // Vault statistics (P4.1): note/attachment counts straight from the index.
  const [vaultStats, setVaultStats] = useState<{ notes: number; attachments: number } | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [{ getVersion, getTauriVersion }] = await Promise.all([import("@tauri-apps/api/app")]);
        const [appVersion, tauriVersion] = await Promise.all([getVersion(), getTauriVersion()]);
        if (alive) setAboutInfo({ appVersion, tauriVersion, os: navigator.userAgent.includes("Windows") ? "Windows" : navigator.userAgent.includes("Mac") ? "macOS" : "Linux" });
      } catch {
        if (alive) setAboutInfo({ appVersion: "dev", tauriVersion: "-", os: navigator.platform || "?" });
      }
    })();
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (!queryService) { setVaultStats(null); return; }
    let alive = true;
    queryService.db
      .query<{ mode: string; n: number }>(`SELECT mode, COUNT(*) AS n FROM files GROUP BY mode`)
      .then((rows) => {
        if (!alive) return;
        let notes = 0;
        let attachments = 0;
        for (const r of rows) {
          if (String(r.mode) === "attachment") attachments += Number(r.n);
          else notes += Number(r.n);
        }
        setVaultStats({ notes, attachments });
      })
      .catch(() => { if (alive) setVaultStats(null); });
    return () => { alive = false; };
  }, [queryService]);

  const [perfStats, setPerfStats] = useState<import("../services/perfMetrics").PerfStat[] | null>(null);
  const refreshPerfStats = async () => {
    const { perfStats: read } = await import("../services/perfMetrics");
    setPerfStats(read());
  };
  const handleExportPerfMetrics = async () => {
    try {
      const { perfExportJson } = await import("../services/perfMetrics");
      const { save } = await import("@tauri-apps/plugin-dialog");
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");
      const target = await save({ defaultPath: "plainva-perf.json", filters: [{ name: "JSON", extensions: ["json"] }] });
      if (!target) return;
      await writeTextFile(target, perfExportJson());
      toast.success(t("settings.diagnosticsExported"));
    } catch (e) {
      console.error("[Settings] perf export failed", e);
    }
  };

  const handleExportDiagnostics = async () => {
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");
      const target = await save({ defaultPath: "plainva-diagnose.md", filters: [{ name: "Markdown", extensions: ["md"] }] });
      if (!target) return;
      const text = formatDiagnosticsExport({
        appVersion: aboutInfo?.appVersion ?? "dev",
        tauriVersion: aboutInfo?.tauriVersion ?? "-",
        webView: webViewVersion,
        os: aboutInfo?.os ?? "?",
        language: i18n.language,
      });
      await writeTextFile(target, text);
      toast.success(t("settings.diagnosticsExported"));
    } catch (e) {
      toast.error(t("settings.diagnosticsExportFailed", { error: e instanceof Error ? e.message : String(e) }));
    }
  };

  const handleReportIssue = async () => {
    const body = encodeURIComponent(
      `Plainva ${aboutInfo?.appVersion ?? "dev"} · Tauri ${aboutInfo?.tauriVersion ?? "-"} · WebView ${webViewVersion} · ${aboutInfo?.os ?? "?"} · ${i18n.language}\n\n`
    );
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(`https://github.com/plainva/plainva/issues/new?body=${body}`);
    } catch (e) {
      toast.error(String(e));
    }
  };

  // Diagnostics
  const [keychainStatus, setKeychainStatus] = useState<string>("checking");

  // Load theme + which vaults already have sync configured.
  useEffect(() => {
    getStoredThemePref().then(setThemePref).catch(() => {});
    (async () => {
      const set = new Set<string>();
      for (const v of vaults) {
        try {
          const c = await credentialManager.getWebDavCredentials(v);
          if (c && c.url) { set.add(v); continue; }
          const d = await credentialManager.getDriveCredentials(v);
          if (d && d.clientId) { set.add(v); continue; }
          const od = await credentialManager.getOneDriveCredentials(v);
          if (od && od.clientId) { set.add(v); continue; }
          const db = await credentialManager.getDropboxCredentials(v);
          if (db && db.appKey) { set.add(v); continue; }
          const s3 = await credentialManager.getS3Credentials(v);
          if (s3 && s3.endpoint) set.add(v);
        } catch { /* ignore */ }
      }
      setConfiguredVaults(set);
      
      const store = await getSettingsStore().catch(() => null);
      if (store) {
        const showWarn = await store.get<boolean>(SHOW_COMPATIBILITY_WARNING_KEY);
        if (showWarn !== undefined && showWarn !== null) {
          setShowCompatibilityWarning(showWarn);
        }
      }
    })();
    credentialManager.checkKeychainStatus().then(setKeychainStatus).catch(() => setKeychainStatus("fallback"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load credentials for the selected vault and derive the active provider.
  useEffect(() => {
    if (section === GENERAL) return;
    setDriveError(null);
    setOneDriveError(null);
    setDropboxError(null);
    (async () => {
      const c = await credentialManager.getWebDavCredentials(section).catch(() => null);
      const d = await credentialManager.getDriveCredentials(section).catch(() => null);
      const od = await credentialManager.getOneDriveCredentials(section).catch(() => null);
      const db = await credentialManager.getDropboxCredentials(section).catch(() => null);
      const s3 = await credentialManager.getS3Credentials(section).catch(() => null);
      setUrl(c?.url || ""); setUser(c?.user || ""); setPass(c?.pass || "");
      setDriveClientId(d?.clientId || ""); setDriveClientSecret(d?.clientSecret || "");
      setDriveFolderName(d?.rootFolderName || "");
      setDriveConnected(!!d?.refreshToken);
      setOneDriveClientId(od?.clientId && od.clientId !== PLAINVA_ONEDRIVE_CLIENT_ID ? od.clientId : "");
      setOneDriveFolderName(od?.rootFolderName || "");
      setOneDriveConnected(!!od?.refreshToken);
      setOneDriveShowId(!!od?.clientId && od.clientId !== PLAINVA_ONEDRIVE_CLIENT_ID);
      setDropboxAppKey(db?.appKey && db.appKey !== PLAINVA_DROPBOX_APP_KEY ? db.appKey : "");
      setDropboxRootPath(db?.rootPath || "");
      setDropboxConnected(!!db?.refreshToken);
      setDropboxShowKey(!!db?.appKey && db.appKey !== PLAINVA_DROPBOX_APP_KEY);
      setS3Endpoint(s3?.endpoint || ""); setS3Region(s3?.region || ""); setS3Bucket(s3?.bucket || "");
      setS3AccessKeyId(s3?.accessKeyId || ""); setS3SecretKey(s3?.secretAccessKey || "");
      setS3Prefix(s3?.prefix || ""); setS3PathStyle(s3?.forcePathStyle !== false);
      const active: SyncProvider = d?.clientId
        ? "drive"
        : od?.clientId
          ? "onedrive"
          : db?.appKey
            ? "dropbox"
            : s3?.endpoint
              ? "s3"
              : c?.url
                ? "webdav"
                : "none";
      setProvider(active);
      setActiveProvider(active);
      // Splash deep link: show the wanted provider's form — the saved state
      // still decides activeProvider. The ref is NOT consumed here (the effect
      // runs twice under StrictMode and the second pass would undo the pick);
      // it clears when the user changes the provider dropdown themselves.
      const wanted = initialProviderRef.current;
      if (wanted && section === vaultPath) {
        setProvider(wanted as SyncProvider);
      }

      // Per-vault sync interval (falls back to the legacy global value, then default).
      const store = await getSettingsStore().catch(() => null);
      if (store) {
        const perVault = await store.get<number>(syncIntervalKey(section));
        const global = await store.get<number>("syncIntervalSeconds");
        setIntervalSec(String(perVault ?? global ?? DEFAULT_SYNC_INTERVAL_SECONDS));

        setDailyNotesFolder(await store.get<string>(dailyNotesFolderKey(section)) ?? "");
        setDailyNotesFormat(await store.get<string>(dailyNotesFormatKey(section)) ?? "YYYY-MM-DD");
        setTemplateFolder(await store.get<string>(templateFolderKey(section)) ?? "Templates");
        setDailyNoteTemplate(await store.get<string>(dailyNoteTemplateKey(section)) ?? "");
        setTaskDatabase(await store.get<string>(taskDatabaseKey(section)) ?? "");
        const extDb = await store.get<boolean>(extendedDatabasesKey(section));
        setExtendedDatabases(extDb ?? true);
        setDefaultNoteType((await store.get<string>(defaultNoteTypeKey(section))) || DEFAULT_NOTE_TYPE);
        setDailyNoteType((await store.get<string>(dailyNoteTypeKey(section))) || DEFAULT_DAILY_NOTE_TYPE);

        const zipSettings = await loadZipBackupSettings(store, section);
        setZipEnabled(zipSettings.enabled);
        setZipKeep(String(zipSettings.keep));
        setZipDest(zipSettings.dest);
        setZipLastRun(zipSettings.lastRun);
        setZipStatus({ state: "idle" });
        const retention = await loadBackupRetentionSettings(store, section);
        setSnapshotIntervalSec(String(retention.minSnapshotIntervalSeconds));
        setVersionMaxCount(String(retention.maxBackupsPerFile));
        setVersionMaxAgeDays(String(retention.maxAgeDays));
        defaultZipDestination(section).then(setZipDefaultDest).catch(() => setZipDefaultDest(""));
      }
    })();
    // vaultPath gates the splash deep link above; reloading on a vault switch
    // is an idempotent re-read (P5.10 — last standing lint warning).
  }, [section, vaultPath]);

  // Declared before its first hook use below (react-hooks/immutability).
  const vaultPathRef = useRef(vaultPath);
  useEffect(() => { vaultPathRef.current = vaultPath; }, [vaultPath]);

  // Inline feedback for the "Back up now" row (running/done/error).
  useEffect(() => {
    const onZipStatus = (e: Event) => {
      const d = (e as CustomEvent).detail as { vaultPath?: string; state?: string; message?: string; fileCount?: number };
      if (!d?.state || d.vaultPath !== vaultPathRef.current) return;
      if (d.state === "done") {
        setZipStatus({ state: "done", fileCount: d.fileCount });
        setZipLastRun(Date.now());
      } else if (d.state === "running" || d.state === "error") {
        setZipStatus({ state: d.state, message: d.message });
      }
    };
    window.addEventListener("plainva-backup-zip-status", onZipStatus);
    return () => window.removeEventListener("plainva-backup-zip-status", onZipStatus);
  }, []);

  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
  }, [section]);

  // Escape/overlay-close come from <Modal> (plan Designsprache P4); its modal
  // stack lets child modals own Escape while they are open.

  const handleThemeChange = (value: ThemePref) => {
    setThemePref(value);
    setStoredThemePref(value).catch(console.error);
  };

  const handleLanguageChange = async (lang: string) => {
    setAppLanguage(lang);
    await changeAppLanguage(lang); // loads the lazy locale chunk first (P2.8)
    try {
      const store = await getSettingsStore();
      await store.set("appLanguage", lang);
      await store.save();
    } catch (e) {
      console.error("Failed to save language setting", e);
    }
  };

  /**
   * P6 (Gesamtplan 2026-07-04): plain settings persist on change — only the
   * sync-provider forms keep explicit Save/Connect/Disconnect buttons (they
   * write to the OS keychain, clear competing providers and run OAuth).
   * Feature values are written immediately (the change is a deliberate user
   * action); only the reload NOTIFICATIONS are debounced, so typing a folder
   * name does not restart workers per keystroke.
   */
  const featuresEventTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const featuresEventSection = useRef<string | null>(null);
  const intervalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalFlush = useRef<(() => void) | null>(null);

  const persistFeature = async (target: string, storeKey: string, value: unknown) => {
    if (target === GENERAL) return;
    try {
      const store = await getSettingsStore();
      await store.set(storeKey, value);
      await store.save();
      if (featuresEventTimer.current) clearTimeout(featuresEventTimer.current);
      featuresEventSection.current = target;
      featuresEventTimer.current = setTimeout(() => {
        featuresEventTimer.current = null;
        if (target === vaultPathRef.current) window.dispatchEvent(new CustomEvent("plainva-features-saved"));
      }, 600);
    } catch (e) {
      console.error("Failed to save setting", e);
    }
  };

  /** Like persistFeature, but notifies the backup layer (retention lives in the running adapter). */
  const persistBackupSetting = async (target: string, storeKey: string, value: unknown) => {
    if (target === GENERAL) return;
    try {
      const store = await getSettingsStore();
      await store.set(storeKey, value);
      await store.save();
      if (target === vaultPathRef.current) window.dispatchEvent(new CustomEvent("plainva-backup-settings-changed"));
    } catch (e) {
      console.error("Failed to save backup setting", e);
    }
  };

  /** Child folder names one level below `path` in the OPEN vault (shared
   *  helper since 2026-07-17 — the .base pickers browse the same way). */
  const listVaultFolders = async (path: string): Promise<string[]> => {
    if (!vaultAdapter) return [];
    return sharedListVaultFolders(vaultAdapter, path);
  };

  // Template-folder .md files → the daily-note template becomes a dropdown
  // instead of a hand-typed filename. Only for the OPEN vault (listDir needs an
  // adapter); empty/missing folder falls back to the free-text input below.
  useEffect(() => {
    if (section !== vaultPath || !vaultAdapter || !templateFolder.trim()) {
      setTemplateFiles([]);
      return;
    }
    let cancelled = false;
    void vaultAdapter
      .listDir(templateFolder)
      .then((entries) =>
        entries
          .filter((e) => !e.isDirectory && e.name.endsWith(".md"))
          .map((e) => e.name)
          .sort((a, b) => a.localeCompare(b))
      )
      .then((files) => { if (!cancelled) setTemplateFiles(files); })
      .catch(() => { if (!cancelled) setTemplateFiles([]); });
    return () => { cancelled = true; };
  }, [section, vaultPath, vaultAdapter, templateFolder]);

  // Existing `.base` files → the standard task database becomes a dropdown.
  // Only for the OPEN vault (listBases reads its index); other vaults fall back
  // to the free-text input below.
  useEffect(() => {
    if (section !== vaultPath || !queryService) {
      setBaseFiles([]);
      return;
    }
    let cancelled = false;
    void queryService
      .listBases()
      .then((bases) => { if (!cancelled) setBaseFiles(bases); })
      .catch(() => { if (!cancelled) setBaseFiles([]); });
    return () => { cancelled = true; };
  }, [section, vaultPath, queryService]);

  /** Create a fresh task database (folder + `.base` in the template-vault
   * shape) and select it. An existing database of that name is adopted. */
  const handleCreateTaskDb = async () => {
    if (section !== vaultPath || !vaultAdapter) return;
    const name = await appPrompt({
      title: t("settings.taskDatabaseCreate"),
      message: t("settings.taskDatabaseCreateName"),
      initial: t("settings.taskDatabaseDefaultName"),
    });
    if (name === null) return;
    try {
      const path = await createTaskDatabase(vaultAdapter, name, {
        viewTable: t("database.viewTable"),
        viewBoard: t("database.viewBoard"),
        doneKey: t("tasks.dbDoneKey", { defaultValue: "done" }),
        dueKey: t("tasks.dbDueKey"),
        statusOptions: [t("tasks.dbStatusOpen"), t("tasks.dbStatusInProgress"), t("tasks.dbStatusDone")],
      });
      if (!path) return;
      // Optimistic list entry — the index picks the new file up via the
      // watcher, but the dropdown should show the selection immediately.
      const title = path.replace(/\.base$/i, "");
      setBaseFiles((prev) => (prev.some((b) => b.path === path) ? prev : [...prev, { path, title }].sort((a, b) => a.path.localeCompare(b.path))));
      setTaskDatabase(path);
      void persistFeature(section, taskDatabaseKey(section), path);
    } catch (e) {
      toast.error(String(e));
    }
  };

  const handleIntervalChange = (raw: string) => {
    setIntervalSec(raw);
    if (section === GENERAL) return;
    const target = section;
    const run = () => {
      intervalTimer.current = null;
      intervalFlush.current = null;
      const parsed = parseInt(raw, 10);
      const seconds = Number.isFinite(parsed) ? Math.max(MIN_SYNC_INTERVAL_SECONDS, parsed) : DEFAULT_SYNC_INTERVAL_SECONDS;
      void (async () => {
        const store = await getSettingsStore();
        await store.set(syncIntervalKey(target), seconds);
        await store.save();
        // Reloading the active vault restarts its worker with the new interval.
        if (target === vaultPathRef.current) window.dispatchEvent(new CustomEvent("plainva-credentials-saved", { detail: { isNewConnection: false } }));
      })();
    };
    if (intervalTimer.current) clearTimeout(intervalTimer.current);
    intervalFlush.current = run;
    intervalTimer.current = setTimeout(run, 800);
  };

  /** Blur normalizes the visible value the same way the save clamps it. */
  const normalizeIntervalDisplay = () => {
    const parsed = parseInt(intervalSec, 10);
    const seconds = Number.isFinite(parsed) ? Math.max(MIN_SYNC_INTERVAL_SECONDS, parsed) : DEFAULT_SYNC_INTERVAL_SECONDS;
    setIntervalSec(String(seconds));
  };

  // Closing the modal flushes pending debounced work instead of dropping it.
  useEffect(() => () => {
    if (featuresEventTimer.current) {
      clearTimeout(featuresEventTimer.current);
      if (featuresEventSection.current === vaultPathRef.current) window.dispatchEvent(new CustomEvent("plainva-features-saved"));
    }
    if (intervalTimer.current) {
      clearTimeout(intervalTimer.current);
      intervalFlush.current?.();
    }
  }, []);

  /**
   * XOR: exactly one sync provider per vault. Clears every provider's stored
   * credentials except `keep`, and resets the corresponding form state (OAuth id
   * fields fall back to the central defaults).
   */
  const clearOtherProviders = async (keep: SyncProvider) => {
    if (keep !== "webdav") {
      await credentialManager.clearWebDavCredentials(section);
      setUrl(""); setUser(""); setPass("");
    }
    if (keep !== "drive") {
      await credentialManager.clearDriveCredentials(section);
      setDriveClientId(""); setDriveClientSecret(""); setDriveFolderName(""); setDriveConnected(false);
    }
    if (keep !== "onedrive") {
      await credentialManager.clearOneDriveCredentials(section);
      setOneDriveClientId(""); setOneDriveShowId(false); setOneDriveFolderName(""); setOneDriveConnected(false);
    }
    if (keep !== "dropbox") {
      await credentialManager.clearDropboxCredentials(section);
      setDropboxAppKey(""); setDropboxShowKey(false); setDropboxRootPath(""); setDropboxConnected(false);
    }
    if (keep !== "s3") {
      await credentialManager.clearS3Credentials(section);
      setS3Endpoint(""); setS3Region(""); setS3Bucket(""); setS3AccessKeyId(""); setS3SecretKey(""); setS3Prefix(""); setS3PathStyle(true);
    }
  };

  const handleSaveVault = async () => {
    if (section === GENERAL) return;
    setSaving(true);
    try {
      let isNew = false;
      if (!url || !user || !pass) {
        await credentialManager.clearWebDavCredentials(section);
        setConfiguredVaults((prev) => { const n = new Set(prev); n.delete(section); return n; });
        setActiveProvider("none");
      } else {
        const existing = await credentialManager.getWebDavCredentials(section);
        isNew = !existing;
        await credentialManager.saveWebDavCredentials(section, { url, user, pass });
        await clearOtherProviders("webdav");
        setConfiguredVaults((prev) => new Set(prev).add(section));
        setActiveProvider("webdav");
      }
      // Only the currently open vault needs a live reload to apply changes.
      if (section === vaultPath) {
        window.dispatchEvent(new CustomEvent("plainva-credentials-saved", { detail: { isNewConnection: isNew } }));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    if (section === GENERAL) return;
    await credentialManager.clearWebDavCredentials(section);
    setUrl(""); setUser(""); setPass("");
    setProvider("none");
    setActiveProvider("none");
    setConfiguredVaults((prev) => { const n = new Set(prev); n.delete(section); return n; });
    if (section === vaultPath) window.dispatchEvent(new CustomEvent("plainva-credentials-saved"));
  };

  const handleSaveDrive = async () => {
    if (section === GENERAL) return;
    setDriveSaving(true);
    try {
      if (!driveClientId || !driveClientSecret) {
        await credentialManager.clearDriveCredentials(section);
        setDriveConnected(false);
        setConfiguredVaults((prev) => { const n = new Set(prev); n.delete(section); return n; });
        setActiveProvider("none");
      } else {
        const existing = await credentialManager.getDriveCredentials(section);
        // A changed client identity invalidates the old refresh token -> drop it and
        // require a fresh login. An unchanged client keeps its token (e.g. folder rename).
        const clientChanged = !!existing && (existing.clientId !== driveClientId || existing.clientSecret !== driveClientSecret);
        const refreshToken = clientChanged ? undefined : existing?.refreshToken;
        await credentialManager.saveDriveCredentials(section, {
          clientId: driveClientId,
          clientSecret: driveClientSecret,
          refreshToken,
          rootFolderName: driveFolderName || undefined,
        });
        await clearOtherProviders("drive");
        setDriveConnected(!!refreshToken);
        setConfiguredVaults((prev) => new Set(prev).add(section));
        setActiveProvider("drive");
      }
      // Apply live: reload the active vault so the worker picks up the new target/folder
      // (or stops if the token was dropped), just like WebDAV save does.
      if (section === vaultPath) {
        window.dispatchEvent(new CustomEvent("plainva-credentials-saved", { detail: { isNewConnection: false } }));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setDriveSaving(false);
    }
  };

  const handleDisconnectDrive = async () => {
    if (section === GENERAL) return;
    await credentialManager.clearDriveCredentials(section);
    setDriveClientId(""); setDriveClientSecret(""); setDriveFolderName(""); setDriveConnected(false);
    setProvider("none");
    setActiveProvider("none");
    setConfiguredVaults((prev) => { const n = new Set(prev); n.delete(section); return n; });
    // Apply live: reload so the active Drive worker actually stops.
    if (section === vaultPath) window.dispatchEvent(new CustomEvent("plainva-credentials-saved"));
  };

  // Runs the loopback OAuth flow (ADR 0006): native listener + PKCE token exchange (G3).
  const handleAuthorizeDrive = async () => {
    if (section === GENERAL || !driveClientId || !driveClientSecret) return;
    setDriveSaving(true);
    setDriveError(null);
    try {
      // Persist the client up front so it survives an aborted/failed login.
      const existing = await credentialManager.getDriveCredentials(section);
      await credentialManager.saveDriveCredentials(section, {
        clientId: driveClientId,
        clientSecret: driveClientSecret,
        refreshToken: existing?.refreshToken,
        rootFolderName: driveFolderName || undefined,
      });
      await clearOtherProviders("drive");
      setConfiguredVaults((prev) => new Set(prev).add(section));
      setActiveProvider("drive");

      await runDriveAuthorization({ clientId: driveClientId, clientSecret: driveClientSecret, vaultPath: section });
      setDriveConnected(true);
      // Reload the active vault so the sync worker picks up the Drive target.
      if (section === vaultPath) {
        window.dispatchEvent(new CustomEvent("plainva-credentials-saved", { detail: { isNewConnection: true } }));
      }
    } catch (e) {
      setDriveError(e instanceof Error ? e.message : String(e));
    } finally {
      setDriveSaving(false);
    }
  };

  // --- OneDrive (public client, loopback OAuth; sync-provider plan 2026-07-04) ---

  const handleAuthorizeOneDrive = async () => {
    const clientId = oneDriveClientId || PLAINVA_ONEDRIVE_CLIENT_ID;
    if (section === GENERAL || !clientId) return;
    setOneDriveSaving(true);
    setOneDriveError(null);
    try {
      // Persist the client up front so it survives an aborted/failed login.
      const existing = await credentialManager.getOneDriveCredentials(section);
      const clientChanged = !!existing && existing.clientId !== clientId;
      await credentialManager.saveOneDriveCredentials(section, {
        clientId,
        refreshToken: clientChanged ? undefined : existing?.refreshToken,
        rootFolderName: oneDriveFolderName || undefined,
      });
      await clearOtherProviders("onedrive");
      setConfiguredVaults((prev) => new Set(prev).add(section));
      setActiveProvider("onedrive");

      await runOneDriveAuthorization({ clientId, vaultPath: section });
      setOneDriveConnected(true);
      if (section === vaultPath) {
        window.dispatchEvent(new CustomEvent("plainva-credentials-saved", { detail: { isNewConnection: true } }));
      }
    } catch (e) {
      setOneDriveError(e instanceof Error ? e.message : String(e));
    } finally {
      setOneDriveSaving(false);
    }
  };

  const handleSaveOneDrive = async () => {
    if (section === GENERAL) return;
    const clientId = oneDriveClientId || PLAINVA_ONEDRIVE_CLIENT_ID;
    setOneDriveSaving(true);
    try {
      if (!clientId) {
        await credentialManager.clearOneDriveCredentials(section);
        setOneDriveConnected(false);
        setConfiguredVaults((prev) => { const n = new Set(prev); n.delete(section); return n; });
        setActiveProvider("none");
      } else {
        const existing = await credentialManager.getOneDriveCredentials(section);
        // A changed client invalidates the old refresh token -> require a fresh login.
        const clientChanged = !!existing && existing.clientId !== clientId;
        const refreshToken = clientChanged ? undefined : existing?.refreshToken;
        await credentialManager.saveOneDriveCredentials(section, {
          clientId,
          refreshToken,
          rootFolderName: oneDriveFolderName || undefined,
        });
        await clearOtherProviders("onedrive");
        setOneDriveConnected(!!refreshToken);
        setConfiguredVaults((prev) => new Set(prev).add(section));
        setActiveProvider("onedrive");
      }
      if (section === vaultPath) {
        window.dispatchEvent(new CustomEvent("plainva-credentials-saved", { detail: { isNewConnection: false } }));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setOneDriveSaving(false);
    }
  };

  const handleDisconnectOneDrive = async () => {
    if (section === GENERAL) return;
    await credentialManager.clearOneDriveCredentials(section);
    setOneDriveClientId(""); setOneDriveShowId(false); setOneDriveFolderName(""); setOneDriveConnected(false);
    setProvider("none");
    setActiveProvider("none");
    setConfiguredVaults((prev) => { const n = new Set(prev); n.delete(section); return n; });
    if (section === vaultPath) window.dispatchEvent(new CustomEvent("plainva-credentials-saved"));
  };

  // --- Dropbox (public client, fixed loopback port) ---

  const handleAuthorizeDropbox = async () => {
    const appKey = dropboxAppKey || PLAINVA_DROPBOX_APP_KEY;
    if (section === GENERAL || !appKey) return;
    setDropboxSaving(true);
    setDropboxError(null);
    try {
      const existing = await credentialManager.getDropboxCredentials(section);
      const keyChanged = !!existing && existing.appKey !== appKey;
      await credentialManager.saveDropboxCredentials(section, {
        appKey,
        refreshToken: keyChanged ? undefined : existing?.refreshToken,
        rootPath: dropboxRootPath || undefined,
      });
      await clearOtherProviders("dropbox");
      setConfiguredVaults((prev) => new Set(prev).add(section));
      setActiveProvider("dropbox");

      await runDropboxAuthorization({ appKey, vaultPath: section });
      setDropboxConnected(true);
      if (section === vaultPath) {
        window.dispatchEvent(new CustomEvent("plainva-credentials-saved", { detail: { isNewConnection: true } }));
      }
    } catch (e) {
      setDropboxError(e instanceof Error ? e.message : String(e));
    } finally {
      setDropboxSaving(false);
    }
  };

  const handleSaveDropbox = async () => {
    if (section === GENERAL) return;
    const appKey = dropboxAppKey || PLAINVA_DROPBOX_APP_KEY;
    setDropboxSaving(true);
    try {
      if (!appKey) {
        await credentialManager.clearDropboxCredentials(section);
        setDropboxConnected(false);
        setConfiguredVaults((prev) => { const n = new Set(prev); n.delete(section); return n; });
        setActiveProvider("none");
      } else {
        const existing = await credentialManager.getDropboxCredentials(section);
        const keyChanged = !!existing && existing.appKey !== appKey;
        const refreshToken = keyChanged ? undefined : existing?.refreshToken;
        await credentialManager.saveDropboxCredentials(section, {
          appKey,
          refreshToken,
          rootPath: dropboxRootPath || undefined,
        });
        await clearOtherProviders("dropbox");
        setDropboxConnected(!!refreshToken);
        setConfiguredVaults((prev) => new Set(prev).add(section));
        setActiveProvider("dropbox");
      }
      if (section === vaultPath) {
        window.dispatchEvent(new CustomEvent("plainva-credentials-saved", { detail: { isNewConnection: false } }));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setDropboxSaving(false);
    }
  };

  const handleDisconnectDropbox = async () => {
    if (section === GENERAL) return;
    await credentialManager.clearDropboxCredentials(section);
    setDropboxAppKey(""); setDropboxShowKey(false); setDropboxRootPath(""); setDropboxConnected(false);
    setProvider("none");
    setActiveProvider("none");
    setConfiguredVaults((prev) => { const n = new Set(prev); n.delete(section); return n; });
    if (section === vaultPath) window.dispatchEvent(new CustomEvent("plainva-credentials-saved"));
  };

  // --- S3-compatible object storage (key-based, no OAuth) ---

  const handleSaveS3 = async () => {
    if (section === GENERAL) return;
    setS3Saving(true);
    try {
      let isNew = false;
      const complete = s3Endpoint && s3Bucket && s3AccessKeyId && s3SecretKey;
      if (!complete) {
        await credentialManager.clearS3Credentials(section);
        setConfiguredVaults((prev) => { const n = new Set(prev); n.delete(section); return n; });
        setActiveProvider("none");
      } else {
        const existing = await credentialManager.getS3Credentials(section);
        isNew = !existing;
        await credentialManager.saveS3Credentials(section, {
          endpoint: s3Endpoint.trim(),
          region: s3Region.trim() || "us-east-1",
          bucket: s3Bucket.trim(),
          accessKeyId: s3AccessKeyId.trim(),
          secretAccessKey: s3SecretKey,
          prefix: s3Prefix.trim() || undefined,
          forcePathStyle: s3PathStyle,
        });
        await clearOtherProviders("s3");
        setConfiguredVaults((prev) => new Set(prev).add(section));
        setActiveProvider("s3");
      }
      if (section === vaultPath) {
        window.dispatchEvent(new CustomEvent("plainva-credentials-saved", { detail: { isNewConnection: isNew } }));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setS3Saving(false);
    }
  };

  const handleDisconnectS3 = async () => {
    if (section === GENERAL) return;
    await credentialManager.clearS3Credentials(section);
    setS3Endpoint(""); setS3Region(""); setS3Bucket(""); setS3AccessKeyId(""); setS3SecretKey(""); setS3Prefix(""); setS3PathStyle(true);
    setProvider("none");
    setActiveProvider("none");
    setConfiguredVaults((prev) => { const n = new Set(prev); n.delete(section); return n; });
    if (section === vaultPath) window.dispatchEvent(new CustomEvent("plainva-credentials-saved"));
  };

  const handleDisableSync = async () => {
    if (section === GENERAL) return;
    await clearOtherProviders("none");
    setConfiguredVaults((prev) => { const n = new Set(prev); n.delete(section); return n; });
    setActiveProvider("none");
    if (section === vaultPath) window.dispatchEvent(new CustomEvent("plainva-credentials-saved"));
  };

  /**
   * Folder listing for the cloud-provider picker (2026-07-06). Builds a
   * throwaway sync target per call: S3 from the CURRENT form values (browse
   * before saving, like WebDAV), the OAuth providers from the stored keychain
   * credentials (their Browse buttons are disabled until connected). OneDrive/
   * Dropbox may ROTATE the refresh token during the call — persist it, exactly
   * like the sync worker does (a dropped rotation kills the stored token).
   */
  const listSyncFolders = async (prov: "drive" | "onedrive" | "dropbox" | "s3", path: string): Promise<string[]> => {
    if (prov === "s3") {
      return buildS3Target({
        endpoint: s3Endpoint.trim(),
        region: s3Region.trim() || "us-east-1",
        bucket: s3Bucket.trim(),
        accessKeyId: s3AccessKeyId.trim(),
        secretAccessKey: s3SecretKey,
        forcePathStyle: s3PathStyle,
      }).listFolders(path);
    }
    if (prov === "drive") {
      const creds = await credentialManager.getDriveCredentials(section);
      if (!creds?.refreshToken) throw new Error(t("settings.pickerConnectFirst"));
      return buildDriveTarget({
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
        refreshToken: creds.refreshToken,
      }).listFolders(path);
    }
    if (prov === "onedrive") {
      const creds = await credentialManager.getOneDriveCredentials(section);
      if (!creds?.refreshToken) throw new Error(t("settings.pickerConnectFirst"));
      return buildOneDriveTarget(
        { clientId: creds.clientId || PLAINVA_ONEDRIVE_CLIENT_ID, refreshToken: creds.refreshToken },
        (refreshToken) =>
          credentialManager
            .saveOneDriveCredentials(section, { ...creds, refreshToken })
            .catch((e) => console.error("[Settings] persisting rotated OneDrive token failed", e))
      ).listFolders(path);
    }
    const creds = await credentialManager.getDropboxCredentials(section);
    if (!creds?.refreshToken) throw new Error(t("settings.pickerConnectFirst"));
    return buildDropboxTarget(
      { appKey: creds.appKey || PLAINVA_DROPBOX_APP_KEY, refreshToken: creds.refreshToken },
      (refreshToken) =>
        credentialManager
          .saveDropboxCredentials(section, { ...creds, refreshToken })
          .catch((e) => console.error("[Settings] persisting rotated Dropbox token failed", e))
    ).listFolders(path);
  };

  /** Applies a picker result to the matching provider's folder field. */
  const applySyncPickerResult = (prov: "drive" | "onedrive" | "dropbox" | "s3", picked: string) => {
    if (prov === "drive") setDriveFolderName(picked);
    else if (prov === "onedrive") setOneDriveFolderName(picked);
    else if (prov === "dropbox") setDropboxRootPath(`/${picked.replace(/^\/+/, "")}`);
    else setS3Prefix(picked);
  };

  // Updater-plugin access lives in services/appUpdate (P3.8); this component
  // only maps the result states onto its status line.
  const checkForUpdates = async () => {
    setUpdateStatus(t("settings.checkingUpdate", "Suche nach Updates..."));
    const result = await checkForAppUpdate();
    if (result.status === "available") {
      setUpdateAvailable(result.update);
      setUpdateStatus(t("settings.updateAvailable", { defaultValue: "Ein Update ist verfügbar: {{version}}", version: result.update.version }));
    } else if (result.status === "none") {
      setUpdateAvailable(null);
      setUpdateStatus(t("settings.noUpdate", "Du bist auf dem neuesten Stand."));
    } else if (result.status === "no-release") {
      setUpdateStatus(t("settings.updateErrorNoRelease", "Aktuell sind noch keine öffentlichen Updates (Releases) verfügbar."));
    } else {
      setUpdateStatus(t("settings.updateCheckError", { defaultValue: "Fehler beim Suchen: {{error}}", error: result.error }));
    }
  };

  const installUpdate = async () => {
    if (!updateAvailable) return;
    try {
      setIsUpdating(true);
      setUpdateStatus(t("settings.installingUpdate", "Lade Update herunter und installiere..."));
      await downloadAndInstallUpdate(updateAvailable);
    } catch (e) {
      setIsUpdating(false);
      setUpdateStatus(t("settings.updateInstallError", { defaultValue: "Fehler beim Installieren: {{error}}", error: String(e) }));
    }
  };


  // Two-worlds nav (settings redesign 2026-07-11, variant B): the left rail
  // shows the APP areas and the VAULT areas at once; a dropdown picks WHICH
  // vault the vault areas show. `section` still carries GENERAL vs. a vault
  // path, so every persistence handler keeps its existing contract. Clicking
  // an area of the other world switches the page first, then scrolls.
  const appAnchors = [
    { id: "sec-appearance", label: t("settings.sectionAppearance", { defaultValue: "Erscheinungsbild" }) },
    { id: "sec-editor", label: t("settings.sectionEditor", { defaultValue: "Editor & Notizen" }) },
    { id: "sec-behavior", label: t("settings.sectionBehavior", { defaultValue: "Start & Verhalten" }) },
    { id: "sec-updates", label: t("settings.updates", "Updates") },
    { id: "sec-about", label: t("settings.about") },
  ];
  const vaultAnchors = [
    { id: "sec-sync", label: t("settings.syncSection", { defaultValue: "Synchronisation" }) },
    { id: "sec-pim", label: t("settings.sectionPim", { defaultValue: "Kalender & Konten" }) },
    { id: "sec-content", label: t("settings.sectionContent", { defaultValue: "Inhalt & Struktur" }) },
    { id: "sec-backup", label: t("settings.backupSection") },
    { id: "sec-maintenance", label: t("settings.sectionMaintenance", { defaultValue: "Wartung" }) },
  ];
  const [activeAnchor, setActiveAnchor] = useState<string | null>(null);
  // Click wins: sections near the end can never scroll up to the spy line, so
  // scrollIntoView alone shows no feedback there (maintainer report 2026-07-05).
  // The click highlights its target directly and pauses the spy for the smooth
  // scroll; any real user input on the container hands control back to the spy.
  const spyPausedRef = useRef(false);
  const spyResumeTimerRef = useRef<number | undefined>(undefined);
  const jumpToAnchor = (id: string, behavior: ScrollBehavior = "smooth") => {
    setActiveAnchor(id);
    spyPausedRef.current = true;
    window.clearTimeout(spyResumeTimerRef.current);
    spyResumeTimerRef.current = window.setTimeout(() => { spyPausedRef.current = false; }, 1000);
    contentRef.current?.querySelector(`#${id}`)?.scrollIntoView({ block: "start", behavior });
  };
  // Cross-world clicks land on a page that has not rendered yet — park the
  // anchor, switch the section, jump after the new content mounted.
  const pendingJumpRef = useRef<string | null>(null);
  const openArea = (target: string, anchorId: string) => {
    if (!target) return;
    if (section === target) { jumpToAnchor(anchorId); return; }
    pendingJumpRef.current = anchorId;
    setSection(target);
  };
  useEffect(() => {
    const id = pendingJumpRef.current;
    if (!id) return;
    pendingJumpRef.current = null;
    requestAnimationFrame(() => jumpToAnchor(id, "auto"));
  }, [section]);
  useEffect(() => {
    const c = contentRef.current;
    if (!c) return;
    const ids = (section === GENERAL ? appAnchors : vaultAnchors).map((a) => a.id);
    const onScroll = () => {
      if (spyPausedRef.current) return;
      const top = c.getBoundingClientRect().top;
      let current: string | null = ids[0] ?? null;
      for (const id of ids) {
        const el = c.querySelector<HTMLElement>(`#${id}`);
        if (el && el.getBoundingClientRect().top - top <= 48) current = id;
      }
      setActiveAnchor(current);
    };
    const resumeSpy = () => {
      window.clearTimeout(spyResumeTimerRef.current);
      spyPausedRef.current = false;
    };
    resumeSpy(); // section switch: drop any pending click-pause before the initial sync
    onScroll();
    c.addEventListener("scroll", onScroll);
    c.addEventListener("wheel", resumeSpy);
    c.addEventListener("pointerdown", resumeSpy);
    c.addEventListener("keydown", resumeSpy);
    return () => {
      window.clearTimeout(spyResumeTimerRef.current);
      c.removeEventListener("scroll", onScroll);
      c.removeEventListener("wheel", resumeSpy);
      c.removeEventListener("pointerdown", resumeSpy);
      c.removeEventListener("keydown", resumeSpy);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);
  // One button per settings area. Both worlds stay visible; a click on an area
  // of the inactive world switches the page first (openArea), so the rail acts
  // as one flat map of every setting.
  const navGroupLabel: React.CSSProperties = { padding: "0 0.4rem 0.25rem", fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" };
  const navAreaBtn = (target: string, a: { id: string; label: string }) => {
    const active = section === target && activeAnchor === a.id;
    return (
      <button
        key={a.id}
        onClick={() => openArea(target, a.id)}
        className={active ? "pv-navlink is-active" : "pv-navlink"}
      >
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.label}</span>
      </button>
    );
  };

  return (
    <>
      <Modal
        onClose={onClose}
        title={t("settings.title")}
        size="xl"
        bodyClassName="pv-modal-body--flush"
      >
        <div style={{ display: "flex", flexDirection: "row", flex: 1, minHeight: 0 }}>
          {/* Left navigation: two worlds — app-wide areas above, the selected vault's areas below. */}
          <div className="custom-scrollbar" style={{ width: "220px", flexShrink: 0, borderRight: "1px solid var(--border-color)", background: "var(--bg-secondary)", padding: "0.75rem", overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <div style={{ ...navGroupLabel, display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <Settings2 size={13} color="var(--accent-color)" style={{ flexShrink: 0 }} />
              {t("settings.sectionApp", { defaultValue: "App" })}
            </div>
            {appAnchors.map((a) => navAreaBtn(GENERAL, a))}

            {vaults.length > 0 && (
              <>
                <div style={{ ...navGroupLabel, marginTop: "1rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <Folder size={13} color="var(--accent-color)" style={{ flexShrink: 0 }} />
                  {t("settings.sectionVault", { defaultValue: "Vault" })}
                </div>
                <div style={{ padding: "0 0.1rem 0.25rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Select
                      ariaLabel={t("settings.vaultSelect", { defaultValue: "Vault wählen" })}
                      value={selectedVault}
                      onChange={(v) => {
                        setSelectedVault(v);
                        setSection(v);
                      }}
                      options={vaults.map((v) => ({ value: v, label: basename(v) }))}
                    />
                  </div>
                  {configuredVaults.has(selectedVault) && <Cloud size={13} color="var(--text-muted)" style={{ flexShrink: 0 }} />}
                  {selectedVault === vaultPath && <span title={t("settings.activeVault")} style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent-color)", flexShrink: 0 }} />}
                </div>
                {vaultAnchors.map((a) => navAreaBtn(selectedVault, a))}
              </>
            )}

            <div style={{ marginTop: "auto", paddingTop: "1rem" }}>
              <button
                onClick={() => setShowShortcuts(true)}
                className="pv-navlink"
                style={{ color: "var(--text-muted)", fontSize: "0.8rem", padding: "0.4rem" }}
              >
                <Keyboard size={15} style={{ flexShrink: 0 }} />
                <span style={{ flex: 1, textAlign: "left" }}>{t("settings.showShortcuts")}</span>
                <kbd style={{ fontSize: "0.7rem", fontFamily: "monospace", border: "1px solid var(--border-color)", borderRadius: "var(--radius-xs)", padding: "0 4px", color: "var(--text-faint)", flexShrink: 0 }}>F1</kbd>
              </button>
            </div>
          </div>

          {/* Right content */}
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <div ref={contentRef} className="custom-scrollbar" style={{ flex: 1, overflowY: "auto", padding: "1.75rem" }}>
              {section === GENERAL ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
                  <div>
                    <h3 id="sec-appearance" style={{ marginTop: 0, scrollMarginTop: "8px" }}>{t("settings.sectionAppearance", { defaultValue: "Erscheinungsbild" })}</h3>
                    <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>

                      {/* Theme picker as full-width preview cards (E6). */}
                      <div style={{ padding: "0.9rem 0", borderBottom: "1px solid var(--border-color-light)", display: "flex", flexDirection: "column", gap: "0.7rem" }}>
                        <div style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--text-main)" }}>{t("settings.themeName", { defaultValue: "Theme" })}</div>
                        <ThemePickerCards
                          value={themeName}
                          onChange={(name) => { setThemeName(name); setStoredThemeName(name).catch(console.error); }}
                        />
                      </div>

                      <SettingRow
                        label={t("settings.themeMode", { defaultValue: "Modus" })}
                        desc={isModePinned(themeName) ? t("titlebar.themePinned", { defaultValue: "Modus vom Theme festgelegt" }) : undefined}
                      >
                        <div style={{ width: "100%" }}>
                          {isModePinned(themeName) ? (
                            <Select
                              ariaLabel={t("settings.themeMode", { defaultValue: "Modus" })}
                              value={getThemeDef(themeName)?.modes[0] ?? "dark"}
                              onChange={() => {}}
                              disabled
                              options={[
                                { value: "light", label: t("settings.themeLight") },
                                { value: "dark", label: t("settings.themeDark") },
                              ]}
                            />
                          ) : (
                            <Select
                              ariaLabel={t("settings.themeMode", { defaultValue: "Modus" })}
                              value={themePref}
                              onChange={(v) => handleThemeChange(v as ThemePref)}
                              options={[
                                { value: "system", label: t("settings.themeSystem") },
                                { value: "light", label: t("settings.themeLight") },
                                { value: "dark", label: t("settings.themeDark") },
                              ]}
                            />
                          )}
                        </div>
                      </SettingRow>

                      <SettingRow label={t("settings.language")}>
                        <div style={{ width: "100%" }}>
                          <Select
                            ariaLabel={t("settings.language")}
                            value={appLanguage}
                            onChange={(v) => handleLanguageChange(v)}
                            options={APP_LANGUAGES.map((l) => ({ value: l.code, label: l.nativeName }))}
                          />
                        </div>
                      </SettingRow>

                      <SettingRow
                        label={t("settings.weekStart", { defaultValue: "Wochenbeginn" })}
                        desc={t("settings.weekStartDesc", { defaultValue: "Erster Wochentag in allen Kalender-Ansichten." })}
                      >
                        <div style={{ width: "100%" }}>
                          <Select
                            ariaLabel={t("settings.weekStart", { defaultValue: "Wochenbeginn" })}
                            value={weekStart}
                            onChange={(v) => {
                              setWeekStart(v as WeekStartSetting);
                              void setWeekStartSetting(v as WeekStartSetting);
                            }}
                            options={[
                              { value: "monday", label: t("settings.weekStartMonday", { defaultValue: "Montag" }) },
                              { value: "saturday", label: t("settings.weekStartSaturday", { defaultValue: "Samstag" }) },
                              { value: "sunday", label: t("settings.weekStartSunday", { defaultValue: "Sonntag" }) },
                            ]}
                          />
                        </div>
                      </SettingRow>

                      <SettingRow
                        label={t("settings.density", { defaultValue: "Kompaktheitsgrad" })}
                        desc={t("settings.densityDesc", { defaultValue: "Kompakt verdichtet Dateibaum, Listen, Menüs und Tabellen; der Notiz-Inhalt bleibt unverändert." })}
                      >
                        <div style={{ width: "100%" }}>
                          <Select
                            ariaLabel={t("settings.density", { defaultValue: "Kompaktheitsgrad" })}
                            value={density}
                            onChange={(v) => { setDensity(v as Density); void setStoredDensity(v as Density); }}
                            options={[
                              { value: "comfortable", label: t("settings.densityComfortable", { defaultValue: "Standard" }) },
                              { value: "compact", label: t("settings.densityCompact", { defaultValue: "Kompakt" }) },
                            ]}
                          />
                        </div>
                      </SettingRow>

                      <SettingRow
                        label={t("settings.uiZoom", { defaultValue: "Oberflächen-Zoom" })}
                        desc={t("settings.uiZoomDesc", { defaultValue: "Skaliert die gesamte Oberfläche. Auch per Strg/Cmd + Plus/Minus; 0 setzt zurück." })}
                      >
                        <div style={{ width: "100%" }}>
                          <Select
                            ariaLabel={t("settings.uiZoom", { defaultValue: "Oberflächen-Zoom" })}
                            value={String(uiZoom)}
                            onChange={(v) => {
                              const z = Number(v);
                              setUiZoom(z);
                              void setStoredUiZoom(z);
                            }}
                            options={Array.from(
                              { length: (MAX_UI_ZOOM - MIN_UI_ZOOM) / UI_ZOOM_STEP + 1 },
                              (_, i) => MIN_UI_ZOOM + i * UI_ZOOM_STEP
                            ).map((z) => ({ value: String(z), label: `${z} %${z === DEFAULT_UI_ZOOM ? ` (${t("settings.uiZoomDefault", { defaultValue: "Standard" })})` : ""}` }))}
                          />
                        </div>
                      </SettingRow>

                      <h4 id="sec-editor" style={{ marginTop: "1.5rem", marginBottom: "0.25rem", scrollMarginTop: "8px" }}>{t("settings.sectionEditor", { defaultValue: "Editor & Notizen" })}</h4>
                      <SettingRow
                        label={t("settings.defaultViewMode", { defaultValue: "Standard-Ansicht" })}
                        desc={t("settings.defaultViewModeDesc", { defaultValue: "Notizen öffnen in dieser Ansicht; ein manueller Wechsel gilt je Datei für die laufende Sitzung." })}
                      >
                        <div style={{ width: "100%" }}>
                          <Select
                            ariaLabel={t("settings.defaultViewMode", { defaultValue: "Standard-Ansicht" })}
                            value={defaultViewMode}
                            onChange={(v) => { setDefaultViewMode(v as EditorViewMode); void setStoredDefaultViewMode(v as EditorViewMode); }}
                            options={[
                              { value: "read", label: t("editor.readMode") },
                              { value: "live", label: t("editor.livePreview") },
                              { value: "source", label: t("editor.sourceMode") },
                            ]}
                          />
                        </div>
                      </SettingRow>

                      <SettingRow
                        label={t("settings.contentFontSize", { defaultValue: "Inhalts-Schriftgröße" })}
                        desc={t("settings.contentFontSizeDesc", { defaultValue: "Schriftgröße von Editor und Leseansicht; die Oberfläche bleibt unverändert." })}
                      >
                        <div style={{ width: "100%", display: "flex", alignItems: "center", gap: "10px" }}>
                          <input
                            type="range"
                            min={MIN_CONTENT_FONT_SIZE}
                            max={MAX_CONTENT_FONT_SIZE}
                            step={1}
                            value={contentFont.size}
                            aria-label={t("settings.contentFontSize", { defaultValue: "Inhalts-Schriftgröße" })}
                            onChange={(e) => {
                              const next = { ...contentFont, size: Number(e.target.value) };
                              setContentFont(next);
                              void setStoredContentFont(next);
                            }}
                            style={{ flex: 1 }}
                          />
                          <span style={{ minWidth: "44px", textAlign: "right", fontSize: "0.85rem", color: "var(--text-muted)" }}>
                            {contentFont.size} px
                          </span>
                        </div>
                      </SettingRow>

                      <SettingRow
                        label={t("settings.contentFontFamily", { defaultValue: "Inhalts-Schriftart" })}
                        desc={t("settings.contentFontFamilyDesc", { defaultValue: "Schriftart des Notiz-Inhalts. „Theme-Standard“ folgt dem gewählten Theme." })}
                      >
                        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "8px" }}>
                          <Select
                            ariaLabel={t("settings.contentFontFamily", { defaultValue: "Inhalts-Schriftart" })}
                            value={contentFont.family}
                            onChange={(v) => {
                              const next = { ...contentFont, family: v as ContentFontFamily };
                              setContentFont(next);
                              void setStoredContentFont(next);
                            }}
                            options={[
                              { value: "theme", label: t("settings.fontTheme", { defaultValue: "Theme-Standard" }) },
                              { value: "serif", label: t("settings.fontSerif", { defaultValue: "Serif" }) },
                              { value: "sans", label: t("settings.fontSans", { defaultValue: "Sans-Serif" }) },
                              { value: "mono", label: t("settings.fontMono", { defaultValue: "Monospace" }) },
                              { value: "custom", label: t("settings.fontCustom", { defaultValue: "Benutzerdefiniert…" }) },
                            ]}
                          />
                          {contentFont.family === "custom" && (
                            <input
                              autoComplete="off"
                              value={contentFont.customName}
                              placeholder={t("settings.fontCustomPlaceholder", { defaultValue: "Name einer installierten Schriftart" })}
                              onChange={(e) => {
                                const next = { ...contentFont, customName: e.target.value };
                                setContentFont(next);
                                void setStoredContentFont(next);
                              }}
                              className="pv-field" style={{ width: "100%" }}
                            />
                          )}
                        </div>
                      </SettingRow>

                      <h4 id="sec-behavior" style={{ marginTop: "1.5rem", marginBottom: "0.25rem", scrollMarginTop: "8px" }}>{t("settings.sectionBehavior", { defaultValue: "Start & Verhalten" })}</h4>
                      <SettingRow label={t("splash.autoOpenLastVault")} desc={t("settings.autoOpenLastVaultDesc")}>
                        <input type="checkbox" id="autoOpenLastVault" aria-label={t("splash.autoOpenLastVault")} checked={autoOpenLastVault} onChange={(e) => { void setAutoOpenLastVault(e.target.checked); }} />
                      </SettingRow>
                      <SettingRow label={t("settings.showCompatWarning")}>
                        <input type="checkbox" id="showCompat" aria-label={t("settings.showCompatWarning")} checked={showCompatibilityWarning} onChange={async (e) => {
                          const val = e.target.checked;
                          setShowCompatibilityWarning(val);
                          const store = await getSettingsStore();
                          await store.set(SHOW_COMPATIBILITY_WARNING_KEY, val);
                          await store.save();
                        }} />
                      </SettingRow>

                      <h4 id="sec-updates" style={{ marginTop: "1.5rem", marginBottom: "0.25rem", scrollMarginTop: "8px" }}>{t("settings.updates", "Updates")}</h4>
                      <SettingRow label={t("settings.autoUpdateCheck")} desc={t("settings.autoUpdateCheckDesc")}>
                        <input type="checkbox" id="autoUpdateCheck" aria-label={t("settings.autoUpdateCheck")} checked={autoUpdateCheckEnabled} onChange={(e) => {
                          const val = e.target.checked;
                          setAutoUpdateCheckEnabled(val);
                          void setAutoUpdateCheck(val);
                        }} />
                      </SettingRow>
                      <SettingRow label={t("settings.updates", "Updates")} desc={updateStatus || undefined}>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.5rem" }}>
                          <button
                            onClick={checkForUpdates}
                            disabled={isUpdating}
                            className="pv-btn pv-btn--secondary" style={{ cursor: isUpdating ? "not-allowed" : "pointer" }}
                          >
                            {t("settings.checkUpdates", "Nach Updates suchen")}
                          </button>
                          {updateAvailable && !isUpdating && (
                            <button
                              onClick={installUpdate}
                              className="pv-btn pv-btn--primary"
                            >
                              {t("settings.installUpdate", "Jetzt installieren & Neustarten")}
                            </button>
                          )}
                        </div>
                      </SettingRow>

                      <h4 id="sec-about" style={{ marginTop: "1.5rem", marginBottom: "0.25rem", scrollMarginTop: "8px" }}>{t("settings.about")}</h4>
                      <SettingRow label={t("settings.aboutVersions")} desc={aboutInfo ? `Plainva ${aboutInfo.appVersion} · Tauri ${aboutInfo.tauriVersion} · WebView ${webViewVersion} · ${aboutInfo.os}` : "…"}>
                        <Button variant="secondary" size="sm" onClick={() => { void handleExportDiagnostics(); }}>
                          {t("settings.exportDiagnostics")}
                        </Button>
                      </SettingRow>
                      <SettingRow label={t("settings.osKeychain")}>
                        <strong style={{ color: keychainStatus === "native" ? "var(--accent-color)" : "var(--error-text)", fontSize: "0.9rem" }}>{keychainStatus === "checking" ? t("settings.keychainChecking") : keychainStatus === "native" ? t("settings.keychainNative") : t("settings.keychainFallback")}</strong>
                      </SettingRow>
                      <SettingRow label={t("settings.perfMetrics", { defaultValue: "Performance-Messwerte" })} desc={t("settings.perfMetricsDesc", { defaultValue: "Lokale Messpunkte dieser Sitzung (Median/p95 in ms) — verlassen das Gerät nie." })}>
                        <div style={{ display: "flex", gap: "8px" }}>
                          <Button variant="secondary" size="sm" onClick={() => { void refreshPerfStats(); }}>
                            {t("settings.perfMetricsRefresh", { defaultValue: "Anzeigen/Aktualisieren" })}
                          </Button>
                          <Button variant="secondary" size="sm" onClick={() => { void handleExportPerfMetrics(); }}>
                            {t("settings.perfMetricsExport", { defaultValue: "Als JSON exportieren…" })}
                          </Button>
                        </div>
                      </SettingRow>
                      {perfStats && perfStats.length > 0 && (
                        <div style={{ margin: "0 0 0.75rem", fontSize: "0.78rem", color: "var(--text-muted)" }}>
                          <table style={{ borderCollapse: "collapse", width: "100%" }}>
                            <thead>
                              <tr>
                                <th style={{ textAlign: "left", padding: "2px 8px 2px 0" }}>{t("settings.perfMetricPoint", { defaultValue: "Messpunkt" })}</th>
                                <th style={{ textAlign: "right", padding: "2px 8px" }}>n</th>
                                <th style={{ textAlign: "right", padding: "2px 8px" }}>Median</th>
                                <th style={{ textAlign: "right", padding: "2px 8px" }}>p95</th>
                              </tr>
                            </thead>
                            <tbody>
                              {perfStats.map((s) => (
                                <tr key={s.name}>
                                  <td style={{ padding: "2px 8px 2px 0" }}>{s.name}</td>
                                  <td style={{ textAlign: "right", padding: "2px 8px" }}>{s.count}</td>
                                  <td style={{ textAlign: "right", padding: "2px 8px" }}>{s.medianMs} ms</td>
                                  <td style={{ textAlign: "right", padding: "2px 8px" }}>{s.p95Ms} ms</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {perfStats && perfStats.length === 0 && (
                        <div style={{ margin: "0 0 0.75rem", fontSize: "0.78rem", color: "var(--text-muted)" }}>
                          {t("settings.perfMetricsEmpty", { defaultValue: "Noch keine Messwerte in dieser Sitzung." })}
                        </div>
                      )}
                      <SettingRow label={t("settings.reportIssue")} desc={t("settings.reportIssueDesc")}>
                        <Button variant="secondary" size="sm" onClick={() => { void handleReportIssue(); }}>
                          {t("settings.reportIssueAction")}
                        </Button>
                      </SettingRow>
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  <h3 style={{ marginTop: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <Folder size={18} color="var(--accent-color)" /> {basename(section)}
                    {section === vaultPath && <span style={{ fontSize: "0.75rem", color: "var(--accent-color)", border: "1px solid var(--accent-color)", borderRadius: "var(--radius-xs)", padding: "0 0.4rem" }}>{t("settings.activeVault")}</span>}
                  </h3>
                  <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", wordBreak: "break-all", marginBottom: "0.5rem" }}>{section}</div>

                  <h4 id="sec-sync" style={{ marginTop: 0, marginBottom: "0.25rem", scrollMarginTop: "8px" }}>{t("settings.syncSection", { defaultValue: "Synchronisation" })}</h4>
                  <SettingRow
                    label={t("settings.provider")}
                    desc={`${t("settings.activeSync")}: ${
                      activeProvider === "webdav" ? t("settings.providerWebDav")
                      : activeProvider === "drive" ? t("settings.providerDrive")
                      : activeProvider === "onedrive" ? t("settings.providerOneDrive")
                      : activeProvider === "dropbox" ? t("settings.providerDropbox")
                      : activeProvider === "s3" ? t("settings.providerS3")
                      : t("settings.providerNone")
                    }`}
                  >
                    <div style={{ width: "100%" }}>
                      <Select
                        ariaLabel={t("settings.provider")}
                        value={provider}
                        onChange={(v) => { initialProviderRef.current = null; setProvider(v as SyncProvider); setDriveError(null); setOneDriveError(null); setDropboxError(null); }}
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
                  {provider !== activeProvider && activeProvider !== "none" && (
                    <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", display: "block", marginTop: "0.5rem" }}>
                      {t("settings.activeSyncHint")}
                    </span>
                  )}
                  {provider !== "none" && (
                    <span style={{ fontSize: "0.8rem", color: "var(--text-faint)", display: "block", marginTop: "0.25rem" }}>
                      {t("settings.providerSaveHint")}
                    </span>
                  )}

                  {provider === "none" && (
                    <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                      <span>{t("sync.none")}</span>
                      {activeProvider !== "none" && (
                        <button onClick={handleDisableSync} className="pv-btn pv-btn--danger-soft" style={{ alignSelf: "flex-start" }}>{t("sync.disconnect")}</button>
                      )}
                    </div>
                  )}

                  {provider === "webdav" && (
                    <>
                      <SettingRow label={t("settings.serverUrl")}>
                        <input autoComplete="off" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://nextcloud.example.com/remote.php/webdav" className="pv-field" style={{ width: "100%" }} />
                      </SettingRow>
                      <SettingRow label={t("settings.username")}>
                        <input autoComplete="off" value={user} onChange={(e) => setUser(e.target.value)} className="pv-field" style={{ width: "100%" }} />
                      </SettingRow>
                      <SettingRow label={t("settings.password")}>
                        <input type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} className="pv-field" style={{ width: "100%" }} />
                      </SettingRow>
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
                        <button onClick={() => setShowPicker(true)} disabled={saving || !url || !user || !pass} className="pv-btn pv-btn--secondary">{t("settings.browseServer")}</button>
                        <button onClick={handleSaveVault} disabled={saving} className="pv-btn pv-btn--primary">{t("settings.save")}</button>
                        <button onClick={handleDisconnect} className="pv-btn pv-btn--danger-soft">{t("settings.disconnect")}</button>
                      </div>
                    </>
                  )}

                  {provider === "drive" && (
                    <>
                      <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: "0.75rem 0 0.25rem", lineHeight: 1.5 }}>
                        {t("settings.driveByoDesc")}
                      </div>
                      <ByoBadgeRow guidePage={GDRIVE_BYO_GUIDE} />
                      <SettingRow label={t("settings.clientId")}>
                        <input autoComplete="off" value={driveClientId} onChange={(e) => setDriveClientId(e.target.value)} placeholder="xxxxxxxx.apps.googleusercontent.com" className="pv-field" style={{ width: "100%" }} />
                      </SettingRow>
                      <SettingRow label={t("settings.clientSecret")}>
                        <input type="password" autoComplete="new-password" value={driveClientSecret} onChange={(e) => setDriveClientSecret(e.target.value)} className="pv-field" style={{ width: "100%" }} />
                      </SettingRow>
                      <SettingRow label={t("settings.driveFolder")} desc={t("settings.driveFolderDesc")}>
                        <input autoComplete="off" readOnly value={driveFolderName} placeholder="Plainva" className="pv-field" style={{ width: "100%" }} />
                      </SettingRow>
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
                        <button onClick={() => setSyncPicker("drive")} disabled={driveSaving || !driveConnected} title={!driveConnected ? t("settings.pickerConnectFirst") : undefined} className="pv-btn pv-btn--secondary">{t("settings.browseFolders")}</button>
                        <button onClick={handleAuthorizeDrive} disabled={driveSaving || !driveClientId || !driveClientSecret} className="pv-btn pv-btn--primary">{driveConnected ? t("settings.reconnectGoogle") : t("settings.connectGoogle")}</button>
                        <button onClick={handleSaveDrive} disabled={driveSaving} className="pv-btn pv-btn--secondary">{t("settings.save")}</button>
                        <button onClick={handleDisconnectDrive} className="pv-btn pv-btn--danger-soft">{t("settings.disconnect")}</button>
                      </div>
                      <span style={{ fontSize: "0.8rem", color: driveError ? "var(--error-text)" : "var(--text-muted)", marginTop: "0.5rem", display: "block" }}>
                        {driveSaving
                          ? t("settings.driveAuthProgress")
                          : driveError
                            ? t("settings.error", { error: driveError })
                            : driveConnected
                              ? t("settings.driveConnected")
                              : t("settings.driveAuthHint")}
                      </span>
                    </>
                  )}

                  {provider === "onedrive" && (
                    <>
                      <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: "0.75rem 0 0.25rem", lineHeight: 1.5 }}>
                        {t("settings.oneDriveDesc")}
                      </div>
                      {!PLAINVA_ONEDRIVE_CLIENT_ID && <ByoBadgeRow guidePage={ONEDRIVE_DROPBOX_BYO_GUIDE} />}
                      {!PLAINVA_ONEDRIVE_CLIENT_ID || oneDriveShowId ? (
                        <SettingRow label={t("settings.clientId")} desc={t("settings.oneDriveClientIdDesc")}>
                          <input autoComplete="off" value={oneDriveClientId} onChange={(e) => setOneDriveClientId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" className="pv-field" style={{ width: "100%" }} />
                        </SettingRow>
                      ) : (
                        <button type="button" onClick={() => setOneDriveShowId(true)} className="pv-linkbtn" style={{ alignSelf: "flex-start", padding: "0.4rem 0" }}>{t("settings.useOwnAppId")}</button>
                      )}
                      <SettingRow label={t("settings.oneDriveFolder")} desc={t("settings.oneDriveFolderDesc")}>
                        <input autoComplete="off" readOnly value={oneDriveFolderName} placeholder="Plainva" className="pv-field" style={{ width: "100%" }} />
                      </SettingRow>
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
                        <button onClick={() => setSyncPicker("onedrive")} disabled={oneDriveSaving || !oneDriveConnected} title={!oneDriveConnected ? t("settings.pickerConnectFirst") : undefined} className="pv-btn pv-btn--secondary">{t("settings.browseFolders")}</button>
                        <button onClick={handleAuthorizeOneDrive} disabled={oneDriveSaving || !(oneDriveClientId || PLAINVA_ONEDRIVE_CLIENT_ID)} className="pv-btn pv-btn--primary">{oneDriveConnected ? t("settings.reconnectOneDrive") : t("settings.connectOneDrive")}</button>
                        <button onClick={handleSaveOneDrive} disabled={oneDriveSaving} className="pv-btn pv-btn--secondary">{t("settings.save")}</button>
                        <button onClick={handleDisconnectOneDrive} className="pv-btn pv-btn--danger-soft">{t("settings.disconnect")}</button>
                      </div>
                      <span style={{ fontSize: "0.8rem", color: oneDriveError ? "var(--error-text)" : "var(--text-muted)", marginTop: "0.5rem", display: "block" }}>
                        {oneDriveSaving
                          ? t("settings.oneDriveAuthProgress")
                          : oneDriveError
                            ? t("settings.error", { error: oneDriveError })
                            : oneDriveConnected
                              ? t("settings.oneDriveConnected")
                              : t("settings.oneDriveAuthHint")}
                      </span>
                    </>
                  )}

                  {provider === "dropbox" && (
                    <>
                      <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: "0.75rem 0 0.25rem", lineHeight: 1.5 }}>
                        {t("settings.dropboxDesc")}
                      </div>
                      {!PLAINVA_DROPBOX_APP_KEY && <ByoBadgeRow guidePage={ONEDRIVE_DROPBOX_BYO_GUIDE} />}
                      {!PLAINVA_DROPBOX_APP_KEY || dropboxShowKey ? (
                        <SettingRow label={t("settings.appKey")} desc={t("settings.dropboxAppKeyDesc")}>
                          <input autoComplete="off" value={dropboxAppKey} onChange={(e) => setDropboxAppKey(e.target.value)} className="pv-field" style={{ width: "100%" }} />
                        </SettingRow>
                      ) : (
                        <button type="button" onClick={() => setDropboxShowKey(true)} className="pv-linkbtn" style={{ alignSelf: "flex-start", padding: "0.4rem 0" }}>{t("settings.useOwnAppId")}</button>
                      )}
                      <SettingRow label={t("settings.dropboxRootPath")} desc={t("settings.dropboxRootPathDesc")}>
                        <input autoComplete="off" readOnly value={dropboxRootPath} placeholder="/Plainva" className="pv-field" style={{ width: "100%" }} />
                      </SettingRow>
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
                        <button onClick={() => setSyncPicker("dropbox")} disabled={dropboxSaving || !dropboxConnected} title={!dropboxConnected ? t("settings.pickerConnectFirst") : undefined} className="pv-btn pv-btn--secondary">{t("settings.browseFolders")}</button>
                        <button onClick={handleAuthorizeDropbox} disabled={dropboxSaving || !(dropboxAppKey || PLAINVA_DROPBOX_APP_KEY)} className="pv-btn pv-btn--primary">{dropboxConnected ? t("settings.reconnectDropbox") : t("settings.connectDropbox")}</button>
                        <button onClick={handleSaveDropbox} disabled={dropboxSaving} className="pv-btn pv-btn--secondary">{t("settings.save")}</button>
                        <button onClick={handleDisconnectDropbox} className="pv-btn pv-btn--danger-soft">{t("settings.disconnect")}</button>
                      </div>
                      <span style={{ fontSize: "0.8rem", color: dropboxError ? "var(--error-text)" : "var(--text-muted)", marginTop: "0.5rem", display: "block" }}>
                        {dropboxSaving
                          ? t("settings.dropboxAuthProgress")
                          : dropboxError
                            ? t("settings.error", { error: dropboxError })
                            : dropboxConnected
                              ? t("settings.dropboxConnected")
                              : t("settings.dropboxAuthHint")}
                      </span>
                    </>
                  )}

                  {provider === "s3" && (
                    <>
                      <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: "0.75rem 0 0.25rem", lineHeight: 1.5 }}>
                        {t("settings.s3Desc")}
                      </div>
                      <SettingRow label={t("settings.s3Endpoint")} desc={t("settings.s3EndpointDesc")}>
                        <input autoComplete="off" value={s3Endpoint} onChange={(e) => setS3Endpoint(e.target.value)} placeholder="https://s3.eu-central-1.amazonaws.com" className="pv-field" style={{ width: "100%" }} />
                      </SettingRow>
                      <SettingRow label={t("settings.s3Bucket")}>
                        <input autoComplete="off" value={s3Bucket} onChange={(e) => setS3Bucket(e.target.value)} className="pv-field" style={{ width: "100%" }} />
                      </SettingRow>
                      <SettingRow label={t("settings.s3Region")} desc={t("settings.s3RegionDesc")}>
                        <input autoComplete="off" value={s3Region} onChange={(e) => setS3Region(e.target.value)} placeholder="us-east-1" className="pv-field" style={{ width: "100%" }} />
                      </SettingRow>
                      <SettingRow label={t("settings.s3AccessKeyId")}>
                        <input autoComplete="off" value={s3AccessKeyId} onChange={(e) => setS3AccessKeyId(e.target.value)} className="pv-field" style={{ width: "100%" }} />
                      </SettingRow>
                      <SettingRow label={t("settings.s3SecretAccessKey")}>
                        <input type="password" autoComplete="new-password" value={s3SecretKey} onChange={(e) => setS3SecretKey(e.target.value)} className="pv-field" style={{ width: "100%" }} />
                      </SettingRow>
                      <SettingRow label={t("settings.s3Prefix")} desc={t("settings.s3PrefixDesc")}>
                        <input autoComplete="off" value={s3Prefix} onChange={(e) => setS3Prefix(e.target.value)} placeholder="vault" className="pv-field" style={{ width: "100%" }} />
                      </SettingRow>
                      <SettingRow label={t("settings.s3PathStyle")} desc={t("settings.s3PathStyleDesc")}>
                        <input type="checkbox" checked={s3PathStyle} onChange={(e) => setS3PathStyle(e.target.checked)} style={{ width: "18px", height: "18px", accentColor: "var(--accent-color)" }} />
                      </SettingRow>
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
                        <button onClick={() => setSyncPicker("s3")} disabled={s3Saving || !s3Endpoint || !s3Bucket || !s3AccessKeyId || !s3SecretKey} className="pv-btn pv-btn--secondary">{t("settings.browseFolders")}</button>
                        <button onClick={handleSaveS3} disabled={s3Saving || !s3Endpoint || !s3Bucket || !s3AccessKeyId || !s3SecretKey} className="pv-btn pv-btn--primary">{t("settings.save")}</button>
                        <button onClick={handleDisconnectS3} className="pv-btn pv-btn--danger-soft">{t("settings.disconnect")}</button>
                      </div>
                    </>
                  )}

                  {provider !== "none" && (
                    <>
                      <hr style={{ border: "none", borderTop: "1px solid var(--border-color-light)", margin: "1.5rem 0 0.75rem" }} />
                      <SettingRow label={t("settings.syncInterval")} desc={t("settings.syncIntervalDesc", { min: MIN_SYNC_INTERVAL_SECONDS })}>
                        <input type="number" min={MIN_SYNC_INTERVAL_SECONDS} value={intervalSec} onChange={(e) => handleIntervalChange(e.target.value)} onBlur={normalizeIntervalDisplay} className="pv-field" style={{ flex: 1, minWidth: 0 }} />
                      </SettingRow>
                      {section === vaultPath && syncWorker && (
                        <SettingRow
                          label={t("settings.syncQueue", { defaultValue: "Ausstehende Übertragungen" })}
                          desc={t("settings.syncQueueDesc", { defaultValue: "Zeigt, was noch zur Cloud übertragen wird (älteste zuerst)." })}
                        >
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              void syncWorker
                                .listPendingOperations(20)
                                .then((snap) => setSyncQueueSnapshot(snap))
                                .catch(() => setSyncQueueSnapshot({ total: 0, items: [] }));
                            }}
                          >
                            {t("settings.perfMetricsRefresh", { defaultValue: "Anzeigen/Aktualisieren" })}
                          </Button>
                        </SettingRow>
                      )}
                      {section === vaultPath && syncQueueSnapshot && (
                        <div style={{ margin: "0 0 0.75rem", fontSize: "0.78rem", color: "var(--text-muted)" }}>
                          {syncQueueSnapshot.total === 0
                            ? t("settings.syncQueueEmpty", { defaultValue: "Nichts ausstehend — alles übertragen." })
                            : (
                              <>
                                <div style={{ marginBottom: "0.3rem" }}>
                                  {t("settings.syncQueueCount", { defaultValue: "{{n}} Operation(en) ausstehend:", n: syncQueueSnapshot.total })}
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem", maxHeight: 140, overflowY: "auto", border: "1px solid var(--border-color-light)", borderRadius: "var(--radius-sm)", padding: "0.4rem 0.6rem" }}>
                                  {syncQueueSnapshot.items.map((it, i) => (
                                    <div key={`${it.file_path}-${i}`} style={{ overflowWrap: "anywhere" }}>
                                      <span style={{ color: "var(--text-faint)" }}>{it.operation}</span>{" "}
                                      {it.file_path}
                                      {it.retry_count > 0 ? ` (${t("settings.syncQueueRetries", { defaultValue: "Versuch {{n}}", n: it.retry_count + 1 })})` : ""}
                                    </div>
                                  ))}
                                </div>
                              </>
                            )}
                        </div>
                      )}
                      {section === vaultPath && syncStatusStore.getErrorHistory().length > 0 && (
                        <div style={{ marginTop: "0.75rem" }}>
                          <div style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--text-main)", marginBottom: "0.3rem" }}>{t("settings.syncErrorHistory")}</div>
                          <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem", maxHeight: 140, overflowY: "auto", border: "1px solid var(--border-color-light)", borderRadius: "var(--radius-sm)", padding: "0.4rem 0.6rem" }}>
                            {[...syncStatusStore.getErrorHistory()].reverse().map((e, i) => (
                              <div key={`${e.ts}-${i}`} style={{ fontSize: "0.76rem", color: "var(--text-muted)", overflowWrap: "anywhere" }}>
                                <span style={{ color: "var(--text-faint)" }}>{new Intl.DateTimeFormat(i18n.language, { dateStyle: "short", timeStyle: "medium" }).format(new Date(e.ts))}</span>{" — "}{e.message}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  <hr style={{ border: "none", borderTop: "1px solid var(--border-color-light)", margin: "1.5rem 0 0.75rem" }} />
                  <h4 id="sec-pim" style={{ marginTop: 0, marginBottom: "0.4rem", scrollMarginTop: "8px" }}>{t("settings.sectionPim", { defaultValue: "Kalender & Konten" })}</h4>
                  {section === vaultPath ? (
                    <>
                      <PimAccountsSection />
                      <h5 style={{ margin: "1rem 0 0.4rem" }}>{t("mail.sectionTitle", { defaultValue: "E-Mail (IMAP, nur Lesen)" })}</h5>
                      <MailAccountsSection />
                    </>
                  ) : (
                    <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>{t("pim.openVaultFirst", { defaultValue: "Nur für den geöffneten Vault verfügbar." })}</p>
                  )}

                  <hr style={{ border: "none", borderTop: "1px solid var(--border-color-light)", margin: "1.5rem 0 0.75rem" }} />
                  <h4 id="sec-content" style={{ marginTop: 0, marginBottom: "0.25rem", scrollMarginTop: "8px" }}>{t("settings.sectionContent", { defaultValue: "Inhalt & Struktur" })}</h4>
                  <h5 style={{ margin: "0.5rem 0 0.1rem", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--text-muted)" }}>{t("settings.features")}</h5>

                  <SettingRow label={t("settings.dailyNotesFolder")}>
                    <div style={{ display: "flex", gap: "0.4rem", width: "100%", alignItems: "center" }}>
                      <input autoComplete="off" value={dailyNotesFolder} onChange={(e) => { setDailyNotesFolder(e.target.value); void persistFeature(section, dailyNotesFolderKey(section), e.target.value); }} placeholder="Tagebuch/" className="pv-field" style={{ flex: 1, minWidth: 0 }} />
                      <IconButton
                        label={t("settings.browseFolders")}
                        data-testid="browse-daily-folder"
                        disabled={section !== vaultPath}
                        onClick={() => setVaultFolderPicker("daily")}
                      >
                        <Folder size={14} />
                      </IconButton>
                    </div>
                  </SettingRow>

                  <SettingRow label={t("settings.dailyNotesFormat")} desc={t("settings.dailyNotesFormatDesc")}>
                    <input autoComplete="off" value={dailyNotesFormat} onChange={(e) => { const v = e.target.value.replace(/[./\\]/g, '-'); setDailyNotesFormat(v); void persistFeature(section, dailyNotesFormatKey(section), v); }} placeholder="YYYY-MM-DD" className="pv-field" style={{ width: "100%" }} />
                  </SettingRow>

                  <SettingRow label={t("settings.templateFolder")}>
                    <div style={{ display: "flex", gap: "0.4rem", width: "100%", alignItems: "center" }}>
                      <input autoComplete="off" value={templateFolder} onChange={(e) => { setTemplateFolder(e.target.value); void persistFeature(section, templateFolderKey(section), e.target.value); }} placeholder="Templates/" className="pv-field" style={{ flex: 1, minWidth: 0 }} />
                      <IconButton
                        label={t("settings.browseFolders")}
                        data-testid="browse-template-folder"
                        disabled={section !== vaultPath}
                        onClick={() => setVaultFolderPicker("templates")}
                      >
                        <Folder size={14} />
                      </IconButton>
                    </div>
                  </SettingRow>

                  <SettingRow label={t("settings.dailyNotesTemplate")}>
                    {templateFiles.length > 0 ? (
                      <Select
                        ariaLabel={t("settings.dailyNotesTemplate")}
                        value={templateFiles.includes(dailyNoteTemplate) ? dailyNoteTemplate : ""}
                        onChange={(v) => { setDailyNoteTemplate(v); void persistFeature(section, dailyNoteTemplateKey(section), v); }}
                        options={[{ value: "", label: "—" }, ...templateFiles.map((f) => ({ value: f, label: f }))]}
                      />
                    ) : (
                      <input autoComplete="off" value={dailyNoteTemplate} onChange={(e) => { setDailyNoteTemplate(e.target.value); void persistFeature(section, dailyNoteTemplateKey(section), e.target.value); }} placeholder="DailyTemplate.md" className="pv-field" style={{ width: "100%" }} />
                    )}
                  </SettingRow>

                  <SettingRow label={t("settings.taskDatabase")} desc={t("settings.taskDatabaseDesc")}>
                    <div style={{ display: "flex", gap: "0.4rem", width: "100%", alignItems: "center" }}>
                      {baseFiles.length > 0 ? (
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Select
                            ariaLabel={t("settings.taskDatabase")}
                            value={baseFiles.some((b) => b.path === taskDatabase) ? taskDatabase : ""}
                            onChange={(v) => { setTaskDatabase(v); void persistFeature(section, taskDatabaseKey(section), v); }}
                            options={[{ value: "", label: "—" }, ...baseFiles.map((b) => ({ value: b.path, label: b.title }))]}
                          />
                        </div>
                      ) : (
                        <input autoComplete="off" value={taskDatabase} onChange={(e) => { setTaskDatabase(e.target.value); void persistFeature(section, taskDatabaseKey(section), e.target.value); }} placeholder="Tasks.base" className="pv-field" style={{ flex: 1, minWidth: 0 }} />
                      )}
                      <button
                        onClick={() => void handleCreateTaskDb()}
                        disabled={section !== vaultPath || !vaultAdapter}
                        data-testid="create-task-db"
                        className="pv-btn pv-btn--secondary"
                        style={{ whiteSpace: "nowrap" }}
                      >
                        {t("settings.taskDatabaseCreate")}
                      </button>
                    </div>
                  </SettingRow>

                  <h5 style={{ margin: "1.25rem 0 0.1rem", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--text-muted)" }}>{t("settings.okfHeading")}</h5>

                  <SettingRow label={t("settings.defaultNoteType")} desc={t("settings.defaultNoteTypeDesc")}>
                    <input autoComplete="off" value={defaultNoteType} onChange={(e) => { setDefaultNoteType(e.target.value); void persistFeature(section, defaultNoteTypeKey(section), e.target.value.trim() || DEFAULT_NOTE_TYPE); }} placeholder={DEFAULT_NOTE_TYPE} className="pv-field" style={{ width: "100%" }} />
                  </SettingRow>

                  <SettingRow label={t("settings.dailyNoteType")} desc={t("settings.dailyNoteTypeDesc")}>
                    <input autoComplete="off" value={dailyNoteType} onChange={(e) => { setDailyNoteType(e.target.value); void persistFeature(section, dailyNoteTypeKey(section), e.target.value.trim() || DEFAULT_DAILY_NOTE_TYPE); }} placeholder={DEFAULT_DAILY_NOTE_TYPE} className="pv-field" style={{ width: "100%" }} />
                  </SettingRow>

                  {section === vaultPath && (
                    <>
                      {okfViolations !== null && okfViolations > 0 && (
                        <SettingRow
                          label={t("settings.okfConversionLabel")}
                          desc={t("settings.okfConversionDesc", { count: okfViolations })}
                        >
                          <button
                            onClick={() => setShowOkfWizard(true)}
                            className="pv-btn pv-btn--primary"
                          >
                            {t("settings.okfConversionButton")}
                          </button>
                        </SettingRow>
                      )}
                      <SettingRow label={t("okfInfo.settingsButton")} desc={t("okfInfo.settingsDesc")}>
                        <button
                          onClick={() => setShowOkfInfo(true)}
                          className="pv-btn pv-btn--secondary"
                        >
                          {t("okfInfo.settingsButton")}
                        </button>
                      </SettingRow>
                      <SettingRow label={t("settings.okfIndexLabel")} desc={t("settings.okfIndexDesc")}>
                        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                          <button
                            onClick={() => setShowIndexManager(true)}
                            className="pv-btn pv-btn--secondary"
                          >
                            {t("settings.okfIndexButton")}
                          </button>
                          <button
                            onClick={() => window.dispatchEvent(new CustomEvent("plainva-update-all-indexes"))}
                            className="pv-btn pv-btn--secondary"
                          >
                            {t("indexMd.updateAllAction")}
                          </button>
                        </div>
                      </SettingRow>
                    </>
                  )}

                  <h5 style={{ margin: "1.25rem 0 0.1rem", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--text-muted)" }}>{t("settings.extendedDatabases")}</h5>
                  <SettingRow label={t("settings.allowExtendedDb")} desc={t("settings.allowExtendedDbDesc")}>
                    <input type="checkbox" id="extDb" checked={extendedDatabases} onChange={(e) => { setExtendedDatabases(e.target.checked); void persistFeature(section, extendedDatabasesKey(section), e.target.checked); }} />
                  </SettingRow>

                  {/* Backup & Versionierung (Gesamtplan 2026-07-05, P7). Plain
                      settings persist on change; retention changes reach the
                      running adapter via plainva-backup-settings-changed. */}
                  <h4 id="sec-backup" style={{ marginTop: "1.5rem", marginBottom: "0.25rem", scrollMarginTop: "8px" }}>{t("settings.backupSection")}</h4>

                  <SettingRow label={t("settings.backupZipEnabled")} desc={t("settings.backupZipEnabledDesc")}>
                    <input
                      type="checkbox"
                      data-testid="backup-zip-enabled"
                      checked={zipEnabled}
                      onChange={(e) => { setZipEnabled(e.target.checked); void persistBackupSetting(section, backupZipEnabledKey(section), e.target.checked); }}
                    />
                  </SettingRow>

                  <SettingRow label={t("settings.backupZipDest")} desc={zipDest || zipDefaultDest || undefined}>
                    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <button
                        onClick={async () => {
                          const picked = await openFolderDialog({ directory: true, multiple: false, title: t("settings.backupZipChoose") }).catch(() => null);
                          if (typeof picked === "string" && picked) {
                            setZipDest(picked);
                            void persistBackupSetting(section, backupZipDestKey(section), picked);
                          }
                        }}
                        className="pv-btn pv-btn--secondary"
                      >
                        {t("settings.backupZipChoose")}
                      </button>
                      {zipDest && (
                        <button
                          onClick={() => { setZipDest(""); void persistBackupSetting(section, backupZipDestKey(section), ""); }}
                          className="pv-btn pv-btn--secondary"
                        >
                          {t("settings.backupZipDefault")}
                        </button>
                      )}
                      <button
                        onClick={async () => {
                          const dir = zipDest || zipDefaultDest;
                          if (!dir) return;
                          try {
                            // The folder only exists after the first backup ran;
                            // create it so Explorer never errors on a missing path.
                            await mkdir(dir, { recursive: true }).catch(() => {});
                            await openPath(dir);
                          } catch (e) {
                            toast.error(String(e));
                          }
                        }}
                        className="pv-btn pv-btn--secondary"
                      >
                        {t("settings.backupZipOpen")}
                      </button>
                    </div>
                  </SettingRow>

                  <SettingRow label={t("settings.backupZipKeep")} desc={t("settings.backupZipKeepDesc")}>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={zipKeep}
                      onChange={(e) => {
                        setZipKeep(e.target.value);
                        const n = Math.min(50, Math.max(1, parseInt(e.target.value, 10) || DEFAULT_ZIP_KEEP));
                        void persistBackupSetting(section, backupZipKeepKey(section), n);
                      }}
                      className="pv-field" style={{ width: "90px" }}
                    />
                  </SettingRow>

                  {section === vaultPath && (
                    <SettingRow
                      label={t("settings.backupNow")}
                      desc={
                        zipStatus.state === "running"
                          ? t("settings.backupRunning")
                          : zipStatus.state === "error"
                            ? t("settings.backupError", { message: zipStatus.message ?? "" })
                            : zipLastRun
                              ? t("settings.backupLastRun", { when: new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(zipLastRun)) })
                              : t("settings.backupNever")
                      }
                    >
                      <button
                        data-testid="backup-now"
                        disabled={zipStatus.state === "running"}
                        onClick={() => window.dispatchEvent(new CustomEvent("plainva-backup-now", { detail: { vaultPath: section } }))}
                        className="pv-btn pv-btn--primary" style={{ opacity: zipStatus.state === "running" ? 0.6 : 1 }}
                      >
                        {t("settings.backupNowButton")}
                      </button>
                    </SettingRow>
                  )}

                  <SettingRow label={t("settings.versionInterval")} desc={t("settings.versionIntervalDesc")}>
                    <Select
                      ariaLabel={t("settings.versionInterval")}
                      value={snapshotIntervalSec}
                      minWidth={180}
                      align="right"
                      options={[
                        { value: "0", label: t("settings.versionIntervalEvery") },
                        { value: "30", label: "30 s" },
                        { value: "120", label: "2 min" },
                        { value: "300", label: "5 min" },
                        { value: "600", label: "10 min" },
                      ]}
                      onChange={(v) => { setSnapshotIntervalSec(v); void persistBackupSetting(section, backupSnapshotIntervalKey(section), parseInt(v, 10)); }}
                    />
                  </SettingRow>

                  <SettingRow label={t("settings.versionMaxCount")} desc={t("settings.versionMaxCountDesc")}>
                    <input
                      type="number"
                      min={5}
                      max={1000}
                      value={versionMaxCount}
                      onChange={(e) => {
                        setVersionMaxCount(e.target.value);
                        const n = Math.min(1000, Math.max(5, parseInt(e.target.value, 10) || DEFAULT_BACKUP_RETENTION.maxBackupsPerFile));
                        void persistBackupSetting(section, backupMaxCountKey(section), n);
                      }}
                      className="pv-field" style={{ width: "90px" }}
                    />
                  </SettingRow>

                  <SettingRow label={t("settings.versionMaxAge")} desc={t("settings.versionMaxAgeDesc")}>
                    <Select
                      ariaLabel={t("settings.versionMaxAge")}
                      value={versionMaxAgeDays}
                      minWidth={180}
                      align="right"
                      options={[
                        { value: "30", label: t("settings.versionAgeDays", { days: 30 }) },
                        { value: "90", label: t("settings.versionAgeDays", { days: 90 }) },
                        { value: "180", label: t("settings.versionAgeDays", { days: 180 }) },
                        { value: "365", label: t("settings.versionAgeDays", { days: 365 }) },
                        { value: "0", label: t("settings.versionAgeUnlimited") },
                      ]}
                      onChange={(v) => { setVersionMaxAgeDays(v); void persistBackupSetting(section, backupMaxAgeDaysKey(section), parseInt(v, 10)); }}
                    />
                  </SettingRow>

                  {/* Maintenance (settings redesign 2026-07-11): repair/recovery
                      actions and the vault's stats — everything here operates on
                      the OPEN vault, hence the active-vault gate per row. */}
                  <h4 id="sec-maintenance" style={{ marginTop: "1.5rem", marginBottom: "0.25rem", scrollMarginTop: "8px" }}>{t("settings.sectionMaintenance", { defaultValue: "Wartung" })}</h4>
                  {section === vaultPath && (
                    <>
                      <SettingRow
                        label={t("settings.rebuildIndex", { defaultValue: "Suchindex" })}
                        desc={t("settings.rebuildIndexDesc", { defaultValue: "Baut den Suchindex dieses Vaults komplett neu auf — hilft, wenn Suche, Backlinks oder Datenbanken veraltet wirken." })}
                      >
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={reindexRunning}
                          onClick={() => {
                            setReindexRunning(true);
                            void refreshVault()
                              .catch((e) => console.error("[Settings] reindex failed", e))
                              .finally(() => setReindexRunning(false));
                          }}
                        >
                          {reindexRunning ? t("settings.rebuildIndexRunning", { defaultValue: "Läuft…" }) : t("settings.rebuildIndexAction", { defaultValue: "Index neu aufbauen" })}
                        </Button>
                      </SettingRow>
                      <SettingRow label={t("versions.deletedTitle")} desc={t("settings.deletedFilesDesc")}>
                        <button
                          data-testid="settings-deleted-files"
                          onClick={() => { window.dispatchEvent(new CustomEvent("plainva-show-deleted-files")); onClose(); }}
                          className="pv-btn pv-btn--secondary"
                        >
                          {t("settings.deletedFilesButton")}
                        </button>
                      </SettingRow>
                      {vaultStats && (
                        <SettingRow
                          label={t("settings.vaultStats", { defaultValue: "Vault-Statistik" })}
                          desc={t("settings.vaultStatsValue", { defaultValue: "Notizen: {{notes}} · Anhänge: {{attachments}}", notes: vaultStats.notes, attachments: vaultStats.attachments })}
                        >
                          <span />
                        </SettingRow>
                      )}
                    </>
                  )}

                  {section !== vaultPath && (
                    <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.5rem", display: "block" }}>
                      {t("settings.vaultNotOpenHint")}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </Modal>

      {showPicker && (
        <WebDavFolderPickerModal
          initialUrl={url}
          user={user}
          pass={pass}
          onSelect={(selectedUrl) => { setUrl(selectedUrl); setShowPicker(false); }}
          onCancel={() => setShowPicker(false)}
        />
      )}
      {syncPicker && (
        <SyncFolderPickerModal
          // An empty S3 prefix (bucket root) is a valid configuration.
          allowRoot={syncPicker === "s3"}
          rootLabel={
            syncPicker === "s3" ? (s3Bucket.trim() || "S3")
              : syncPicker === "drive" ? "Google Drive"
                : syncPicker === "onedrive" ? "OneDrive"
                  : "Dropbox"
          }
          listFolders={(p) => listSyncFolders(syncPicker, p)}
          onSelect={(picked) => { applySyncPickerResult(syncPicker, picked); setSyncPicker(null); }}
          onCancel={() => setSyncPicker(null)}
        />
      )}
      {vaultFolderPicker && (
        <SyncFolderPickerModal
          // The vault root is a legitimate pick for both fields ("" = root).
          allowRoot
          rootLabel={basename(section)}
          listFolders={listVaultFolders}
          onSelect={(picked) => {
            if (vaultFolderPicker === "daily") {
              setDailyNotesFolder(picked);
              void persistFeature(section, dailyNotesFolderKey(section), picked);
            } else {
              setTemplateFolder(picked);
              void persistFeature(section, templateFolderKey(section), picked);
            }
            setVaultFolderPicker(null);
          }}
          onCancel={() => setVaultFolderPicker(null)}
        />
      )}
      {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}
      {showOkfWizard && (
        <OkfConversionModal
          onClose={() => setShowOkfWizard(false)}
          onConverted={refreshOkfScan}
          onOpenIndexManager={() => setShowIndexManager(true)}
        />
      )}
      {showIndexManager && <IndexMdModal onClose={() => { setShowIndexManager(false); refreshOkfScan(); }} />}
      {showOkfInfo && <OkfInfoModal onClose={() => setShowOkfInfo(false)} />}
    </>
  );
};
