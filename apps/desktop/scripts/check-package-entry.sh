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
#     named plainva-desktop, launched by this start, owning a mapped window
#     (by its _NET_WM_PID; the title is reported, the app renames it).
#   - macOS: the .app copied out of the dmg and started through `open`
#     (LaunchServices, which reads CFBundleExecutable). Evidence: a process
#     named plainva-desktop owning an on-screen window (window-count.swift,
#     the window server's list, no permission dialog).
# Both wait up to $PLAINVA_START_TIMEOUT seconds (default 45) for the window
# and require the process 3 seconds later; a slow start is waited for, never
# retried. A failure names what was missing and shows the program's output;
# a command that ends the script without a word of its own is named by the
# ERR trap (line and command). Exactly one annotation per failure, never
# none: this script, package-entry-check.mjs and package-start-linux.sh mark
# a failure they named ($PLAINVA_REPORTED), and the trap stays silent then;
# a command that failed without naming it (xvfb-run, dbus-run-session, a
# crash of node) is named by `reports`, with its status.
#
# Only processes of these starts are ended, by their PID (Linux: the start's
# own descendants; macOS: the processes of the copied .app); another Plainva
# on the same machine is never touched.
#
# Not started: the rpm (there is no rpm-based runner; it is read only). Its
# header and payload digests are verified (`rpm -K --nosignature`), since
# rpm2cpio does not check them.
# Windows: check-package-entry.ps1. Usage: check-package-entry.sh <leg>
set -Eeuo pipefail

leg="${1:?usage: check-package-entry.sh <macos-latest|ubuntu-22.04>}"
here="$(cd "$(dirname "$0")" && pwd)"
target="$here/../src-tauri/target"
timeout_s="${PLAINVA_START_TIMEOUT:-45}"
main=plainva-desktop

# The physical path: macOS starts the copied app under /private/var/…, and
# its processes are found by that path.
work="$(cd "$(mktemp -d)" && pwd -P)"
mounted=""
installed=""
app=""
opener=""
reported="$work/.reported"
export PLAINVA_REPORTED="$reported"

# The processes started from the copied .app (macOS), by path.
app_pids() { [ -n "$app" ] && pgrep -f "$app/Contents/MacOS/" || true; }

cleanup() {
  local p
  for p in $(app_pids); do kill "$p" 2>/dev/null || true; done
  # The background `open -W`: ended and collected quietly, or bash writes
  # "Terminated: 15 open -W …" into a green log.
  if [ -n "$opener" ]; then
    kill "$opener" 2>/dev/null || true
    wait "$opener" 2>/dev/null || true
  fi
  if [ -n "$mounted" ]; then hdiutil detach "$mounted" -quiet || true; fi
  if [ -n "$installed" ]; then sudo apt-get remove -y -qq "$installed" >/dev/null || true; fi
  rm -rf "$work"
}
trap cleanup EXIT
trap '[ -e "$reported" ] || { : >"$reported"; echo "::error::check-package-entry.sh stopped at line $LINENO: $BASH_COMMAND" >&2; }' ERR

# A failure this script names itself: reported once, and the ERR trap of the
# enclosing shells stays silent.
die() {
  : >"$reported"
  echo "::error::$*" >&2
  exit 1
}
# A command that may name its own failure (it marks $PLAINVA_REPORTED when it
# does); when it fails without the mark, its failure is named here.
reports() {
  local status=0
  "$@" || status=$?
  [ "$status" = 0 ] && return 0
  [ -e "$reported" ] || die "$* ended with status $status and no message of its own"
  exit 1
}
check() { reports node "$here/package-entry-check.mjs" "$@"; }
one() {
  local found
  found="$(ls $1 2>/dev/null | head -n 1 || true)"
  [ -n "$found" ] || die "no package matches $1"
  echo "$found"
}

