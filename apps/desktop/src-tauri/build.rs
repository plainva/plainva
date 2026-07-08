fn main() {
    // tauri-build (2.6.3) embeds icons/icon.ico into the Windows exe inside
    // its build script but emits no rerun-if-changed for it — an icon-only
    // change would never re-run the script, so rebuilt binaries keep the OLD
    // icon from cargo's cached .res. Watch the file ourselves.
    println!("cargo:rerun-if-changed=icons/icon.ico");
    tauri_build::build()
}
