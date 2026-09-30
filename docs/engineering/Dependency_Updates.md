# Dependency updates

Status: 2026-09-30. Dependabot (`.github/dependabot.yml`) opens one weekly
pull request per ecosystem for minor and patch updates. Three kinds of
dependency are held back from that routine; this page says why and how they
move instead.

## Tauri pairs: moved by hand, both halves in one commit

Every Tauri crate in `apps/desktop/src-tauri` has an npm half in
`apps/desktop/package.json`: `tauri` / `@tauri-apps/api`, and each
`tauri-plugin-<name>` / `@tauri-apps/plugin-<name>`. `tauri build` refuses a
pair whose major.minor differs ("Found version mismatched Tauri packages"),
and it does so only in the release workflow — the regular CI builds no
binary. The guard `apps/desktop/src/tauriVersionPairs.test.ts` reads both
lockfiles and turns such a tree red in every CI run.

Dependabot cuts along ecosystems, so its cargo and npm pull requests each
carry one half of the same pairs and each is red on its own (#114 and #115,
2026-09-30). Dependabot's multi-ecosystem groups (`multi-ecosystem-groups`)
are meant to join such halves, but an ecosystem/directory pair may appear only
once in the file, so the Tauri group would have to live in the same entries
that carry the weekly minor/patch groups, and how the two kinds of group share
one entry is not specified clearly enough to trust with a pair that blocks the
release build. Instead `dependabot.yml` ignores minor and patch updates of `tauri`,
`tauri-build`, `tauri-plugin-*` and `@tauri-apps/*`. Major versions still
arrive as pull requests and are a planned migration anyway.

Note that the ignore rules also suppress Dependabot security pull requests for
these packages; the security alert itself still appears under the repository's
Security tab and is handled with the procedure below, straight away.

**Once a month** (or when an advisory names a Tauri package):

1. See what is new: `cargo update --dry-run` in `apps/desktop/src-tauri` for
   the crates, `pnpm --filter desktop outdated "@tauri-apps/*"` for npm.
2. Crates: `cargo update -p tauri -p tauri-build -p tauri-plugin-<name> …`
   in `apps/desktop/src-tauri` (the `Cargo.toml` requirements are loose; the
   lockfile carries the versions). Raise a requirement in `Cargo.toml` only
   where the code needs a newer minimum.
3. npm: set each `@tauri-apps/*` half in `apps/desktop/package.json` to the
   `~X.Y.0` range of its crate's new major.minor (`~` keeps pnpm from running
   ahead of the crate into a minor that `tauri build` refuses), then
   `pnpm install`. `@tauri-apps/cli` moves along, with a `^` range.
4. Run `npx vitest run src/tauriVersionPairs.test.ts src/editorSingletons.test.ts`
   in `apps/desktop`, then commit crates and npm halves together
   (`chore(deps): move the Tauri pairs to 2.X`). The CI's Rust job and the
   WebKit editor regression cover the rest.

## Editor building blocks: one version each

CodeMirror requires a single instance of `@codemirror/state` and its
siblings; syntax trees from two copies of `@lezer/common` are different types.
`apps/desktop/src/editorSingletons.test.ts` demands one resolved version each
of `@codemirror/state`, `@codemirror/view`, `@codemirror/language`,
`@lezer/common`, `@lezer/highlight` and `@lezer/lr`. When a Dependabot pull
request turns it red, the fix is `pnpm dedupe` on top of that pull request
(or a matching range bump), never an exception in the guard.

## imap-proto: ignored until imap moves

`imap` 2.4.1 depends on `imap-proto` 0.10 and brings its own copy. Moving the
direct `imap-proto` dependency alone (0.16, #107) puts two copies in the tree
whose types do not match (`expected BodyStructure<'_>, found
BodyStructure<'_>`). `dependabot.yml` ignores `imap-proto` until `imap` has a
stable release built on 0.16 (today only the 3.0 alpha); then both move
together by hand and the ignore rule goes.
