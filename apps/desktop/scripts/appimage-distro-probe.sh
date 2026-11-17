#!/usr/bin/env bash
# Starts a built AppImage on the distribution this runs on and reports whether
# it starts and whether spell checking loaded a dictionary (Sammelplan § 3.183
# Nr. 1). Run by appimage-distros.sh in one container per distribution; it
# works the same on any Linux machine with Xvfb.
#
# How it measures:
#   - The AppImage is extracted and its AppRun started under Xvfb with spell
#     checking switched on in a fresh settings file and a German locale.
#   - The app writes one line to stderr each time the checker is switched on
#     (src-tauri/src/linux_spellcheck.rs): "spell checking loaded [..]" or
#     "spell checking finds no dictionary". The switch is read by the page's
#     own script, so the line also proves the page loaded and ran.
#   - "starts" = that line appeared and the process was still running.
#
# Usage: appimage-distro-probe.sh <file.AppImage> <label> <expect-loaded: yes|no>
# Exit: 0 when it starts and the languages match the expectation, 1 otherwise.
set -uo pipefail

appimage="${1:?usage: appimage-distro-probe.sh <file.AppImage> <label> <yes|no>}"
label="${2:?label}"
expect="${3:?expect yes|no}"
wait_seconds="${PROBE_WAIT_SECONDS:-120}"

work="$(mktemp -d)"
cp "$appimage" "$work/app.AppImage"
chmod +x "$work/app.AppImage"
(cd "$work" && ./app.AppImage --appimage-extract >/dev/null) || { echo "::error::$label: the AppImage does not extract"; exit 1; }
root="$work/squashfs-root"

# The host's own Enchant and GLib, by the file the soname points to.
host_version() {
  local soname="$1" f
  for d in /usr/lib64 /usr/lib/x86_64-linux-gnu /usr/lib /lib64 /lib/x86_64-linux-gnu; do
    if [ -e "$d/$soname" ]; then
      f="$(readlink -f "$d/$soname")"
      echo "${f##*/}"
      return
    fi
  done
  echo "none"
}
enchant_host="$(host_version libenchant-2.so.2)"
glib_host="$(host_version libglib-2.0.so.0)"
dicts="$(ls /usr/share/hunspell/*.dic 2>/dev/null | xargs -r -n1 basename | tr '\n' ' ')"

echo "== $label: host Enchant $enchant_host, host GLib $glib_host, dictionaries: ${dicts:-none}"
echo "== libraries the bundle does not carry and the host lacks:"
missing="$(find "$root/usr/bin" "$root/usr/lib" -maxdepth 2 -type f \( -name '*.so*' -o -perm -u+x \) -print0 \
  | LD_LIBRARY_PATH="$root/usr/lib" xargs -0 -r ldd 2>/dev/null | grep "not found" | sort -u || true)"
echo "${missing:-   (none)}"

home="$work/home"
mkdir -p "$home/.local/share/com.plainva.desktop" "$home/.config"
echo '{ "spellcheck": true }' > "$home/.local/share/com.plainva.desktop/plainva-settings.json"

log="$work/app.log"
launcher=()
command -v dbus-run-session >/dev/null && launcher=(dbus-run-session --)
# The web process sandbox needs user namespaces a container does not grant;
# it has nothing to do with spell checking and behaves the same before and
# after this change. Software rendering: Xvfb has no GPU.
HOME="$home" XDG_CONFIG_HOME="$home/.config" XDG_DATA_HOME="$home/.local/share" \
LANG=de_DE.UTF-8 LANGUAGE=de_DE LC_ALL= \
WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1 LIBGL_ALWAYS_SOFTWARE=1 \
  "${launcher[@]}" xvfb-run -a -s "-screen 0 1280x800x24" "$root/AppRun" >"$log" 2>&1 &
runner=$!

line=""
for _ in $(seq 1 "$wait_seconds"); do
  line="$(grep -m1 -E 'plainva: spell checking (loaded|finds no dictionary)' "$log" || true)"
  [ -n "$line" ] && break
  kill -0 "$runner" 2>/dev/null || break
  sleep 1
done
sleep 3
alive=no
pgrep -f plainva-desktop >/dev/null && alive=yes

started=no
[ -n "$line" ] && [ "$alive" = yes ] && started=yes
loaded=no
case "$line" in *"spell checking loaded ["*) loaded=yes ;; esac
languages="$(sed -n 's/.*spell checking loaded \(\[.*\]\).*/\1/p' <<<"$line")"

pkill -f plainva-desktop 2>/dev/null
kill "$runner" 2>/dev/null
wait "$runner" 2>/dev/null

echo "== $label: starts $started, languages loaded $loaded ${languages}"
echo "== last lines of the app's output:"
tail -n 40 "$log"

summary="${GITHUB_STEP_SUMMARY:-/dev/null}"
echo "| $label | $started | $loaded ${languages} | $expect | $enchant_host | $glib_host |" >> "$summary"

rm -rf "$work"
[ "$started" = yes ] && [ "$loaded" = "$expect" ]