start_linux() {
  local label="$1"
  shift
  local run
  run="$(mktemp -d "$work/run-XXXX")"
  mkdir -p "$run/home" "$run/runtime"
  chmod 700 "$run/runtime"
  reports env HOME="$run/home" XDG_CONFIG_HOME="$run/home/.config" XDG_DATA_HOME="$run/home/.local/share" \
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
    # The digests first: rpm2cpio unpacks without checking them.
    digests="$(rpm -K --nosignature "$rpm" 2>&1)" || die "$(basename "$rpm"): its digests do not match ($digests)"
    echo "$digests"
    # rpm2cpio's exit status is not the judge: on the first rehearsal with this
    # step it ended the script with status 1 and no message. cpio fails on a
    # short or broken archive, and the check below reads what came out.
    mkdir "$work/rpm"
    rpm2cpio "$rpm" >"$work/rpm.cpio" || echo "rpm2cpio ended with status $? for $(basename "$rpm"); cpio judges the archive"
    [ -s "$work/rpm.cpio" ] || die "$(basename "$rpm"): rpm2cpio wrote no archive"
    (cd "$work/rpm" && cpio -idm --quiet <"$work/rpm.cpio") || die "$(basename "$rpm"): cpio could not unpack the payload"
    check linux "$work/rpm" "$(basename "$rpm")"

    appimage="$(one "$target/release/bundle/appimage/*.AppImage")"
    mkdir "$work/ai" && cp "$appimage" "$work/ai/app.AppImage" && chmod +x "$work/ai/app.AppImage"
    (cd "$work/ai" && ./app.AppImage --appimage-extract >/dev/null) || die "$(basename "$appimage"): --appimage-extract failed"
    check linux "$work/ai/squashfs-root" --appimage "$(basename "$appimage")"

    # The deb as a user installs it, started by what its menu entry runs —
    # the Exec key read as a launcher reads it (package-entry.mjs).
    pkg="$(dpkg-deb -f "$deb" Package)"
    sudo apt-get install -y -qq "$deb" >/dev/null || die "$(basename "$deb"): apt-get could not install it"
    installed="$pkg"
    entry="" exec_cmd=""
    for file in /usr/share/applications/*.desktop; do
      word="$(node "$here/package-entry-check.mjs" exec "$file" 2>/dev/null || true)"
      if [ "$(basename "${word:-x}")" = "$main" ]; then entry="$file" exec_cmd="$word"; break; fi
    done
    [ -n "$entry" ] || die "$(basename "$deb"): installed, but no .desktop entry under /usr/share/applications runs $main"
    resolved="$(command -v "$exec_cmd" || true)"
    [ -n "$resolved" ] || die "$(basename "$deb"): $(basename "$entry") runs $exec_cmd, which is not on PATH"
    start_linux "$(basename "$deb") (installed, $(basename "$entry"))" "$resolved"
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
    app="$work/apps/Plainva.app"

    # Without the window count the start would be judged by the process alone
    # and a start without a window would pass: no fallback, the step fails.
    windows="$work/window-count"
    if ! swiftc -O -o "$windows" "$here/window-count.swift" 2>"$work/swiftc.log"; then
      cat "$work/swiftc.log"
      die "window-count.swift did not compile; the start cannot be judged by its window"
    fi

    label="Plainva.app from $(basename "$dmg") (open)"
    log="$work/output.log"
    : >"$log"
    fail() {
      : >"$reported"
      echo "::error::$label: $1"
      echo "--- last lines of the program's output ($log) ---"
      tail -n 40 "$log" 2>/dev/null || true
      exit 1
    }
    # `open -W` stays until the app ends: when it is gone, so is the app, and
    # an early crash is seen at once instead of after the full wait.
    open -W -n --stdout "$log" --stderr "$log" "$app" &
    opener=$!
    # The app's processes named plainva-desktop (its other programs are not).
    ours() { for p in $(app_pids); do [ "$(basename "$(ps -o comm= -p "$p" 2>/dev/null)")" = "$main" ] && echo "$p"; done; true; }
    pid="" seen=0 shown=0
    for _ in $(seq "$timeout_s"); do
      sleep 1
      pid="$(ours | head -n 1)"
      if [ -n "$pid" ]; then
        seen=1
        if [ "$("$windows" "$pid")" -gt 0 ]; then shown=1; break; fi
      fi
      if ! kill -0 "$opener" 2>/dev/null && [ -z "$(ours)" ]; then
        code=0
        wait "$opener" || code=$?
        opener=""
        if [ "$seen" = 1 ]; then fail "$main started and ended before a window appeared (open does not pass on its exit code)"; fi
        [ "$code" = 0 ] || fail "open could not start the app (status $code)"
        fail "the app ended before a process named $main was seen (open does not pass on its exit code)"
      fi
    done
    if [ "$seen" = 0 ]; then
      others="$(for p in $(app_pids); do ps -o comm= -p "$p"; done | xargs -n1 basename 2>/dev/null | sort -u | paste -sd ' ' - || true)"
      fail "no process named $main after ${timeout_s} s (running from the app instead: ${others:-nothing})"
    fi
    [ "$shown" = 1 ] || fail "$main runs (pid $pid), but owns no on-screen window after ${timeout_s} s"
    sleep 3
    [ -n "$(ours)" ] || fail "$main ended within 3 s after its window appeared"
    echo "$label: $main is running with an on-screen window"
    ;;
  *)
    echo "::error::unknown build leg: $leg (Windows: check-package-entry.ps1)" >&2
    exit 2
    ;;
esac
