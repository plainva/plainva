#!/usr/bin/env bash
# One start of a built Linux package, run INSIDE an X server and a D-Bus
# session (check-package-entry.sh calls it under `xvfb-run` and
# `dbus-run-session`, with its own HOME and XDG_RUNTIME_DIR, so the start
# depends on nothing of the runner's session).
#
# Passes when a process named plainva-desktop that this start launched (the
# started command itself or one of its descendants) owns a mapped top-level
# window within $PLAINVA_START_TIMEOUT seconds (default 45; polled every
# second, so a slow first start is waited for, not retried) and still runs 3
# seconds after that. The window is the start's by its _NET_WM_PID (GDK sets
# it on every top-level window), not by its title: the app renames its window
# after what it shows (windowTitle.ts). The title is reported, not judged.
#
# On failure it says which of these went wrong — never started, ended early
# (with its exit code), running under another name, no window (with the
# windows that were there) — and prints the last lines of the program's
# output. Only processes of this start are ended, by their PID; another
# Plainva on the same machine is never touched.
#
# Usage: package-start-linux.sh <label> <output-log> <command> [args...]
set -uo pipefail

label="$1" log="$2"
shift 2
main=plainva-desktop
timeout_s="${PLAINVA_START_TIMEOUT:-45}"

# The plainva-desktop processes of this start: $pid itself or a descendant.
ours() {
  local p q
  for p in $(pgrep -x "$main"); do
    q="$p"
    while [ -n "$q" ] && [ "$q" -gt 1 ]; do
      if [ "$q" = "$pid" ]; then echo "$p"; break; fi
      q="$(awk '{print $4}' "/proc/$q/stat" 2>/dev/null)"
    done
  done
}

stop() {
  local p
  for p in $(ours) "$pid"; do kill "$p" 2>/dev/null; done
  wait "$pid" 2>/dev/null
}

fail() {
  echo "::error::$label: $1"
  echo "--- last lines of the program's output ($log) ---"
  tail -n 40 "$log" 2>/dev/null || echo "(no output)"
  stop
  exit 1
}

# The mapped top-level windows, one line each: id, owning PID, title.
windows() {
  local id owner title
  for id in $(xwininfo -root -children 2>/dev/null | awk '$1 ~ /^0x/ { print $1 }'); do
    xwininfo -id "$id" 2>/dev/null | grep -q 'Map State: IsViewable' || continue
    owner="$(xprop -id "$id" _NET_WM_PID 2>/dev/null | sed -n 's/.* = \([0-9]*\)$/\1/p')"
    title="$(xwininfo -id "$id" 2>/dev/null | sed -n 's/^xwininfo: Window id: [^ ]* "\(.*\)"$/\1/p')"
    echo "$id ${owner:-?} ${title:-(no title)}"
  done
}

# The first mapped window owned by a process of this start.
our_window() {
  local procs id owner rest
  procs=" $(ours | tr '\n' ' ') "
  while read -r id owner rest; do
    case "$procs" in *" $owner "*) echo "$id $rest"; return ;; esac
  done < <(windows)
}

"$@" >"$log" 2>&1 &
pid=$!
seen=0
found=""
for _ in $(seq "$timeout_s"); do
  sleep 1
  if [ -n "$(ours)" ]; then seen=1; fi
  found="$(our_window)"
  [ -n "$found" ] && break
  if ! kill -0 "$pid" 2>/dev/null && [ -z "$(ours)" ]; then
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
if [ -z "$found" ]; then
  there="$(windows | awk '{ $1 = ""; sub(/^ /, ""); print "pid " $0 }' | paste -sd ';' - | sed 's/;/; /g')"
  fail "$main runs (pid $(ours | paste -sd ' ' -)), but owns no mapped window after ${timeout_s} s (mapped windows: ${there:-none})"
fi

sleep 3
[ -n "$(ours)" ] || fail "$main ended within 3 s after its window appeared"
echo "$label: $main is running with its window mapped (${found%% *}, titled \"${found#* }\")"
stop
exit 0
