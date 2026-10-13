# ADR 0028: Nix packaging lives in the repository

Status: Proposed

Date: 2026-10-11

## Context

Nixpkgs has no `plainva` attribute, and the repository carried no flake. A Nix
user on Linux had three options, and each of them sat outside the Nix store:
the `.deb`, the `.rpm` or the AppImage from the release page; the AUR package
that `README.md` names as independently maintained and unverified; or a manual
build with a toolchain installed by hand.

The release workflow builds and signs the installers, and it stays the way
most users install Plainva. What it cannot provide is a build that follows a
commit, an installation the Nix store tracks, or a shell that carries the Tauri
prerequisites for development.

## Decision

`flake.nix` in the repository root provides:

- `packages.plainva` (also `default`), built from the source tree the flake is
  evaluated from, through `cargo-tauri.hook` and `fetchPnpmDeps`;
- `packages.plainva-bin`, the amd64 `.deb` of a release, unpacked with `dpkg`;
- `devShells.default`, the toolchain that "Building from source" in `README.md`
  describes.

The flake covers `x86_64-linux` only, the platform the release workflow builds
for and the only one with a release artifact. The expression takes `src` as an
argument, so a nixpkgs package can hand in a release tarball instead of the
source tree. `nix/README.md` documents the maintenance of the two release
hashes and of the lockfile.

## Consequences

Easier: a Nix user installs from a commit (`nix run github:plainva/plainva`) or
from the published binary, without compiling. A contributor gets Node.js,
pnpm, Rust and the Tauri libraries from `nix develop` instead of installing
them by hand.

Harder: three hashes and one lockfile need care, and none of them is covered by
Dependabot. `pnpmDeps.hash` follows `pnpm-lock.yaml`, the `.deb` hash follows a
release, and `flake.lock` pins the nixpkgs revision behind the toolchain of
both packages. `nix/README.md` holds the commands, and
`docs/engineering/Dependency_Updates.md` lists the lockfile with the
dependencies that move by hand.

Constrained: the source package builds from the whole source tree, so any
commit changes its input hash and the next build compiles Rust again, about 25
minutes on 22 cores. A binary cache would remove that cost and the project has
none. The binary package can never cover more systems than the release page
does, and it trusts the artifact the maintainers publish.

## Alternatives

- **A package in nixpkgs only.** It builds from a release tarball, so an
  outside maintainer updates the source hash after every release, and nixpkgs
  carries no development shell for this repository.
- **A binary package only.** A checkout, a fork or a CI cache could not build
  anything, and a Nix user could not build the commit they are reading.
- **No flake.** The release page keeps serving `.deb`, `.rpm` and AppImage,
  and a Nix user keeps installing outside the store.

## Links

- `nix/README.md` — the packages, the hashes and the lockfile
- `README.md` — "Download & install" and "Building from source"
- `docs/engineering/Dependency_Updates.md` — the moved Nix inputs
