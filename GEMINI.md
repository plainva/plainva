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

Run `pnpm lint`, `pnpm typecheck` and `pnpm test` before committing (Husky hooks enforce this; pre-push mirrors the full CI).

Maintainer setup only: project status, planning and the AI workflow live in the workspace one level above this repository (AI entry files and `docs/` there). Those files are not part of this repository.
