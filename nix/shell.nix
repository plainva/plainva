# `nix develop` — the tools and native libraries of the "Building from source"
# section in README.md, pinned to what this flake's nixpkgs provides.
{ pkgs, ... }:

pkgs.mkShell {
  packages = with pkgs; [
    nodejs_22
    pnpm_10
    cargo-tauri

    rustc
    cargo
    rustfmt
    clippy
    rust-analyzer

    git
  ];

  # Tauri's Linux prerequisites. buildInputs puts the libraries on
  # PKG_CONFIG_PATH and LD_LIBRARY_PATH; the hook in nativeBuildInputs exports
  # the GSettings schemas and GDK pixbuf loaders, which `cargo tauri dev` needs
  # to open a window that renders.
  buildInputs = with pkgs; [
    webkitgtk_4_1
    gtk3
    gdk-pixbuf
    cairo
    glib
    dbus
    libsoup_3
    libayatana-appindicator
    librsvg
    xdotool # Tauri's libxdo
    openssl
  ];

  nativeBuildInputs = with pkgs; [
    pkg-config
    wrapGAppsHook3
    # Its setup hook exports GIO_EXTRA_MODULES, the TLS and proxy modules of
    # WebKit's network stack; a hook only runs from nativeBuildInputs.
    glib-networking
  ];

  # wrapGAppsHook3 writes GIO_EXTRA_MODULES into the wrapper of a built binary.
  # A dev shell starts the binary unwrapped, so export the same path here —
  # without it `cargo tauri dev` reaches the network through GTK without TLS.
  shellHook = ''
    export GIO_EXTRA_MODULES="${pkgs.glib-networking}/lib/gio/modules''${GIO_EXTRA_MODULES:+:$GIO_EXTRA_MODULES}"
  '';
}
