import React from "react";
import ReactDOM from "react-dom/client";
import { i18nReady } from "@plainva/ui/i18n";
import "@plainva/ui/styles/base-colors.css";
import "@plainva/ui/styles/tokens.css";
import "@plainva/ui/styles/ui.css";
import "@plainva/ui/themes/index.css";
import App from "./App";
import { TooltipHost, setPlatformServices } from "@plainva/ui";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getSettingsStore } from "./services/settingsStore";
import { credentialManager } from "./services/CredentialManager";
import { ToastHost } from "@plainva/ui";
import { DialogHost } from "./components/ui/DialogHost";
import { ContextMenuHost } from "./components/ContextMenuHost";
import { VaultProvider } from "./contexts/VaultContext";
import { initTheme } from "./services/theme";
import { initDensity } from "./services/density";
import { initDefaultViewMode } from "./services/viewModeDefault";
import { initInputModality } from "./services/inputModality";
import { initWebviewHardening } from "./services/webviewHardening";
import { installGlobalDiagnostics } from "@plainva/ui";
import { ErrorBoundary } from "./components/ErrorBoundary";

// Apply the persisted (or system) color theme before first paint.
initTheme();
// Apply the persisted UI density (comfortable/compact chrome metrics).
initDensity();
// Fill the sync cache for the default editor view mode (read/live/source).
initDefaultViewMode();
// Track keyboard vs. pointer so the editor focus ring shows only on keyboard.
initInputModality();
// Suppress the native WebView menu + reload/devtools keys (desktop-app feel,
// keeps the single-page state stable); adds our own "Copy" menu for text.
initWebviewHardening();
// Uncaught errors feed the diagnostics export (P4.2, no note content).
installGlobalDiagnostics();
// Register the platform capabilities (ADR 0011): shared code in @plainva/ui
// reaches settings, secrets and URL-opening only through this injected bundle.
setPlatformServices({
  loadSettings: getSettingsStore,
  credentials: credentialManager,
  openExternal: (url) => openUrl(url),
});

// First render waits for the active locale bundle (P2.8): locales are lazy
// chunks now, and rendering before the bundle arrives would flash raw keys.
void i18nReady.then(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <VaultProvider>
          <App />
        </VaultProvider>
        <DialogHost />
        <ToastHost />
        <TooltipHost />
        <ContextMenuHost />
      </ErrorBoundary>
    </React.StrictMode>
  );
});
