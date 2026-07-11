import React from "react";
import ReactDOM from "react-dom/client";
import { i18nReady } from "@plainva/ui/i18n";
import "@plainva/ui/styles/base-colors.css";
import "@plainva/ui/styles/tokens.css";
import "@plainva/ui/styles/ui.css";
import "@plainva/ui/themes/index.css";
import "./mobile.css";
import { setPlatformServices, ToastHost } from "@plainva/ui";
import { initMobileSettings } from "./services/mobileSettings";
import { capacitorSettingsStore } from "./platform/capacitorPlatform";
import { secureCredentialStore } from "./platform/secureStore";
import { MobileDialogHost } from "./components/MobileDialogHost";
import App from "./App";

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

window.addEventListener("error", (e) => showFatalError("error", e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => showFatalError("promise", e.reason));

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

setPlatformServices({
  loadSettings: async () => capacitorSettingsStore,
  credentials: secureCredentialStore,
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

async function boot(): Promise<void> {
  // Never let an init failure blank the screen: log and render anyway, so an
  // i18n/settings problem degrades to defaults instead of a black screen.
  await i18nReady.catch((e) => console.error("[boot] i18n init failed", e));
  await initMobileSettings().catch((e) => console.error("[boot] settings init failed", e));
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <FatalBoundary>
        <App />
        <ToastHost />
        <MobileDialogHost />
      </FatalBoundary>
    </React.StrictMode>,
  );
}

void boot().catch((err) => showFatalError("boot", err));
