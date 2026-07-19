# Contributing to Plainva

Thank you for your interest in Plainva. The project is still in its earliest setup phase, so contribution rules are intentionally small and may evolve.

## Start Here

Before proposing project changes, read:

- `README.md`
- `docs/adr/` — architecture decision records
- `docs/engineering/` — engineering conventions (design language, theme platform, translations, performance)

For direction and priorities, check GitHub Issues and Discussions. Concrete implementation steps are worked out incrementally.

## Development Setup

Install the required tools and set up the workspace as described in `README.md`.

Current baseline:

- Node.js `>=22.0.0`
- npm
- pnpm `10.0.0`

Install dependencies with:

```powershell
pnpm install --frozen-lockfile
```

## Contribution Scope

Plainva works in small, reviewed steps:

- Keep changes focused.
- Avoid unrelated refactors.
- Update docs when requirements, setup, commands, architecture decisions or workflow expectations change.
- Do not commit secrets, tokens, API keys, private vault contents or private file paths.
- Do not include private vault screenshots, personal note contents or sensitive incident details in public issues or pull requests.
- Do not add generated folders such as `node_modules/`.

## Commits and Pull Requests

All documentation, code comments and commit messages are written in English. The only multilingual area is the user guide (`docs/user/<lang>/`) — user-visible changes update the affected pages in ALL language folders.

`CHANGELOG.md` tracks the released desktop app. Changes to the (not yet released) mobile shell under `apps/mobile` are not listed there until the mobile app ships; they get their own changelog section with the first mobile release.

Use concise conventional-style commit messages where practical, for example:

```text
docs: clarify setup requirements
build: add package configuration
test: add markdown roundtrip fixture
```

Before opening a pull request:

1. Rebase or merge the latest `main`.
2. Run the checks relevant to your change.
3. Include what changed, why it changed and how it was checked.
4. Link related issues or decisions when available.

UI changes additionally follow the design language (`docs/engineering/Design_Language.md`, visual reference `docs/engineering/design-styleguide.html`):

- Values come from tokens and the shared primitives — the `designLint`/`designGuards`/`mobileLint` test nets fail raw values, undefined classes, duplicated selectors and unthemed surfaces.
- New `pv-*` surfaces need LCARS + Win95 selectors (or a justified exemption) — attach screenshots in light AND dark, plus LCARS/Win95 when a themed surface changed.
- New visual patterns extend the design docs first, then get built.

## Licensing

Plainva core is licensed under AGPL-3.0-only.

By contributing, you agree that your contribution is provided under the repository license unless a different license is explicitly stated for a specific file or package.

Pull requests require a signed Contributor License Agreement: the CLA-Assistant bot asks for a signature on your first PR and records it in the repository. The agreement text lives in [CLA.md](CLA.md); signing is a one-time comment on the PR.

Commercial exception licensing is planned as a project/business option. It is not configured through pull requests.

## Code of Conduct

Participation is governed by `CODE_OF_CONDUCT.md`.
