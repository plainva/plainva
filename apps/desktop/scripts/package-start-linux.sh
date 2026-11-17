#!/usr/bin/env bash
# One start of a built Linux package, run INSIDE an X server and a D-Bus
# session (check-package-entry.sh calls it under `xvfb-run` and
# `dbus-run-session`, with its own HOME and XDG_RUNTIME_DIR, so the start
# depends on nothing of the runner's session).
#
# Passes when a process named plainva-desktop shows a mapped top-level window
# titled "Plainva" within $PLAINVA_START_TIMEOUT seconds (default 45; polled
# every second, so a slow first start is waited for, not retried) and is
# still running 3 seconds after that. On failure it says which of these went
# wrong — never started, ended early (with its exit code), running under
# another name, no window — and prints the last lines of the program's
# output.
#
# Usage: package-start-linux.sh <label> <output-log> <command> [args...]
set -uo pipefail

label="$1" log="$2"
shift 2
main=plainva-desktop
title=Plainva
timeout_s="${PLAINVA_START_TIMEOUT:-45}"

fail() {
  echo "::error::$label: $1"
  echo "--- last lines of the program's output ($log) ---"
  tail -n 40 "$log" 2>/dev/null || echo "(no output)"
  pkill -x "$main" 2>/dev/null
  kill "$pid" 2>/dev/null
  exit 1
}

# A mapped top-level window with the app's title, owned by any X client.
window() {
  local id
  for id in $(xwininfo -root -children 2>/dev/null | awk -v t="\"$title\"" 'index($0, t) { print $1 }'); do
    if xwininfo -id "$id" 2>/dev/null | grep -q 'Map State: IsViewable'; then echo "$id"; return; fi
  done
}

"$@" >"$log" 2>&1 &
pid=$!
seen=0
found=""
for _ in $(seq "$timeout_s"); do
  sleep 1
  if pgrep -x "$main" >/dev/null; then seen=1; fi
  found="$(window)"
  [ -n "$found" ] && [ "$seen" = 1 ] && break
  if ! kill -0 "$pid" 2>/dev/null && ! pgrep -x "$main" >/dev/null; then
    wait "$pid"
    code=$?
    if [ "$seen" = 1 ]; then fail "$main started and ended before a window appeared (exit code $code)"; fi
    fail "no $main process was seen; the start command ($(basename "$1")) ended with exit code $code within $SECONDS s"
  fi
done

if [ "$seen" = 0 ]; then
  others="$(ps -o comm= --ppid "$pid" -p "$pid" 2>/dev/null | sort -u | tr '\n' ' ' | sed 's/ $//')"
  fail "no process named $main after ${timeout_s} s (running instead: ${others:-nothing})"
fi
[ -n "$found" ] || fail "$main runs, but no window titled \"$title\" was mapped within ${timeout_s} s"

sleep 3
pgrep -x "$main" >/dev/null || fail "$main ended within 3 s after its window appeared"
echo "$label: $main is running with its window \"$title\" mapped ($found)"
pkill -x "$main"
kill "$pid" 2>/dev/null
wait "$pid" 2>/dev/null
exit 0
