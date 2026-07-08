# Pull Request

## What & why

<!-- What does this change, and what problem does it solve? Link the issue if one exists. -->

## Checklist

- [ ] Tests cover the change (unit and, for user-visible behavior, E2E) and `pnpm test` is green.
- [ ] `pnpm lint` and `pnpm typecheck` pass; `cargo test` passes when Rust code changed.
- [ ] New UI strings exist in ALL 10 locale files (`apps/desktop/src/locales/*.json`) — the parity test enforces this.
- [ ] User-visible changes update the affected handbook pages in ALL language folders under `docs/user/`.
- [ ] Vault files written by the change stay Obsidian-openable (plain Markdown, `plainva`-namespaced extras only).
- [ ] No secrets, tokens, private paths or vault contents in code, tests, fixtures or this PR.
