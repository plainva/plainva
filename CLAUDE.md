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

## Desktop/mobile parity (binding for every session)

- Plainva is ONE product with two shells. **Every feature and every bug fix applies to desktop AND mobile.** The implementation may differ — touch instead of mouse, bottom sheet instead of modal, native instead of WebView — the result for the user may not.
- Where one shell does not get something, that is a **decided, written-down** fact, never an omission: add an entry to the parity catalog `packages/ui/src/lib/featureParity.ts` in the SAME commit. `apps/desktop/src/featureParity.test.ts` fails the commit when a `"partial"` or `null` side carries no reason.
- **A dated finding comment is a debt** (since 2026-08-19): when a fix in one shell carries a comment of the form "(finding 2026-xx-xx)", the SAME commit must bring either the other shell along or a catalog entry. Five findings in a row hung on exactly that.
- Each entry is either a **gap** (`kind: "gap"` — meant to be closed) or a **decision** (`kind: "decision"` — permanently asymmetric because the platform demands it). Valid reasons are platform limits (no `set_zoom` on Android, no OS trash, no Rust process on the phone) or a deliberately different interaction model (peek window ↔ pushed screen). "Nobody noticed" and "a later session will do it" are not reasons.
- Order of work: lift the building block into `packages/core`/`packages/ui` first, then wire both views. Where the logic is already shared, the second shell is wiring rather than a rebuild — and the asymmetry never appears.

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
- One definition per interaction (Design-Runde 2026-09-04): what a row can do comes from `packages/ui/src/lib/rowActions.ts` (context menu, selection bar, sheet and swipe read it), what "New …" can make from `packages/ui/src/lib/newCatalog.ts` (sidebar menu, ribbon, both palettes, the FAB). Every desktop list that can be empty renders `EmptyState`; modals are `Modal`, menus are `MenuSurface`. `apps/desktop/src/interactionGrammar.test.ts` fails a surface that invents its own.

**How changes reach `main` (binding for every session and every tool, since 2026-09-28):** the pre-commit hook runs the unit tests of the packages a commit touches and of everything that depends on them; the pre-push hook runs lint, typecheck and those unit tests for everything that differs from `origin/main`. The full check — every unit test, the E2E suite, the production-build smokes, the WebKit editor regression, the Rust checks (cargo check/clippy/test/audit) and CodeQL — runs in CI, and `main` is protected: it only accepts a commit whose CI is green, admins included. So work reaches `main` in two steps: push the commit to a `feature/**` branch (CI runs there), and once that run is green, push the same commit to `main` as a fast-forward (`git push origin HEAD:main`). If `main` moved in between, rebase (or merge `main` into a long-lived branch), push the branch again and wait for the new run. `cargo audit` resolves a network advisory database, so CI can turn red without any code change; then fix or record the advisory before `main` can move. The full local suite is still available: `pnpm lint && pnpm typecheck && pnpm run test:all`.

Maintainer setup only: project status, planning and the AI workflow live in the workspace one level above this repository (AI entry files and `docs/` there). Those files are not part of this repository.
