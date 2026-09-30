//! `plainva-mcp` — the helper an AI tool starts to reach Plainva (plan
//! KI-Harness §17.3, ADR 0022).
//!
//! An MCP client (Claude Code, Claude Desktop, an editor) runs this program as
//! a stdio server. It connects to the running Plainva through a named pipe
//! (Windows) or a private Unix socket (macOS, Linux), says which client started
//! it, and from then on only passes bytes along in both directions. It reads
//! nothing from the vault and opens no network port. When Plainva is not
//! running, or turns the client away, the client gets one clear error and the
//! helper ends.
//!
//! Usage: `plainva-mcp [--app <identifier>]` — the identifier picks the
//! installation (release by default; the Labs and dev builds have their own).

#[path = "../mcp/hello.rs"]
#[allow(dead_code)]
mod hello;
#[cfg(unix)]
#[path = "../mcp/socket_dir.rs"]
mod socket_dir;

use std::io;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};

/// The keychain service of the secrets this helper keeps, one per client and installation.
const KEYCHAIN_SERVICE: &str = "plainva-mcp";

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let identifier = match parse_args() {
        Some(identifier) => identifier,
        None => return,
    };
    if let Err(message) = run(&identifier).await {
        eprintln!("plainva-mcp: {message}");
        std::process::exit(1);
    }
}

fn parse_args() -> Option<String> {
    let mut identifier = hello::RELEASE_IDENTIFIER.to_string();
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--app" => identifier = args.next().unwrap_or(identifier),
            "--version" => {
                println!("plainva-mcp {}", env!("CARGO_PKG_VERSION"));
                return None;
            }
            _ => {}
        }
    }
    Some(identifier)
}

async fn run(identifier: &str) -> Result<(), String> {
    let mut stdin = BufReader::new(tokio::io::stdin());
    let mut stdout = tokio::io::stdout();

    // The client speaks first; its `initialize` says who it is.
    let mut first = Vec::new();
    stdin.read_until(b'\n', &mut first).await.map_err(|e| e.to_string())?;
    if first.is_empty() {
        return Ok(());
    }
    let init: serde_json::Value = serde_json::from_slice(&first).unwrap_or(serde_json::Value::Null);
    let request_id = init.get("id").cloned().unwrap_or(serde_json::Value::Null);
    let client = hello::clean_label(init.pointer("/params/clientInfo/name").and_then(|v| v.as_str()).unwrap_or(""));
    let version = hello::clean_label(init.pointer("/params/clientInfo/version").and_then(|v| v.as_str()).unwrap_or(""));
    let account = format!("{identifier}/{client}");
    let secret = keyring::Entry::new(KEYCHAIN_SERVICE, &account).ok().and_then(|entry| entry.get_password().ok());

    let stream = match connect(identifier).await {
        Ok(stream) => stream,
        Err(_) => {
            return refuse(&mut stdout, &request_id, "Plainva is not running, or AI tools are switched off in its Settings (AI & automation).").await;
        }
    };
    let (pipe_read, mut pipe_write) = tokio::io::split(stream);
    let mut pipe_in = BufReader::new(pipe_read);

    let hello = hello::Hello { v: hello::HELLO_VERSION, client, version, program: parent_program(), secret };
    let line = serde_json::to_string(&hello).map_err(|e| e.to_string())?;
    pipe_write.write_all(format!("{line}\n").as_bytes()).await.map_err(|e| e.to_string())?;

    // Plainva may be asking the user now: the answer can take a while.
    let mut reply_line = Vec::new();
    let read = (&mut pipe_in).take(hello::HELLO_MAX_BYTES as u64).read_until(b'\n', &mut reply_line).await;
    let reply: Option<hello::HelloReply> = read.ok().and_then(|_| serde_json::from_slice(&reply_line).ok());
    let Some(reply) = reply else {
        return refuse(&mut stdout, &request_id, "Plainva ended the connection.").await;
    };
    if !reply.ok {
        let message = match reply.reason.as_deref() {
            Some("denied") => "Plainva did not allow this client. Allow it when Plainva asks, or look in Settings, AI & automation.",
            Some("no-vault") => "Plainva has no vault open.",
            Some("busy") => "Plainva is asking about another client right now. Try again in a moment.",
            Some("version") => "This helper does not match the running Plainva. Update Plainva.",
            _ => "Plainva could not admit this client.",
        };
        return refuse(&mut stdout, &request_id, message).await;
    }
    if let Some(new_secret) = reply.secret {
        // Kept for the next start; without it, Plainva asks again.
        if let Ok(entry) = keyring::Entry::new(KEYCHAIN_SERVICE, &account) {
            let _ = entry.set_password(&new_secret);
        }
    }

    pipe_write.write_all(&first).await.map_err(|e| e.to_string())?;
    let up = async {
        let _ = tokio::io::copy(&mut stdin, &mut pipe_write).await;
        let _ = pipe_write.shutdown().await;
    };
    let down = async {
        let _ = tokio::io::copy(&mut pipe_in, &mut stdout).await;
        let _ = stdout.flush().await;
    };
    // Either side ending ends the session.
    tokio::select! {
        _ = up => {}
        _ = down => {}
    }
    Ok(())
}

