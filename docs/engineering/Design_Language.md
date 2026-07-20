# Plainva Design Language ("Plainva UI 2.0")

Last reviewed: 2026-07-19 · Plan: full design-language migration of 2026-07-19 (internal planning document, maintainer workspace)

This document is the binding contract for all visible UI in `apps/desktop`, `apps/mobile` and the shared `packages/ui` layer. It complements `docs/engineering/Theme_Platform.md` (theme axes, structural rules). The visual companion is `docs/engineering/design-styleguide.html` — open it in a browser to SEE every element in light and dark.

**Enforcement is mechanical, not aspirational:** `apps/desktop/src/designLint.test.ts` fails the commit for any raw value (radius/color/font-size/z-index/shadow/duration/`title=`/legacy class/JS hover/icon literal) outside a small, justified budget, and `apps/desktop/src/designGuards.test.ts` fails it for referenced-but-undefined classes, duplicated selectors and unthemed surfaces. `apps/mobile/src/mobileLint.test.ts` is the mobile twin. All three run in pre-commit, pre-push and CI.

## Core character

**A calm workbench.** Clear surfaces instead of stacked borders; the accent (petrol in the default theme) carries meaning — primary action, selection, today — and is not decoration. Soft but disciplined rounding, a 4px grid, subtle chrome: the note's content is the star. Themes bend tokens plus theme-scoped class rules only; components never change for a theme.

## Token sources

| File | Content |
|---|---|
| `packages/ui/src/styles/base-colors.css` | Color palette (light + dark), radius scale, surface containers, accent container, state layers, font split |
| `packages/ui/src/styles/tokens.css` | Spacing, type scale, control heights, touch heights, density roles, shadows, z layers, motion, status colors, chip and accent palettes |
| `packages/ui/src/styles/ui.css` | The `pv-*` primitive classes (canonical component implementations) |
| `packages/ui/src/themes/*.css` | Theme overrides of all of the above (double-attribute selectors) |
| `apps/desktop/src/App.css` | Desktop-shell-only chrome (editor host, doc header, merge view…) |
| `apps/mobile/src/mobile.css` | Mobile-shell chrome; its `--m-radius-*` tokens are ALIASES of the shared radius scale, its z ladder uses `--z-m-*` |

## Scales

- **Spacing:** `--space-1..8` (4/8/12/16/20/24/32px). Chrome paddings, margins and gaps come from this scale; free pixel values only for micro details (1-2px).
- **Type (chrome):** `--text-xs` 11 / `--text-sm` 12 / `--text-ui` 13 / `--text-md` 14 / `--text-lg` 16 / `--text-headline` 22 / `--text-display` 32. Document content (editor/read mode) sizes with `em` relative to `--font-content` — `em` is the ONE sanctioned way to size content-relative text; px/rem font literals fail the lint.
- **Control heights:** `--control-sm` 24 / `--control-md` 28 / `--control-lg` 34. Buttons, inputs and selects on the same row share the same height.
- **Field metric (E10):** the FORM standard is `--control-lg` with a 12px inset (`.pv-field`); the compact role (`.pv-field--compact`, 28px) is reserved for toolbars, the sidebar search and inline cell editors. Density compresses `--control-*` globally, so compact density still reaches every form.
- **Touch heights (mobile):** `--touch-sm` 44 / `--touch-md` 48 / `--touch-row` 56. No mobile tap target below 44px.
- **Icons:** lucide sizes come ONLY from the shared roles in `packages/ui/src/lib/iconSizes.ts` — `ICON.meta` 12, `ICON.ui` 15, `ICON.head` 18, `ICON.touch` 22, `ICON.empty` 28, plus `ICON_DOC_HEADER` 44 for the document-header glyph (`--doc-header-icon` in CSS). `size={<number>}` literals fail the lint.
- **Density:** `data-density="compact"` on `<html>` compresses `--control-*`, `--pad-row-y`, `--pad-cell` and the chrome type scale. Content typography is not a density concern.
- **Elevation:** `--shadow-1` (cards at rest), `--shadow-2` (menus/popovers/floating windows), `--shadow-3` (modals). Black themes set them to `none` — there the border separates. Literal shadow recipes fail the lint.
- **Z layers:** `--z-popover` 500 < `--z-modal` 1000 < `--z-menu` 1100 < `--z-dialog` 1250 < `--z-toast` 1300 < `--z-tooltip` 1400 (drag ghosts ride the tooltip layer via `.pv-fixed-ghost`). Mobile: `--z-m-bar` 30 < `--z-m-sheet` 40 < `--z-m-sheet-dialog` 50 < `--z-m-overlay` 60. No free z-index values; purely local stacking inside one positioned container is the only budgeted exception.
- **Motion:** `--dur-1` 120ms (hover/opacity), `--dur-2` 180ms (panels), `--dur-3` 260ms (large moves) with `--ease-1`/`--ease-spatial`. Continuous indicator cycles use `--dur-spin`/`--dur-progress` and are deliberately NOT zeroed by reduced motion (a 0.01ms cycle strobes). Literal durations fail the lint.

