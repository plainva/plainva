import React from "react";
import ReactDOM from "react-dom/client";
import { i18nReady } from "@plainva/ui/i18n";
import "@plainva/ui/styles/base-colors.css";
import "@plainva/ui/styles/tokens.css";
import "@plainva/ui/styles/ui.css";
import "@plainva/ui/themes/index.css";
import "./mobile.css";
import { logDiagnostic, setPlatformServices, ToastHost } from "@plainva/ui";
import { initMobileSettings } from "./services/mobileSettings";
import { initWindowClass } from "./services/windowClass";
import { capacitorSettingsStore } from "./platform/capacitorPlatform";
import { secureCredentialStore } from "./platform/secureStore";
import { MobileDialogHost } from "./components/MobileDialogHost";
import { registerMobileMailPlatform } from "./services/mail/mobileMailPlatform";
import { applyMobileSlashSupport } from "./services/slashSupport";
import { setMailTokenResolver } from "@plainva/ui/mail";
import { brokerTokenProvider } from "./services/accountBroker";
import App from "./App";
import { registerAccountLoginHandler } from "./services/accountLogin";

// A black screen on a real device (TestFlight) gives no clue why the app
// failed to mount. This overlay renders any boot/runtime error straight into
// the DOM on a light background, independent of React and the theme, so a
// failure is READABLE without a Mac / Safari web inspector. Remove once iOS
// boot is proven stable.
function showFatalError(label: string, err: unknown): void {
  const detail =
    err instanceof Error ? `${err.name}: ${err.message}\n\n${err.stack ?? ""}` : String(err);
  let box = document.getElementById("m-fatal");
  if (!box) {
    box = document.createElement("div");
    box.id = "m-fatal";
    box.setAttribute(
      "style",
      "position:fixed;inset:0;z-index:99999;background:#ffffff;color:#a00000;" +
        "font:13px/1.45 ui-monospace,Menlo,monospace;padding:44px 16px 24px;" +
        "overflow:auto;white-space:pre-wrap;word-break:break-word;" +
        "-webkit-user-select:text;user-select:text;",
    );
    document.body.appendChild(box);
  }
  box.textContent = `Plainva startup error\n[${label}]\n\n${detail}`;
}

// The fatal overlay is a BOOT-failure safety net: a black screen on a real
// device gives no clue why the app failed to mount. Once the app HAS mounted,
// a stray background rejection — a failed sync/token refresh, a plugin error —
// must NOT cover the whole app; it is logged for diagnostics and the UI keeps
// running (sync surfaces its own error/reconnect state instead). Before mount,
// any error is a genuine boot failure and stays fatal + readable.
let appMounted = false;
window.addEventListener("error", (e) => {
  logDiagnostic("window.error", String(e.error ?? e.message));
  if (!appMounted) showFatalError("error", e.error ?? e.message);
});
window.addEventListener("unhandledrejection", (e) => {
  logDiagnostic("unhandledrejection", String(e.reason));
  if (!appMounted) showFatalError("promise", e.reason);
});

// Catches errors thrown while rendering the tree (a mounted-but-crashing
// child), which window.onerror would not surface as readable text.
class FatalBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    showFatalError("render", err);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

import { noteSaver } from "./services/vaultService";
import { mobileAppVersion } from "./services/mobileWhatsNew";

setPlatformServices({
  loadSettings: async () => capacitorSettingsStore,
  credentials: secureCredentialStore,
  // The phone's editor queues its saves in the coordinator; a shared write
  // path must let that land first, or it overwrites the change a second later.
  flushPendingSave: (path) => noteSaver.flush(path),
  // Version for the `generated` stamps of import / mail capture / task sync
  // (OKF 0.2 provenance, plan P3b) — the same producer names as the desktop.
  appVersion: mobileAppVersion,
  openExternal: async (url) => {
    // window.open doesn't reliably reach the system browser inside the
    // Capacitor WebView; open web links in the in-app browser instead.
    if (/^https?:\/\//i.test(url)) {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url });
    } else {
      window.open(url, "_blank", "noopener");
    }
  },
});

// The mail seam (feinplan G0.1/G1): registered once, before any mail screen
// can be opened. Stage one is Graph-only — the IMAP half refuses until the
// native plugin lands (G2).
registerMobileMailPlatform();

// Declare the editor commands this shell cannot serve, before an editor can
// open one from the slash menu.
applyMobileSlashSupport();

// Mail reads its Graph token from the shared account broker when the account
// was connected through the union consent; otherwise the resolver returns
// undefined and the per-account refresh path stays (cloud accounts stage B).
setMailTokenResolver((vaultId) => brokerTokenProvider(vaultId, "mail"));

// The union consent ("one login for all services") completes through the same
// single OAuth redirect handler as calendar and mail; registering its purpose
// here is what makes the phone able to OFFER it (Sammelplan C5).
registerAccountLoginHandler();

async function boot(): Promise<void> {
  // Never let an init failure blank the screen: log and render anyway, so an
  // i18n/settings problem degrades to defaults instead of a black screen.
  await i18nReady.catch((e) => console.error("[boot] i18n init failed", e));
  await initMobileSettings().catch((e) => console.error("[boot] settings init failed", e));
  // Before the first paint: a stylesheet keyed on the window class must not
  // see a phone layout for one frame on a tablet.
  initWindowClass();
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <FatalBoundary>
        <App />
        <ToastHost />
        <MobileDialogHost />
      </FatalBoundary>
    </React.StrictMode>,
  );
  // Mounted: from here on, a render crash is caught by FatalBoundary, and a
  // stray background rejection is logged rather than covering the app.
  appMounted = true;
}

void boot().catch((err) => showFatalError("boot", err));
