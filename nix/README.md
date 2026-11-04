# Nix packaging

`flake.nix` in the repository root provides:

| Attribute | Source | Notes |
| --- | --- | --- |
| `plainva-bin` (also `default`) | the `.deb` on the GitHub release | nothing is compiled |
| `devShells.default` | — | `nix develop`, the toolchain for `pnpm --filter desktop tauri dev` |

```bash
nix run github:plainva/plainva#plainva-bin   # start the released desktop app
nix build .#plainva-bin
nix develop                                  # development shell
```

The package installs `bin/plainva-desktop` and keeps the icons and the
`.desktop` file exactly as the release ships them. It covers x86_64 Linux only,
the one platform with a `.deb` on the release page. It is maintained by the
community, and the release checks do not build it.

The flake carries no package built from source: its `pnpm-lock.yaml` hash would
break with every dependency update, and nobody on the project can rebuild it.
A source build belongs in nixpkgs or a repository of its own; the expression
from the original contribution (git history of `nix/plainva.nix`) takes `src`
as an argument for exactly that.

## Updates come through Nix

The release binary updates itself from the release page. A copy in the Nix store
cannot be replaced that way, so the wrapper sets `PLAINVA_UPDATES_MANAGED_BY=Nix`.
With it the app never asks the update feed: there is no start-up check and no
update offer, and **Settings → About & diagnostics → Updates** shows "Updated
through Nix" instead of the switch and the button. Releases up to 0.8.6 do not
read the variable yet; from the first release after 0.8.6 on they do.

Any other package manager can do the same: set the variable to its name in the
environment of the app.

## Updating the release hash — `nix/plainva-bin.nix`

`version` and `hash` both move with a desktop release. With Nix:

```bash
nix store prefetch-file --json --hash-type sha256 \
  https://github.com/plainva/plainva/releases/download/v0.8.6/Plainva_0.8.6_amd64.deb
```

Without Nix, from the digest GitHub shows for the release asset (hex SHA-256 to
the SRI form Nix expects):

```bash
gh api repos/plainva/plainva/releases/tags/v0.8.6 \
  --jq '.assets[] | select(.name | endswith("_amd64.deb")) | .digest'
# sha256:abccf84a…  ->
echo "sha256-$(echo abccf84a… | xxd -r -p | base64)"
```

## Updating nixpkgs — `flake.lock`

The flake pins nixpkgs; the libraries the binary links against and the tools of
the development shell come from that revision. Dependabot does not cover it:

```bash
nix flake update          # or: nix flake update nixpkgs
```

`docs/engineering/Dependency_Updates.md` lists the lockfile with the
dependencies that move by hand instead of through Dependabot.

## Notes on the binary package

- The binary links against the system WebKitGTK and GTK, so `autoPatchelfHook`
  rewrites its RUNPATH to the matching store paths.
- libappindicator-sys loads the tray library with `dlopen` and a hard-coded
  soname, so it appears in no `DT_NEEDED` entry. The package puts it on the
  RUNPATH through `runtimeDependencies`; without it the tray icon stays away and
  GTK logs a load failure.
