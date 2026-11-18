#!/usr/bin/env bash
# Builds the spell-checking library the Linux AppImage carries (Sammelplan
# § 3.183 Nr. 1).
#
# Why: WebKitGTK checks spelling through Enchant 2, and the AppImage bundler
# sweeps the build machine's libenchant-2.so.2 into usr/lib — but not its
# provider modules. Ubuntu builds that library without relocation, so it looks
# for providers only under the compiled-in /usr/lib/x86_64-linux-gnu/enchant-2
# of whatever host runs the AppImage. Debian and Ubuntu have them there; Fedora,
# Arch and openSUSE keep them elsewhere, and a system without Enchant has none:
# nothing was ever underlined there.
#
# What: the same Enchant release the build image ships (Ubuntu 22.04,
# enchant-2 2.3.2, byte-identical upstream tarball, no Debian patches), built
# with gnulib relocation. A relocatable libenchant finds its own file through
# /proc/self/maps and looks for providers next to itself, in
# <AppDir>/usr/lib/enchant-2. The Hunspell provider and libhunspell travel
# along; the dictionaries stay the host's (/usr/share/hunspell and the XDG data
# dirs, which the AppRun hook keeps), so an installed hunspell-de-de or
# hunspell-de is what gets used. The library links only GLib and GModule, the
# same ones the AppImage already bundles, so it starts wherever today's build
# starts.
#
# Licences travel along (LGPL-2.1 for Enchant, MPL/GPL/LGPL for Hunspell):
# Enchant's COPYING.LIB and AUTHORS from the very tarball go to
# usr/share/doc/enchant-2, the Debian copyright of the libhunspell package to
# usr/share/doc/<package>. The same step adds the copyright files linuxdeploy
# leaves out for libraries it does bundle (see copyright_packages below);
# check-appimage.sh fails a build in which any bundled library's package has
# none.
#
# The output directory mirrors the AppDir: lib/ goes to usr/lib, doc/ to
# usr/share/doc. src-tauri/tauri.appimage.conf.json maps both
# (bundle.linux.appimage.files, relative to src-tauri like every bundle path),
# and the release passes that overlay with --config. The bundler copies it in before linuxdeploy
# runs, so linuxdeploy treats it like
# its own (dependencies, runpaths); check-appimage.sh asserts afterwards that
# the AppImage carries this build and not the system's.
#
# Usage: build-appimage-enchant.sh   (writes src-tauri/target/appimage-enchant/{lib,doc})
# Needs: build-essential, pkg-config, patchelf, libglib2.0-dev, libhunspell-dev.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
base="$here/../src-tauri/target/appimage-enchant"
out="$base/lib"
doc="$base/doc"

version=2.3.2
sha256=ce9ba47fd4d34031bd69445598a698a6611602b2b0e91d705e91a6f5099ead6e
urls=(
  "https://archive.ubuntu.com/ubuntu/pool/main/e/enchant-2/enchant-2_${version}.orig.tar.gz"
  "https://github.com/AbiWord/enchant/releases/download/v${version}/enchant-${version}.tar.gz"
)
# Not a path on the build machine or the host: only the anchor relocation
# replaces with the AppDir. It must not be a prefix of /usr/share/hunspell,
# or the dictionary directory would move into the AppDir as well.
prefix=/opt/plainva-enchant

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

fetched=0
for url in "${urls[@]}"; do
  if curl -fsSL --retry 3 -o "$work/enchant.tar.gz" "$url" \
    && echo "$sha256  $work/enchant.tar.gz" | sha256sum -c --status; then
    fetched=1
    break
  fi
done
[ "$fetched" -eq 1 ] || { echo "::error::could not fetch enchant ${version} with the expected checksum"; exit 1; }

tar -xzf "$work/enchant.tar.gz" -C "$work"
src="$work/enchant-${version}"
(
  cd "$src"
  # RUNPATH: the library next to itself, the provider one level up.
  ./configure --quiet \
    --prefix="$prefix" --libdir="$prefix/lib" \
    --enable-relocatable --disable-static \
    --with-hunspell-dir=/usr/share/hunspell \
    --without-aspell --without-hspell --without-nuspell --without-voikko \
    --without-zemberek --without-applespell
  make -s -j"$(nproc)"
  make -s DESTDIR="$work/dest" install
)

lib="$work/dest$prefix/lib"
provider="$lib/enchant-2/enchant_hunspell.so"
[ -f "$provider" ] || { echo "::error::the Hunspell provider was not built (libhunspell-dev missing?)"; exit 1; }

rm -rf "$base"
mkdir -p "$out/enchant-2" "$doc/enchant-2"
cp -L "$lib/libenchant-2.so.2" "$out/libenchant-2.so.2"
cp "$provider" "$out/enchant-2/"
# libhunspell beside the provider: found through its runpath even if
# linuxdeploy were to leave a subdirectory alone.
hunspell="$(ldd "$provider" | awk '/libhunspell/ { print $3 }')"
[ -n "$hunspell" ] || { echo "::error::the provider does not link libhunspell"; exit 1; }
cp -L "$hunspell" "$out/enchant-2/$(basename "$hunspell")"
patchelf --set-rpath '$ORIGIN' "$out/libenchant-2.so.2"
patchelf --set-rpath '$ORIGIN:$ORIGIN/..' "$out/enchant-2/enchant_hunspell.so"

# Licences. Enchant's from the tarball that was built; Hunspell's from the
# package the copied library belongs to.
cp "$src/COPYING.LIB" "$src/AUTHORS" "$doc/enchant-2/"
hunspell_package="$(dpkg -S "$(readlink -f "$hunspell")" | cut -d: -f1 | head -n 1)"
[ -n "$hunspell_package" ] || { echo "::error::no package owns $hunspell"; exit 1; }

# Copyright files linuxdeploy does not carry for libraries it bundles: on
# Ubuntu 22.04 it looks a library up by its /usr/lib path, and dpkg knows the
# ones from /lib (usrmerge) only by that path; the GIO, GDK-Pixbuf and tray
# libraries come in through the bundler's plugins without one. Measured in the
# AppImage of the 0.9.0 test build of 2026-11-17 (Sammelplan § 3.183 Nr. 1);
# check-appimage.sh names any package that is still missing.
copyright_packages=(
  "$hunspell_package"
  libbz2-1.0 libcap2 libdbus-1-3 libkeyutils1 liblzma5 libpcre3 libselinux1
  libayatana-appindicator3-1 librsvg2-common glib-networking dconf-gsettings-backend
)
for package in "${copyright_packages[@]}"; do
  file="/usr/share/doc/$package/copyright"
  [ -f "$file" ] || { echo "::error::$package is not installed on the build machine, or has no $file"; exit 1; }
  mkdir -p "$doc/$package"
  cp -L "$file" "$doc/$package/copyright"
done

# Relocation is the point; refuse a build without it.
grep -q '/proc/self/maps' "$out/libenchant-2.so.2" \
  || { echo "::error::libenchant was built without relocation"; exit 1; }

echo "Built relocatable Enchant ${version} into $base:"
find "$base" -type f -printf '  %P (%s bytes)\n'
