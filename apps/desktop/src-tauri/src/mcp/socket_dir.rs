//! The private folder of the Unix socket — one answer for the app and for the
//! `plainva-mcp` helper, which links this file directly. Derived from the user,
//! not from the environment: a client may start the helper with a cleaned one.

use std::path::PathBuf;

pub fn socket_dir() -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        // The per-user temporary folder the system hands every process of this user.
        let mut buf = vec![0u8; 1024];
        let n = unsafe { libc::confstr(libc::_CS_DARWIN_USER_TEMP_DIR, buf.as_mut_ptr() as *mut libc::c_char, buf.len()) };
        if n > 1 && (n as usize) <= buf.len() {
            let dir = String::from_utf8_lossy(&buf[..n as usize - 1]).to_string();
            return PathBuf::from(dir).join("plainva-mcp");
        }
        let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/tmp"));
        home.join("Library/Caches/plainva-mcp")
    }
    #[cfg(not(target_os = "macos"))]
    {
        let uid = unsafe { libc::getuid() };
        let runtime = PathBuf::from(format!("/run/user/{uid}"));
        if runtime.is_dir() {
            return runtime.join("plainva-mcp");
        }
        PathBuf::from(format!("/tmp/plainva-mcp-{uid}"))
    }
}
