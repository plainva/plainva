//! Where the helper finds the app: a named pipe on Windows, a Unix socket in a
//! private folder elsewhere — never a network port (plan KI-Harness E23). Both
//! admit only the signed-in user: the pipe carries an owner-only DACL and
//! refuses remote clients; the socket lives in a folder only the user can
//! enter and is itself `0600`.

use std::io;
use std::path::PathBuf;
use std::time::Duration;

use tauri::{AppHandle, Runtime};
use tokio::sync::OwnedMutexGuard;

/// The pauses after a connection that could not be taken: the listener goes on after them (see `serve`).
const ACCEPT_PAUSE_MIN: Duration = Duration::from_millis(50);
const ACCEPT_PAUSE_MAX: Duration = Duration::from_secs(2);

/// How many connections in a row may fail to be taken: a listener that cannot take any ends, and the status says so
/// (`McpState::listening`); the next settings that keep the server on start another.
const ACCEPT_FAILURES_MAX: u32 = 10;

/// The connections that could not be taken in a row, and the pause after the next one.
struct Streak {
    pause: Duration,
    failures: u32,
}

impl Streak {
    fn new() -> Self {
        Self { pause: ACCEPT_PAUSE_MIN, failures: 0 }
    }

    /// One was taken: the next failure starts anew.
    fn taken(&mut self) {
        *self = Self::new();
    }

    /// One more could not be taken: the pause before the listener goes on, or `None` once too many failed in a row.
    fn failed(&mut self) -> Option<Duration> {
        self.failures += 1;
        if self.failures >= ACCEPT_FAILURES_MAX {
            return None;
        }
        let pause = self.pause;
        self.pause = (self.pause * 2).min(ACCEPT_PAUSE_MAX);
        Some(pause)
    }
}

/// The helper program next to the app's executable, when it is there.
pub fn helper_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    let name = if cfg!(windows) { "plainva-mcp.exe" } else { "plainva-mcp" };
    let path = dir.join(name);
    path.is_file().then_some(path)
}

/// The longest pause between two tries to take the pipe name (see `serve`).
#[cfg(windows)]
const NAME_PAUSE_MAX: Duration = Duration::from_secs(1);

/// Serves the endpoint until the task that runs it is ended. `held` is the
/// endpoint's own lock — one listener at a time (`McpState::start_listener`);
/// `bound` is called once the endpoint is taken and a client can reach it.
#[cfg(windows)]
pub async fn serve<R: Runtime>(app: AppHandle<R>, endpoint: String, held: OwnedMutexGuard<()>, bound: impl FnOnce() + Send) -> io::Result<()> {
    use tokio::net::windows::named_pipe::ServerOptions;
    const ERROR_ACCESS_DENIED: i32 = 5;

    let _held = held;
    let name = format!(r"\\.\pipe\{endpoint}");
    let security = security::OwnerOnly::new()?;
    // `first_pipe_instance`: while any instance of this name is open, Plainva
    // does not serve beside it — another program's, which is not Plainva and
    // whose clients it does not share, or one of its own that is still
    // closing: a connection of the listener before this one (the server
    // switched off and on) whose app has not let go yet. It tries again until
    // the name is free.
    let mut pause = Duration::from_millis(50);
    let mut server = loop {
        let created = unsafe {
            ServerOptions::new()
                .first_pipe_instance(true)
                .reject_remote_clients(true)
                .create_with_security_attributes_raw(&name, security.as_ptr())
        };
        match created {
            Ok(server) => break server,
            Err(error) if error.raw_os_error() == Some(ERROR_ACCESS_DENIED) => {
                tokio::time::sleep(pause).await;
                pause = (pause * 2).min(NAME_PAUSE_MAX);
            }
            Err(error) => return Err(error),
        }
    };
    bound();
    let mut streak = Streak::new();
    loop {
        if let Err(error) = server.connect().await {
            // A connection that failed on its way in ends nothing but itself: a new instance waits for the next one.
            // An instance that cannot be made, or too many failures in a row, end the listener (the status says so).
            eprintln!("mcp: a connection could not be taken: {error}");
            let Some(pause) = streak.failed() else {
                return Err(error);
            };
            server = unsafe { ServerOptions::new().reject_remote_clients(true).create_with_security_attributes_raw(&name, security.as_ptr())? };
            tokio::time::sleep(pause).await;
            continue;
        }
        streak.taken();
        let connected = server;
        server = unsafe { ServerOptions::new().reject_remote_clients(true).create_with_security_attributes_raw(&name, security.as_ptr())? };
        let app = app.clone();
        tauri::async_runtime::spawn(async move { super::serve_connection(app, connected).await });
    }
}

