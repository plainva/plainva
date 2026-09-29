//! Where the helper finds the app: a named pipe on Windows, a Unix socket in a
//! private folder elsewhere — never a network port (plan KI-Harness E23). Both
//! admit only the signed-in user: the pipe carries an owner-only DACL and
//! refuses remote clients; the socket lives in a folder only the user can
//! enter and is itself `0600`.

use std::io;
use std::path::PathBuf;

use tauri::AppHandle;

/// The helper program next to the app's executable, when it is there.
pub fn helper_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    let name = if cfg!(windows) { "plainva-mcp.exe" } else { "plainva-mcp" };
    let path = dir.join(name);
    path.is_file().then_some(path)
}

#[cfg(windows)]
pub async fn serve(app: AppHandle, endpoint: String) -> io::Result<()> {
    use tokio::net::windows::named_pipe::ServerOptions;

    let name = format!(r"\\.\pipe\{endpoint}");
    let security = security::OwnerOnly::new()?;
    // `first_pipe_instance`: if another process already created this name, it
    // is not Plainva — refuse to serve beside it rather than share its clients.
    let mut server = unsafe {
        ServerOptions::new()
            .first_pipe_instance(true)
            .reject_remote_clients(true)
            .create_with_security_attributes_raw(&name, security.as_ptr())?
    };
    loop {
        server.connect().await?;
        let connected = server;
        server = unsafe { ServerOptions::new().reject_remote_clients(true).create_with_security_attributes_raw(&name, security.as_ptr())? };
        let app = app.clone();
        tauri::async_runtime::spawn(async move { super::serve_connection(app, connected).await });
    }
}

#[cfg(unix)]
pub async fn serve(app: AppHandle, endpoint: String) -> io::Result<()> {
    let path = socket_path(&endpoint)?;
    // A socket left by a crashed run: remove it only when it is a socket and ours.
    if let Ok(meta) = std::fs::symlink_metadata(&path) {
        use std::os::unix::fs::{FileTypeExt, MetadataExt};
        if meta.file_type().is_socket() && meta.uid() == unsafe { libc::getuid() } {
            let _ = std::fs::remove_file(&path);
        } else {
            return Err(io::Error::new(io::ErrorKind::AlreadyExists, "the socket path is taken by something else"));
        }
    }
    let listener = bind_private(&path)?;
    let _cleanup = RemoveOnDrop(path);
    loop {
        let (stream, _) = listener.accept().await?;
        let app = app.clone();
        tauri::async_runtime::spawn(async move { super::serve_connection(app, stream).await });
    }
}

/// The socket itself: bound, then closed to everyone but the user.
#[cfg(unix)]
pub fn bind_private(path: &std::path::Path) -> io::Result<tokio::net::UnixListener> {
    use std::os::unix::fs::PermissionsExt;
    let listener = tokio::net::UnixListener::bind(path)?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    Ok(listener)
}

#[cfg(unix)]
struct RemoveOnDrop(PathBuf);

