//! AppImage start-up on Linux (issue #85).
//!
//! The AppImage bundler sweeps `libwayland-client` (and the GLib family) from
//! the build machine into `usr/lib` of the AppImage. On a host with Mesa 25 or
//! newer (Fedora 44, Ubuntu 26.04) Mesa's EGL then loads against that stale
//! bundled Wayland library, `eglGetDisplay(EGL_DEFAULT_DISPLAY)` fails with
//! `EGL_BAD_PARAMETER`, and the WebKit web process aborts before it draws a
//! pixel — the window stays blank. Upstream: tauri-apps/tauri#15665. The usual
//! `WEBKIT_DISABLE_*` variables do not help: they are read after that point.
//!
//! The `.deb` and `.rpm` never see this — they use the system's WebKitGTK, Mesa
//! and Wayland. Only the AppImage carries the conflicting copy, so only the
//! AppImage launch (`APPDIR` set by the AppRun) gets the workaround: the host's
//! `libwayland-client.so.0` is put on `LD_PRELOAD` and the process re-executes
//! itself once, so the dynamic loader resolves the soname to the host copy
//! before Mesa is loaded. The WebKit helper processes inherit the variable.
//!
//! Two guards keep this narrow: the preload is planned only when the bundle
//! actually contains its own `libwayland-client.so.0` (a future bundler that
//! stops bundling it turns this into a no-op), and `PLAINVA_APPIMAGE_HOST_LIBS=0`
//! switches it off for diagnosis.
//!
//! The same start-up also drops the GStreamer plugin path the AppRun exports
//! unconditionally: with `bundleMediaFramework` off the directory never exists,
//! and a plugin path that points nowhere disables GStreamer's default search
//! entirely (media elements go missing, the registry cache is written empty).
//!
//! The planning is a pure function over an environment lookup and a file probe,
//! so it is unit-tested without an AppImage; `apply()` is the thin shell that
//! reads the real environment and re-executes.

use std::path::{Path, PathBuf};

/// Where the host keeps `libwayland-client.so.0`: Fedora/openSUSE (`lib64`),
/// Debian/Ubuntu (multiarch), Arch (`/usr/lib`), and the merged-/usr aliases.
const HOST_WAYLAND_CANDIDATES: &[&str] = &[
    "/usr/lib64/libwayland-client.so.0",
    "/usr/lib/x86_64-linux-gnu/libwayland-client.so.0",
    "/usr/lib/aarch64-linux-gnu/libwayland-client.so.0",
    "/usr/lib/libwayland-client.so.0",
    "/lib64/libwayland-client.so.0",
    "/lib/x86_64-linux-gnu/libwayland-client.so.0",
    "/lib/aarch64-linux-gnu/libwayland-client.so.0",
];

/// The GStreamer variables the AppRun hook exports (linuxdeploy-plugin-gstreamer).
const GST_VARS: &[&str] = &[
    "GST_PLUGIN_SYSTEM_PATH_1_0",
    "GST_PLUGIN_PATH_1_0",
    "GST_PLUGIN_SYSTEM_PATH",
    "GST_PLUGIN_PATH",
    "GST_PLUGIN_SCANNER_1_0",
    "GST_PTP_HELPER_1_0",
];

/// Marker so the re-executed process does not plan a second re-execution.
const REEXEC_MARKER: &str = "PLAINVA_APPIMAGE_REEXEC";

#[derive(Debug, Default, PartialEq, Eq)]
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) struct Plan {
    /// Host library to prepend to `LD_PRELOAD`, followed by a re-exec.
    pub preload: Option<PathBuf>,
    /// GStreamer variables to remove because their target does not exist.
    pub drop_vars: Vec<&'static str>,
}

/// Pure planning: `env` is the environment lookup, `exists` the file probe.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) fn plan(env: &dyn Fn(&str) -> Option<String>, exists: &dyn Fn(&Path) -> bool) -> Plan {
    let Some(appdir) = env("APPDIR").filter(|v| !v.is_empty()) else {
        return Plan::default();
    };
    let appdir = PathBuf::from(appdir);
    let mut out = Plan::default();

    let opted_out = env("PLAINVA_APPIMAGE_HOST_LIBS").as_deref() == Some("0");
    let already = env(REEXEC_MARKER).is_some();
    let ld_preload = env("LD_PRELOAD").unwrap_or_default();
    let bundled = appdir.join("usr/lib/libwayland-client.so.0");
    if !opted_out && !already && !ld_preload.contains("libwayland-client") && exists(&bundled) {
        out.preload = HOST_WAYLAND_CANDIDATES
            .iter()
            .map(PathBuf::from)
            .find(|p| exists(p));
    }

    for var in GST_VARS {
        if let Some(value) = env(var) {
            let path = Path::new(&value);
            if path.starts_with(&appdir) && !exists(path) {
                out.drop_vars.push(var);
            }
        }
    }
    out
}