/// Answers the client's `initialize` with one error it will show, and ends.
async fn refuse<W: AsyncWrite + Unpin>(out: &mut W, id: &serde_json::Value, message: &str) -> Result<(), String> {
    let error = serde_json::json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32001, "message": message } });
    let _ = out.write_all(format!("{error}\n").as_bytes()).await;
    let _ = out.flush().await;
    Ok(())
}

#[cfg(windows)]
async fn connect(identifier: &str) -> io::Result<tokio::net::windows::named_pipe::NamedPipeClient> {
    use tokio::net::windows::named_pipe::ClientOptions;
    const ERROR_PIPE_BUSY: i32 = 231;
    let name = format!(r"\\.\pipe\{}", hello::endpoint_name(identifier));
    for _ in 0..50 {
        match ClientOptions::new().open(&name) {
            Ok(client) => return Ok(client),
            // Every instance is taken for a moment: the app creates the next one right away.
            Err(e) if e.raw_os_error() == Some(ERROR_PIPE_BUSY) => tokio::time::sleep(Duration::from_millis(100)).await,
            Err(e) => return Err(e),
        }
    }
    Err(io::Error::new(io::ErrorKind::TimedOut, "the pipe stayed busy"))
}

#[cfg(unix)]
async fn connect(identifier: &str) -> io::Result<tokio::net::UnixStream> {
    let path = socket_dir::socket_dir().join(format!("{}.sock", hello::endpoint_name(identifier)));
    tokio::time::timeout(Duration::from_secs(5), tokio::net::UnixStream::connect(path))
        .await
        .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "no answer"))?
}

/// The program that started this helper, for the pairing question — shown, never trusted.
fn parent_program() -> String {
    parent_program_inner().unwrap_or_else(|| "unknown".to_string())
}

#[cfg(windows)]
fn parent_program_inner() -> Option<String> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
    use windows_sys::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
    unsafe {
        let me = std::process::id();
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot.is_null() || snapshot as isize == -1 {
            return None;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut parent = None;
        if Process32FirstW(snapshot, &mut entry) != 0 {
            loop {
                if entry.th32ProcessID == me {
                    parent = Some(entry.th32ParentProcessID);
                    break;
                }
                if Process32NextW(snapshot, &mut entry) == 0 {
                    break;
                }
            }
        }
        CloseHandle(snapshot);
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, parent?);
        if process.is_null() {
            return None;
        }
        let mut buffer = [0u16; 1024];
        let mut size = buffer.len() as u32;
        let ok = QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, buffer.as_mut_ptr(), &mut size);
        CloseHandle(process);
        (ok != 0).then(|| String::from_utf16_lossy(&buffer[..size as usize]))
    }
}

#[cfg(target_os = "linux")]
fn parent_program_inner() -> Option<String> {
    let parent = std::os::unix::process::parent_id();
    std::fs::read_link(format!("/proc/{parent}/exe")).ok().map(|p| p.to_string_lossy().to_string())
}

#[cfg(target_os = "macos")]
fn parent_program_inner() -> Option<String> {
    let parent = std::os::unix::process::parent_id() as i32;
    let mut buffer = vec![0u8; 4096];
    let n = unsafe { libc::proc_pidpath(parent, buffer.as_mut_ptr() as *mut libc::c_void, buffer.len() as u32) };
    (n > 0).then(|| String::from_utf8_lossy(&buffer[..n as usize]).to_string())
}

#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
fn parent_program_inner() -> Option<String> {
    None
}
