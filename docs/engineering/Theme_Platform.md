# Theming Platform

Last reviewed: 2026-07-04 (Themes/LCARS master plan of 2026-07-04 — internal planning document, maintainer workspace)

Plainva theming is purely CSS-token-based. Components consume CSS variables exclusively — a theme can reshape the colors, radii and fonts of the entire app without ever touching a single component.

## Three axes on the `<html>` element

| Attribute | Values | Source |
|---|---|---|
| `data-theme` | `light` \| `dark` | resolved mode (`resolveThemeMode`; single-mode themes pin it) |
| `data-theme-name` | theme id | registry `AVAILABLE_THEMES` in `apps/desktop/src/services/theme.ts` |
| `data-theme-variant` | variant id (optional) | collectible palette variants (currently LCARS only) |

Persisted in `plainva-settings.json` (Tauri store): `theme` (preference light/dark/system), `themeName`, `themeVariants` (active variant per theme), `unlockedThemes` + `unlockedThemeVariants` (easter-egg progress), `themeBefore_<id>` (fallback theme for the easter-egg switch-back).

## Token contract

Base tokens (Petrol) live in `apps/desktop/src/App.css` on `:root` (light) + `[data-theme="dark"]`. Themeable:

- Colors: `--bg-primary/secondary/hover/active`, `--text-main/muted/faint`, `--accent-color/-hover`, `--accent-on`, `--border-color/-light`, `--error-*`, `--overlay-bg`
- Editor/read: `--selection-bg`, `--active-line-bg`, `--code-bg`, `--quote-border`, `--highlight-bg`
- Callouts: `--callout-<key>` + `--callout-<key>-tint` (8 types)
- Structure: `--radius-xs/sm/md/lg/xl/pill` (Plainva UI 2.0 scale 4/8/12/16/20/999 px — widened one notch for the M3-Expressive look; components NEVER use hardcoded radii, migration 2026-07-04, ~230 spots)
- Font split: `--font-ui` (chrome: title bar, sidebars, buttons, menus) vs. `--font-content` (editor + reading view); `--font-family` remains an alias for `--font-ui`

## Creating a new theme

1. Registry entry in `services/theme.ts` (`AVAILABLE_THEMES`): `{ id, label, modes, swatch }`. `swatch` holds CONCRETE hex values per mode (bg/surface/text/accent) for the preview cards in Settings — no var() references, since the card shows the theme before it is active.
2. Token file `src/themes/<id>.css` with DOUBLE-attribute selectors (cascade-order-safe): `[data-theme-name="<id>"][data-theme="light"] { … }` + `…[data-theme="dark"] { … }`. Dark-only themes define only the dark block plus `modes: ["dark"]` — the mode is then pinned (Settings mode select + title-bar toggle are disabled).
3. Add an `@import` in `src/themes/index.css`.
4. Display name: proper names (Nord, Solarized, …) stay untranslated; translatable names go into `themes.names.<id>` in ALL locale files.
5. Additional structural rules are allowed, but only theme-scoped (`[data-theme-name="<id>"] .pv-btn-primary { … }`) and never for `display`/`visibility`/`pointer-events` or hiding focus indicators. Palette ports carry the license attribution in the file header (Nord/Solarized/Gruvbox/Catppuccin: MIT).
6. Watch out with tab strips: the active-tab underline is a stylesheet rule (`.tabstrip [role="tab"][aria-selected="true"]` in `styles/ui.css`); the inline `box-shadow` on tabs belongs SOLELY to the drag-and-drop indicator. Themes should only override the stylesheet rule (as `themes/lcars.css` does) — never blanket `box-shadow: none !important` on `[role="tab"]`, which kills the drag feedback (LCARS lesson, 2026-07-05).

Since 2026-07-05, **Windows 95** (`win95`) has been the first LIGHT-ONLY theme (mode pinned to `light`). Since the authenticity rework of 2026-07-06: NEUTRAL system colors (ButtonFace `#C0C0C0`, ButtonShadow `#808080`, ButtonLight `#DFDFDF`, Frame `#0A0A0A`), a teal desktop `#008080` as the pane canvas (token `--canvas-bg`), a navy title bar `#000080` with white text (tokens `--titlebar-*`; the title-bar surfaces are inline styles, so they run through tokens instead of selectors), two-level 3D bevels as `box-shadow` stacks (raised/pressed/sunken, light from the top left), square bevel scrollbars, all radii at 0, navy/white menu hover. In addition, win95 has been an **easter-egg theme** since 2026-07-06 (`unlock: "easteregg"`, deliberately the LAST registry entry = the last picker card): unlocked by Scotty's "Hello computer" / "Hallo Computer" (Star Trek IV) in the hailing-frequencies dialog (`unlocksTheme: "win95"` in the quote catalog — unlocks the WHOLE theme instead of an LCARS variant and does not count toward the 13-piece collection); existing users who already have win95 active are unlocked for it automatically in `initTheme()`. Trademark note: "Windows" is a trademark of Microsoft; the theme is a retro homage with its own CSS (no assets/icons from Microsoft). Should this become sensitive before going public, renaming it (e.g. "Chicago 95" or "Redmond") is a one-line label change in the registry.

## Easter egg (LCARS) and quotes

5 quick clicks (3-second window) on the title-bar logo open the hailing-frequencies dialog (`components/HailingFrequenciesModal.tsx`). Every recognized Star Trek line unlocks ONE LCARS palette variant (a collectible mechanic, 13 in total including "Red Alert"); the dialog then shows progress, variant chips and the LCARS on/off switch. The theme appears as a regular card in the Settings cards after the first discovery.

