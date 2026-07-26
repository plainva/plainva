import { Bookmark, ClipboardCopy, Columns2, FolderTree, History, Pencil, Pin, PinOff, RefreshCw, Rows2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SplitDirection } from "./SplitButton";
import { ICON, MenuItem, MenuSeparator, MenuSurface } from "@plainva/ui";

interface Props {
  // Right-click point in viewport coordinates.
  x: number;
  y: number;
  onSplitVertical: () => void;
  onSplitHorizontal: () => void;
  onCloseTab: () => void;
  onClose: () => void;
  // When the editor is already split, the active direction; the matching split
  // option is hidden because re-splitting the same way would be a no-op.
  activeDirection?: SplitDirection;
  /** Opens the version history for the tab's file (absent for empty tabs). */
  onShowVersionHistory?: () => void;
  /** Re-reads the tab's file from disk (P2, the per-file sibling of P1). */
  onReload?: () => void;
  /** Pin state of the right-clicked tab, and the toggle. */
  pinned?: boolean;
  onTogglePin?: () => void;
  onRevealInTree?: () => void;
  onCopyPath?: () => void;
  onRename?: () => void;
  onToggleBookmark?: () => void;
  isBookmarked?: boolean;
  onReopenClosed?: () => void;
  canReopenClosed?: boolean;
  onCloseOthers?: () => void;
  onCloseLeft?: () => void;
  onCloseRight?: () => void;
  onCloseAll?: () => void;
  /** False for the leftmost tab — the entry stays visible but disabled. */
  canCloseLeft?: boolean;
  canCloseRight?: boolean;
}

// Shortcut hints, in the platform's own notation (⌘ on macOS, Ctrl elsewhere).
// Written out rather than derived from the shortcut catalog: exactly two
// entries carry a hint here, and a lookup would cost more than it explains.
const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const SHORTCUT_CLOSE = IS_MAC ? "⌘W" : "Ctrl W";
const SHORTCUT_REOPEN = IS_MAC ? "⌘⇧T" : "Ctrl ⇧T";

/**
 * Right-click menu for tabs, modelled on the browser tab menu (plan P2) but
 * translated into Plainva's world: no tab groups (Plainva has panes), no
 * duplicate (two tabs on one file buy nothing — "split" is the useful version),
 * and "move to new window" waits for the multi-window plan.
 *
 * Grouped exactly like the mockup: file actions, split, navigation, then the
 * close family last. A pinned tab cannot be closed from here — that is the
 * whole point of pinning — so the entry is shown DISABLED rather than hidden,
 * which is what tells the user why.
 */
export function TabContextMenu({
  x, y, onSplitVertical, onSplitHorizontal, onCloseTab, onClose, activeDirection, onShowVersionHistory,
  onReload, pinned, onTogglePin, onRevealInTree, onCopyPath, onRename, onToggleBookmark, isBookmarked,
  onReopenClosed, canReopenClosed, onCloseOthers, onCloseLeft, onCloseRight, onCloseAll,
  canCloseLeft, canCloseRight,
}: Props) {
  const { t } = useTranslation();
  return (
    <MenuSurface open onClose={onClose} at={{ x, y }} minWidth={236} ariaLabel={t("tabMenu.title", { defaultValue: "Tab-Aktionen" })}>
      {onReload && (
        <MenuItem
          hint={t("tabMenu.reloadHint", { defaultValue: "von der Platte" })}
          icon={<RefreshCw size={ICON.ui} />}
          onSelect={onReload}
        >
          {t("tabMenu.reload", { defaultValue: "Neu laden" })}
        </MenuItem>
      )}
      {onTogglePin && (
        <MenuItem icon={pinned ? <PinOff size={ICON.ui} /> : <Pin size={ICON.ui} />} onSelect={onTogglePin}>
          {pinned ? t("tabMenu.unpin", { defaultValue: "Anheftung aufheben" }) : t("tabMenu.pin", { defaultValue: "Tab anheften" })}
        </MenuItem>
      )}
      <MenuSeparator />
      {activeDirection !== "vertical" && (
        <MenuItem icon={<Columns2 size={ICON.ui} />} onSelect={onSplitVertical}>
          {t("tabMenu.splitRight", { defaultValue: "Rechts teilen" })}
        </MenuItem>
      )}
      {activeDirection !== "horizontal" && (
        <MenuItem icon={<Rows2 size={ICON.ui} />} onSelect={onSplitHorizontal}>
          {t("tabMenu.splitDown", { defaultValue: "Unten teilen" })}
        </MenuItem>
      )}
      {(onRevealInTree || onCopyPath || onRename || onToggleBookmark || onShowVersionHistory) && <MenuSeparator />}
      {onRevealInTree && (
        <MenuItem icon={<FolderTree size={ICON.ui} />} onSelect={onRevealInTree}>
          {t("editor.revealInTree", { defaultValue: "Im Dateibaum anzeigen" })}
        </MenuItem>
      )}
      {onRename && (
        <MenuItem icon={<Pencil size={ICON.ui} />} onSelect={onRename}>
          {t("common.rename", { defaultValue: "Umbenennen" })}
        </MenuItem>
      )}
      {onCopyPath && (
        <MenuItem icon={<ClipboardCopy size={ICON.ui} />} onSelect={onCopyPath}>
          {t("fileTree.copyPath", { defaultValue: "Pfad kopieren" })}
        </MenuItem>
      )}
      {onToggleBookmark && (
        <MenuItem icon={<Bookmark size={ICON.ui} fill={isBookmarked ? "currentColor" : "none"} />} onSelect={onToggleBookmark}>
          {isBookmarked ? t("editor.removeBookmark") : t("editor.addBookmark")}
        </MenuItem>
      )}
      {onShowVersionHistory && (
        <MenuItem icon={<History size={ICON.ui} />} onSelect={onShowVersionHistory}>
          {t("tabMenu.versionHistory", { defaultValue: "Versionsverlauf…" })}
        </MenuItem>
      )}
      {onReopenClosed && (
        <>
          <MenuSeparator />
          <MenuItem disabled={!canReopenClosed} hint={SHORTCUT_REOPEN} onSelect={onReopenClosed}>
            {t("shortcuts.reopenTab", { defaultValue: "Geschlossenen Tab öffnen" })}
          </MenuItem>
        </>
      )}
      <MenuSeparator />
      <MenuItem
        danger={!pinned}
        disabled={pinned}
        hint={SHORTCUT_CLOSE}
        icon={<X size={ICON.ui} />}
        onSelect={onCloseTab}
      >
        {t("tabMenu.close", { defaultValue: "Tab schließen" })}
      </MenuItem>
      {onCloseOthers && (
        <MenuItem danger onSelect={onCloseOthers}>
          {t("tabMenu.closeOthers", { defaultValue: "Andere Tabs schließen" })}
        </MenuItem>
      )}
      {onCloseLeft && (
        <MenuItem danger={canCloseLeft} disabled={!canCloseLeft} onSelect={onCloseLeft}>
          {t("tabMenu.closeLeft", { defaultValue: "Tabs links schließen" })}
        </MenuItem>
      )}
      {onCloseRight && (
        <MenuItem danger={canCloseRight} disabled={!canCloseRight} onSelect={onCloseRight}>
          {t("tabMenu.closeRight", { defaultValue: "Tabs rechts schließen" })}
        </MenuItem>
      )}
      {onCloseAll && (
        <MenuItem danger onSelect={onCloseAll}>
          {t("tabMenu.closeAll", { defaultValue: "Alle Tabs schließen" })}
        </MenuItem>
      )}
    </MenuSurface>
  );
}
