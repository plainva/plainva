import React, { useState, useEffect, useRef } from "react";
import { getSettingsStore } from "../services/settingsStore";
import { listVaultFolders as sharedListVaultFolders } from "../services/vaultFolders";
import { open as openFolderDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "@plainva/ui";
import { mkdir } from "@tauri-apps/plugin-fs";
import { openPath } from "@tauri-apps/plugin-opener";
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
import { PLAINVA_ONEDRIVE_CLIENT_ID, PLAINVA_DROPBOX_APP_KEY, firstSettingsArea, settingsArea, type SettingsWorld } from "@plainva/ui";
import { WebDavFolderPickerModal } from "./WebDavFolderPickerModal";
import { SyncFolderPickerModal } from "./SyncFolderPickerModal";
import { buildDriveTarget, buildOneDriveTarget, buildDropboxTarget, buildS3Target } from "../services/syncTargets";
import { ShortcutsModal } from "./ShortcutsModal";
import { useVault, DEFAULT_SYNC_INTERVAL_SECONDS, MIN_SYNC_INTERVAL_SECONDS, syncIntervalKey, dailyNotesFolderKey, dailyNotesFormatKey, templateFolderKey, dailyNoteTemplateKey, extendedDatabasesKey, taskDatabaseKey, SHOW_COMPATIBILITY_WARNING_KEY, defaultNoteTypeKey, dailyNoteTypeKey, DEFAULT_NOTE_TYPE, DEFAULT_DAILY_NOTE_TYPE } from "../contexts/VaultContext";
import { appPrompt } from "../services/appDialogs";
import { createTaskDatabase } from "../services/taskDatabase";
import { scanVaultOkf } from "../services/okfConversion";
import { OkfConversionModal } from "./OkfConversionModal";
import { OkfInfoModal } from "./OkfInfoModal";
import { IndexMdModal } from "./IndexMdModal";
import { ThemePref, getStoredThemePref, setStoredThemePref, setStoredThemeName } from "../services/theme";
import { useTranslation } from "react-i18next";
import { changeAppLanguage } from "@plainva/ui/i18n";
import { Modal } from "@plainva/ui";
import { getStoredDensity, setStoredDensity, DEFAULT_DENSITY, type Density } from "../services/density";
import { getWeekStartSetting, setWeekStartSetting, type WeekStartSetting } from "../services/weekStart";
import { getStoredContentFont, setStoredContentFont, DEFAULT_CONTENT_FONT_SIZE, type ContentFontSettings } from "../services/contentFont";
import { getStoredUiZoom, setStoredUiZoom, DEFAULT_UI_ZOOM } from "../services/uiZoom";
import { getStoredDefaultViewMode, setStoredDefaultViewMode, DEFAULT_VIEW_MODE, type EditorViewMode } from "../services/viewModeDefault";
import type { Update } from "@tauri-apps/plugin-updater";
import { checkForAppUpdate, downloadAndInstallUpdate, getAutoUpdateCheck, setAutoUpdateCheck } from "../services/appUpdate";
import { formatDiagnosticsExport } from "@plainva/ui";
import { SettingsNav } from "./settings/SettingsNav";
import { VaultPickerModal } from "./settings/VaultPickerModal";
import { AppearancePage, EditorPage, BehaviorPage, UpdatesPage, AboutPage } from "./settings/AppPages";
import { SyncPage, type SyncProvider } from "./settings/SyncPage";
import { PimPage, ContentPage, BackupPage, MaintenancePage, clampZipKeep, clampVersionMaxCount } from "./settings/VaultPages";

interface SettingsModalProps {
  onClose: () => void;
  /** Preselects a sync-provider form once (splash online-vault deep link). */
  initialProvider?: string;
  /** Opens a specific VAULT settings page (e.g. "backup" from the status-bar
   * backup-error chip, "pim" from the mail/calendar empty states). */
  initialArea?: string;
}

const GENERAL = "general";

const basename = (p: string) => p.split(/[/\\]/).pop() || p;

export const SettingsModal: React.FC<SettingsModalProps> = ({ onClose, initialProvider, initialArea }) => {
  const { vaultPath, recentVaults, vaultAdapter, queryService, autoOpenLastVault, setAutoOpenLastVault, syncWorker, refreshVault } = useVault();
  const [reindexRunning, setReindexRunning] = useState(false);
  const [syncQueueSnapshot, setSyncQueueSnapshot] = useState<{ total: number; items: Array<{ operation: string; file_path: string; retry_count: number }> } | null>(null);
  const initialProviderRef = useRef<string | null>(initialProvider ?? null);
  const { t, i18n } = useTranslation();

  const vaults = Array.from(new Set([vaultPath, ...recentVaults].filter(Boolean) as string[]));

  const [section, setSection] = useState<string>(vaultPath || GENERAL);
  // Which vault the VAULT areas show (two-worlds nav); the identity card's
  // "switch" link changes it via the vault picker (redesign P2 — no dropdown).
  const [selectedVault, setSelectedVault] = useState<string>(vaultPath || vaults[0] || "");
  // One PAGE per settings area (redesign P2): clicking a rail entry renders
  // exactly that area — the scroll-spy over one long document is gone.
  const [appPage, setAppPage] = useState<string>(firstSettingsArea("app").id);
  const [vaultPage, setVaultPage] = useState<string>(() =>
    initialArea && settingsArea(initialArea)?.world === "vault" ? initialArea : firstSettingsArea("vault").id
  );
  const [showVaultPicker, setShowVaultPicker] = useState(false);
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

  // A page switch starts at the top of the fresh page.
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
  }, [section, appPage, vaultPage]);

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

  // One page per area (redesign P2): a rail click renders exactly that page.
  // The section contract (GENERAL vs. vault path) is untouched — it still
  // decides which WORLD the content shows and keys every persistence handler.
  const openArea = (world: SettingsWorld, areaId: string) => {
    if (world === "app") {
      setSection(GENERAL);
      setAppPage(areaId);
    } else {
      if (selectedVault) setSection(selectedVault);
      setVaultPage(areaId);
    }
  };

  const isActiveVault = section === vaultPath;

  const zipStatusDesc =
    zipStatus.state === "running"
      ? t("settings.backupRunning")
      : zipStatus.state === "error"
        ? t("settings.backupError", { message: zipStatus.message ?? "" })
        : zipLastRun
          ? t("settings.backupLastRun", { when: new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(zipLastRun)) })
          : t("settings.backupNever");

  return (
    <>
      <Modal
        onClose={onClose}
        title={t("settings.title")}
        size="lg"
        className="pv-modal--settings"
        bodyClassName="pv-modal-body--flush"
      >
        <div style={{ display: "flex", flexDirection: "row", flex: 1, minHeight: 0 }}>
          <SettingsNav
            world={section === GENERAL ? "app" : "vault"}
            page={section === GENERAL ? appPage : vaultPage}
            onOpenArea={openArea}
            vaultName={selectedVault ? basename(selectedVault) : null}
            vaultPath={selectedVault || null}
            vaultIsActive={selectedVault === vaultPath}
            vaultHasSync={configuredVaults.has(selectedVault)}
            canSwitchVault={vaults.length > 1}
            onSwitchVault={() => setShowVaultPicker(true)}
            onShowShortcuts={() => setShowShortcuts(true)}
          />

          {/* Right content: exactly one settings page. */}
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <div ref={contentRef} className="custom-scrollbar" style={{ flex: 1, overflowY: "auto", padding: "1.5rem 1.75rem" }}>
              {section === GENERAL ? (
                <>
                  {appPage === "appearance" && (
                    <AppearancePage
                      themeName={themeName}
                      onThemeName={(name) => { setThemeName(name); setStoredThemeName(name).catch(console.error); }}
                      themePref={themePref}
                      onThemePref={handleThemeChange}
                      appLanguage={appLanguage}
                      onLanguage={(v) => { void handleLanguageChange(v); }}
                      weekStart={weekStart}
                      onWeekStart={(v) => { setWeekStart(v); void setWeekStartSetting(v); }}
                      density={density}
                      onDensity={(v) => { setDensity(v); void setStoredDensity(v); }}
                      uiZoom={uiZoom}
                      onUiZoom={(z) => { setUiZoom(z); void setStoredUiZoom(z); }}
                    />
                  )}
                  {appPage === "editor" && (
                    <EditorPage
                      defaultViewMode={defaultViewMode}
                      onDefaultViewMode={(m) => { setDefaultViewMode(m); void setStoredDefaultViewMode(m); }}
                      contentFont={contentFont}
                      onContentFont={(next) => { setContentFont(next); void setStoredContentFont(next); }}
                    />
                  )}
                  {appPage === "behavior" && (
                    <BehaviorPage
                      autoOpenLastVault={autoOpenLastVault}
                      onAutoOpenLastVault={(v) => { void setAutoOpenLastVault(v); }}
                      showCompatibilityWarning={showCompatibilityWarning}
                      onShowCompatibilityWarning={(val) => {
                        setShowCompatibilityWarning(val);
                        void (async () => {
                          const store = await getSettingsStore();
                          await store.set(SHOW_COMPATIBILITY_WARNING_KEY, val);
                          await store.save();
                        })();
                      }}
                    />
                  )}
                  {appPage === "updates" && (
                    <UpdatesPage
                      autoUpdateCheckEnabled={autoUpdateCheckEnabled}
                      onAutoUpdateCheck={(val) => { setAutoUpdateCheckEnabled(val); void setAutoUpdateCheck(val); }}
                      updateStatus={updateStatus}
                      updateAvailable={!!updateAvailable && !isUpdating}
                      isUpdating={isUpdating}
                      onCheckUpdates={() => { void checkForUpdates(); }}
                      onInstallUpdate={() => { void installUpdate(); }}
                    />
                  )}
                  {appPage === "about" && (
                    <AboutPage
                      aboutLine={aboutInfo ? `Plainva ${aboutInfo.appVersion} · Tauri ${aboutInfo.tauriVersion} · WebView ${webViewVersion} · ${aboutInfo.os}` : "…"}
                      keychainStatus={keychainStatus}
                      perfStats={perfStats}
                      onRefreshPerfStats={() => { void refreshPerfStats(); }}
                      onExportPerfMetrics={() => { void handleExportPerfMetrics(); }}
                      onExportDiagnostics={() => { void handleExportDiagnostics(); }}
                      onReportIssue={() => { void handleReportIssue(); }}
                    />
                  )}
                </>
              ) : (
                <>
                  {vaultPage === "sync" && (
                    <SyncPage
                      provider={provider}
                      activeProvider={activeProvider}
                      onProviderChange={(v) => { initialProviderRef.current = null; setProvider(v); setDriveError(null); setOneDriveError(null); setDropboxError(null); }}
                      onDisableSync={() => { void handleDisableSync(); }}
                      webdav={{
                        url, setUrl, user, setUser, pass, setPass,
                        saving,
                        onBrowse: () => setShowPicker(true),
                        onSave: () => { void handleSaveVault(); },
                        onDisconnect: () => { void handleDisconnect(); },
                      }}
                      drive={{
                        clientId: driveClientId, setClientId: setDriveClientId,
                        clientSecret: driveClientSecret, setClientSecret: setDriveClientSecret,
                        folderName: driveFolderName,
                        connected: driveConnected,
                        saving: driveSaving,
                        error: driveError,
                        onBrowse: () => setSyncPicker("drive"),
                        onAuthorize: () => { void handleAuthorizeDrive(); },
                        onSave: () => { void handleSaveDrive(); },
                        onDisconnect: () => { void handleDisconnectDrive(); },
                      }}
                      oneDrive={{
                        clientId: oneDriveClientId, setClientId: setOneDriveClientId,
                        showId: oneDriveShowId, setShowId: setOneDriveShowId,
                        folderName: oneDriveFolderName,
                        connected: oneDriveConnected,
                        saving: oneDriveSaving,
                        error: oneDriveError,
                        onBrowse: () => setSyncPicker("onedrive"),
                        onAuthorize: () => { void handleAuthorizeOneDrive(); },
                        onSave: () => { void handleSaveOneDrive(); },
                        onDisconnect: () => { void handleDisconnectOneDrive(); },
                      }}
                      dropbox={{
                        appKey: dropboxAppKey, setAppKey: setDropboxAppKey,
                        showKey: dropboxShowKey, setShowKey: setDropboxShowKey,
                        rootPath: dropboxRootPath,
                        connected: dropboxConnected,
                        saving: dropboxSaving,
                        error: dropboxError,
                        onBrowse: () => setSyncPicker("dropbox"),
                        onAuthorize: () => { void handleAuthorizeDropbox(); },
                        onSave: () => { void handleSaveDropbox(); },
                        onDisconnect: () => { void handleDisconnectDropbox(); },
                      }}
                      s3={{
                        endpoint: s3Endpoint, setEndpoint: setS3Endpoint,
                        region: s3Region, setRegion: setS3Region,
                        bucket: s3Bucket, setBucket: setS3Bucket,
                        accessKeyId: s3AccessKeyId, setAccessKeyId: setS3AccessKeyId,
                        secretKey: s3SecretKey, setSecretKey: setS3SecretKey,
                        prefix: s3Prefix, setPrefix: setS3Prefix,
                        pathStyle: s3PathStyle, setPathStyle: setS3PathStyle,
                        saving: s3Saving,
                        onBrowse: () => setSyncPicker("s3"),
                        onSave: () => { void handleSaveS3(); },
                        onDisconnect: () => { void handleDisconnectS3(); },
                      }}
                      intervalSec={intervalSec}
                      onIntervalChange={handleIntervalChange}
                      onIntervalBlur={normalizeIntervalDisplay}
                      isActiveVault={isActiveVault}
                      hasSyncWorker={!!syncWorker}
                      syncQueueSnapshot={syncQueueSnapshot}
                      onLoadQueue={() => {
                        if (!syncWorker) return;
                        void syncWorker
                          .listPendingOperations(20)
                          .then((snap) => setSyncQueueSnapshot(snap))
                          .catch(() => setSyncQueueSnapshot({ total: 0, items: [] }));
                      }}
                    />
                  )}
                  {vaultPage === "pim" && <PimPage isActiveVault={isActiveVault} />}
                  {vaultPage === "content" && (
                    <ContentPage
                      isActiveVault={isActiveVault}
                      dailyNotesFolder={dailyNotesFolder}
                      onDailyNotesFolder={(v) => { setDailyNotesFolder(v); void persistFeature(section, dailyNotesFolderKey(section), v); }}
                      onBrowseDailyFolder={() => setVaultFolderPicker("daily")}
                      dailyNotesFormat={dailyNotesFormat}
                      onDailyNotesFormat={(v) => { setDailyNotesFormat(v); void persistFeature(section, dailyNotesFormatKey(section), v); }}
                      templateFolder={templateFolder}
                      onTemplateFolder={(v) => { setTemplateFolder(v); void persistFeature(section, templateFolderKey(section), v); }}
                      onBrowseTemplateFolder={() => setVaultFolderPicker("templates")}
                      dailyNoteTemplate={dailyNoteTemplate}
                      onDailyNoteTemplate={(v) => { setDailyNoteTemplate(v); void persistFeature(section, dailyNoteTemplateKey(section), v); }}
                      templateFiles={templateFiles}
                      taskDatabase={taskDatabase}
                      onTaskDatabase={(v) => { setTaskDatabase(v); void persistFeature(section, taskDatabaseKey(section), v); }}
                      baseFiles={baseFiles}
                      onCreateTaskDb={() => { void handleCreateTaskDb(); }}
                      canCreateTaskDb={isActiveVault && !!vaultAdapter}
                      defaultNoteType={defaultNoteType}
                      onDefaultNoteType={(v) => { setDefaultNoteType(v); void persistFeature(section, defaultNoteTypeKey(section), v.trim() || DEFAULT_NOTE_TYPE); }}
                      dailyNoteType={dailyNoteType}
                      onDailyNoteType={(v) => { setDailyNoteType(v); void persistFeature(section, dailyNoteTypeKey(section), v.trim() || DEFAULT_DAILY_NOTE_TYPE); }}
                      okfViolations={okfViolations}
                      onShowOkfWizard={() => setShowOkfWizard(true)}
                      onShowOkfInfo={() => setShowOkfInfo(true)}
                      onShowIndexManager={() => setShowIndexManager(true)}
                      onUpdateAllIndexes={() => window.dispatchEvent(new CustomEvent("plainva-update-all-indexes"))}
                      extendedDatabases={extendedDatabases}
                      onExtendedDatabases={(v) => { setExtendedDatabases(v); void persistFeature(section, extendedDatabasesKey(section), v); }}
                    />
                  )}
                  {vaultPage === "backup" && (
                    <BackupPage
                      isActiveVault={isActiveVault}
                      zipEnabled={zipEnabled}
                      onZipEnabled={(v) => { setZipEnabled(v); void persistBackupSetting(section, backupZipEnabledKey(section), v); }}
                      zipDest={zipDest}
                      zipDefaultDest={zipDefaultDest}
                      onChooseZipDest={() => {
                        void (async () => {
                          const picked = await openFolderDialog({ directory: true, multiple: false, title: t("settings.backupZipChoose") }).catch(() => null);
                          if (typeof picked === "string" && picked) {
                            setZipDest(picked);
                            void persistBackupSetting(section, backupZipDestKey(section), picked);
                          }
                        })();
                      }}
                      onResetZipDest={() => { setZipDest(""); void persistBackupSetting(section, backupZipDestKey(section), ""); }}
                      onOpenZipDest={() => {
                        void (async () => {
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
                        })();
                      }}
                      zipKeep={zipKeep}
                      onZipKeep={(raw) => {
                        setZipKeep(raw);
                        void persistBackupSetting(section, backupZipKeepKey(section), clampZipKeep(raw));
                      }}
                      zipStatusDesc={zipStatusDesc}
                      zipRunning={zipStatus.state === "running"}
                      onBackupNow={() => window.dispatchEvent(new CustomEvent("plainva-backup-now", { detail: { vaultPath: section } }))}
                      snapshotIntervalSec={snapshotIntervalSec}
                      onSnapshotInterval={(v) => { setSnapshotIntervalSec(v); void persistBackupSetting(section, backupSnapshotIntervalKey(section), parseInt(v, 10)); }}
                      versionMaxCount={versionMaxCount}
                      onVersionMaxCount={(raw) => {
                        setVersionMaxCount(raw);
                        void persistBackupSetting(section, backupMaxCountKey(section), clampVersionMaxCount(raw));
                      }}
                      versionMaxAgeDays={versionMaxAgeDays}
                      onVersionMaxAge={(v) => { setVersionMaxAgeDays(v); void persistBackupSetting(section, backupMaxAgeDaysKey(section), parseInt(v, 10)); }}
                    />
                  )}
                  {vaultPage === "maintenance" && (
                    <MaintenancePage
                      isActiveVault={isActiveVault}
                      reindexRunning={reindexRunning}
                      onReindex={() => {
                        setReindexRunning(true);
                        void refreshVault()
                          .catch((e) => console.error("[Settings] reindex failed", e))
                          .finally(() => setReindexRunning(false));
                      }}
                      onShowDeletedFiles={() => { window.dispatchEvent(new CustomEvent("plainva-show-deleted-files")); onClose(); }}
                      vaultStats={vaultStats}
                    />
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </Modal>

      {showVaultPicker && (
        <VaultPickerModal
          vaults={vaults}
          selected={selectedVault}
          activeVaultPath={vaultPath}
          onSelect={(v) => {
            setSelectedVault(v);
            setSection(v);
          }}
          onClose={() => setShowVaultPicker(false)}
        />
      )}
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