Quote catalog: `services/startrekQuotes.ts` — deliberately NOT in the i18n JSONs (canonical data, not a UI translation). Rules for additions:

- Only CANONICAL lines: the original plus genuine dub versions (verify against Memory Alpha or similar), never freely translated. Examples: "Engage!" is "Energie!" in the German dub, the Vulcan salute has three dub readings, and Picard's exclamation is "Da sind vier Lichter!".
- Per-quote language lists (`lines: Record<lang, string[]>`); `xx` = language-neutral (Klingon). ALL lists are accepted regardless of the app language.
- New app language: add a `<lang>` list per quote (only attested dub lines; if a language is missing, the original plus the remaining lists still apply).
- New quote = new variant: entry in `STAR_TREK_QUOTES` + `LCARS_VARIANTS` (ids 1:1, enforced by a unit test; quotes with `unlocksTheme` are exempt) + variant palette in `themes/lcars.css` + label `themes.variants.<id>` in all locales.
- A quote unlocks a WHOLE theme: `unlocksTheme: "<theme-id>"` on the quote (example `hello-computer` → `win95`); the target theme needs `unlock: "easteregg"` in the registry (enforced by a unit test), and the dialog uses `activateEasterEggThemeNoVariant`.
- Matching: NFKC, lowercase, apostrophe unification, punctuation stripped, whitespace collapsed, ss/ß folding, additional ae/oe/ue transliteration. Exact matches only, NO fuzzy matching.

Trademark note: the LCARS/Star Trek design belongs to CBS/Paramount. The theme remains an unadvertised easter egg (maintainer decision E3, 2026-07-04); the user guide only carries a cryptic FAQ hint.

## Font bundle

Antonio (SIL OFL 1.1) ships as a variable-font woff2 under `apps/desktop/src/assets/fonts/antonio/` (license text `OFL.txt` alongside it); `@font-face` in `themes/lcars.css`, active only via the LCARS theme's `--font-ui`. Fallback stack: Bahnschrift SemiCondensed / Arial Narrow.

## Tests

- Unit: `services/theme.test.ts` (registry consistency, mode pinning, gating, unlock flows), `services/startrekQuotes.test.ts` (normalization, all lines, negative cases, 1:1 id matching).
- E2E: `e2e/theming.spec.ts` (5x-click trigger, failed attempt including the Shaka line, a German quote in the English app, variant switching, reload persistence via a localStorage-backed store mock, card switching, mode pinning, axe smoke test under LCARS).

## New token families (design language 2026-07-05)

Since the design-language master plan (P1), additional themeable families exist in `apps/desktop/src/styles/tokens.css`: spacing scale `--space-1..8`, type scale `--text-xs/sm/ui/md/lg`, control heights `--control-sm/md/lg`, density roles `--pad-row-y`/`--pad-cell` (plus the `[data-density="compact"]` block), elevation `--shadow-1/2/3`, z layers `--z-popover/modal/menu/dialog/toast/tooltip`, motion `--dur-1/2` + `--ease-1`, status colors `--warning/success/info-*`, the chip palette `--chip-0..7-*`/`--chip-tag-*`/`--chip-link-*`, and the accent palette `--palette-1..10` (TS source: `components/palette.ts`, values are frontmatter DATA). Black themes (Midnight, LCARS, Phosphor) set the shadows to `none` and separate via border instead. The ui/ primitives (`.pv-btn`, `.pv-iconbtn`, `.pv-field`, `.pv-menu*`, `.pv-overlay`/`.pv-modal*`, `.pv-palette*`, `.pv-toast*`, `.pv-tooltip`, `.pv-empty`) are the stable docking points for theme-scoped structural rules — LCARS uses them for pills, elbow modals, console fields and the section color blocks (stage 2, E5). Rules and roles: `docs/engineering/Design_Language.md`.

## Plainva UI 2.0 families (M3 Expressive, 2026-07-11)

The redesign (plan `docs/planning/Gesamtplan_Redesign_M3_Expressive_2026-07-11.md`, maintainer workspace) adds token families to `packages/ui/src/styles/base-colors.css` and `tokens.css`, so both shells (desktop + mobile) inherit them:

- **Surface-container hierarchy** `--surface`, `--surface-container-low/high/highest` — tonal elevation. Derived per theme via `color-mix()` from `--bg-primary`/`--text-main`, so every theme adapts (light AND dark) without an override; special themes may still pin them.
- **Accent container** `--accent-container`, `--on-accent-container` — tonal active/selected fills (nav pill, tree selection).
- **State layers** `--state-hover/focus/press` — translucent overlays, consumed as cheap opacity/pseudo-element (never a per-row box-shadow).
- **Scroll-edge** `--edge-scrim`, `--edge-shadow` — fade + faint shadow at overflow boundaries (the splash-list case).
- **Motion** `--dur-3`, `--ease-spatial` (may overshoot), `--ease-effects`; `@media (prefers-reduced-motion: reduce)` collapses the durations — the `--motion-scheme` mechanism. Every animation MUST source its duration from these tokens; a "none" theme (Win95, E-Ink) pins the durations to ~0. Motion is chrome-only; content never animates.
- **Emphasis type** `--text-display`, `--text-headline` — on `--font-ui` (no new webfont), for splash/empty-state/screen titles.

Black themes (Midnight, LCARS, Phosphor) keep `--shadow-*: none` and express elevation/edge via colour frames, tonal lightening or glow. Per-theme tuning of these families is a dedicated audit as surfaces begin consuming them (later phases).
