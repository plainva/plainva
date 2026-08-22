import { WindowControls, detectMac } from "./WindowControls";

/**
 * Title bar of an auxiliary window (multi-window P0).
 *
 * Deliberately not the main `TitleBar`: that one carries the ribbon offset, the
 * tab strip, the sidebar toggles and the hailing-frequencies easter egg — all
 * of it owner-only chrome. An auxiliary window shows what it holds and the
 * window buttons, nothing else.
 *
 * Same inline-token styling as the main bar (`--titlebar-*`), so both react to
 * a theme change identically and no new CSS surface appears that the theme
 * matrix would have to cover.
 */
export function AuxTitleBar({ title }: { title: string }) {
  const isMac = detectMac();

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
      <WindowControls divider={false} />
    </header>
  );
}
