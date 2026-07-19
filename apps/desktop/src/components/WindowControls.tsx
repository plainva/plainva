import { useEffect, useState } from "react";
import { Minus, Square, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ICON } from "@plainva/ui";

export const isTauriRuntime = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function detectMac(): boolean {
  if (typeof navigator === "undefined") return false;
  const s = `${navigator.platform || ""} ${navigator.userAgent || ""}`;
  return /Mac|iPhone|iPad|iPod/i.test(s);
}

/**
 * Minimize/maximize/close for the frameless window (decorations: false) —
 * Windows/Linux only, macOS keeps its native traffic lights. Shared by the
 * title bar and the title-bar-less screens (splash, vault loading), which
 * must stay movable and closable too.
 */
export function WindowControls({ divider = true }: { divider?: boolean }) {
  const { t } = useTranslation();
  const isMac = detectMac();
  const [maximized, setMaximized] = useState(false);

  const win = () => import("@tauri-apps/api/window").then((m) => m.getCurrentWindow());

  const doMinimize = () => { if (isTauriRuntime) win().then((w) => w.minimize()).catch(console.error); };
  const doToggleMax = () => {
    if (!isTauriRuntime) return;
    win().then(async (w) => { await w.toggleMaximize(); setMaximized(await w.isMaximized()); }).catch(console.error);
  };
  const doClose = () => { if (isTauriRuntime) win().then((w) => w.close()).catch(console.error); };

  useEffect(() => {
    if (!isTauriRuntime) return;
    win().then(async (w) => { try { setMaximized(await w.isMaximized()); } catch { /* ignore */ } }).catch(() => {});
  }, []);

  if (isMac || !isTauriRuntime) return null;

  const iconBtn: React.CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 30,
    border: "none", background: "transparent", color: "var(--titlebar-fg-muted)", borderRadius: "var(--radius-sm)", cursor: "pointer",
  };

  return (
    <>
      {divider && <div style={{ width: 1, height: 18, background: "var(--border-color)", margin: "0 6px" }} />}
      <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
        <button type="button" data-testid="window-minimize" aria-label={t("titlebar.minimize", { defaultValue: "Minimieren" })} data-tip={t("titlebar.minimize", { defaultValue: "Minimieren" })} onClick={doMinimize} style={iconBtn}
          onMouseOver={(e) => { e.currentTarget.style.background = "var(--titlebar-hover)"; e.currentTarget.style.color = "var(--titlebar-fg)"; }}
          onMouseOut={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--titlebar-fg-muted)"; }}>
          <Minus size={ICON.ui} />
        </button>
        <button type="button" data-testid="window-maximize" aria-label={maximized ? t("titlebar.restore", { defaultValue: "Wiederherstellen" }) : t("titlebar.maximize", { defaultValue: "Maximieren" })} data-tip={maximized ? t("titlebar.restore", { defaultValue: "Wiederherstellen" }) : t("titlebar.maximize", { defaultValue: "Maximieren" })} onClick={doToggleMax} style={iconBtn}
          onMouseOver={(e) => { e.currentTarget.style.background = "var(--titlebar-hover)"; e.currentTarget.style.color = "var(--titlebar-fg)"; }}
          onMouseOut={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--titlebar-fg-muted)"; }}>
          <Square size={ICON.ui} />
        </button>
        <button type="button" data-testid="window-close" aria-label={t("titlebar.close", { defaultValue: "Schließen" })} data-tip={t("titlebar.close", { defaultValue: "Schließen" })} onClick={doClose} style={iconBtn}
          onMouseOver={(e) => { e.currentTarget.style.background = "#e5484d"; e.currentTarget.style.color = "#ffffff"; }}
          onMouseOut={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--titlebar-fg-muted)"; }}>
          <X size={ICON.ui} />
        </button>
      </div>
    </>
  );
}

/**
 * Slim overlay strip for screens without the regular title bar: full-width
 * drag region with the window controls on the right. The parent needs
 * `position: relative`.
 */
export function WindowChromeStrip() {
  return (
    <div
      data-tauri-drag-region
      data-testid="window-chrome-strip"
      style={{ position: "absolute", top: 0, left: 0, right: 0, height: 40, display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 6, userSelect: "none", zIndex: 20 }}
    >
      <WindowControls divider={false} />
    </div>
  );
}
