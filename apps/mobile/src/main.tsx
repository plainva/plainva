import React from "react";
import ReactDOM from "react-dom/client";
import { i18nReady } from "@plainva/ui/i18n";
import "@plainva/ui/styles/tokens.css";
import "@plainva/ui/styles/ui.css";
import "@plainva/ui/themes/index.css";
import "./mobile.css";
import { setPlatformServices, ToastHost } from "@plainva/ui";
import { memoryCredentialStore, memorySettingsStore } from "./platform/memoryPlatform";
import App from "./App";

// Register the platform capabilities (ADR 0011) before the first render —
// shared code reaches settings/secrets/URL-opening only through this bundle.
setPlatformServices({
  loadSettings: async () => memorySettingsStore,
  credentials: memoryCredentialStore,
  openExternal: async (url) => {
    window.open(url, "_blank", "noopener");
  },
});

void i18nReady.then(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
      <ToastHost />
    </React.StrictMode>,
  );
});