## Radius roles

`--radius-xs` 4 / `sm` 8 / `md` 12 / `lg` 16 / `xl` 20 / `pill`. The ROLE is binding:

| Role | Token |
|---|---|
| Controls (buttons, inputs, selects, menu items, tabs, tree rows) | `--radius-md` |
| Floating menus/popovers/pickers | `--radius-md` |
| Cards and panes (board/gallery/list/empty state) and FAB | `--radius-lg` |
| Modals, peek/floating windows and bottom sheets | `--radius-xl` (mobile sheets: `--radius-sheet`) |
| Chips, switches, segmented controls, counter badges | `--radius-pill` |

Mnemonic: *control & floating = md, card = lg, dialog/sheet = xl, round = pill.* LCARS/Win95 pin the whole scale (pills / 0). Geometric radii (`50%` circles, 1-2px micro details) remain literal.

## ONE state system

- Hover: `--state-hover` (press: `--state-press`) via CSS `:hover` — never `onMouseOver`/`onMouseOut` style mutation (fails the lint), never a second hover variable family.
- Active/selected rows and toggles: ALWAYS the `--accent-container` fill + `--on-accent-container` text PAIR at weight 600 (`.is-active`, `.pv-popover-row-active`, `aria-selected` rules) — never the fill with `--accent-color` or an inherited text color on top (under Win95 the container is solid navy; unpaired text vanishes). Multi-tone row content (subtitle/time lines) switches to `color: inherit` with opacity steps while selected. The accent EDGE marker is exclusive to the file tree. `--bg-active` is CONTENT-highlight tint only (editor match/active line) — never a chrome active state.
- Focus: the global `:focus-visible` ring plus `--state-focus`; composite fields (`.pv-chipfield`, `.pv-searchfield`, palette input rows, popover search rows) light up via `:focus-within` ONLY — their inner input suppresses the global ring (see the "composite fields" block in ui.css), otherwise it reads as a second field frame. Components never set `outline: none` on standalone focusables.

## Status colors

`--error-*`, `--warning-*`, `--success-*`, `--info-*`, each with `-bg/-border/-text`. Toasts, banners, dialog kinds, sync/backup states use exclusively these; no freely chosen reds/yellows. Diff tints derive from them via `color-mix`.

## Component primitives (`packages/ui/src/components/ui/`)

