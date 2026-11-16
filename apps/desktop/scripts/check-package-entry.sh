#!/usr/bin/env bash
# What the built Linux and macOS packages start (0.9.0 is the first release
# with two programs in every package: the app and the MCP helper).
#
# Read, in every package: the helper is in it, and every entry the system
# starts names the app (package-entry.mjs) — deb and rpm by the Exec line of
# their .desktop file, the AppImage by the .desktop file its AppRun reads,
# the .app (from the bundle, the dmg and the updater archive) by
# CFBundleExecutable. The sizes of the new parts are logged.
#
# Started, the way a user starts them:
#   - Linux: the deb, installed with apt and started by its .desktop Exec
#     line, then removed; the AppImage, extracted and started through AppRun.
#     Each start runs under Xvfb in a D-Bus session of its own, with its own
#     HOME and XDG_RUNTIME_DIR (package-start-linux.sh). Evidence: a process
#     named plainva-desktop with a mapped window titled "Plainva".
#   - macOS: the .app copied out of the dmg and started through `open`
#     (LaunchServices, which reads CFBundleExecutable). Evidence: a process
#     named plainva-desktop owning an on-screen window (window-count.swift,
#     the window server's list, no permission dialog).
# Both wait up to $PLAINVA_START_TIMEOUT seconds (default 45) for the window
# and require the process 3 seconds later; a slow start is waited for, never
# retried. A failure names what was missing and shows the program's output.
#
# Not started: the rpm (there is no rpm-based runner; it is read only).
# Windows: check-package-entry.ps1. Usage: check-package-entry.sh <leg>
set -euo pipefail

leg="${1:?usage: check-package-entry.sh <macos-latest|ubuntu-22.04>}"
here="$(cd "$(dirname "$0")" && pwd)"
target="$here/../src-tauri/target"
timeout_s="${PLAINVA_START_TIMEOUT:-45}"
main=plainva-desktop

work="$(mktemp -d)"
mounted=""
installed=""
cleanup() {
  pkill -x "$main" 2>/dev/null || true
  if [ -n "$mounted" ]; then hdiutil detach "$mounted" -quiet || true; fi
  if [ -n "$installed" ]; then sudo apt-get remove -y -qq "$installed" >/dev/null || true; fi
  rm -rf "$work"
}
trap cleanup EXIT

check() { node "$here/package-entry-check.mjs" "$@"; }
one() {
  local found
  found="$(ls $1 2>/dev/null | head -n 1 || true)"
  [ -n "$found" ] || { echo "::error::no package matches $1" >&2; exit 1; }
  echo "$found"
}

start_linux() {
  local label="$1"
  shift
  local run
  run="$(mktemp -d "$work/run-XXXX")"
  mkdir -p "$run/home" "$run/runtime"
  chmod 700 "$run/runtime"
  HOME="$run/home" XDG_CONFIG_HOME="$run/home/.config" XDG_DATA_HOME="$run/home/.local/share" \
    XDG_CACHE_HOME="$run/home/.cache" XDG_RUNTIME_DIR="$run/runtime" PLAINVA_START_TIMEOUT="$timeout_s" \
    xvfb-run -a -s "-screen 0 1440x900x24" dbus-run-session -- \
    bash "$here/package-start-linux.sh" "$label" "$run/output.log" "$@"
}

