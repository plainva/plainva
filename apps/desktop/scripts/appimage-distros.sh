#!/usr/bin/env bash
# Starts a freshly built AppImage on the distributions it has to run on
# (Sammelplan § 3.183 Nr. 1) and fails when one of them does not start it or
# spell checking does not do what that distribution's setup says.
#
# It must start everywhere it started before — also on a system without
# Enchant and on ones with a far newer Enchant and GLib than the build image —
# and spell checking must use the host's Hunspell dictionary. Each
# distribution is a container in which appimage-distro-probe.sh starts the
# AppImage under Xvfb twice: without a German dictionary (nothing may load)
# and with one (de_DE must load). The second run also installs the
# distribution's own Enchant (not on openSUSE), so a far newer host Enchant
# beside the bundled one is measured too. The base packages are what any
# desktop has and a minimal container lacks.
#
# Run by release.yml on the Linux leg right after the AppImage is built — on
# the tag path, in the rehearsal and in the manual test build — so the file
# never leaves the runner before the maintainer publishes the draft, and the
# containers see the AppImage and the probe, nothing else (no checkout, no
# token). The images float (:latest, :stable); the summary names the digest
# each one resolved to.
#
# Usage: appimage-distros.sh <file.AppImage>   (needs docker)
# Exit: 0 when every distribution passed, 1 otherwise (all are run).
set -uo pipefail

appimage="${1:?usage: appimage-distros.sh <file.AppImage>}"
here="$(cd "$(dirname "$0")" && pwd)"
summary="${GITHUB_STEP_SUMMARY:-/dev/stdout}"

apt_base='apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates xvfb xauth dbus procps libgtk-3-0t64 libgl1 libegl1 libgbm1 libgles2 libgpg-error0 fonts-dejavu-core'
apt_dictionary='DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends hunspell-de-de libenchant-2-2'

# name | image | base packages | dictionary (empty: the run without Enchant)
distributions=(
  "Debian stable|debian:stable|$apt_base|$apt_dictionary"
  "Ubuntu 24.04 LTS|ubuntu:24.04|$apt_base|$apt_dictionary"
  "Fedora|fedora:latest|dnf -y install --setopt=install_weak_deps=False xorg-x11-server-Xvfb xorg-x11-xauth dbus-daemon dbus-tools procps-ng gtk3 mesa-libGL mesa-libEGL mesa-libgbm mesa-libGLES libgpg-error dejavu-sans-fonts|dnf -y install --setopt=install_weak_deps=False hunspell-de enchant2"
  "Arch Linux|archlinux:latest|pacman -Syu --noconfirm xorg-server-xvfb xorg-xauth dbus procps-ng gtk3 mesa ttf-dejavu|pacman -S --noconfirm hunspell-de enchant"
  "openSUSE Tumbleweed|opensuse/tumbleweed:latest|zypper -n install --no-recommends xvfb-run xauth dbus-1 procps libgtk-3-0 Mesa-libGL1 Mesa-libEGL1 libgbm1 dejavu-fonts|zypper -n install --no-recommends myspell-de_DE"
  # No Enchant and no dictionary at all: the bundled library must neither
  # break the start nor pretend to check.
  "Debian stable without Enchant|debian:stable|$apt_base|"
)

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cp "$appimage" "$work/app.AppImage"
cp "$here/appimage-distro-probe.sh" "$work/probe.sh"

{
  echo "### AppImage on the distributions"
  echo
  echo "| Distribution | Image |"
  echo "|---|---|"
} >> "$summary"
for entry in "${distributions[@]}"; do
  IFS='|' read -r name image _ _ <<<"$entry"
  if docker pull -q "$image" >/dev/null; then
    digest="$(docker image inspect --format '{{index .RepoDigests 0}}' "$image")"
  else
    digest="(pull failed)"
  fi
  echo "| $name | \`$digest\` |" >> "$summary"
done
{
  echo
  echo "| Run | Starts | Languages loaded | Expected | Host Enchant | Host GLib |"
  echo "|---|---|---|---|---|---|"
} >> "$summary"

failed=()
for entry in "${distributions[@]}"; do
  IFS='|' read -r name image base dictionary <<<"$entry"
  echo "::group::$name ($image)"
  : > "$work/summary"
  {
    echo 'set -euo pipefail'
    echo "$base"
    if [ -z "$dictionary" ]; then
      echo 'for so in libenchant-2.so.2 libhunspell-1.7.so.0; do'
      echo '  if ls /usr/lib*/"$so" /usr/lib/*/"$so" >/dev/null 2>&1; then echo "::error::$so is installed"; exit 1; fi'
      echo 'done'
    fi
    echo "bash /probe/probe.sh /probe/app.AppImage '$name, no dictionary' no"
    if [ -n "$dictionary" ]; then
      echo "$dictionary"
      echo "bash /probe/probe.sh /probe/app.AppImage '$name, hunspell de_DE' yes"
    fi
  } > "$work/run.sh"
  if docker run --rm -v "$work:/probe" -e GITHUB_STEP_SUMMARY=/probe/summary "$image" bash /probe/run.sh; then
    status=0
  else
    status=1
    failed+=("$name")
    echo "::error::the AppImage failed on $name"
  fi
  cat "$work/summary" >> "$summary"
  echo "::endgroup::"
  [ "$status" -eq 0 ] || echo "| $name | **failed** — see the log | | | | |" >> "$summary"
done

if [ "${#failed[@]}" -gt 0 ]; then
  echo "::error::the AppImage failed on: ${failed[*]}"
  exit 1
fi
echo "The AppImage started on all ${#distributions[@]} distributions."
