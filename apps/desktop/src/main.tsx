import React from "react";
import ReactDOM from "react-dom/client";
import { i18nReady } from "./i18n";
import "./styles/tokens.css";
import "./styles/ui.css";
import "./themes/index.css";
import App from "./App";
import { TooltipHost } from "@plainva/ui";
import { ToastHost } from "./components/ui/ToastHost";
import { DialogHost } from "./components/ui/DialogHost";
import { ContextMenuHost } from "./components/ContextMenuHost";
import { VaultProvider } from "./contexts/VaultContext";
import { initTheme } from "./services/theme";
import { initDensity } from "./services/density";
import { initDefaultViewMode } from "./services/viewModeDefault";
import { initInputModality } from "./services/inputModality";
import { initWebviewHardening } from "./services/webviewHardening";
import { installGlobalDiagnostics } from "./services/diagnosticsLog";
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
