# Plainva desktop from the binary package the maintainers publish.
#
# The release page carries a deb, an rpm and an AppImage for x86_64 Linux; the
# deb is the smallest and the easiest to unpack, so this expression takes it
# apart with dpkg and keeps the layout the maintainers shipped (one binary in
# bin/, the icons and the .desktop file under share/). Nothing is compiled,
# which makes this the package to use when a full Rust and frontend build is
# not wanted.
#
# The binary links against the system WebKitGTK and GTK, so autoPatchelfHook
# rewrites its RUNPATH to the matching store paths. libayatana-appindicator is
# not in DT_NEEDED — libappindicator-sys loads it with dlopen — so it goes into
# runtimeDependencies: autoPatchelfHook puts it on the RUNPATH too, which is
# where the dynamic linker looks when the tray icon is created.
{
  lib,
  stdenvNoCC,
  fetchurl,
  dpkg,
  autoPatchelfHook,
  wrapGAppsHook3,
  gtk3,
  gdk-pixbuf,
  cairo,
  glib,
  glib-networking,
  dbus,
  libsoup_3,
  webkitgtk_4_1,
  libayatana-appindicator,
  # Bump both together when a new desktop release is published:
  #   nix store prefetch-file --json --hash-type sha256 \
  #     https://github.com/plainva/plainva/releases/download/vX.Y.Z/Plainva_X.Y.Z_amd64.deb
  version ? "0.8.4",
  hash ? "sha256-83EIWX8ptKeuKEu77yCvLY59p6r9HpPPvZb/73jIxDw=",
}:

stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "plainva-bin";
  inherit version;

  src = fetchurl {
    url = "https://github.com/plainva/plainva/releases/download/v${finalAttrs.version}/Plainva_${finalAttrs.version}_amd64.deb";
    inherit hash;
  };

  nativeBuildInputs = [
    dpkg
    autoPatchelfHook
    wrapGAppsHook3
  ];

  buildInputs = [
    gtk3
    gdk-pixbuf
    cairo
    glib
    glib-networking # TLS and proxy backend of WebKit's network stack
    dbus
    libsoup_3
    webkitgtk_4_1
  ];

  # Loaded through dlopen by the tray icon, so it appears in no DT_NEEDED entry.
  runtimeDependencies = [ libayatana-appindicator ];

  dontConfigure = true;
  dontBuild = true;

  unpackPhase = ''
    runHook preUnpack
    dpkg-deb -x ${finalAttrs.src} .
    runHook postUnpack
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p $out
    cp -r usr/* $out/
    runHook postInstall
  '';

  meta = {
    description = "Open-source, local-first editor for plain Markdown vaults (prebuilt binary)";
    homepage = "https://plainva.com/";
    changelog = "https://github.com/plainva/plainva/releases/tag/v${finalAttrs.version}";
    license = lib.licenses.agpl3Only;
    mainProgram = "plainva-desktop";
    # The release carries an amd64 deb only.
    platforms = [ "x86_64-linux" ];
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
  };
})
