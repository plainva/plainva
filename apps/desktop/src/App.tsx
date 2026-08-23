import { useState, useEffect, useCallback, useMemo, useRef, Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";
import { getSettingsStore } from "./services/settingsStore";
import { useVault, okfPromptDismissedKey, type SyncProviderId } from "./contexts/VaultContext";
import { captureSyncErrorSnapshot, isSyncAuthenticationError, useDisplaySyncStatus, type SyncErrorSnapshot } from "./services/syncStatusStore";
import { scanVaultOkf, pendingOkfRun } from "./services/okfConversion";
import { AlertTriangle } from "lucide-react";
import { Button, ICON, migrateLegacyBarLayouts, Modal, toast, useStableHandler } from "@plainva/ui";
import { appConfirm } from "./services/appDialogs";
import { IndexMdModal } from "./components/IndexMdModal";
import { WindowChromeStrip } from "./components/WindowControls";
import { ImportWizardModal } from "./components/import/ImportWizardModal";
import { WhatsNewModal } from "./components/whatsNew/WhatsNewModal";
import { getAppVersion, markWhatsNewSeen, readWhatsNewSeenVersion, requestWelcomeOnNextStart, shouldShowWhatsNew, takeWelcomeRequest } from "./services/whatsNew";
import { scheduleStartupUpdateCheck } from "./services/appUpdate";
import { SplashScreen } from "./components/SplashScreen";
import { getRestoreWindowsSetting, listAuxWindows, restoreAuxWindows, setOwnerOpenContents } from "./services/windowManager";
import { AppShell } from "./AppShell";
import type { ShellCapabilities } from "./shellCapabilities";
// Rarely-shown surfaces load lazily (P2.9): none of these are needed to paint
// the first frame, and each becomes its own chunk that only ever downloads
// when the user opens it.
const SettingsModal = lazy(() => import("./components/SettingsModal").then(m => ({ default: m.SettingsModal })));
const OkfConversionModal = lazy(() => import("./components/OkfConversionModal").then(m => ({ default: m.OkfConversionModal })));

/**
 * The central window (multi-window P0; shell split out in stage C0).
 *
 * What is left here is what only the owner may do: the surfaces that start
 * background services, bind credentials, or write across the whole vault —
 * settings, the OKF conversion, index.md management, the import wizard, the
 * release dialogs, and the sync-error dialog. Everything a window DRAWS lives
 * in `AppShell`, which a full second window renders too.
 *
 * The shell reaches these through an explicit `ShellCapabilities` object
 * rather than a `mode` flag: a flag would spread `if (owner)` across thirty
 * call sites, while an object forces every surface to NAME the thing it
 * depends on — and makes the client's list of what it cannot do readable in
 * one place (`FullApp`).
 */
function App() {
  const { t } = useTranslation();
  const {
    vaultPath, loadingPath, loadingProgress, isLoading,
    openVault, closeVault, recentVaults,
    vaultAdapter, queryService, syncWorker, resetConnectionEncryption,
  } = useVault();

  const [showSettings, setShowSettings] = useState(false);
  // Deep link from the splash's online-vault chooser: open Settings with the
  // picked sync provider preselected once the vault has loaded. `area` (added
  // with the pages redesign) picks WHICH vault settings page opens — e.g. the
  // backup-error chip lands on Backup, the mail/calendar empty states on PIM.
  const [settingsInitialProvider, setSettingsInitialProvider] = useState<string | null>(null);
  const [settingsInitialArea, setSettingsInitialArea] = useState<string | null>(null);
  const openSettings = useCallback((opts?: { provider?: string; area?: string }) => {
    setSettingsInitialProvider(opts?.provider ?? null);
    setSettingsInitialArea(opts?.area ?? null);
    setShowSettings(true);
  }, []);
  useEffect(() => {
    const onOpenSyncSettings = (e: Event) => {
      const provider = (e as CustomEvent).detail?.provider;
      const area = (e as CustomEvent).detail?.area;
      openSettings({
        provider: typeof provider === "string" ? provider : undefined,
        area: typeof area === "string" ? area : undefined,
      });
    };
    window.addEventListener("plainva-open-sync-settings", onOpenSyncSettings);
    return () => window.removeEventListener("plainva-open-sync-settings", onOpenSyncSettings);
  }, [openSettings]);
  // Arrangements that predate the shared bar model (rail order in the settings
  // store, sidebar orders in localStorage) become bar layouts on first sight.
  // Idempotent: it only writes where nothing is stored yet.
  useEffect(() => {
    void migrateLegacyBarLayouts(vaultPath);
  }, [vaultPath]);
  const [showOkfWizard, setShowOkfWizard] = useState(false);
  const [showIndexManager, setShowIndexManager] = useState(false);
  // .CONFLICT copies listed in the sync-error dialog (P3.11 "Sync-Dialog"
  // entry point): looked up from the index whenever the dialog opens.
  const [dialogConflicts, setDialogConflicts] = useState<string[]>([]);
  // "Was ist OKF?" — on demand only (E2). It used to open BY ITSELF once per
  // vault, for every vault, whether or not anything was wrong: four sections of
  // explanation in front of someone who had just come to write. The explaining
  // now lives in the handbook and behind the settings button; what remains
  // automatic is the one thing that is actionable — an offer to convert, and
  // only when there is something to convert.
  const okfPromptCheckedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!vaultPath || isLoading || !vaultAdapter || !queryService) return;
    if (okfPromptCheckedRef.current === vaultPath) return;
    okfPromptCheckedRef.current = vaultPath;
    (async () => {
      try {
        // An interrupted conversion comes first — and instead of the offer,
        // never on top of it. It leaves a vault where some notes carry the OKF
        // fields and some do not, with nothing on screen saying so; the offer
        // to convert would be the wrong sentence for that state, and two
        // toasts about the same subject teach people to dismiss both.
        //
        // A persistent toast rather than a dialog, because that is what this
        // shell does with OKF: the automatic explain-modal was deliberately
        // removed and replaced by a toast with a button. The phone shows a
        // sheet for the same thing — different shell, same three ways out:
        // take a look, or decide later by dismissing it. The journal stays
        // until the run is finished or undone, so declining is not forgetting.
        const open = await pendingOkfRun({ vaultPath, queryService, adapter: vaultAdapter }).catch(() => null);
        if (open) {
          toast.progress(
            t("okf.recoveryBody", { started: new Date(open.journal.startedAt).toLocaleString() }),
            { label: t("okf.recoveryOpen"), run: () => setShowOkfWizard(true) }
          );
          return;
        }
        const store = await getSettingsStore();
        if (await store.get<boolean>(okfPromptDismissedKey(vaultPath))) return;
        const scan = await scanVaultOkf({ vaultPath, queryService, adapter: vaultAdapter });
        // Nothing to offer: say nothing. A vault that already conforms — every
        // vault Plainva created itself — never hears about OKF unasked.
        if (scan.violations.length === 0) {
          await store.set(okfPromptDismissedKey(vaultPath), true);
          await store.save();
          return;
        }
        // A toast, not a dialog: it does not stand between the user and their
        // notes, and its action leads to where the conversion lives anyway.
        // The settings section keeps showing the offer while violations exist.
        toast.info(t("okf.openPromptMsg", { count: scan.violations.length }), {
          label: t("okf.openPromptAction"),
          run: () =>
            window.dispatchEvent(
              new CustomEvent("plainva-open-sync-settings", { detail: { area: "content" } })
            ),
        });
        await store.set(okfPromptDismissedKey(vaultPath), true);
        await store.save();
      } catch (e) {
        console.warn("[App] OKF vault-open check failed", e);
      }
    })();
  }, [vaultPath, isLoading, vaultAdapter, queryService, t]);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [syncErrorSnapshot, setSyncErrorSnapshot] = useState<SyncErrorSnapshot | null>(null);
  const openSyncError = useCallback(() => {
    setSyncErrorSnapshot(captureSyncErrorSnapshot(vaultPath));
    setShowErrorModal(true);
  }, [vaultPath]);
  // Fill the dialog's conflict rows from the index whenever it opens (P3.11).
  useEffect(() => {
    if (!showErrorModal || !queryService) {
      setDialogConflicts([]);
      return;
    }
    let alive = true;
    queryService.db
      .query<{ path: string }>(`SELECT path FROM files WHERE path LIKE ? ORDER BY path LIMIT 5`, ["%.CONFLICT-%"])
      .then((rows) => { if (alive) setDialogConflicts(rows.map((r) => r.path)); })
      .catch(() => { if (alive) setDialogConflicts([]); });
    return () => { alive = false; };
  }, [showErrorModal, queryService]);
  // The status bar's "Offline" button routes here: same error dialog as the
  // vault-switcher warning triangle.
  useEffect(() => {
    const onShowSyncError = () => openSyncError();
    window.addEventListener("plainva-show-sync-error", onShowSyncError);
    return () => window.removeEventListener("plainva-show-sync-error", onShowSyncError);
  }, [openSyncError]);
  const [showImportWizard, setShowImportWizard] = useState(false);
  const [showWhatsNew, setShowWhatsNew] = useState(false);
  const [showFirstRun, setShowFirstRun] = useState(false);
  useEffect(() => {
    const onOpenImport = () => setShowImportWizard(true);
    const onShowWhatsNew = () => setShowWhatsNew(true);
    window.addEventListener("plainva-open-import-wizard", onOpenImport);
    window.addEventListener("plainva-show-whats-new", onShowWhatsNew);
    return () => {
      window.removeEventListener("plainva-open-import-wizard", onOpenImport);
      window.removeEventListener("plainva-show-whats-new", onShowWhatsNew);
    };
  }, []);
  // After an update, show existing users what changed; show newcomers a short
  // welcome instead. Both write the same marker, so neither reappears.
  // Runs once per app start, before any vault is required.
  const whatsNewChecked = useRef(false);
  useEffect(() => {
    if (whatsNewChecked.current) return;
    whatsNewChecked.current = true;

    // The ref is the only guard on purpose. There used to be a `cancelled`
    // flag set from the cleanup as well, and under StrictMode the two cancelled
    // each other out: the first pass armed the ref and started the read, the
    // cleanup set `cancelled`, the second pass returned at the ref — so the
    // resolved read always found `cancelled` and NEITHER dialog ever appeared
    // in dev or in any E2E. Production has no StrictMode, which is why the
    // dialogs worked there and this stayed invisible.
    void (async () => {
      // "Show the welcome again" from the settings arms it for exactly one
      // start without an open vault — which is the only place it can appear.
      if (await takeWelcomeRequest()) {
        if (!vaultPath) {
          setShowFirstRun(true);
          return;
        }
        // A vault opened automatically, so the splash never shows. Re-arm and
        // stay quiet rather than dropping the request on the floor.
        await requestWelcomeOnNextStart();
      }

      const [seen, version] = await Promise.all([readWhatsNewSeenVersion(), getAppVersion()]);
      if (!shouldShowWhatsNew(seen, version)) return;

      // No marker AND no vault history means this is a first run, not an update.
      const isFirstRun = !seen && recentVaults.length === 0 && !vaultPath;
      if (isFirstRun) setShowFirstRun(true);
      else setShowWhatsNew(true);
    })();
    // Intentionally start-only: recentVaults/vaultPath are read once, as they
    // are already populated by the time this effect runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismissReleaseDialog = useStableHandler(async () => {
    setShowWhatsNew(false);
    setShowFirstRun(false);
    markWhatsNewSeen(await getAppVersion());
  });

  // Quiet startup update check (P3.8): one toast if a release is available;
  // failures (no feed yet, offline, dev build) stay silent. Opt-out lives in
  // the settings ("Updates" section).
  useEffect(() => {
    scheduleStartupUpdateCheck();
  }, []);

  /**
   * Put yesterday's windows back (multi-window P4, E5).
   *
   * Once per vault and only while none are open: the restore reads a stored
   * list, so running it twice would open every window twice. A window whose
   * saved position no longer lands on a monitor keeps its size and loses its
   * position — better placed by the OS than restored out of reach.
   */
  const restoredFor = useRef<string | null>(null);
  useEffect(() => {
    if (!vaultPath || isLoading) return;
    if (restoredFor.current === vaultPath) return;
    restoredFor.current = vaultPath;
    void (async () => {
      try {
        if (!(await getRestoreWindowsSetting())) return;
        if (listAuxWindows().some((w) => w.vaultPath === vaultPath)) return;
        await restoreAuxWindows(vaultPath);
      } catch (e) {
        // No backend, or a window that would not come up: the app is usable
        // without its extra windows, so this never blocks the start.
        console.warn("[App] could not restore the auxiliary windows", e);
      }
    })();
  }, [vaultPath, isLoading]);

  const openImport = useCallback(() => setShowImportWizard(true), []);
  // Memoised: the shell passes these into effects, and a fresh object on every
  // render would re-run them — exactly the fan-out the 2026-07-08 typing-lag
  // fix removed.
  const capabilities = useMemo<ShellCapabilities>(() => ({
    openSettings,
    openSyncError,
    openImport,
    reportOpenContents: setOwnerOpenContents,
    closeVault,
    openVault,
    recentVaults,
  }), [openSettings, openSyncError, openImport, closeVault, openVault, recentVaults]);

  if (isLoading) {
    // Show the vault being loaded (loadingPath), not the one we're leaving (vaultPath
    // stays set until the new vault finishes loading).
    const loadingTarget = loadingPath ?? vaultPath;
    const loadingVaultName = loadingTarget ? loadingTarget.split(/[/\\]/).pop() : null;
    return (
      <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", background: "var(--bg-primary)", color: "var(--text-main)" }}>
        {/* No regular title bar while loading — keep the window movable/closable. */}
        <WindowChromeStrip />
        <p style={{ fontSize: "var(--text-lg)", fontWeight: 500, margin: 0 }}>
          {loadingVaultName ? t("splash.loadingVault", { name: loadingVaultName }) : t("splash.initializing")}
        </p>
        {/* Fixed-width block: the (path-bearing) message is one ellipsized line
            and the bar spans the container, so nothing jumps with path length. */}
        <div style={{ margin: '1rem 0', width: 'min(480px, 80vw)' }}>
          <p
            style={{ margin: 0, height: '1.45em', lineHeight: '1.45em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}
            data-tip={loadingProgress?.message}
          >
            {loadingProgress?.message ?? ''}
          </p>
          <div style={{ width: '100%', height: '4px', background: 'var(--bg-hover)', marginTop: '0.5rem', borderRadius: 'var(--radius-pill)', overflow: 'hidden' }}>
            {loadingProgress ? (
              <div style={{
                width: `${(loadingProgress.current / Math.max(1, loadingProgress.total)) * 100}%`,
                height: '100%',
                background: 'var(--accent-color)',
                borderRadius: 'var(--radius-pill)',
                transition: 'width var(--dur-2) var(--ease-1)'
              }} />
            ) : (
              <div className="indeterminate-progress" style={{
                height: '100%',
                background: 'var(--accent-color)',
                borderRadius: 'var(--radius-pill)'
              }} />
            )}
          </div>
        </div>

        <button
          onClick={closeVault}
          className="pv-btn pv-btn--danger-soft"
          style={{ marginTop: '2rem' }}
        >
          {t("splash.cancelLoad")}
        </button>
      </div>
    );
  }

  if (!vaultPath) {
    // The release dialogs render here too: a first run and the first start
    // after an update both land on the splash, before any vault is open.
    // The welcome is passed INTO the splash: its three actions are the splash's
    // own flows (open / new / import), and it can only ever appear here — a
    // first run is by definition a start without a vault.
    return (
      <>
        <SplashScreen showFirstRun={showFirstRun} onFirstRunDismiss={dismissReleaseDialog} />
        {showWhatsNew && <WhatsNewModal onClose={dismissReleaseDialog} />}
      </>
    );
  }

  return (
    <AppShell capabilities={capabilities}>
      {/* Lazy modal chunks (P2.9): mounted conditionally, so the Suspense
          fallback is never visible longer than the chunk download. */}
      <Suspense fallback={null}>
        {showSettings && <SettingsModal initialProvider={settingsInitialProvider ?? undefined} initialArea={settingsInitialArea ?? undefined} onClose={() => { setShowSettings(false); setSettingsInitialProvider(null); setSettingsInitialArea(null); }} />}
        {showOkfWizard && (
          <OkfConversionModal
            onClose={() => setShowOkfWizard(false)}
            onOpenIndexManager={() => setShowIndexManager(true)}
          />
        )}
        {showIndexManager && <IndexMdModal onClose={() => setShowIndexManager(false)} />}
      </Suspense>
      {showErrorModal && (
        <SyncErrorDialog
          dialogConflicts={dialogConflicts}
          error={syncErrorSnapshot}
          onClose={() => setShowErrorModal(false)}
          // The resolve dialog lives in the shell (it has to close the tabs of
          // the copy it merges), so this asks for it the same way the tree and
          // the editor banner do rather than reaching across.
          onResolveConflict={(p) => { setShowErrorModal(false); window.dispatchEvent(new CustomEvent("plainva-resolve-conflict", { detail: { path: p } })); }}
          onOpenSettings={(provider) => { setShowErrorModal(false); openSettings({ provider: provider ?? undefined }); }}
          onRetry={() => syncWorker?.retryFailed()}
          onResetEncryption={resetConnectionEncryption}
        />
      )}
      {showImportWizard && <ImportWizardModal targetVaultPath={vaultPath || ""} onClose={() => setShowImportWizard(false)} />}
      {showWhatsNew && <WhatsNewModal onClose={dismissReleaseDialog} />}
    </AppShell>
  );
}

/**
 * Sync-error dialog, extracted as a leaf (2026-07-06 fix) so it can read the
 * error message/provider from the store WITHOUT App subscribing at the top
 * level. Mounted only while open, so its per-cycle re-render never reaches the
 * editor.
 */
function SyncErrorDialog({
  dialogConflicts,
  error,
  onClose,
  onResolveConflict,
  onOpenSettings,
  onRetry,
  onResetEncryption,
}: {
  dialogConflicts: string[];
  error: SyncErrorSnapshot | null;
  onClose: () => void;
  onResolveConflict: (path: string) => void;
  onOpenSettings: (provider: SyncProviderId | null) => void;
  onRetry: () => void;
  onResetEncryption: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const { vaultPath } = useVault();
  const { status } = useDisplaySyncStatus(vaultPath);
  const message = error?.message || t("sync.unknownError", { defaultValue: "Unbekannter Fehler aufgetreten." });
  // Stated wins over guessed: the worker's raw provider texts still go through
  // the regex, but a failure that KNOWS it needs a sign-in says so (P3).
  const authError = error?.authRecoverable ?? isSyncAuthenticationError(message);
  const recovered = status === "idle";
  const retrying = status === "syncing";
  // A bricked content-E2E connection (missing/invalid remote manifest but a
  // pinned "known encrypted" flag) can only be un-bricked by an explicit,
  // confirmed reset — the fail-closed guard never downgrades on its own
  // (Stilllegen P2). Ordinary failures never show this.
  const encryptionBricked = error?.reason === "manifest-invalid" || error?.reason === "encrypted-without-key";
  const handleResetEncryption = async () => {
    const ok = await appConfirm({
      title: t("sync.resetEncryptionTitle", { defaultValue: "Verschlüsselung zurücksetzen?" }),
      message: t("sync.resetEncryptionConfirm", { defaultValue: "Plainva merkt sich nicht mehr, dass diese Verbindung verschlüsselt war, und synchronisiert wieder als Klartext. Nur nutzen, wenn der verschlüsselte Vault absichtlich entfernt wurde. Trägt die Cloud noch verschlüsselte Inhalte, brich hier ab." }),
      kind: "danger",
      confirmLabel: t("sync.resetEncryptionAction", { defaultValue: "Verschlüsselung zurücksetzen" }),
    });
    if (!ok) return;
    await onResetEncryption();
    onClose();
  };
  return (
    <Modal
      onClose={onClose}
      size="sm"
      title={t("sync.errorTitle", { defaultValue: "Sync-Fehler" })}
      icon={<AlertTriangle size={ICON.head} style={{ color: "var(--error-text)" }} />}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("common.close")}</Button>
          {!recovered && encryptionBricked && (
            <Button variant="danger-soft" onClick={handleResetEncryption}>{t("sync.resetEncryptionAction", { defaultValue: "Verschlüsselung zurücksetzen" })}</Button>
          )}
          {!recovered && !encryptionBricked && (authError
            ? <Button variant="primary" onClick={() => onOpenSettings(error?.provider ?? null)}>{t("sync.openSettings")}</Button>
            : <Button variant="primary" onClick={onRetry}>{t("sync.retryNow", { defaultValue: "Jetzt erneut versuchen" })}</Button>)}
        </>
      }
    >
        <div style={{ padding: "1rem", background: "var(--error-bg)", color: "var(--error-text)", borderRadius: "var(--radius-xs)", wordBreak: "break-word", fontSize: "var(--text-md)", maxHeight: "300px", overflowY: "auto" }}>
          {message}
        </div>
        {(recovered || retrying) && (
          <p style={{ margin: "0.85rem 0 0", color: recovered ? "var(--success-text)" : "var(--text-muted)", fontWeight: 600 }}>
            {recovered
              ? t("sync.recovered", { defaultValue: "Die Synchronisierung war beim erneuten Versuch erfolgreich." })
              : t("sync.retrying", { defaultValue: "Plainva versucht die Synchronisierung erneut …" })}
          </p>
        )}
        <p style={{ margin: "0.85rem 0 0", fontSize: "var(--text-md)", color: "var(--text-muted)" }}>
          {encryptionBricked
            ? t("sync.encryptionErrorHint", { defaultValue: "Diese Verbindung galt als verschlüsselt, aber die Verschlüsselungsdaten fehlen in der Cloud (z. B. weil der verschlüsselte Vault gelöscht wurde). Zum Schutz stoppt der Sync. Wurde der Vault absichtlich entfernt, setze die Verschlüsselung für diese Verbindung zurück." })
            : authError
              ? t("sync.authErrorHint", { defaultValue: "Die Anmeldung ist abgelaufen oder wurde widerrufen. Stelle die Verbindung in den Sync-Einstellungen neu her." })
              : t("sync.transientErrorHint", { defaultValue: "Das war wahrscheinlich ein vorübergehendes Netzwerk- oder Providerproblem. Plainva versucht solche Fehler automatisch erneut." })}
        </p>
        {dialogConflicts.length > 0 && (
          <div style={{ marginTop: "0.85rem" }}>
            <div style={{ fontSize: "var(--text-md)", fontWeight: 600, marginBottom: "0.35rem" }}>
              {t("sync.conflictCopies", { defaultValue: "Gefundene Konfliktkopien:" })}
            </div>
            {dialogConflicts.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => onResolveConflict(p)}
                style={{ display: "flex", alignItems: "center", gap: "0.5rem", width: "100%", textAlign: "left", padding: "0.35rem 0.5rem", marginBottom: "2px", background: "var(--bg-secondary)", color: "var(--text-main)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-xs)", cursor: "pointer", fontSize: "var(--text-md)" }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{p}</span>
                <span style={{ color: "var(--accent-color)", flexShrink: 0 }}>{t("conflict.resolveAction")}</span>
              </button>
            ))}
          </div>
        )}
    </Modal>
  );
}

export default App;
