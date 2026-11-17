#!/usr/bin/env bash
# Measures a freshly built AppImage (issue #85, tauri-apps/tauri#15665).
#
# Four things are asserted, the rest is measured:
#   - the AppImage extracts and carries the app, the MCP helper and an AppRun;
#   - spell checking travels along (Sammelplan § 3.183 Nr. 1): the bundled
#     libenchant is the relocatable build of build-appimage-enchant.sh, not the
#     build machine's, and the Hunspell provider with libhunspell sits in
#     usr/lib/enchant-2 where that library looks;
#   - every bundled library carries its licence: its package's copyright file
#     under usr/share/doc, Enchant's own COPYING.LIB under usr/share/doc/enchant-2
#     (needs dpkg — run it on the machine that built the AppImage);
#   - the inventory of "infrastructure" libraries the bundler swept in
#     (libwayland-*, the GLib family, GStreamer) is written to the job summary.
#
# The inventory is the point. The blank window on Mesa-25 hosts comes from a
# bundled libwayland-client that collides with the host's Mesa; the app works
# around it at start-up (src-tauri/src/linux_appimage.rs) as long as that copy
# is in the bundle. When a future bundler stops bundling it, this list is where
# that becomes visible — and the day the list is empty, the workaround is dead
# code that can go.
#
# Usage: check-appimage.sh <path-to.AppImage>
set -euo pipefail

appimage="${1:?usage: check-appimage.sh <file.AppImage>}"
[ -f "$appimage" ] || { echo "::error::no AppImage at $appimage"; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cp "$appimage" "$work/app.AppImage"
chmod +x "$work/app.AppImage"
(cd "$work" && ./app.AppImage --appimage-extract >/dev/null)
root="$work/squashfs-root"

[ -x "$root/AppRun" ] || { echo "::error::AppRun missing or not executable"; exit 1; }
# Two programs since 0.9.0: the app and the MCP helper. Both are required by
# name; the first executable under usr/bin is not "the binary" any more (the
# 0.9.0 rehearsal reported the helper here). What the AppImage starts is
# checked by check-package-entry.sh.
for program in plainva-desktop plainva-mcp; do
  [ -x "$root/usr/bin/$program" ] || { echo "::error::usr/bin/$program missing or not executable"; exit 1; }
done
binary="$root/usr/bin/plainva-desktop"

enchant="$root/usr/lib/libenchant-2.so.2"
[ -f "$enchant" ] || { echo "::error::no bundled libenchant-2.so.2"; exit 1; }
grep -q '/proc/self/maps' "$enchant" \
  || { echo "::error::the bundled libenchant is not the relocatable build — linuxdeploy took the build machine's"; exit 1; }
[ -f "$root/usr/lib/enchant-2/enchant_hunspell.so" ] \
  || { echo "::error::the Hunspell provider is missing from usr/lib/enchant-2"; exit 1; }
missing="$(LD_LIBRARY_PATH="$root/usr/lib" ldd "$root/usr/lib/enchant-2/enchant_hunspell.so" | grep 'not found' || true)"
[ -z "$missing" ] || { echo "::error::the Hunspell provider cannot resolve: $missing"; exit 1; }

# Licences (Sammelplan § 3.183 Nr. 1). linuxdeploy copies a library's Debian
# copyright file only when dpkg knows the library by the path it found it at,
# which left out the /lib libraries and the plugin modules; the AppImage
# preparation (build-appimage-enchant.sh) adds those. Each bundled library is
# looked up on this machine — the one it was taken from — and one of its
# packages must have usr/share/doc/<package>/copyright in the AppImage. A file
# no package owns fails too: nothing says what licence it has.
[ -f "$root/usr/share/doc/enchant-2/COPYING.LIB" ] \
  || { echo "::error::Enchant's licence is missing (usr/share/doc/enchant-2/COPYING.LIB)"; exit 1; }
command -v dpkg >/dev/null || { echo "::error::the licence check needs dpkg (the build machine)"; exit 1; }
licence_gaps=()
libraries=0
licensed=()
while IFS= read -r rel; do
  libraries=$((libraries + 1))
  # A library by its SONAME (the bundle also carries copies under development
  # names such as libgio-2.0.so, owned by -dev packages); a module without one
  # by its path below usr/lib, which tells GTK 3 modules from GTK 2 ones of the
  # same name; the build's own copies in usr/lib/enchant-2 by file name. dpkg
  # takes a pattern with a leading slash as an exact path, so each query is a
  # glob ending in that name, wherever the build machine keeps it.
  dir="$(dirname "$rel")"
  # Not from a package: Enchant's own build (its licence was asserted above)
  # and a library shipped with its licence beside it (ONNX Runtime).
  case "$(basename "$rel")" in
    libenchant-2.so.2 | enchant_hunspell.so) licensed+=("enchant-2"); continue ;;
  esac
  if [ "$dir" != . ] && { compgen -G "$root/usr/lib/$dir/LICENSE*" || compgen -G "$root/usr/lib/$dir/COPYING*"; } >/dev/null; then
    licensed+=("$dir"); continue
  fi
  soname="$(objdump -p "$root/usr/lib/$rel" 2>/dev/null | awk '$1 == "SONAME" { print $2 }')"
  owners=""
  for query in ${soname:+"*/$soname"} "*/$rel" "*/$(basename "$rel")"; do
    owners="$(dpkg -S "$query" 2>/dev/null || true)"
    [ -n "$owners" ] && break
  done
  packages="$(cut -d: -f1 <<<"$owners" | tr ',' '\n' | tr -d ' ' | sed '/^$/d' | sort -u)"
  ok=no
  for package in $packages; do
    if [ -f "$root/usr/share/doc/$package/copyright" ]; then ok=yes; licensed+=("$package"); break; fi
  done
  if [ "$ok" = no ]; then
    licence_gaps+=("usr/lib/$rel (${packages:-no package owns it})")
  fi
