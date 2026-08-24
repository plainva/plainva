import React from "react";
import ReactDOM from "react-dom/client";
import { i18nReady } from "@plainva/ui/i18n";
import "@plainva/ui/styles/base-colors.css";
import "@plainva/ui/styles/tokens.css";
import "@plainva/ui/styles/ui.css";
import "@plainva/ui/themes/index.css";
import App from "./App";
import { TooltipHost, setPlatformServices, keychainSlotName } from "@plainva/ui";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getSettingsStore } from "./services/settingsStore";
import { requestSaveFlush } from "./services/saveFlush";
import { credentialManager } from "./services/CredentialManager";
import { registerDesktopMailPlatform } from "./services/mail/tauriMailTransport";
import { getAppVersion } from "./services/whatsNew";
import { setMailLookupNote, setMailTokenResolver } from "@plainva/ui/mail";
import { brokerTokenProvider, describeBrokerLookup } from "./services/accountBroker";
import { ToastHost } from "@plainva/ui";
import { DialogHost } from "./components/ui/DialogHost";
import { EncryptionUnlockHost } from "./components/settings/EncryptionUnlockHost";
import { ContextMenuHost } from "./components/ContextMenuHost";
import { AppProvider, ClientAppProvider } from "./contexts/AppContext";
import { ClientVaultHost, VaultHost } from "./contexts/VaultHost";
import { currentWindowParams } from "./services/windowContext";
import { initTheme } from "./services/theme";
import { initDensity } from "./services/density";
import { initDefaultViewMode } from "./services/viewModeDefault";
import { initContentFont } from "./services/contentFont";
import { initUiZoom } from "./services/uiZoom";
import { initInputModality } from "./services/inputModality";
import { initWebviewHardening } from "./services/webviewHardening";
import { installGlobalDiagnostics } from "@plainva/ui";
import { ErrorBoundary } from "./components/ErrorBoundary";

// Which window is this? An auxiliary window loads the same bundle and differs
// only in what it starts (multi-window P0): theme, density, fonts and the
// platform services apply everywhere, the background machinery does not.
const windowParams = currentWindowParams();
const isOwnerWindow = windowParams.role === "owner";

// Apply the persisted (or system) color theme before first paint.
initTheme();
// Apply the persisted UI density (comfortable/compact chrome metrics).
initDensity();
// Fill the sync cache for the default editor view mode (read/live/source).
initDefaultViewMode();
// Apply the persisted content font size/family (issue #5, a11y).
initContentFont();
// Re-apply a persisted non-default UI zoom (issue #5 follow-up).
initUiZoom();
// Track keyboard vs. pointer so the editor focus ring shows only on keyboard.
initInputModality();
// Suppress the native WebView menu + reload/devtools keys (desktop-app feel,
// keeps the single-page state stable); adds our own "Copy" menu for text.
initWebviewHardening();
// Uncaught errors feed the diagnostics export (P4.2, no note content).
installGlobalDiagnostics();
// Local perf sampling (hardening P1.1): typing keystroke→frame latency for
// the "About & diagnostics" table — on-device only, never transmitted.
if (isOwnerWindow) {
  void import("./services/perfMetrics").then(({ installTypingLatencySampler }) => installTypingLatencySampler());
}
// Register the platform capabilities (ADR 0011): shared code in @plainva/ui
// reaches settings, secrets and URL-opening only through this injected bundle.
setPlatformServices({
  loadSettings: getSettingsStore,
  credentials: credentialManager,
  openExternal: (url) => openUrl(url),
  // Shared write paths wait for the open editor's pending save before they
  // rewrite a file (graph connect, mention linking, …).
  flushPendingSave: (path) => requestSaveFlush(path),
  // Names the version in the `generated` stamps of the machine write paths
  // (import, mail capture, task sync) — OKF 0.2 provenance, plan P3b.
  appVersion: getAppVersion,
  // Readable keychain names (P6). Registered here so the shared mail module
  // uses them too — mobile registers nothing and keeps the legacy shape.
  keychainSlotName,
});

// The mail seam (feinplan G0.1): IMAP/SMTP go to the Rust commands, Graph HTTP
// to the Tauri http plugin with the Origin-free relay for token POSTs. The
// TOKEN half is owner-only — one refresher per account, because Microsoft
// rotates the refresh token. Auxiliary windows register the same seam minus
// that half (`registerClientMailPlatform`, finding 2026-08-23); sending still
// goes over the bus so the undo queue stays with the owner.
if (isOwnerWindow) {
  registerDesktopMailPlatform();

  // Mail draws its Graph token from the shared account broker when the account
  // was connected through the union consent (cloud accounts stage B); otherwise
  // the resolver returns undefined and the per-account refresh path stays.
  setMailTokenResolver((vaultPath) => brokerTokenProvider(vaultPath, "mail"));
  // And why it came back empty, when it does (finding 2026-07-30).
  setMailLookupNote((vaultPath) => describeBrokerLookup(vaultPath, "mail"));
}

// First render waits for the active locale bundle (P2.8): locales are lazy
// chunks now, and rendering before the bundle arrives would flash raw keys.
void i18nReady.then(async () => {
  const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

  if (!isOwnerWindow) {
    // Client window: the client-mode provider reads the vault and hands writes
    // to the owner. The shell is imported here, not at module level, so the
    // central window's start path stays exactly what it was.
    //
    // Which shell depends on the role: `full` (stage C) draws the whole app —
    // sidebars, ribbon, status bar — while `aux`/`compose` draw content and
    // nothing else. Both run in the same client mode; only what they SHOW
    // differs.
    const Shell = windowParams.role === "full"
      ? (await import("./FullApp")).FullApp
      : (await import("./AuxApp")).AuxApp;
    // Theme/density/font/zoom changes happen in the central window's settings;
    // this keeps the look of this window in step with them.
    const { installAppearanceSync } = await import("./services/appearanceSync");
    void installAppearanceSync().catch(() => {
      /* no bus: nothing to follow */
    });
    // Mail reads and writes the mailbox from here too — the message list stayed
    // empty otherwise (finding 2026-08-23). Token refresh is NOT part of that:
    // this registration routes it to the owner, which stays the only refresher.
    const { registerClientMailPlatform } = await import("./services/mail/tauriMailTransport");
    registerClientMailPlatform();
    root.render(
      <React.StrictMode>
        <ErrorBoundary>
          <ClientAppProvider vaultPath={windowParams.vaultPath}>
            <ClientVaultHost>
              <Shell />
            </ClientVaultHost>
          </ClientAppProvider>
          <DialogHost />
          <ToastHost />
          <TooltipHost />
          <ContextMenuHost />
        </ErrorBoundary>
      </React.StrictMode>,
    );
    return;
  }

  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <AppProvider>
          <VaultHost>
            <App />
            <EncryptionUnlockHost />
          </VaultHost>
        </AppProvider>
        <DialogHost />
        <ToastHost />
        <TooltipHost />
        <ContextMenuHost />
      </ErrorBoundary>
    </React.StrictMode>
  );
});
