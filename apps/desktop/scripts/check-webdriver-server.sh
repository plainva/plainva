#!/usr/bin/env bash
# Is the embedded WebDriver server in a built binary?
#
# The native smoke on macOS drives the app through tauri-plugin-wdio-webdriver,
# a W3C WebDriver server INSIDE the app: whoever reaches its local port controls
# the app completely. It is compiled in only with the cargo feature
# `webdriver-smoke`, which only the smoke build of native-smoke.yml enables
# (docs/engineering/WebDriver_Smoke.md). Two locks keep it there:
# src/webdriverSmokeIsolation.test.ts reads the sources, and this script reads
# what was actually built — the release legs run it on every binary they ship.
#
# The smoke build runs it with --expect-present as the positive control: a check
# that never finds anything proves nothing, so the build that DOES carry the
# server has to make it fire.
#
# What it looks for, all of them strings the plugin's code needs at run time:
# its plugin name, the variable that sets its port, and its own HTTP route.
#
# Usage: check-webdriver-server.sh [--expect-present] <binary>...
set -euo pipefail

expect_present=false
if [ "${1:-}" = "--expect-present" ]; then
  expect_present=true
  shift
fi
[ "$#" -gt 0 ] || { echo "usage: check-webdriver-server.sh [--expect-present] <binary>..."; exit 64; }

traces=("wdio-webdriver" "TAURI_WEBDRIVER_PORT" "/wdio/eval")
status=0
for binary in "$@"; do
  [ -f "$binary" ] || { echo "::error::no binary at $binary"; exit 1; }
  found=()
  for trace in "${traces[@]}"; do
    # grep -a reads the binary as text; LC_ALL=C keeps it byte for byte (a
    # universal macOS binary is two images in one file, both are read).
    if LC_ALL=C grep -a -q -F -- "$trace" "$binary"; then found+=("$trace"); fi
  done
  if $expect_present; then
    if [ "${#found[@]}" -eq "${#traces[@]}" ]; then
      echo "$binary: carries the embedded WebDriver server (${found[*]}) — as expected for the smoke build"
    else
      echo "::error::$binary: the smoke build should carry every trace of the embedded WebDriver server, found only: ${found[*]:-none} — the check would not see a leak either"
      status=1
    fi
  else
    if [ "${#found[@]}" -eq 0 ]; then
      echo "$binary: no trace of the embedded WebDriver server"
    else
      echo "::error::$binary carries the embedded WebDriver server (${found[*]}) — a release must never be built with the webdriver-smoke feature"
      status=1
    fi
  fi
done
exit $status