done < <(cd "$root/usr/lib" && find . -type f -name '*.so*' | sed 's|^\./||' | sort)
if [ "${#licence_gaps[@]}" -gt 0 ]; then
  for gap in "${licence_gaps[@]}"; do echo "::error::no licence in the AppImage for $(tr '\n' ' ' <<<"$gap")"; done
  echo "Add the package to copyright_packages in build-appimage-enchant.sh."
  exit 1
fi
packages_licensed="$(printf '%s\n' "${licensed[@]}" | sort -u | wc -l)"

summary="${GITHUB_STEP_SUMMARY:-/dev/stdout}"
{
  echo "### AppImage inventory — $(basename "$appimage")"
  echo
  echo "Binary: \`${binary#"$root/"}\` · size $(du -h "$appimage" | cut -f1)"
  echo
  echo "AppRun hooks sourced at start:"
  if ls "$root"/apprun-hooks/*.sh >/dev/null 2>&1; then
    for h in "$root"/apprun-hooks/*.sh; do echo "- \`$(basename "$h")\`"; done
  else
    echo "- (none)"
  fi
  echo
  echo "Infrastructure libraries the bundler swept in (each one is a potential"
  echo "collision with the host on newer distributions — tauri#15665):"
  echo
  found=0
  for pattern in 'libwayland-*' 'libglib-2.0*' 'libgio-2.0*' 'libgobject-2.0*' 'libgmodule-2.0*' 'libgst*'; do
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      found=$((found + 1))
      echo "- \`${f#"$root/"}\`"
    done < <(find "$root/usr/lib" -maxdepth 1 -name "$pattern" 2>/dev/null | sort)
  done
  if [ "$found" -eq 0 ]; then
    echo "- (none — the start-up preload in linux_appimage.rs is a no-op for this build)"
  fi
  echo
  echo "Licences: each of the $libraries bundled libraries has its package's copyright file ($packages_licensed packages), Enchant its COPYING.LIB."
  echo
  echo "Spell checking: relocatable \`usr/lib/libenchant-2.so.2\` with"
  for f in "$root"/usr/lib/enchant-2/*; do echo "- \`${f#"$root/"}\`"; done
  echo
  if [ -f "$root/usr/lib/libwayland-client.so.0" ]; then
    echo "\`usr/lib/libwayland-client.so.0\` is bundled → the start-up preload of the host copy is ACTIVE on AppImage launches."
  else
    echo "No bundled \`libwayland-client.so.0\` → the start-up preload never fires; consider removing it."
  fi
} | tee -a "$summary"
