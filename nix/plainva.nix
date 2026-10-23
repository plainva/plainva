# Plainva desktop, built from the source tree of this repository.
#
# The repository is a pnpm/Turborepo monorepo whose Tauri app lives in
# apps/desktop; the Rust crate and the tauri.conf.json are in
# apps/desktop/src-tauri. The build runs fully offline:
#
#   * cargo dependencies come from Cargo.lock through importCargoLock, so no
#     hash has to be maintained for them;
#   * pnpm dependencies come from pnpm-lock.yaml through fetchPnpmDeps, which
#     does carry a hash — see nix/README.md for how to update it;
#   * the frontend is produced by the tauri beforeBuildCommand (`pnpm build`
#     runs tsc and vite build), the Rust crate embeds the result.
#
# cargo-tauri.hook replaces cargoBuildHook/cargoInstallHook: on Linux it runs
# `cargo tauri build --bundles deb` and moves the unpacked bundle into $out
# (bin/, share/applications/, share/icons/).
{
  lib,
  stdenv,
  fetchFromGitHub,
  rustPlatform,
  cargo-tauri,
  pkg-config,
  nodejs_22,
  pnpm_10,
  fetchPnpmDeps,
  pnpmConfigHook,
  wrapGAppsHook3,
  webkitgtk_4_1,
  glib-networking,
  libayatana-appindicator,
  yq-go,
  desktop-file-utils,
  nix-update-script,
  # The source tree. The flake passes its own source so that a build always
  # matches the checkout that was evaluated; a nixpkgs-style consumer can pass
  # a release tarball instead.
  src ? null,
  # Only used when `src` is left at null: the release tag to fetch.
  version ? "0.8.4",
}:

let
  # A release tarball is only fetched when no source tree was handed in.
  source =
    if src != null then
      src
    else
      fetchFromGitHub {
        owner = "plainva";
        repo = "plainva";
        tag = "v${version}";
        hash = "sha256-50ZZQN/Avg0sRI/jI4wx2zHJ4Zj2bO/HHZ1ebRp4iVk=";
      };
in
rustPlatform.buildRustPackage (finalAttrs: {
  pname = "plainva";
  # The desktop version is the version in tauri.conf.json and in the three
  # package manifests around it; read it instead of repeating it here.
  version = (lib.importJSON (source + "/apps/desktop/src-tauri/tauri.conf.json")).version;

  src = source;

  # The Tauri app sits in a subdirectory of the monorepo; cargo and tauri both
  # run from there.
  cargoRoot = "apps/desktop/src-tauri";
  buildAndTestSubdir = finalAttrs.cargoRoot;

  cargoDeps = rustPlatform.importCargoLock {
    lockFile = "${finalAttrs.src}/apps/desktop/src-tauri/Cargo.lock";
  };

  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname version src;
    pnpm = pnpm_10;
    fetcherVersion = 4;
    # Update with the procedure in nix/README.md whenever pnpm-lock.yaml moves.
    hash = "sha256-xEt1KkozO67yzBJXPlEk81wHglR7hdLmifYd6ky2gkw=";
  };

  nativeBuildInputs = [
    cargo-tauri.hook

    # Frontend toolchain: the tauri beforeBuildCommand calls `pnpm build`.
    nodejs_22
    pnpm_10
    pnpmConfigHook

    pkg-config
    yq-go # postPatch rewrites tauri.conf.json
    desktop-file-utils # postInstall edits the .desktop file
  ]
  ++ lib.optionals stdenv.hostPlatform.isLinux [ wrapGAppsHook3 ];

  buildInputs = [
    webkitgtk_4_1
    glib-networking # Tauri's network stack (TLS and proxy backend of WebKit)
    libayatana-appindicator # the tray icon reaches it through libappindicator-sys
  ];

  env = {
    # pnpm 10 asks for confirmation in non-interactive environments (for
    # example before it clears node_modules) and would hang the build.
    CI = "true";
    # package.json pins pnpm@10.0.0; the offline build must not try to fetch it.
    pnpm_config_manage_package_manager_versions = "false";
  };

  postPatch = ''
    # The updater artifacts are signed with the maintainer's private key, which
    # a Nix build does not have. The updater plugin configuration itself stays
    # untouched, so an installed app still updates itself.
    yq -iPo=json '.bundle.createUpdaterArtifacts = false' apps/desktop/src-tauri/tauri.conf.json
  ''
  + lib.optionalString stdenv.hostPlatform.isLinux ''
    # libappindicator-sys dlopens the library by a hard-coded soname, which the
    # dynamic linker cannot resolve inside the Nix store. Point it at the store
    # path (the usual treatment for Tauri packages in nixpkgs).
    substituteInPlace "$cargoDepsCopy"/libappindicator-sys-*/src/lib.rs \
      --replace-fail "libayatana-appindicator3.so.1" "${libayatana-appindicator}/lib/libayatana-appindicator3.so.1"
  '';

  postInstall = lib.optionalString stdenv.hostPlatform.isLinux ''
    desktop-file-edit \
      --set-key="Comment" --set-value="Open-source, local-first editor for plain Markdown vaults" \
      "$out/share/applications/"*.desktop
  '';

  # The repository tests are vitest, Playwright and cargo suites driven by the
  # monorepo scripts; they need a dev server and a browser and are not part of
  # a package build.
  doCheck = false;

  passthru.updateScript = nix-update-script { };

  meta = {
    description = "Open-source, local-first editor for plain Markdown vaults";
    homepage = "https://plainva.com/";
    changelog = "https://github.com/plainva/plainva/releases/tag/v${finalAttrs.version}";
    license = lib.licenses.agpl3Only;
    mainProgram = "plainva-desktop";
    platforms = lib.platforms.linux;
    sourceProvenance = [ lib.sourceTypes.fromSource ];
  };
})
