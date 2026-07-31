# Plainva — AI Entry Point

Plainva is a local-first Markdown vault editor (Tauri v2 + React + CodeMirror 6; pnpm/Turborepo monorepo with `apps/desktop` and `packages/core`). The canonical format is plain Markdown: existing Obsidian vaults must never be damaged, migrated, or silently reformatted.

Authoritative entry points in this repository:

- `README.md` — overview, setup and commands ("Building from source")
- `CONTRIBUTING.md` — working rules, tests, definition of done
- `docs/adr/` — architecture decision records
- `docs/engineering/` — design language, theme platform, translation glossary, performance notes
- `docs/user/` — multilingual user guide; any user-visible change must update the affected pages in ALL language folders (`apps/desktop/src/docsParity.test.ts` enforces identical file lists)

All documentation and code comments in this repository are written in English — READMEs, ADRs, `docs/engineering/`, commit messages. The only multilingual area is the user guide: translations live in the per-language folders under `docs/user/`.

Text files are UTF-8 without BOM with LF line endings. On Windows PowerShell, never write files via `>`, `>>` or `Out-File` without `-Encoding utf8` — prefer the harness file tools.

## Build and version policy (binding for every session)

- Normal internal Android builds between coordinated releases use a fourth display segment: after `X.Y.Z`, use `X.Y.Z.1`, `X.Y.Z.2`, and so on in the Android `versionName` and `mobile-vX.Y.Z.N` tag. Keep `apps/mobile/package.json` on the three-part base; Android `versionCode` remains the monotonically increasing GitHub Actions run number.
- iOS does not adopt the fourth segment. TestFlight iterations keep the current `MARKETING_VERSION` and increase only `CURRENT_PROJECT_VERSION`.
- A maintainer request for a real release covers all app variants unless it explicitly says otherwise: desktop and Android move together to the same new three-part `X.Y.Z` (`vX.Y.Z` and `mobile-vX.Y.Z`), and a fresh iOS/TestFlight build is included. Later Android internal builds restart at `X.Y.Z.1`. Public Play/App Store production still requires separate explicit approval.

## UI rules (design language 2.0 — binding for every session)

- Never write raw style values in components: radii/colors/font sizes/z-index/shadows/durations come from the tokens (`packages/ui/src/styles/*.css`), lucide icon sizes from the shared `ICON` roles. `designLint.test.ts` fails the commit otherwise.
- Build on the primitives in `packages/ui/src/components/ui/` (Button/IconButton/Field/Select/SearchField/Modal/Banner/Segmented/FloatingWindow/Fab…). Cancel buttons are `ghost`; active states use the `--accent-container` + `--on-accent-container` PAIR; hover is CSS `:hover` on `--state-hover`, never JS style mutation.
- Tooltips are `data-tip` (plus `aria-label` on icon-only buttons), never `title=`. Popover panels use `pv-popover pv-popover--fixed`; drag ghosts `.pv-fixed-ghost`.
- Every referenced `pv-`/`m-`/`base-cfg-` class must exist, no selector is defined twice per bundle, and every new `pv-` surface needs LCARS + Win95 selectors or a justified exemption (`designGuards.test.ts`).
- New visual patterns: extend `docs/engineering/Design_Language.md` + `design-styleguide.html` (and the docking matrix) FIRST, then build. Budget maps only ever shrink; new entries need a justification comment.

Run `pnpm lint`, `pnpm typecheck` and `pnpm test` before committing (Husky hooks enforce this; pre-push mirrors the full CI).

Maintainer setup only: project status, planning and the AI workflow live in the workspace one level above this repository (AI entry files and `docs/` there). Those files are not part of this repository.
