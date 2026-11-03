# ADR 0036: Nix packaging lives in the repository as the release binary and a development shell

Status: Accepted

Date: 2026-11-03 (proposed 2026-10-11 in pull request #124)

(The numbers 0017 to 0030 and 0032 to 0035 are in use on a feature branch that
has not been merged yet.)

## Context

Nixpkgs has no `plainva` attribute, and the repository carried no flake. A Nix
user on Linux had three options, and each of them sat outside the Nix store:
the `.deb`, the `.rpm` or the AppImage from the release page; the AUR package
that `README.md` names as independently maintained and unverified; or a manual
build with a toolchain installed by hand.

The release workflow builds and signs the installers, and it stays the way
most users install Plainva. What it cannot provide is an installation the Nix
store tracks, or a shell that carries the Tauri prerequisites for development.

The project is maintained by one person without a Nix machine, and CI has no
Nix either. What decides which parts the repository carries is therefore which
parts keep working without anyone watching them.

## Decision

`flake.nix` in the repository root provides:

- `packages.plainva-bin` (also `default`), the amd64 `.deb` of a release,
  unpacked with `dpkg`. It carries one hash per release, which can be computed
  from the published file's digest without Nix; the release checklist moves it.
- `devShells.default`, the toolchain that "Building from source" in `README.md`
  describes. It carries no hash.

The flake covers `x86_64-linux` only, the one platform with a `.deb` on the
release page.

The release binary updates itself from the release page, which cannot work
inside the read-only Nix store. The package's wrapper sets
`PLAINVA_UPDATES_MANAGED_BY=Nix`; the app then never asks the update feed, and
the settings say that Nix brings the next version. Any package manager can set
the same variable.

The flake carries **no package built from source**. Its `pnpmDeps` hash follows
`pnpm-lock.yaml`, which Dependabot moves about once a week; after each such
merge the build would fail on a hash mismatch until someone with Nix updated
it, and nobody on the project could notice, repair or reproduce that.

## Consequences

Easier: a Nix user installs the published binary without compiling, and Nix
tracks it. A contributor gets Node.js, pnpm, Rust and the Tauri libraries from
`nix develop` instead of installing them by hand.

Harder: one hash per release and one lockfile need care, and neither is covered
by Dependabot. `nix/README.md` holds the commands, the release checklist names
the hash step, and `docs/engineering/Dependency_Updates.md` lists the lockfile
with the dependencies that move by hand.

Constrained: the binary package can never cover more systems than the release
page does, and it trusts the artifact the maintainers publish. Nothing in the
release checks builds it, so a broken package is noticed by its users. Releases
up to 0.8.6 do not read the updater variable; they still offer an update they
cannot install.

## Alternatives

- **A package built from source in this repository.** It follows every commit,
  but its dependency hash breaks with every lockfile change and needs Nix to
  repair. Its place is nixpkgs or a repository of its own; the expression in
  the original contribution takes `src` as an argument for that.
- **A package in nixpkgs only.** An outside maintainer updates it after every
  release, and nixpkgs carries no development shell for this repository.
- **No flake.** The release page keeps serving `.deb`, `.rpm` and AppImage,
  and a Nix user keeps installing outside the store.

## Links

- `nix/README.md` — the package, the hash, the lockfile and the updater switch
- `README.md` — "Download & install" and "Building from source"
- `docs/engineering/Dependency_Updates.md` — the moved Nix inputs
- `docs/engineering/Release_Gate_Checklist.md` — the hash step of a release
- `apps/desktop/src/services/appUpdate.ts`, `apps/desktop/src-tauri/src/app_identity.rs` — the updater switch
