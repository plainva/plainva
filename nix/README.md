# Nix packaging

`flake.nix` in the repository root builds the desktop app two ways:

| Attribute | Source | Notes |
| --- | --- | --- |
| `plainva` (also `default`) | this source tree | full Rust and frontend build |
| `plainva-bin` | the `.deb` on the GitHub release | nothing is compiled |
| `devShells.default` | — | `nix develop`, the toolchain for `pnpm --filter desktop tauri dev` |

```bash
nix build            # the source package (the default attribute)
nix build .#plainva-bin
nix run              # start the desktop app built from source
nix develop          # development shell
```

Both packages install `bin/plainva-desktop`; `plainva-bin` keeps the icons and
the `.desktop` file exactly as the release ships them.

## Updating the hashes

Three hashes have to follow the repository; `cargoDeps` is not one of them,
because `importCargoLock` reads `Cargo.lock` directly.

### pnpm dependencies — `nix/plainva.nix`

`pnpmDeps.hash` follows `pnpm-lock.yaml`. Put `lib.fakeHash` in its place, run
the build, and copy the hash Nix reports into `nix/plainva.nix`:

```bash
nix build .#plainva 2>&1 | grep -A2 'hash mismatch'
#   specified: sha256-AAAA...
#   got:       sha256-BBBB...   <- this one
```

That run also downloads the dependencies, so the build after it compiles
without a network round trip.

`fetcherVersion` must match the one `fetchPnpmDeps` in the pinned nixpkgs
expects; nixpkgs states the current value in the error message when it drifts.

### release artifact — `nix/plainva-bin.nix`

`version` and `hash` both move with a release:

```bash
nix store prefetch-file --json --hash-type sha256 \
  https://github.com/plainva/plainva/releases/download/v0.8.5/Plainva_0.8.5_amd64.deb
```

### release tarball — `nix/plainva.nix`

The `fetchFromGitHub` hash is used only when the expression is called without
`src`, the way a nixpkgs package would; inside this flake the source tree is
passed in, so a release never touches that hash. Whoever lifts the expression
into nixpkgs updates it there with `nix-update --flake plainva` — the
`passthru.updateScript` for that is already in place.

## Updating nixpkgs — `flake.lock`

The flake pins nixpkgs, and both packages take Node.js, pnpm, Rust and the
Tauri libraries from that revision. Dependabot does not cover it:

```bash
nix flake update          # or: nix flake update nixpkgs
```

`docs/engineering/Dependency_Updates.md` lists the lockfile with the
dependencies that move by hand instead of through Dependabot.

## Notes on the source build

- `cargo-tauri.hook` replaces the usual cargo build and install hooks: on Linux
  it runs `cargo tauri build --bundles deb` and installs the unpacked bundle.
- `apps/desktop/src-tauri/tauri.conf.json` is patched in `postPatch` to switch
  `bundle.createUpdaterArtifacts` off. Signed updater artifacts need the
  maintainer's private key, which a Nix build does not have; the updater plugin
  settings stay in place, so an installed app keeps updating itself.
- libappindicator-sys loads the tray library with `dlopen` and a hard-coded
  soname. The source build rewrites that string in the vendored crate, the
  binary build puts the library on the RUNPATH through `runtimeDependencies`;
  without either, the tray icon stays away and GTK logs a load failure.
