import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pin } from "lucide-react";
import { ICON, IconButton } from "@plainva/ui";
import { WindowControls, detectMac } from "./WindowControls";
import { getWindowBus } from "../services/windowBus";

/**
 * Title bar of an auxiliary window (multi-window P0, extended in P4).
 *
 * Deliberately not the main `TitleBar`: that one carries the ribbon offset, the
 * tab strip, the sidebar toggles and the hailing-frequencies easter egg — all
 * of it owner-only chrome. An auxiliary window shows what it holds, the pin and
 * the window buttons, nothing else.
 *
 * Same inline-token styling as the main bar (`--titlebar-*`), so both react to
 * a theme change identically and no new CSS surface appears that the theme
 * matrix would have to cover.
 */
export function AuxTitleBar({ title, tabs, label, actions }: { title: string; tabs?: ReactNode; label?: string | null; actions?: ReactNode }) {
  const { t } = useTranslation();
  const isMac = detectMac();
  const [pinned, setPinned] = useState(false);

  // The window may have been RESTORED with the pin already set (E5/E6): ask it,
  // rather than assuming a fresh window always starts unpinned — a pin that is
  // active but shown as off is worse than no pin at all.
  useEffect(() => {
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        setPinned(await getCurrentWindow().isAlwaysOnTop());
      } catch {
        /* browser/test: no OS window to ask */
      }
    })();
  }, []);

  const togglePin = useCallback(() => {
    const next = !pinned;
    setPinned(next);
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().setAlwaysOnTop(next);
      } catch (e) {
        // The OS refused: put the button back rather than lying about the state.
        console.warn("[AuxTitleBar] could not change always-on-top", e);
        setPinned(!next);
        return;
      }
      // The owner keeps the window list, so the pin survives a restart only if
      // it hears about it.
      if (!label) return;
      try {
        const bus = await getWindowBus();
        await bus.request("window-always-on-top", { label, value: next });
      } catch {
        /* no owner listening: the pin still works, it just is not remembered */
      }
    })();
  }, [pinned, label]);

  return (
    <header
      data-tauri-drag-region
      data-testid="aux-titlebar"
      style={{
        display: "flex",
        alignItems: "center",
        height: 40,
        flexShrink: 0,
        background: "var(--titlebar-bg)",
        borderBottom: "1px solid var(--border-color)",
        paddingLeft: isMac ? 78 : 12,
        paddingRight: 6,
        gap: 8,
        userSelect: "none",
      }}
    >
      {/* Title OR tab strip: a window with several tabs IS its tab strip, and a
          second row of chrome would cost the content the height it needs. */}
      {tabs ?? (
        <span
          data-tauri-drag-region
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: "var(--text-ui)",
            fontWeight: 600,
            color: "var(--titlebar-fg)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {title}
        </span>
      )}
      {actions}
      <IconButton
        label={pinned ? t("window.unpinOnTop") : t("window.pinOnTop")}
        size="sm"
        active={pinned}
        data-testid="aux-pin"
        onClick={togglePin}
      >
        <Pin size={ICON.ui} />
      </IconButton>
      <WindowControls divider={false} />
    </header>
  );
}
