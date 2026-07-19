/**
 * Icon size roles (design sweep 2026-07-19, decision E5). Icons are sized via
 * a JS prop (lucide `size={N}`), so the scale lives as constants instead of
 * CSS tokens. Every icon in chrome MUST use one of these roles — designLint
 * flags raw `size={<number>}` literals outside this module.
 *
 *  - `meta`  12 — inline meta/status indicators next to text
 *  - `ui`    15 — the default: menus, buttons, list rows, toolbars
 *  - `head`  18 — pane heads / prominent actions; also the mobile default
 *  - `touch` 22 — prominent mobile touch actions (tab bar, sheet heads)
 *  - `empty` 28 — empty-state illustrations
 *
 * Named special cases outside the scale (each used exactly once, by design):
 */
export const ICON = {
  meta: 12,
  ui: 15,
  head: 18,
  touch: 22,
  empty: 28,
} as const;

/** Document icon in the note header (read view + live widget, 88px stripe). */
export const ICON_DOC_HEADER = 44;

export type IconRole = keyof typeof ICON;
