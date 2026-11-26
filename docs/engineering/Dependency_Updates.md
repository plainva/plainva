# Dependency updates

Status: 2026-11-26. Dependabot (`.github/dependabot.yml`) opens one weekly
pull request per ecosystem for minor and patch updates. Five kinds of
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
   `pnpm install`. `@tauri-apps/cli` does not move along: it has a section of
   its own below.
4. Run `npx vitest run src/tauriVersionPairs.test.ts src/editorSingletons.test.ts`
   in `apps/desktop`, then commit crates and npm halves together
   (`chore(deps): move the Tauri pairs to 2.X`). The CI's Rust job and the
   WebKit editor regression cover the rest.

## Tauri CLI: pinned, raised only through a rehearsal

`@tauri-apps/cli` is the one Tauri package that is not a pair: it bundles the
installers (NSIS, WiX, the DMG, the AppImage) and makes the updater
signatures, and every release is built with it — the tag through
tauri-action's `tauriScript`, the release rehearsal with the same command
(`.github/workflows/release.yml`). CI compiles with it every day, but its
smokes build with `--no-bundle`, so no CI run shows what a new CLI changes in
an installer. It therefore stands exactly, without a range, in
`apps/desktop/package.json`, and Dependabot leaves it alone like the other
`@tauri-apps/*` packages.

Pinned CLI: `2.12.4` — the version the last public release (0.8.7) was bundled with.

Raising it is a step of its own, never part of the pairs above:

1. Set the exact version in `apps/desktop/package.json`, `pnpm install`, and
   change the version on the "Pinned CLI" line above in the same commit
   (`apps/desktop/src/releaseCli.test.ts` holds the three together).
2. Start the release rehearsal on that commit (Actions → "Release",
   input `rehearsal`) and read its record: all three legs green, the CLI
   version it names.
3. Only then a release tag.

## Editor building blocks: one version each

CodeMirror requires a single instance of `@codemirror/state` and its
siblings; syntax trees from two copies of `@lezer/common` are different types.
`apps/desktop/src/editorSingletons.test.ts` demands one resolved version each
of `@codemirror/state`, `@codemirror/view`, `@codemirror/language`,
`@lezer/common`, `@lezer/highlight` and `@lezer/lr`. When a Dependabot pull
request turns it red, the fix is `pnpm dedupe` on top of that pull request
(or a matching range bump), never an exception in the guard.

## micromark: patched, moved only with the patch proven anew

The root `package.json` patches micromark 4.0.3 through pnpm's
`patchedDependencies` (`patches/micromark@4.0.3.patch`). The patch changes one
function in both of its builds, `resolveAllText` in `lib/initialize/text.js`
and `dev/lib/initialize/text.js`, and nothing else.

*What and why.* The text initializer merges each run of adjacent `data` events
into one. 4.0.3 does it with an `events.splice` per run, and every splice moves
the whole rest of the event list. With GFM a paragraph's data is split at every
word start, so the merge is quadratic in the paragraph's lines: a quiet
paragraph of 10 000 lines took 2.1 s to parse, of 40 000 lines 17 s, and a
note behind an unclosed `---` in its first line is read as one such paragraph.
The patch merges in one pass, moving the events that stay forward in place and
shortening the list once at the end: 0.21 s and 0.7 s for the same paragraphs.
The events that come out are the same, in the same order: of a run, the first
enter and exit stay and the token's end is set to the run's end, as before.

*How it is proven.* `packages/core/test/micromark-text-patch.test.ts` keeps the
original function as an oracle. It builds a second micromark parser from the
installed package's own initializers whose text and string initializers run the
original merge first, and compares every event — kind, type, start and end —
with the patched parser, for both builds, over the parser corpus's forms (also
as paragraphs of a hundred lines), the generated fixture vault, the table
corpus, the forms of the note budget and 1 000 random notes of a fixed seed, in
GFM with wiki links and in plain CommonMark. A time test merges 200 000 runs of
data events and parses paragraphs of 5 000 to 40 000 lines; on the original
merge it fails (8.5 s for 100 000 runs, against 91 ms).

*On a micromark update.* A Dependabot pull request that moves micromark cannot
install: pnpm refuses a patch whose version no longer matches, and the guard in
the same test names the patched version and checks that both builds carry the
one-pass merge. Then:

1. If the new version changed `resolveAllText`, or merges data linearly
   itself, compare with the patch; drop the patch if it is no longer needed.
2. Otherwise apply it to the new version (`pnpm patch micromark@<version>`,
   carry over the function, `pnpm patch-commit`), and copy the new version's
   original function into the oracle in the test, word for word.
3. Move `PATCHED_VERSION` in the test, run it, and commit the patch, the
   lockfile and the test together.

## imap-proto: ignored until imap moves

`imap` 2.4.1 depends on `imap-proto` 0.10 and brings its own copy. Moving the
direct `imap-proto` dependency alone (0.16, #107) puts two copies in the tree
whose types do not match (`expected BodyStructure<'_>, found
BodyStructure<'_>`). `dependabot.yml` ignores `imap-proto` until `imap` has a
stable release built on 0.16 (today only the 3.0 alpha); then both move
together by hand and the ignore rule goes.

## Nix inputs: moved by hand before a release

`flake.lock` pins the nixpkgs revision that the flake in `flake.nix` builds
with. Dependabot covers npm, cargo and the workflow actions only, so the
lockfile moves with `nix flake update`. Run it before a release, or when an
advisory names a package the flake pulls in.