case "$leg" in
  ubuntu-22.04)
    deb="$(one "$target/release/bundle/deb/*.deb")"
    mkdir "$work/deb" && dpkg-deb -x "$deb" "$work/deb"
    check linux "$work/deb" "$(basename "$deb")"

    rpm="$(one "$target/release/bundle/rpm/*.rpm")"
    mkdir "$work/rpm" && (cd "$work/rpm" && rpm2cpio "$rpm" | cpio -idm --quiet)
    check linux "$work/rpm" "$(basename "$rpm")"

    appimage="$(one "$target/release/bundle/appimage/*.AppImage")"
    mkdir "$work/ai" && cp "$appimage" "$work/ai/app.AppImage" && chmod +x "$work/ai/app.AppImage"
    (cd "$work/ai" && ./app.AppImage --appimage-extract >/dev/null)
    check linux "$work/ai/squashfs-root" --appimage "$(basename "$appimage")"

    # The deb as a user installs it, started by what its menu entry runs.
    pkg="$(dpkg-deb -f "$deb" Package)"
    sudo apt-get install -y -qq "$deb" >/dev/null
    installed="$pkg"
    entry="$(ls /usr/share/applications/*.desktop | xargs grep -l "^Exec=$main\b\|^Exec=/usr/bin/$main\b" | head -n 1 || true)"
    [ -n "$entry" ] || { echo "::error::$(basename "$deb"): installed, but no .desktop entry under /usr/share/applications runs $main"; exit 1; }
    exec_cmd="$(grep -m1 '^Exec=' "$entry" | cut -d= -f2- | awk '{print $1}')"
    start_linux "$(basename "$deb") (installed, $(basename "$entry"))" "$(command -v "$exec_cmd")"
    sudo apt-get remove -y -qq "$pkg" >/dev/null
    installed=""

    start_linux "$(basename "$appimage") (AppRun)" "$work/ai/squashfs-root/AppRun"
    ;;
  macos-latest)
    bundle="$target/universal-apple-darwin/release/bundle"
    check mac "$bundle/macos/Plainva.app" "Plainva.app"

    mkdir "$work/updater" && tar -xzf "$bundle/macos/Plainva.app.tar.gz" -C "$work/updater"
    check mac "$work/updater/Plainva.app" "Plainva.app.tar.gz"

    dmg="$(one "$bundle/dmg/*.dmg")"
    mounted="$work/dmg"
    mkdir "$mounted" && hdiutil attach "$dmg" -nobrowse -readonly -mountpoint "$mounted" -quiet
    check mac "$mounted/Plainva.app" "$(basename "$dmg")"
    mkdir "$work/apps" && cp -R "$mounted/Plainva.app" "$work/apps/"
    hdiutil detach "$mounted" -quiet && mounted=""

    windows=""
    if swiftc -O -o "$work/window-count" "$here/window-count.swift" 2>"$work/swiftc.log"; then windows="$work/window-count"
    else echo "::warning::window-count.swift did not compile, the start is judged by the process alone"; cat "$work/swiftc.log"; fi

    label="Plainva.app from $(basename "$dmg") (open)"
    log="$work/output.log"
    : >"$log"
    open -n --stdout "$log" --stderr "$log" "$work/apps/Plainva.app"
    fail() {
      echo "::error::$label: $1"
      echo "--- last lines of the program's output ($log) ---"
      tail -n 40 "$log" 2>/dev/null || true
      exit 1
    }
    pid="" seen=0 shown=0
    for _ in $(seq "$timeout_s"); do
      sleep 1
      pid="$(pgrep -x "$main" | head -n 1 || true)"
      if [ -n "$pid" ]; then
        seen=1
        if [ -z "$windows" ] || [ "$("$windows" "$pid")" -gt 0 ]; then shown=1; break; fi
      elif [ "$seen" = 1 ]; then
        fail "$main started and ended before a window appeared (open does not pass on its exit code)"
      fi
    done
    if [ "$seen" = 0 ]; then
      others="$(pgrep -fl "$work/apps/Plainva.app/" | tr '\n' ' ' || true)"
      fail "no process named $main after ${timeout_s} s (running from the app instead: ${others:-nothing})"
    fi
    [ "$shown" = 1 ] || fail "$main runs (pid $pid), but owns no on-screen window after ${timeout_s} s"
    sleep 3
    pgrep -x "$main" >/dev/null || fail "$main ended within 3 s after its window appeared"
    echo "$label: $main is running$([ -n "$windows" ] && echo " with an on-screen window")"
    ;;
  *)
    echo "::error::unknown build leg: $leg (Windows: check-package-entry.ps1)" >&2
    exit 2
    ;;
esac
