# 12. Plainva UI 2.0 — Material 3 Expressive as a shared system, not a skin

Date: 2026-07-11

## Status

Accepted. Phases 0–3 (token foundation, primitives, first desktop surfaces, mobile wiring) plus the inline-control conversion were merged to `main` on 2026-07-11 (merge commit `2b20292`) and shipped with desktop release v0.2.2. The remaining phases (mobile visual reskin, mobile themes/easter eggs, verification) continue as the mobile M3E track.

## Context

The default look ("Plainva UI 1.0", ADR-era design language of 2026-07-05) is mature but the maintainer wanted a fresher, more expressive feel across desktop and mobile, oriented on **Material 3 Expressive** — without turning Plainva into a generic Google/Android app and without breaking the 13 bundled themes (Petrol default plus Nord, Solarized, Gruvbox, Catppuccin, Paper/E-Ink, Sepia, Forest, Midnight, High-Contrast, Phosphor, and the LCARS/Win95 easter eggs).

Two hard constraints shaped the decision:

1. **All themes must keep working**, and the LCARS (Okuda pills, colour frames, no shadow) and Win95 (bevels, navy, radius 0) essence must be preserved.
2. **The content is the star** — the editor/reading view (Obsidian-first Markdown) must not change; motion and chrome changes are chrome-only.

## Decision

Adopt the **system** of Material 3 Expressive (shape scale, tonal surface-container hierarchy, state layers, scroll-edge treatment, spring motion, emphasis typography) as a **shared token + primitive layer** in `@plainva/ui`, consumed by both the desktop (Tauri) and mobile (Capacitor) shells. Themes remain the **expression** layer: each theme translates the same M3 roles into its own idiom via CSS token overrides and theme-scoped class rules, exactly as before.

Concretely:

- **Token families** live in `packages/ui/src/styles/base-colors.css` and `tokens.css` (both already shared): a widened radius scale (`sm/md/lg/xl` → 8/12/16/20; LCARS/Win95 keep their pinned values), a tonal `--surface-container-*` hierarchy, `--accent-container`/`--on-accent-container`, `--state-hover/focus/press`, `--edge-scrim`/`--edge-shadow`, spring easings `--ease-spatial`/`--ease-effects` plus `--dur-3`, and emphasis type roles `--text-display`/`--text-headline`. The colour families derive per theme via `color-mix()` so every theme adapts (light and dark) without an override.
- **Motion is token-sourced.** `@media (prefers-reduced-motion: reduce)` collapses the duration tokens to ~0 (the `--motion-scheme` mechanism), so a theme can pin a "none" scheme by overriding the durations. Motion is chrome-only; content never animates, and animations must not re-render the CodeMirror host (the editor-stability contract).
- **Primitives** in `packages/ui/src/components/ui/` gain `Fab`, `Segmented`, `ScrollEdge`, a `tonal` Button variant and an EmptyState emphasis title; the core neutral controls adopt the state-layer tokens.
- **Surfaces with bespoke layout** (splash, `.base` view switcher, mobile shell) consume the new tokens/primitives directly; everything else inherits through the tokens.

## Consequences

- Most of the visible refresh propagates automatically once the tokens change (the radius bump and state layers reach every token-consuming surface), which keeps the change small and consistent across 13 themes.
- The colour delta on the Petrol default is deliberately subtle; the clearest new elements are shape, the tonal panes/scroll-edges, the segmented control, and motion.
- Each theme needs a per-theme audit of the new families where `color-mix()` defaults are not ideal (LCARS amber, Win95 navy, High-Contrast, E-Ink); black themes keep `--shadow-*: none` and express elevation via frames/glow.
- Per-theme visual verification (axe + screenshots across all 13 themes) and the LCARS/Win95 mobile pendant rules (mobile has no title bar/sidebars) remain follow-up work that requires native/emulator testing.

## What we deliberately do NOT take from M3 Expressive

- **Dynamic Color / Material You** — would destroy the curated palettes and LCARS/Win95.
- **Material Symbols** — Lucide stays (swapping is huge churn and breaks the LCARS/Win95 character).
- **Heavy ripple / media carousels** — dosed or not applicable to a text vault.

## References

- Internal plan: `docs/planning/Gesamtplan_Redesign_M3_Expressive_2026-07-11.md` (maintainer workspace).
- `docs/engineering/Design_Language.md`, `docs/engineering/Theme_Platform.md` (updated for the UI 2.0 families).
