# Plainva Design Language ("Plainva UI 1.0")

Last reviewed: 2026-07-05 · Plan: design language & UI master plan of 2026-07-05 (internal planning document, maintainer workspace)

This document is the binding contract for all visible UI in `apps/desktop`. It complements `docs/engineering/Theme_Platform.md` (theme axes, structural rules) with the design rules of the components themselves.

## Core character

**A calm workbench.** Clear surfaces instead of stacked borders; the accent (petrol in the default theme) carries meaning — primary action, selection, today — and is not decoration. Soft but disciplined rounding, a 4px grid, subtle chrome: the note's content is the star. Themes bend tokens plus theme-scoped class rules only; components do not change for any theme.

## Token sources

| File | Content |
|---|---|
| `apps/desktop/src/App.css` (`:root`) | Color, radius, font and editor tokens (existing, theme "Petrol") |
| `apps/desktop/src/styles/tokens.css` | Spacing, type scale, control heights, density roles, shadows, z layers, motion, status colors, chip and accent palettes |
| `apps/desktop/src/themes/*.css` | Theme overrides of both blocks (double-attribute selectors) |

## Scales

- **Spacing:** `--space-1..8` (4/8/12/16/20/24/32px). Chrome paddings, margins and gaps come from this scale; free pixel values only for micro details (1-2px).
- **Type (chrome):** `--text-xs` 11 / `--text-sm` 12 / `--text-ui` 13 / `--text-md` 14 / `--text-lg` 16px equivalent. Document content (editor/read mode) stays at 16px/1.6 via `--font-content`.
- **Control heights:** `--control-sm` 24 / `--control-md` 28 / `--control-lg` 34. Buttons, inputs and selects on the same row share the same height.
- **Density:** `data-density="compact"` on `<html>` (Settings → Appearance, `services/density.ts`) compresses ONLY `--control-*`, `--pad-row-y` (rows) and `--pad-cell` (table cells). Content typography is not a density concern.
- **Elevation:** `--shadow-1` (cards at rest), `--shadow-2` (menus/popovers), `--shadow-3` (modals/peek). Black themes (Midnight, LCARS, Phosphor) set them to `none` — there the border separates.
- **Z layers:** `--z-popover` 500 < `--z-modal` 1000 < `--z-menu` 1100 < `--z-dialog` 1250 < `--z-toast` 1300 < `--z-tooltip` 1400. Menus sit above modals (dropdowns open from dialogs); appDialogs (confirm/prompt) sit above EVERY modal — legacy overlays go up to 1200 until P4 moves them onto `<Modal>`. No free z-index values.
- **Motion:** `--dur-1` 120ms (hover/opacity), `--dur-2` 180ms (fade in/out), `--ease-1`. Animations respect `prefers-reduced-motion`.

## Radius roles

The scale (`--radius-xs` 4 / `sm` 6 / `md` 8 / `lg` 10 / `xl` 12 / `pill`) stays; the ROLE is binding:

| Role | Token |
|---|---|
| Controls (buttons, inputs, selects, menu items, tabs, tree rows) | `--radius-sm` |
| Floating menus/popovers/pickers AND cards (board/gallery/list/empty state) | `--radius-md` |
| Modals and peek | `--radius-xl` |
| Chips, switches, counter badges | `--radius-pill` |

Mnemonic: *small & floating = md, dialog = xl, control = sm, round = pill.* Geometric radii (50 % for circles, 1-2px micro details) remain literal — documented in the token comment of App.css.

## Status colors

`--error-*` (App.css) plus `--warning-*`, `--success-*`, `--info-*` (tokens.css), each with `-bg/-border/-text`. Toasts, dialog kinds, sync/backup states use exclusively these; no freely chosen reds/yellows.

## Component primitives (`apps/desktop/src/components/ui/`)

Button, IconButton, Field, Checkbox, Switch, Menu, Modal, EmptyState, Tooltip, Toast, dialogService (built up in plan P2/P3). Rules:

- New UI builds on the primitives; no new `position: fixed` overlay outside of `Modal`/`Menu`/`Toast`/`Tooltip`.
- The primitives render shared `pv-*` classes (styles in `src/styles/ui.css`) — ONLY that way can themes (LCARS in particular) restyle them. Inline styles in primitives are limited to positioning/measurements.
- Blocking system dialogs are taboo: `window.confirm/alert/prompt` and Tauri `ask/message/confirm` are replaced by `dialogService`/`toast`; only the OS folder/file pickers (`open()`) remain native.
- Hover hints via `data-tip` (TooltipHost), not via `title=`; `aria-label` carries the accessible name independently of that.
- Focus: the global `:focus-visible` ring (App.css) applies everywhere; components do not set `outline: none` on focusable elements.

## Do / Don't

- **Do:** values from the scales (`var(--space-2)`, `var(--text-ui)`, `var(--radius-sm)`, `var(--shadow-2)`); colors from tokens; `--z-*` for stacking; `--dur-*`/`--ease-1` for transitions.
- **Don't:** raw px paddings/radii, hex/rgba literals in components, homegrown shadow recipes, homegrown overlay/menu/chip implementations, `title=` tooltips, `outline: none`.

## Enforcement: designLint

`apps/desktop/src/designLint.test.ts` freezes the legacy debt as a budget map (file → rule → count) and fails when (a) a file EXCEEDS its budget or (b) a fully cleaned file still has a budget entry. Partial reductions are allowed without map upkeep; every sweep package (plan P4-P8) lowers the entries of its files along the way. Deliberately not scanned: `styles/tokens.css` and `themes/*.css` (token definitions consist of literals), `components/ui/` (canonical implementations), test files.

## Themes

New token families are theme-overridable like all others (double-attribute selectors). Special cases: black themes set `--shadow-*` to `none`; LCARS/Phosphor additionally restyle primitives via theme-scoped class rules (pills, elbow modals, glow) — limits and prohibitions are governed by `Theme_Platform.md` (never display/visibility/pointer-events, never hide focus).
