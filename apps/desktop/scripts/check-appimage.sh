#!/usr/bin/env bash
# Measures a freshly built AppImage (issue #85, tauri-apps/tauri#15665).
#
# Two things are asserted, the rest is measured:
#   - the AppImage extracts and carries the application binary and an AppRun;
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
binary="$(find "$root/usr/bin" -maxdepth 1 -type f -perm -u+x | head -n 1 || true)"
[ -n "$binary" ] || { echo "::error::no executable under usr/bin"; exit 1; }

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
  if [ -f "$root/usr/lib/libwayland-client.so.0" ]; then
    echo "\`usr/lib/libwayland-client.so.0\` is bundled → the start-up preload of the host copy is ACTIVE on AppImage launches."
  else
    echo "No bundled \`libwayland-client.so.0\` → the start-up preload never fires; consider removing it."
  fi
} | tee -a "$summary"