Button (primary/tonal/secondary/ghost/danger/danger-soft — **Cancel is always ghost**), IconButton (`.pv-iconbtn`; `.is-active` is the one toggle idiom), Field family (TextInput/SelectField/TextArea with the `compact` role), **Select** (field-metric trigger + popover-contract panel, accent-container selection, search row from 8 options; forms, dialogs and toolbar filters use this primitive. A native `<select>` is allowed ONLY wearing the field skin `pv-field pv-field--select` — the documented idiom for dense tool rows whose popup may stay OS-rendered, like the native date/time/color inputs; a naked `<select>` fails the `nakedSelect` lint rule), **SearchField** (THE search pattern: magnifier sibling, clear-X, Escape clears first / closes second), Checkbox/Switch/**Radio**, Segmented, MenuSurface/MenuItem, Modal (icon slot, `testId`), **Banner** (info/warning/error/success notice strip), **FloatingWindow** (drag/resize/session-persist chrome shared by the peek preview and mail compose; `.pv-peek-head` is a themed surface), Fab (`.pv-fab` — the mobile floating buttons render it with position-only `.m-fab-float` modifiers), EmptyState, TooltipHost, ToastHost, DockedToolbar.

Chips: `.pv-chip` is 22px with symmetric `0 10px` padding; removable chips (`.pv-chip--removable`) use `0 4px 0 10px` with a 16px X hit target; count badges (`.pv-badge`) are 18px, min-width 18, `tabular-nums`. **Component inner metrics live ONLY in ui.css** — call sites never re-specify paddings.

Cloud-account patterns (settings): an account row (`.pv-acct`) = provider monogram + identity + service chips inside a `SettingCard`. The monogram (`.pv-acct-mark` + `--<family>` modifier) paints exclusively from the themed `--chip-*` slots; service chips (`.pv-svcchip`) are 22px pills on the accent-container PAIR. The connect wizard is built from provider tiles (`.pv-provtile` — card-radius surfaces; selected = accent-container pair, themed for LCARS/Win95), a numbered step header (`.pv-wizsteps`/`.pv-wizstep`; the active step number is a primary-accent disc, done steps use the accent-container pair) and per-service check/status rows (`.pv-svcline`, `.pv-svcstat` — the setrow grammar with a leading icon; status rows report success, waiting AND error states).

Rules:

- New UI builds on the primitives; no new `position: fixed` overlay outside `Modal`/`Menu`/`Toast`/`Tooltip`/`FloatingWindow` — popover panels use `pv-popover pv-popover--fixed`, invisible click catchers `.pv-click-catch`, drag ghosts `.pv-fixed-ghost`.
- The primitives render shared `pv-*` classes (styles in `packages/ui/src/styles/ui.css`) — ONLY that way can themes restyle them. Inline styles are limited to positioning/measurements.
- Blocking system dialogs are taboo: `window.confirm/alert/prompt` and Tauri `ask/message/confirm` are replaced by `dialogService`/`toast`; only the OS folder/file pickers remain native.
- Hover hints via `data-tip` (TooltipHost), never `title=` (fails the lint); icon-only buttons additionally carry `aria-label` — `data-tip` is NOT an accessible name.

## Arrangement schemata

- Modal footers: right-aligned, ghost Cancel left of the primary action (Modal's `footer` prop).
- Forms: label-over-field, `--space-3` row gap, one shared control height per row.
- Search fields: one schema app-wide (the SearchField primitive; palette/popover search rows are the borderless in-surface variant with the same Escape contract).
- Menus: thematic groups separated by `MenuSeparator` (or the `.pv-menu-sep`/`.pv-popover-label` classes in hand-anchored menus); the danger item is ALWAYS the last group behind a separator. Homogeneous list menus (move-to-folder, link bundles) stay ungrouped by design.
- Tooltips carry ADDED information only: file tabs tip their vault path, virtual tabs (plainva://…) tip nothing — a tooltip must never repeat the visible label or leak internal pseudo paths.
- Pane heads: title left, actions right as IconButtons.
- Empty surfaces render EmptyState, not bespoke prose divs.
- Connect wizards: numbered steps left to right (provider → services → sign-in); the service selection drives which permissions are requested; every service gets a status line covering success, waiting and error; the account-destroying action is always last and danger-styled.

## Theming duties (docking matrix)

Every top-level `pv-*` surface defined in ui.css must either carry LCARS **and** Win95 selectors or a justified entry in `designGuards.test.ts`'s `THEME_EXEMPT` map. The shared chip slots (`--chip-0..7`), graph knobs (`--graph-glow-intensity`, `--graph-edge-curvature`), `--edge-scrim` and the callout palette are part of a theme's contract — details and prohibitions in `Theme_Platform.md`.

## Enforcement: the three test nets

- `designLint.test.ts` — value ratchet. Budget map file → rule → count; fails on any EXCESS and on stale entries. After the 2026-07-19 sweep the map holds only documented data/native-attribute/iframe/local-stacking exceptions; any raw value in ANY other file (including new ones) fails immediately. New entries require a review-visible justification comment; the map only ever shrinks.
- `designGuards.test.ts` — structure: classExistence (referenced `pv-`/`m-`/`base-cfg-` classes must be defined), cssDuplicate (no selector defined twice within one bundle), themeCoverage (the docking matrix above).
- `mobileLint.test.ts` — the mobile twin (radius/hex/rgba/fixed/font-size/z-index + CSS durations).

## The process rule (new visual patterns)

**Catalog first, build second.** A new visual pattern (a new surface, control shape or arrangement) starts by extending this document, `design-styleguide.html` and — where applicable — the docking matrix, and only then gets built on tokens + primitives.
