fn main() {
    // tauri-build (2.6.3) embeds icons/icon.ico into the Windows exe inside
    // its build script but emits no rerun-if-changed for it — an icon-only
    // change would never re-run the script, so rebuilt binaries keep the OLD
    // icon from cargo's cached .res. Watch the file ourselves.
    println!("cargo:rerun-if-changed=icons/icon.ico");
    tauri_build::build();
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        // Tauri's executable resource does not reach the library test harness.
        // Its dialog dependency imports TaskDialogIndirect, which only exists
        // in Common Controls v6. Without a manifest, cargo test exits in the
        // Windows loader before a single test runs (STATUS_ENTRYPOINT_NOT_FOUND).
        // Apply the same dependency to every linked target, including unit tests.
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'");
        // The app binary already embeds Tauri's full manifest as resource #1.
        // Do not generate a second resource there (CVTRES duplicate resource).
        println!("cargo:rustc-link-arg-bin=plainva-desktop=/MANIFEST:NO");
        // The MCP helper (src/bin/plainva-mcp.rs) is a binary of this package
        // too and gets the same resource: the same rule, or its link fails.
        println!("cargo:rustc-link-arg-bin=plainva-mcp=/MANIFEST:NO");
    }
}