/// Apply the plan to the real process: drop the dead GStreamer variables and,
/// when a host Wayland library was found, re-execute with it preloaded.
/// Only the shell is Linux-only; the planning above compiles and is tested on
/// every platform, so a Windows or macOS build still type-checks it.
#[cfg(target_os = "linux")]
pub(crate) fn apply() {
    let plan = plan(&|k| std::env::var(k).ok(), &|p| p.exists());
    for var in &plan.drop_vars {
        std::env::remove_var(var);
    }
    let Some(host) = plan.preload else { return };

    let mut preload = host.to_string_lossy().into_owned();
    if let Ok(existing) = std::env::var("LD_PRELOAD") {
        if !existing.is_empty() {
            preload.push(':');
            preload.push_str(&existing);
        }
    }
    std::env::set_var("LD_PRELOAD", &preload);
    std::env::set_var(REEXEC_MARKER, "1");

    let Ok(exe) = std::env::current_exe() else { return };
    use std::os::unix::process::CommandExt;
    let err = std::process::Command::new(exe)
        .args(std::env::args_os().skip(1))
        .exec();
    // exec only returns on failure; carry on without the preload rather than
    // refusing to start — the deb/rpm path never needed it either.
    eprintln!("plainva: AppImage host-library re-exec failed ({err}); continuing without it");
    std::env::remove_var(REEXEC_MARKER);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{HashMap, HashSet};

    fn env_of(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let map: HashMap<String, String> = pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        move |k| map.get(k).cloned()
    }

    fn fs_of(paths: &[&str]) -> impl Fn(&Path) -> bool {
        let set: HashSet<PathBuf> = paths.iter().map(PathBuf::from).collect();
        move |p| set.contains(p)
    }

    const APPDIR: &str = "/tmp/.mount_PlainvaXYZ";
    const BUNDLED: &str = "/tmp/.mount_PlainvaXYZ/usr/lib/libwayland-client.so.0";

    #[test]
    fn outside_an_appimage_nothing_happens() {
        let p = plan(&env_of(&[]), &fs_of(&["/usr/lib64/libwayland-client.so.0"]));
        assert_eq!(p, Plan::default());
    }

    #[test]
    fn preloads_the_host_library_when_the_bundle_carries_its_own() {
        let p = plan(
            &env_of(&[("APPDIR", APPDIR)]),
            &fs_of(&[BUNDLED, "/usr/lib64/libwayland-client.so.0"]),
        );
        assert_eq!(p.preload.as_deref(), Some(Path::new("/usr/lib64/libwayland-client.so.0")));
    }

    #[test]
    fn prefers_the_first_existing_candidate_in_order() {
        let p = plan(
            &env_of(&[("APPDIR", APPDIR)]),
            &fs_of(&[BUNDLED, "/usr/lib/libwayland-client.so.0", "/usr/lib/x86_64-linux-gnu/libwayland-client.so.0"]),
        );
        assert_eq!(
            p.preload.as_deref(),
            Some(Path::new("/usr/lib/x86_64-linux-gnu/libwayland-client.so.0"))
        );
    }

    #[test]
    fn no_bundled_copy_means_no_preload() {
        let p = plan(&env_of(&[("APPDIR", APPDIR)]), &fs_of(&["/usr/lib64/libwayland-client.so.0"]));
        assert_eq!(p.preload, None);
    }

    #[test]
    fn no_host_copy_means_no_preload() {
        let p = plan(&env_of(&[("APPDIR", APPDIR)]), &fs_of(&[BUNDLED]));
        assert_eq!(p.preload, None);
    }

    #[test]
    fn respects_an_existing_preload_and_the_opt_out_and_the_marker() {
        let fs = fs_of(&[BUNDLED, "/usr/lib64/libwayland-client.so.0"]);
        let user = plan(&env_of(&[("APPDIR", APPDIR), ("LD_PRELOAD", "/opt/libwayland-client.so.0")]), &fs);
        assert_eq!(user.preload, None, "a user-chosen wayland preload wins");
        let off = plan(&env_of(&[("APPDIR", APPDIR), ("PLAINVA_APPIMAGE_HOST_LIBS", "0")]), &fs);
        assert_eq!(off.preload, None, "opt-out");
        let again = plan(&env_of(&[("APPDIR", APPDIR), (REEXEC_MARKER, "1")]), &fs);
        assert_eq!(again.preload, None, "the re-executed process must not plan a second re-exec");
        let other = plan(&env_of(&[("APPDIR", APPDIR), ("LD_PRELOAD", "/opt/libother.so")]), &fs);
        assert!(other.preload.is_some(), "an unrelated preload is kept and prepended to");
    }

    #[test]
    fn drops_gstreamer_variables_that_point_into_a_missing_bundle_dir() {
        let gst = format!("{APPDIR}/usr/lib/gstreamer-1.0");
        let p = plan(
            &env_of(&[("APPDIR", APPDIR), ("GST_PLUGIN_SYSTEM_PATH_1_0", &gst), ("GST_PLUGIN_PATH_1_0", &gst)]),
            &fs_of(&[]),
        );
        assert_eq!(p.drop_vars, vec!["GST_PLUGIN_SYSTEM_PATH_1_0", "GST_PLUGIN_PATH_1_0"]);
    }

    #[test]
    fn keeps_gstreamer_variables_that_exist_or_point_outside_the_bundle() {
        let gst = format!("{APPDIR}/usr/lib/gstreamer-1.0");
        let p = plan(
            &env_of(&[("APPDIR", APPDIR), ("GST_PLUGIN_SYSTEM_PATH_1_0", &gst), ("GST_PLUGIN_PATH", "/usr/lib64/gstreamer-1.0")]),
            &fs_of(&[&gst]),
        );
        assert!(p.drop_vars.is_empty());
    }
}