/// Serves the endpoint until the task that runs it is ended (see the Windows
/// version for `held` and `bound`).
#[cfg(unix)]
pub async fn serve<R: Runtime>(app: AppHandle<R>, endpoint: String, held: OwnedMutexGuard<()>, bound: impl FnOnce() + Send) -> io::Result<()> {
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
    let _cleanup = RemoveOnDrop { path, _held: held };
    bound();
    let mut streak = Streak::new();
    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                streak.taken();
                let app = app.clone();
                tauri::async_runtime::spawn(async move { super::serve_connection(app, stream).await });
            }
            // A connection that could not be taken — out of file handles, gone before it was taken — ends nothing but
            // itself: the listener waits a moment and goes on. Any other failure, or too many in a row, end it, and
            // the status says so.
            Err(error) if passes(&error) => {
                eprintln!("mcp: a connection could not be taken: {error}");
                let Some(pause) = streak.failed() else {
                    return Err(error);
                };
                tokio::time::sleep(pause).await;
            }
            Err(error) => return Err(error),
        }
    }
}

/// Whether a failure to take a connection is one of the moment, after which the listener goes on (Unix).
#[cfg(unix)]
fn passes(error: &io::Error) -> bool {
    matches!(error.kind(), io::ErrorKind::ConnectionAborted | io::ErrorKind::Interrupted)
        || matches!(error.raw_os_error(), Some(libc::EMFILE | libc::ENFILE | libc::ENOBUFS | libc::ENOMEM | libc::EPROTO))
}

/// The socket itself: bound, then closed to everyone but the user.
#[cfg(unix)]
pub fn bind_private(path: &std::path::Path) -> io::Result<tokio::net::UnixListener> {
    use std::os::unix::fs::PermissionsExt;
    let listener = tokio::net::UnixListener::bind(path)?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    Ok(listener)
}

/// A listener's socket, removed when the listener ends. The endpoint's lock
/// is let go only after that: the next listener binds a socket of its own at
/// the same path then, and never loses it to this one's removal.
#[cfg(unix)]
struct RemoveOnDrop {
    path: PathBuf,
    _held: OwnedMutexGuard<()>,
}

#[cfg(unix)]
impl Drop for RemoveOnDrop {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
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

#[cfg(all(test, unix))]
mod accept_tests {
    use std::io;

    /// A connection that could not be taken ends nothing but itself; a listener that cannot take any more ends.
    #[test]
    fn a_connection_that_could_not_be_taken_ends_nothing_but_itself() {
        for passing in [io::Error::from_raw_os_error(libc::EMFILE), io::Error::from_raw_os_error(libc::ENFILE), io::Error::from(io::ErrorKind::ConnectionAborted)] {
            assert!(super::passes(&passing), "{passing}");
        }
        for ending in [io::Error::from_raw_os_error(libc::EBADF), io::Error::from_raw_os_error(libc::EINVAL)] {
            assert!(!super::passes(&ending), "{ending}");
        }
    }
}

#[cfg(test)]
mod streak_tests {
    use super::{Streak, ACCEPT_FAILURES_MAX, ACCEPT_PAUSE_MAX, ACCEPT_PAUSE_MIN};

    /// Failures in a row wait longer each time, up to a bound; too many end the listener; one taken starts anew.
    #[test]
    fn a_streak_of_connections_not_taken_ends_the_listener_and_one_taken_starts_it_anew() {
        let mut streak = Streak::new();
        let mut pauses = Vec::new();
        while let Some(pause) = streak.failed() {
            pauses.push(pause);
        }
        assert_eq!(pauses.len() as u32, ACCEPT_FAILURES_MAX - 1);
        assert_eq!(pauses[0], ACCEPT_PAUSE_MIN);
        assert!(pauses.windows(2).all(|pair| pair[1] >= pair[0]));
        assert_eq!(*pauses.last().unwrap(), ACCEPT_PAUSE_MAX);
        streak.taken();
        assert_eq!(streak.failed(), Some(ACCEPT_PAUSE_MIN));
    }
}