#[cfg(unix)]
impl Drop for RemoveOnDrop {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

/// The socket's folder: private to the user (see `plainva-mcp` for the helper's side of the same rule).
#[cfg(unix)]
pub fn socket_path(endpoint: &str) -> io::Result<PathBuf> {
    use std::os::unix::fs::{DirBuilderExt, MetadataExt, PermissionsExt};
    let dir = super::socket_dir::socket_dir();
    if !dir.exists() {
        std::fs::DirBuilder::new().recursive(true).mode(0o700).create(&dir)?;
    }
    let meta = std::fs::metadata(&dir)?;
    if meta.uid() != unsafe { libc::getuid() } {
        return Err(io::Error::new(io::ErrorKind::PermissionDenied, "the socket folder belongs to another user"));
    }
    if meta.permissions().mode() & 0o077 != 0 {
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(dir.join(format!("{endpoint}.sock")))
}


#[cfg(windows)]
mod security {
    use std::io;
    use std::ptr;
    use windows_sys::Win32::Foundation::{CloseHandle, LocalFree, HANDLE};
    use windows_sys::Win32::Security::Authorization::{
        ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
    };
    use windows_sys::Win32::Security::{GetTokenInformation, TokenUser, PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES, TOKEN_QUERY, TOKEN_USER};
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    /// Security attributes whose DACL grants the signed-in user, and nobody else, the pipe.
    pub struct OwnerOnly {
        attributes: Box<SECURITY_ATTRIBUTES>,
        descriptor: PSECURITY_DESCRIPTOR,
    }

    // The descriptor is only read after creation.
    unsafe impl Send for OwnerOnly {}
    unsafe impl Sync for OwnerOnly {}

    impl OwnerOnly {
        pub fn new() -> io::Result<Self> {
            let sid = current_user_sid()?;
            let sddl: Vec<u16> = format!("D:P(A;;GA;;;{sid})").encode_utf16().chain(Some(0)).collect();
            let mut descriptor: PSECURITY_DESCRIPTOR = ptr::null_mut();
            let ok = unsafe { ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.as_ptr(), SDDL_REVISION_1, &mut descriptor, ptr::null_mut()) };
            if ok == 0 {
                return Err(io::Error::last_os_error());
            }
            let attributes = Box::new(SECURITY_ATTRIBUTES {
                nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
                lpSecurityDescriptor: descriptor,
                bInheritHandle: 0,
            });
            Ok(Self { attributes, descriptor })
        }

        pub fn as_ptr(&self) -> *mut core::ffi::c_void {
            &*self.attributes as *const SECURITY_ATTRIBUTES as *mut core::ffi::c_void
        }
    }

    impl Drop for OwnerOnly {
        fn drop(&mut self) {
            unsafe { LocalFree(self.descriptor as _) };
        }
    }

    fn current_user_sid() -> io::Result<String> {
        unsafe {
            let mut token: HANDLE = ptr::null_mut();
            if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
                return Err(io::Error::last_os_error());
            }
            let mut needed = 0u32;
            GetTokenInformation(token, TokenUser, ptr::null_mut(), 0, &mut needed);
            let mut buffer = vec![0u8; needed as usize];
            let ok = GetTokenInformation(token, TokenUser, buffer.as_mut_ptr() as _, needed, &mut needed);
            CloseHandle(token);
            if ok == 0 {
                return Err(io::Error::last_os_error());
            }
            let user = &*(buffer.as_ptr() as *const TOKEN_USER);
            let mut text: *mut u16 = ptr::null_mut();
            if ConvertSidToStringSidW(user.User.Sid, &mut text) == 0 {
                return Err(io::Error::last_os_error());
            }
            let mut len = 0;
            while *text.add(len) != 0 {
                len += 1;
            }
            let sid = String::from_utf16_lossy(std::slice::from_raw_parts(text, len));
            LocalFree(text as _);
            Ok(sid)
        }
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use std::collections::HashSet;
    use std::os::unix::fs::PermissionsExt;

    /// The gate of plan P1b: "no port listens". Binds the endpoint the way the
    /// server does and looks at every socket this process holds: none of them
    /// may be a listening TCP socket, and the endpoint itself is `0600`.
    #[tokio::test]
    async fn the_endpoint_opens_no_network_port() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("plainva-mcp-test.sock");
        let _listener = super::bind_private(&path).unwrap();
        let mut inodes = HashSet::new();
        for fd in std::fs::read_dir("/proc/self/fd").unwrap().flatten() {
            if let Ok(target) = std::fs::read_link(fd.path()) {
                let target = target.to_string_lossy().to_string();
                if let Some(rest) = target.strip_prefix("socket:[") {
                    inodes.insert(rest.trim_end_matches(']').to_string());
                }
            }
        }
        assert!(!inodes.is_empty(), "the endpoint is a socket this process holds");
        for table in ["/proc/self/net/tcp", "/proc/self/net/tcp6"] {
            for line in std::fs::read_to_string(table).unwrap_or_default().lines().skip(1) {
                let cols: Vec<&str> = line.split_whitespace().collect();
                // Column 3 is the state (0A = LISTEN), column 9 the inode.
                if cols.len() > 9 && cols[3] == "0A" {
                    assert!(!inodes.contains(cols[9]), "a TCP port listens in this process");
                }
            }
        }
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }
}
