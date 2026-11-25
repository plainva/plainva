use std::sync::Mutex;

// All windows share this lane, including ordinary credential writers. A
// conditional journal update must not race a different webview's reconnect.
static STORE_LOCK: Mutex<()> = Mutex::new(());

fn locked<T>(run: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    let step = || {
        let _guard = STORE_LOCK
            .lock()
            .map_err(|_| "secure store lock failed".to_string())?;
        run()
    };
    // On a worker of the async runtime (an async command of another module
    // that reaches a slot), waiting for the lock or for the keychain's dialog
    // must not hold the worker's other tasks: the runtime moves them away.
    match tokio::runtime::Handle::try_current() {
        Ok(runtime) if runtime.runtime_flavor() == tokio::runtime::RuntimeFlavor::MultiThread => tokio::task::block_in_place(step),
        _ => step(),
    }
}

/// Runs `run` under the lock on the keychain's own thread, never on the thread
/// that serves the windows. A synchronous command runs on the app's main
/// thread, and while the system's unlock or access dialog of the keychain was
/// open (a locked keyring on Linux, the first access on macOS) every window of
/// the app stood still. A keychain call that waits now only makes its own
/// caller wait.
///
/// One thread, one queue: the steps run in the order they are handed over,
/// which is the order the commands arrive in — two writes to one slot sent
/// right after each other land in that order (a thread per call, all waiting
/// for the lock, would let them overtake each other). The step is queued when
/// this is called, not when the future is first polled.
fn off_main<T: Send + 'static>(run: impl FnOnce() -> Result<T, String> + Send + 'static) -> impl std::future::Future<Output = Result<T, String>> {
    let (answer, answered) = tokio::sync::oneshot::channel();
    let queued = lane().send(Box::new(move || {
        let _ = answer.send(locked(run));
    }));
    async move {
        queued.map_err(|_| "the keychain's thread is gone".to_string())?;
        answered.await.map_err(|_| "a keychain step ended without an answer".to_string())?
    }
}

type Step = Box<dyn FnOnce() + Send>;

/// The keychain's thread and its queue, made on first use.
fn lane() -> &'static std::sync::mpsc::Sender<Step> {
    static LANE: std::sync::OnceLock<std::sync::mpsc::Sender<Step>> = std::sync::OnceLock::new();
    LANE.get_or_init(|| {
        let (queue, steps) = std::sync::mpsc::channel::<Step>();
        std::thread::Builder::new()
            .name("plainva-keychain".into())
            .spawn(move || {
                for step in steps {
                    // A step that panics answers nothing (its caller hears so); the next one still runs.
                    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(step));
                }
            })
            .expect("the keychain's thread could not be started");
        queue
    })
}

/// How often the keychain has answered a request (a value, "no such entry",
/// a write taken): what lets a move of the key that failed be tried again in
/// the same run (`MoveGate`).
static KEYCHAIN_ANSWERS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn answered() {
    KEYCHAIN_ANSWERS.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
}

/// The keychain entry for `key` in THIS installation's namespace: the release
/// app, the dev build and a Labs build never share credentials (see
/// `app_identity::keychain_service_for`).
fn entry(app: &tauri::AppHandle, key: &str) -> Result<keyring::Entry, String> {
    entry_of(app, key)
}

fn entry_of<R: tauri::Runtime>(app: &tauri::AppHandle<R>, key: &str) -> Result<keyring::Entry, String> {
    let service = crate::app_identity::keychain_service_for(&app.config().identifier);
    keyring::Entry::new(&service, key).map_err(|e| e.to_string())
}

/// AI provider keys are write-only for the web view (ADR 0017): only the AI
/// egress reads them, natively, to put them into a request. The generic
/// commands below refuse their slots, so no script in the web view -- injected
/// or not -- can read one back, overwrite it or probe it through them. The
/// credentials of foreign MCP servers (src/mcp_client) are kept the same way.
fn generic(key: &str) -> Result<&str, String> {
    if key == MARK_KEY_SLOT {
        return Err("this keychain slot is reserved for the key of the secrets marks".into());
    }
    if key.starts_with(crate::ai_egress::AI_KEY_PREFIX) {
        return Err("this keychain slot is reserved for the AI egress".into());
    }
    if key.starts_with(crate::mcp_client::registry::MCP_KEY_PREFIX) {
        return Err("this keychain slot is reserved for the credentials of MCP servers".into());
    }
    Ok(key)
}

/// Native access for the module that owns a slot (the AI egress). Never a
/// command: nothing here is reachable from the web view.
pub(crate) fn read_slot(app: &tauri::AppHandle, key: &str) -> Result<Option<String>, String> {
    locked(|| read(&entry(app, key)?))
}

pub(crate) fn write_slot(app: &tauri::AppHandle, key: &str, value: Option<&str>) -> Result<(), String> {
    locked(|| write(&entry(app, key)?, value))
}

fn read(entry: &keyring::Entry) -> Result<Option<String>, String> {
    let value = match entry.get_password() {
        Ok(value) => Some(value),
        Err(keyring::Error::NoEntry) => None,
        Err(e) => return Err(e.to_string()),
    };
    answered();
    Ok(value)
}

fn write(entry: &keyring::Entry, value: Option<&str>) -> Result<(), String> {
    match value {
        Some(value) => entry.set_password(value).map_err(|e| e.to_string())?,
        None => match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => return Err(e.to_string()),
        },
    }
    answered();
    Ok(())
}

fn conditional_update(
    expected: Option<&str>,
    read: impl FnOnce() -> Result<Option<String>, String>,
    write: impl FnOnce() -> Result<(), String>,
) -> Result<bool, String> {
    if read()?.as_deref() != expected {
        return Ok(false);
    }
    write()?;
    Ok(true)
}

// --- The key of the secrets marks (F67, rounds twelve to fourteen) --------
//
// One key per device marks every password the secrets sync remembers
// (`packages/ui/src/lib/secretsMark.ts`). It lives in ONE place, the keychain
// or the credentials file, decided once and noted in the settings store.
// Every window of the app asks here, and the whole of it -- looking, making,
// writing, reading back, noting -- runs under the one lock all windows share
// (round fourteen): two windows starting at once never make two keys, and no
// window counts on a key another one overwrote.

/// The slot of the key, in the keychain and in the credentials file alike.
const MARK_KEY_SLOT: &str = "settingsSyncSecretsMarkKey";
/// The note of its place, in the settings store.
const MARK_KEY_HOME: &str = "settingsSyncSecretsMarkKeyHome";
const SETTINGS_STORE: &str = "plainva-settings.json";
const CREDENTIALS_STORE: &str = "credentials.bin";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum MarkKeyPlace {
    Keychain,
    File,
}

impl MarkKeyPlace {
    fn name(self) -> &'static str {
        match self {
            MarkKeyPlace::Keychain => "keychain",
            MarkKeyPlace::File => "file",
        }
    }
}

/// The places of the key and the note, as `mark_key` sees them.
pub(crate) trait MarkKeyPlaces {
    fn noted(&self) -> Result<Option<MarkKeyPlace>, String>;
    fn note(&self, place: MarkKeyPlace) -> Result<(), String>;
    /// What the place holds; the keychain is an error when it does not answer, never "not there".
    fn read(&self, place: MarkKeyPlace) -> Result<Option<serde_json::Value>, String>;
    fn write(&self, place: MarkKeyPlace, key: &str) -> Result<(), String>;
    /// Removes the copy in the credentials file, once the key has moved to the keychain.
    fn forget_file(&self) -> Result<(), String>;
}

fn is_mark_key(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// A key as stored, or none; anything else is unreadable, never "none".
fn valid_mark_key(stored: Option<serde_json::Value>) -> Result<Option<String>, String> {
    match stored {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::String(key)) if is_mark_key(&key) => Ok(Some(key)),
        Some(_) => Err("secrets mark key is unreadable".into()),
    }
}

/// The key of this device, made from `fresh` where there is none. Call only
/// under `locked`. With `try_move`, a key that lives in the file moves to the
/// keychain if it answers now (`move_to_keychain`); a copy a finished move
/// left in the file goes in any case.
///
/// Once a place is noted only that place counts: a keychain that does not
/// answer is an error (the round stops and runs again), and a key missing
/// there is made there anew -- the port knows the marks of the old one as
/// lost. Before a place is noted the key is looked for in the keychain, then
/// in the file, and its place noted. A new key goes to the keychain; to the
/// file only when the keychain does not take it, or does not answer on a
/// device that holds no marks. A key read back as another is that key; a
/// read-back that fails is an error -- neither is a reason to make a key
/// elsewhere.
pub(crate) fn mark_key(places: &impl MarkKeyPlaces, fresh: &str, marks_on_device: bool, try_move: bool) -> Result<String, String> {
    // Read back: what stands there is the key, whoever wrote it.
    let confirm = |place: MarkKeyPlace| -> Result<String, String> {
        let Some(key) = valid_mark_key(places.read(place)?)? else {
            return Err("secrets mark key could not be stored".into());
        };
        places.note(place)?;
        Ok(key)
    };
    let make = |place: MarkKeyPlace| -> Result<String, String> {
        places.write(place, fresh)?;
        confirm(place)
    };
    if let Some(place) = places.noted()? {
        return match valid_mark_key(places.read(place)?)? {
            Some(key) if place == MarkKeyPlace::File && try_move => Ok(move_to_keychain(places, key)),
            Some(key) => {
                if place == MarkKeyPlace::Keychain {
                    // A move that ended before the file's copy was removed: what the note says is the key.
                    if let Ok(Some(_)) = places.read(MarkKeyPlace::File) {
                        let _ = places.forget_file();
                    }
                }
                Ok(key)
            }
            None => make(place),
        };
    }
    let in_keychain = places.read(MarkKeyPlace::Keychain).and_then(valid_mark_key);
    if let Ok(Some(key)) = in_keychain {
        places.note(MarkKeyPlace::Keychain)?;
        return Ok(key);
    }
    if let Some(key) = valid_mark_key(places.read(MarkKeyPlace::File)?)? {
        places.note(MarkKeyPlace::File)?;
        return Ok(key);
    }
    if let Err(silent) = in_keychain {
        if marks_on_device {
            return Err(silent);
        }
        return make(MarkKeyPlace::File);
    }
    match places.write(MarkKeyPlace::Keychain, fresh) {
        Ok(()) => confirm(MarkKeyPlace::Keychain),
        // The keychain did not take it: the file is the place.
        Err(_) => make(MarkKeyPlace::File),
    }
}

/// Moves `key` from the file to the keychain and returns it (Sammelplan of the
/// accounts rounds: a device that started while its keychain did not answer —
/// D-Bus not ready at login, a cancelled prompt — kept the key in the file for
/// good). Call only under `locked`, with the file noted as the place.
///
/// The steps, each one undone by nothing: write the key to the keychain, read
/// it back as the same key, note the keychain — the note is the step that
/// moves it — and only then remove the copy in the file. Whatever fails
/// before the note leaves the file as the place, with its key, and the move
/// is tried again (`MoveGate`); a keychain slot written meanwhile is
/// overwritten then, since only the noted place counts. After the note, a
/// copy left in the file is never read and is removed at the next ask.
fn move_to_keychain(places: &impl MarkKeyPlaces, key: String) -> String {
    let moved = places
        .write(MarkKeyPlace::Keychain, &key)
        .and_then(|()| valid_mark_key(places.read(MarkKeyPlace::Keychain)?))
        .and_then(|back| if back.as_deref() == Some(key.as_str()) { Ok(()) } else { Err("read back as another key".into()) })
        .and_then(|()| places.note(MarkKeyPlace::Keychain));
    if moved.is_ok() {
        let _ = places.forget_file();
    }
    key
}

/// When the move of the key to the keychain is tried (`move_to_keychain`).
///
/// At the first ask of a run where the file is the noted place. One that
/// failed is tried again in the same run once the keychain has answered
/// another request since — the anlass is a keychain that did not answer at
/// the start (D-Bus not ready at login, a cancelled prompt), and a password
/// read or written later shows it answers now. A dialog that was turned down
/// asks for no new one by itself: without another answer, no new try.
pub(crate) struct MoveGate {
    state: Mutex<MoveState>,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum MoveState {
    NotTried,
    /// Failed when the keychain had answered this many requests.
    FailedAt(u64),
    Done,
}

impl MoveGate {
    pub(crate) const fn new() -> Self {
        MoveGate { state: Mutex::new(MoveState::NotTried) }
    }

    fn may_try(&self, answers: u64) -> bool {
        match *self.state.lock().unwrap_or_else(|p| p.into_inner()) {
            MoveState::NotTried => true,
            MoveState::FailedAt(then) => answers > then,
            MoveState::Done => false,
        }
    }

    fn tried(&self, moved: bool, answers: u64) {
        *self.state.lock().unwrap_or_else(|p| p.into_inner()) = if moved { MoveState::Done } else { MoveState::FailedAt(answers) };
    }
}

static MOVE_GATE: MoveGate = MoveGate::new();

/// `mark_key` with the move as the gate allows it; `answers` counts the
/// keychain's answers (`KEYCHAIN_ANSWERS`). Call only under `locked`.
pub(crate) fn mark_key_moving(places: &impl MarkKeyPlaces, fresh: &str, marks_on_device: bool, gate: &MoveGate, answers: &dyn Fn() -> u64) -> Result<String, String> {
    let in_file = places.noted()? == Some(MarkKeyPlace::File);
    let try_move = in_file && gate.may_try(answers());
    let key = mark_key(places, fresh, marks_on_device, try_move)?;
    if try_move {
        // Counted after the try: its own answers are no sign the keychain answers again.
        let moved = places.noted().ok().flatten() == Some(MarkKeyPlace::Keychain);
        gate.tried(moved, answers());
    }
    Ok(key)
}

struct AppMarkKeyPlaces<'a, R: tauri::Runtime> {
    app: &'a tauri::AppHandle<R>,
    settings: std::sync::Arc<tauri_plugin_store::Store<R>>,
    credentials: std::sync::Arc<tauri_plugin_store::Store<R>>,
}

impl<R: tauri::Runtime> MarkKeyPlaces for AppMarkKeyPlaces<'_, R> {
    fn noted(&self) -> Result<Option<MarkKeyPlace>, String> {
        Ok(match self.settings.get(MARK_KEY_HOME).as_ref().and_then(|v| v.as_str()) {
            Some("keychain") => Some(MarkKeyPlace::Keychain),
            Some("file") => Some(MarkKeyPlace::File),
            _ => None,
        })
    }
    fn note(&self, place: MarkKeyPlace) -> Result<(), String> {
        self.settings.set(MARK_KEY_HOME, place.name());
        self.settings.save().map_err(|e| e.to_string())
    }
    fn read(&self, place: MarkKeyPlace) -> Result<Option<serde_json::Value>, String> {
        match place {
            // The keychain holds the key as JSON text, as `CredentialManager` writes secrets.
            MarkKeyPlace::Keychain => match read(&entry_of(self.app, MARK_KEY_SLOT)?)? {
                None => Ok(None),
                Some(text) => serde_json::from_str(&text).map(Some).map_err(|_| "secrets mark key is unreadable".to_string()),
            },
            MarkKeyPlace::File => Ok(self.credentials.get(MARK_KEY_SLOT)),
        }
    }
    fn write(&self, place: MarkKeyPlace, key: &str) -> Result<(), String> {
        match place {
            MarkKeyPlace::Keychain => {
                let text = serde_json::to_string(key).map_err(|e| e.to_string())?;
                write(&entry_of(self.app, MARK_KEY_SLOT)?, Some(&text))
            }
            MarkKeyPlace::File => {
                self.credentials.set(MARK_KEY_SLOT, key);
                self.credentials.save().map_err(|e| e.to_string())
            }
        }
    }
    fn forget_file(&self) -> Result<(), String> {
        self.credentials.delete(MARK_KEY_SLOT);
        self.credentials.save().map_err(|e| e.to_string())
    }
}

/// The key of the secrets marks, for every window of the app (round fourteen).
#[tauri::command]
pub async fn secrets_mark_key(app: tauri::AppHandle, fresh: String, marks_on_device: bool) -> Result<String, String> {
    use tauri_plugin_store::StoreExt;
    if !is_mark_key(&fresh) {
        return Err("a new secrets mark key must be 64 hex digits".into());
    }
    off_main(move || {
        let settings = app.store(SETTINGS_STORE).map_err(|e| e.to_string())?;
        let credentials = app.store(CREDENTIALS_STORE).map_err(|e| e.to_string())?;
        // Under the lock: of two windows starting at once, one tries.
        let answers = || KEYCHAIN_ANSWERS.load(std::sync::atomic::Ordering::SeqCst);
        mark_key_moving(&AppMarkKeyPlaces { app: &app, settings, credentials }, &fresh, marks_on_device, &MOVE_GATE, &answers)
    })
    .await
}

/// `mark_key` under the lock every window shares.
#[cfg(test)]
pub(crate) fn obtain_mark_key(places: &impl MarkKeyPlaces, fresh: &str, marks_on_device: bool, try_move: bool) -> Result<String, String> {
    locked(|| mark_key(places, fresh, marks_on_device, try_move))
}

#[tauri::command]
pub async fn keychain_get(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    generic(&key)?;
    off_main(move || read(&entry(&app, &key)?)).await
}

#[tauri::command]
pub async fn keychain_set(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    generic(&key)?;
    off_main(move || write(&entry(&app, &key)?, Some(&value))).await
}

#[tauri::command]
pub async fn keychain_delete(app: tauri::AppHandle, key: String) -> Result<(), String> {
    generic(&key)?;
    off_main(move || write(&entry(&app, &key)?, None)).await
}

#[tauri::command]
pub async fn keychain_compare_and_set(
    app: tauri::AppHandle,
    key: String,
    expected: Option<String>,
    value: Option<String>,
) -> Result<bool, String> {
    generic(&key)?;
    off_main(move || {
        let entry = entry(&app, &key)?;
        conditional_update(
            expected.as_deref(),
            || read(&entry),
            || write(&entry, value.as_deref()),
        )
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::sync::Arc;

    /// A function of the app's sources: its module path (`mcp_client::oauth`),
    /// its name, its text, whether it is a command, and whether it is async.
    struct Function {
        module: Vec<String>,
        name: String,
        body: String,
        command: bool,
        is_async: bool,
    }

    /// Every function of the app's sources, and the names each file takes in
    /// with `use` (name -> module path it comes from). Test modules are left out.
    /// Per module: each name it takes in with `use`, and the module path it comes from.
    type Imports = std::collections::HashMap<Vec<String>, Vec<(String, Vec<String>)>>;

    fn sources() -> (Vec<Function>, Imports) {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut found = Vec::new();
        let mut imports = std::collections::HashMap::new();
        for file in walkdir::WalkDir::new(&root).into_iter().filter_map(Result::ok) {
            if file.path().extension().and_then(|e| e.to_str()) != Some("rs") {
                continue;
            }
            let rel = file.path().strip_prefix(&root).unwrap().with_extension("");
            let mut module: Vec<String> = rel.iter().map(|p| p.to_string_lossy().into_owned()).collect();
            if matches!(module.last().map(String::as_str), Some("mod" | "lib" | "main")) {
                module.pop();
            }
            let text = std::fs::read_to_string(file.path()).unwrap();
            let text = text.split("#[cfg(test)]\nmod tests").next().unwrap();
            // `use a::b::{c, d};` and `use a::b::c;`: the names this file calls without a path.
            let mut taken = Vec::new();
            for line in text.lines().map(str::trim).filter(|l| l.starts_with("use ") || l.starts_with("pub use ") || l.starts_with("pub(crate) use ")) {
                let path = line.split("use ").nth(1).unwrap_or("").trim_end_matches(';');
                let (base, names) = match path.split_once("::{") {
                    Some((base, rest)) => (base, rest.trim_end_matches('}').split(',').map(|n| n.trim().to_string()).collect::<Vec<_>>()),
                    None => match path.rsplit_once("::") {
                        Some((base, name)) => (base, vec![name.to_string()]),
                        None => continue,
                    },
                };
                let resolved = resolve(&module, base);
                for name in names {
                    let name = name.split(" as ").next().unwrap_or("").trim().to_string();
                    if !name.is_empty() {
                        taken.push((name, resolved.clone()));
                    }
                }
            }
            imports.insert(module.clone(), taken);
            let lines: Vec<&str> = text.lines().collect();
            let mut starts = Vec::new();
            for (i, line) in lines.iter().enumerate() {
                let t = line.trim_start();
                let t = t.strip_prefix("pub(crate) ").or_else(|| t.strip_prefix("pub ")).unwrap_or(t);
                let (is_async, t) = match t.strip_prefix("async ") { Some(rest) => (true, rest), None => (false, t) };
                if let Some(rest) = t.strip_prefix("fn ") {
                    let name: String = rest.chars().take_while(|c| c.is_alphanumeric() || *c == '_').collect();
                    let command = lines[i.saturating_sub(3)..i].iter().any(|l| l.trim() == "#[tauri::command]");
                    starts.push((i, name, command, is_async));
                }
            }
            for (n, (i, name, command, is_async)) in starts.iter().enumerate() {
                let end = starts.get(n + 1).map(|s| s.0).unwrap_or(lines.len());
                found.push(Function { module: module.clone(), name: name.clone(), body: lines[*i..end].join("\n"), command: *command, is_async: *is_async });
            }
        }
        (found, imports)
    }

    /// A path written in `module` (`crate::a::b`, `super::c`, `self::d`, `e::f`) as a module path of the crate.
    fn resolve(module: &[String], path: &str) -> Vec<String> {
        let mut parts = path.split("::").filter(|p| !p.is_empty()).peekable();
        let mut out: Vec<String> = match parts.peek().copied() {
            Some("crate") => {
                parts.next();
                Vec::new()
            }
            Some("self") => {
                parts.next();
                module.to_vec()
            }
            Some("super") => module.to_vec(),
            // A path of the module's own children, or of the crate's top level.
            _ => module.to_vec(),
        };
        for part in parts {
            if part == "super" {
                out.pop();
            } else {
                out.push(part.to_string());
            }
        }
        out
    }

    /// No command that runs on the main thread reaches the keychain, directly
    /// or through any function of the app (finding F74 of the release list):
    /// while the system's dialog was open, every window stood still. Calls are
    /// resolved by module path, `use` and the calling file — never skipped by
    /// name, so a common name cannot hide a real way there.
    #[test]
    fn no_synchronous_command_reaches_the_keychain() {
        let (functions, imports) = sources();
        // Which functions a call of `name`, written with `path` before it (or none), in `module` can mean.
        let targets = |module: &[String], path: Option<&str>, name: &str| -> Vec<usize> {
            let in_module = |m: &[String]| functions.iter().enumerate().filter(|(_, f)| f.name == name && f.module == m).map(|(i, _)| i).collect::<Vec<_>>();
            match path {
                Some("Self") => in_module(module),
                Some(path) => {
                    // `a::b::name(`: the module `a::b` as written here, or at the crate's top level.
                    let mut found = in_module(&resolve(module, path));
                    if found.is_empty() {
                        found = in_module(&resolve(&[], path));
                    }
                    // `oauth::forget(` where this file took `oauth` in with `use`.
                    if found.is_empty() {
                        let (first, rest) = path.split_once("::").unwrap_or((path, ""));
                        for (taken, from) in imports.get(module).into_iter().flatten() {
                            if taken == first {
                                let mut whole = from.clone();
                                whole.push(first.to_string());
                                whole.extend(rest.split("::").filter(|p| !p.is_empty()).map(str::to_string));
                                found.extend(in_module(&whole));
                            }
                        }
                    }
                    // A type's function (`Store::open`): a function of that name in the modules this file takes the type from.
                    if found.is_empty() && path.chars().next().is_some_and(char::is_uppercase) {
                        let first = path.split("::").next().unwrap_or(path);
                        for (taken, from) in imports.get(module).into_iter().flatten() {
                            if taken == first {
                                found.extend(in_module(from));
                            }
                        }
                        found.extend(in_module(module));
                    }
                    found
                }
                None => {
                    let own = in_module(module);
                    if !own.is_empty() {
                        return own;
                    }
                    imports.get(module).into_iter().flatten().filter(|(taken, _)| taken == name).flat_map(|(_, from)| in_module(from)).collect()
                }
            }
        };
        // Every call in a body: the name, and the path written before it.
        let calls = |body: &str| -> Vec<(Option<String>, String)> {
            let mut out = Vec::new();
            let bytes: Vec<char> = body.chars().collect();
            let mut i = 0;
            while i < bytes.len() {
                if bytes[i] == '(' && i > 0 {
                    let mut j = i;
                    while j > 0 && (bytes[j - 1].is_alphanumeric() || bytes[j - 1] == '_') {
                        j -= 1;
                    }
                    let name: String = bytes[j..i].iter().collect();
                    let before = if j > 0 { bytes[j - 1] } else { ' ' };
                    if !name.is_empty() && before == '.' {
                        // A method: one of that name in the calling module (its impls), the most it can be told by text.
                        out.push((Some("Self".to_string()), name));
                    } else if !name.is_empty() && !name.chars().next().unwrap().is_ascii_digit() && before != '!' {
                        let mut k = j;
                        while k >= 2 && bytes[k - 1] == ':' && bytes[k - 2] == ':' {
                            k -= 2;
                            while k > 0 && (bytes[k - 1].is_alphanumeric() || bytes[k - 1] == '_') {
                                k -= 1;
                            }
                        }
                        let path: String = bytes[k..j].iter().collect();
                        let path = path.trim_end_matches("::");
                        out.push(((!path.is_empty()).then(|| path.to_string()), name));
                    }
                }
                i += 1;
            }
            out
        };
        let touches = |f: &Function| f.body.contains("keyring::") || f.body.contains("keyring::Entry");
        let mut reaching: Vec<bool> = functions.iter().map(touches).collect();
        let edges: Vec<Vec<usize>> = functions.iter().map(|f| calls(&f.body).into_iter().flat_map(|(path, name)| targets(&f.module, path.as_deref(), &name)).collect()).collect();
        let mut grew = true;
        while grew {
            grew = false;
            for (i, callees) in edges.iter().enumerate() {
                if !reaching[i] && callees.iter().any(|&c| reaching[c]) {
                    reaching[i] = true;
                    grew = true;
                }
            }
        }
        let name_of = |i: usize| format!("{}::{}", functions[i].module.join("::"), functions[i].name);
        let synchronous: Vec<String> = (0..functions.len()).filter(|&i| functions[i].command && !functions[i].is_async && reaching[i]).map(name_of).collect();
        if std::env::var_os("PLAINVA_KEYCHAIN_GUARD_LIST").is_some() {
            let commands: Vec<String> = (0..functions.len()).filter(|&i| functions[i].command && reaching[i]).map(name_of).collect();
            eprintln!("commands that reach the keychain: {commands:?}");
        }
        assert!(synchronous.is_empty(), "commands that reach the keychain on the main thread: {synchronous:?}");
        // The guard sees what it is meant to see.
        for known in [
            "secure_store::keychain_get",
            "secure_store::secrets_mark_key",
            "ai_egress::ai_key_set",
            "mcp_client::registry::mcp_client_secret_present",
            "mcp_client::registry::mcp_client_servers",
            "mcp_client::registry::mcp_client_remove",
            "mcp_client::oauth::mcp_client_oauth_sign_out",
        ] {
            assert!((0..functions.len()).any(|i| reaching[i] && name_of(i) == known), "{known} is not seen to reach the keychain");
        }
    }

    /// The keychain runs on a thread of its own: the caller's thread goes on
    /// while a keychain step waits (its dialog open), and the lock still makes
    /// two steps take turns.
    #[test]
    fn a_waiting_keychain_holds_neither_the_calling_thread_nor_breaks_the_lock() {
        use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
        let (release, released) = std::sync::mpsc::channel::<()>();
        let caller = std::thread::current().id();
        let first_on = Arc::new(Mutex::new(None));
        let inside = Arc::new(AtomicUsize::new(0));
        let overlap = Arc::new(AtomicBool::new(false));
        let second_ran = Arc::new(AtomicBool::new(false));
        let enter = {
            let (inside, overlap) = (Arc::clone(&inside), Arc::clone(&overlap));
            move || {
                if inside.fetch_add(1, Ordering::SeqCst) > 0 {
                    overlap.store(true, Ordering::SeqCst);
                }
            }
        };
        let (enter_first, inside_first) = (enter.clone(), Arc::clone(&inside));
        let first_seen = Arc::clone(&first_on);
        // A keychain step whose dialog stays open until `release`.
        let waiting = tauri::async_runtime::spawn(off_main(move || {
            enter_first();
            *first_seen.lock().unwrap() = Some(std::thread::current().id());
            let _ = released.recv();
            inside_first.fetch_sub(1, Ordering::SeqCst);
            Ok(())
        }));
        let began = std::time::Instant::now();
        while first_on.lock().unwrap().is_none() {
            assert!(began.elapsed() < std::time::Duration::from_secs(5), "the step never began");
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
        // A second window's step, asked for while the dialog is open.
        let (inside_second, ran) = (Arc::clone(&inside), Arc::clone(&second_ran));
        let second = tauri::async_runtime::spawn(off_main(move || {
            enter();
            ran.store(true, Ordering::SeqCst);
            inside_second.fetch_sub(1, Ordering::SeqCst);
            Ok(())
        }));
        // The calling thread goes on answering meanwhile; the first step runs elsewhere, the second waits for the lock.
        std::thread::sleep(std::time::Duration::from_millis(50));
        assert_ne!(*first_on.lock().unwrap(), Some(caller));
        assert!(!waiting.inner().is_finished());
        assert!(!second_ran.load(Ordering::SeqCst), "the lock let a second step in while the first waited");
        release.send(()).unwrap();
        tauri::async_runtime::block_on(async {
            waiting.await.unwrap().unwrap();
            second.await.unwrap().unwrap();
        });
        assert!(second_ran.load(Ordering::SeqCst));
        assert!(!overlap.load(Ordering::SeqCst), "two keychain steps ran at once");
    }

    #[test]
    fn conditional_write_requires_the_actual_predecessor() {
        let value = RefCell::new(Some("current".to_string()));
        let changed = conditional_update(
            Some("old"),
            || Ok(value.borrow().clone()),
            || {
                *value.borrow_mut() = Some("replacement".to_string());
                Ok(())
            },
        )
        .unwrap();
        assert!(!changed);
        assert_eq!(value.borrow().as_deref(), Some("current"));
    }

    /// One device: a keychain, a credentials file and the settings store,
    /// shared by every window; each step takes `delay`, as a keychain takes
    /// its time to answer.
    #[derive(Default)]
    struct Device {
        keychain: Option<serde_json::Value>,
        file: Option<serde_json::Value>,
        note: Option<MarkKeyPlace>,
        keychain_silent: bool,
        keychain_refuses: bool,
        keychain_answers_other: bool,
        file_reads: usize,
        file_writes: usize,
        keychain_writes: usize,
        /// Every request that reached the keychain, answered or not.
        keychain_asks: usize,
    }

    #[derive(Clone)]
    struct Places {
        device: Arc<Mutex<Device>>,
        delay: std::time::Duration,
    }

    impl Places {
        fn new(device: Device, delay_ms: u64) -> Self {
            Places { device: Arc::new(Mutex::new(device)), delay: std::time::Duration::from_millis(delay_ms) }
        }
        fn step<T>(&self, run: impl FnOnce(&mut Device) -> T) -> T {
            std::thread::sleep(self.delay);
            let mut device = self.device.lock().unwrap();
            run(&mut device)
        }
    }

    impl MarkKeyPlaces for Places {
        fn noted(&self) -> Result<Option<MarkKeyPlace>, String> {
            Ok(self.step(|d| d.note))
        }
        fn note(&self, place: MarkKeyPlace) -> Result<(), String> {
            self.step(|d| d.note = Some(place));
            Ok(())
        }
        fn read(&self, place: MarkKeyPlace) -> Result<Option<serde_json::Value>, String> {
            self.step(|d| {
                if place == MarkKeyPlace::Keychain {
                    d.keychain_asks += 1;
                }
                match place {
                MarkKeyPlace::Keychain if d.keychain_silent => Err("keychain does not answer".to_string()),
                MarkKeyPlace::Keychain if d.keychain_answers_other => Ok(Some(serde_json::Value::String("a".repeat(64)))),
                MarkKeyPlace::Keychain => Ok(d.keychain.clone()),
                MarkKeyPlace::File => {
                    d.file_reads += 1;
                    Ok(d.file.clone())
                }
                }
            })
        }
        fn forget_file(&self) -> Result<(), String> {
            self.step(|d| d.file = None);
            Ok(())
        }
        fn write(&self, place: MarkKeyPlace, key: &str) -> Result<(), String> {
            self.step(|d| {
                if place == MarkKeyPlace::Keychain {
                    d.keychain_asks += 1;
                }
                match place {
                MarkKeyPlace::Keychain if d.keychain_silent || d.keychain_refuses => Err("keychain does not take it".to_string()),
                MarkKeyPlace::Keychain => {
                    d.keychain_writes += 1;
                    d.keychain = Some(serde_json::Value::String(key.to_string()));
                    Ok(())
                }
                MarkKeyPlace::File => {
                    d.file_writes += 1;
                    d.file = Some(serde_json::Value::String(key.to_string()));
                    Ok(())
                }
                }
            })
        }
    }

    fn fresh(n: usize) -> String {
        format!("{:064x}", n + 1)
    }

    /// `windows` windows ask at once (each `gap_ms` after the one before);
    /// what each got, and what the device holds then.
    fn windows_ask(places: &Places, windows: usize, gap_ms: u64) -> Vec<Result<String, String>> {
        let tasks: Vec<_> = (0..windows)
            .map(|n| {
                let places = places.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(gap_ms * n as u64));
                    obtain_mark_key(&places, &fresh(n), false, false)
                })
            })
            .collect();
        tasks.into_iter().map(|task| task.join().unwrap()).collect()
    }

    #[test]
    fn windows_starting_at_once_get_one_key_and_one_note() {
        for keychain_key_missing_at_its_note in [false, true] {
            for windows in [2, 3] {
                for gap_ms in [0, 1, 3, 20] {
                    let start = Device { note: keychain_key_missing_at_its_note.then_some(MarkKeyPlace::Keychain), ..Device::default() };
                    let places = Places::new(start, 2);
                    let keys: Vec<String> = windows_ask(&places, windows, gap_ms).into_iter().map(|key| key.unwrap()).collect();
                    let device = places.device.lock().unwrap();
                    let stored = device.keychain.clone().and_then(|v| v.as_str().map(str::to_string));
                    let case = format!("noted {keychain_key_missing_at_its_note}, {windows} windows, {gap_ms} ms apart");
                    assert!(keys.iter().all(|key| Some(key) == stored.as_ref()), "{case}: {keys:?} against {stored:?}");
                    assert_eq!((device.keychain_writes, device.file_writes, device.note), (1, 0, Some(MarkKeyPlace::Keychain)), "{case}");
                    drop(device);
                    // The next start: the key every window marked with is still the key.
                    assert_eq!(obtain_mark_key(&places, &fresh(9), true, false).as_ref(), Ok(&keys[0]), "{case}");
                }
            }
        }
    }

    #[test]
    fn a_keychain_that_does_not_take_the_key_puts_it_in_the_file_once() {
        for windows in [2, 3] {
            let places = Places::new(Device { keychain_refuses: true, ..Device::default() }, 1);
            let keys: Vec<String> = windows_ask(&places, windows, 0).into_iter().map(|key| key.unwrap()).collect();
            let device = places.device.lock().unwrap();
            assert!(keys.iter().all(|key| Some(serde_json::Value::String(key.clone())) == device.file));
            assert_eq!((device.file_writes, device.note), (1, Some(MarkKeyPlace::File)));
        }
    }

    #[test]
    fn a_key_read_back_is_the_key_and_a_failed_read_back_never_makes_one_elsewhere() {
        let places = Places::new(Device { keychain_answers_other: true, ..Device::default() }, 0);
        // The keychain answers with a key of an earlier build: that is the key.
        assert_eq!(obtain_mark_key(&places, &fresh(0), false, false), Ok("a".repeat(64)));
        // Written, and read back as another key: that key, noted, and no second one in the file.
        let places = Places::new(Device { note: None, ..Device::default() }, 0);
        struct Other(Places);
        impl MarkKeyPlaces for Other {
            fn noted(&self) -> Result<Option<MarkKeyPlace>, String> { self.0.noted() }
            fn note(&self, place: MarkKeyPlace) -> Result<(), String> { self.0.note(place) }
            fn read(&self, place: MarkKeyPlace) -> Result<Option<serde_json::Value>, String> {
                let written = self.0.device.lock().unwrap().keychain_writes > 0;
                if place == MarkKeyPlace::Keychain && written { return Ok(Some(serde_json::Value::String("c".repeat(64)))); }
                self.0.read(place)
            }
            fn write(&self, place: MarkKeyPlace, key: &str) -> Result<(), String> { self.0.write(place, key) }
            fn forget_file(&self) -> Result<(), String> { self.0.forget_file() }
        }
        assert_eq!(obtain_mark_key(&Other(places.clone()), &fresh(0), false, false), Ok("c".repeat(64)));
        assert_eq!({ let d = places.device.lock().unwrap(); (d.file_writes, d.note) }, (0, Some(MarkKeyPlace::Keychain)));
        // Written, and nothing read back: an error, and still no key in the file.
        struct Gone(Places);
        impl MarkKeyPlaces for Gone {
            fn noted(&self) -> Result<Option<MarkKeyPlace>, String> { self.0.noted() }
            fn note(&self, place: MarkKeyPlace) -> Result<(), String> { self.0.note(place) }
            fn read(&self, place: MarkKeyPlace) -> Result<Option<serde_json::Value>, String> {
                if place == MarkKeyPlace::Keychain { return Ok(None); }
                self.0.read(place)
            }
            fn write(&self, place: MarkKeyPlace, key: &str) -> Result<(), String> { self.0.write(place, key) }
            fn forget_file(&self) -> Result<(), String> { self.0.forget_file() }
        }
        let places = Places::new(Device::default(), 0);
        assert_eq!(obtain_mark_key(&Gone(places.clone()), &fresh(0), false, false), Err("secrets mark key could not be stored".into()));
        assert_eq!({ let d = places.device.lock().unwrap(); (d.file_writes, d.note) }, (0, None));
    }

    #[test]
    fn a_silent_keychain_where_the_key_lives_stops_the_run() {
        let places = Places::new(Device { note: Some(MarkKeyPlace::Keychain), keychain_silent: true, ..Device::default() }, 0);
        assert_eq!(obtain_mark_key(&places, &fresh(0), false, false), Err("keychain does not answer".into()));
        let device = places.device.lock().unwrap();
        assert_eq!((device.file_reads, device.file_writes, device.note), (0, 0, Some(MarkKeyPlace::Keychain)));
    }

    #[test]
    fn a_silent_keychain_before_any_note_makes_a_key_only_where_no_mark_exists() {
        let places = Places::new(Device { keychain_silent: true, ..Device::default() }, 0);
        assert_eq!(obtain_mark_key(&places, &fresh(0), true, false), Err("keychain does not answer".into()));
        assert_eq!(places.device.lock().unwrap().file_writes, 0);
        assert_eq!(obtain_mark_key(&places, &fresh(0), false, false), Ok(fresh(0)));
        assert_eq!(places.device.lock().unwrap().note, Some(MarkKeyPlace::File));
        // From then on the file is the place, the keychain is not asked again.
        places.device.lock().unwrap().keychain_silent = false;
        assert_eq!(obtain_mark_key(&places, &fresh(5), true, false), Ok(fresh(0)));
    }

    #[test]
    fn a_key_in_the_file_is_the_files_and_is_noted() {
        let places = Places::new(Device { file: Some(serde_json::Value::String(fresh(7))), ..Device::default() }, 0);
        assert_eq!(obtain_mark_key(&places, &fresh(0), true, false), Ok(fresh(7)));
        let device = places.device.lock().unwrap();
        assert_eq!((device.keychain_writes, device.note), (0, Some(MarkKeyPlace::File)));
    }

    #[test]
    fn an_unreadable_key_is_an_error_never_a_new_one() {
        let places = Places::new(Device { note: Some(MarkKeyPlace::File), file: Some(serde_json::json!({ "x": 1 })), ..Device::default() }, 0);
        assert_eq!(obtain_mark_key(&places, &fresh(0), false, false), Err("secrets mark key is unreadable".into()));
        assert_eq!(places.device.lock().unwrap().file_writes, 0);
    }


    /// A device whose key went to the file at a start when the keychain did not answer.
    fn in_the_file() -> Device {
        Device { note: Some(MarkKeyPlace::File), file: Some(serde_json::Value::String(fresh(7))), ..Device::default() }
    }

    #[test]
    fn a_key_in_the_file_moves_to_the_keychain_once_it_answers() {
        let places = Places::new(in_the_file(), 0);
        assert_eq!(obtain_mark_key(&places, &fresh(0), true, true), Ok(fresh(7)));
        let device = places.device.lock().unwrap();
        assert_eq!(device.keychain, Some(serde_json::Value::String(fresh(7))));
        assert_eq!((device.note, device.file.clone()), (Some(MarkKeyPlace::Keychain), None));
        drop(device);
        // The next start reads it there, and the key the marks were made with stays the key.
        assert_eq!(obtain_mark_key(&places, &fresh(1), true, true), Ok(fresh(7)));
        assert_eq!(places.device.lock().unwrap().keychain_writes, 1);
    }

    #[test]
    fn a_move_that_breaks_off_leaves_the_file_the_place_with_its_key() {
        // At each step: the keychain silent, refusing, reading back another key, losing it, the note failing.
        struct Breaks(Places, &'static str);
        impl MarkKeyPlaces for Breaks {
            fn noted(&self) -> Result<Option<MarkKeyPlace>, String> { self.0.noted() }
            fn note(&self, place: MarkKeyPlace) -> Result<(), String> {
                if self.1 == "note" && place == MarkKeyPlace::Keychain { return Err("settings not saved".into()); }
                self.0.note(place)
            }
            fn read(&self, place: MarkKeyPlace) -> Result<Option<serde_json::Value>, String> {
                let written = self.0.device.lock().unwrap().keychain_writes > 0;
                match (place, self.1) {
                    (MarkKeyPlace::Keychain, "silent") => Err("keychain does not answer".into()),
                    (MarkKeyPlace::Keychain, "other") if written => Ok(Some(serde_json::Value::String("c".repeat(64)))),
                    (MarkKeyPlace::Keychain, "lost") if written => Ok(None),
                    _ => self.0.read(place),
                }
            }
            fn write(&self, place: MarkKeyPlace, key: &str) -> Result<(), String> {
                if place == MarkKeyPlace::Keychain && matches!(self.1, "silent" | "refuses") { return Err("keychain does not take it".into()); }
                self.0.write(place, key)
            }
            fn forget_file(&self) -> Result<(), String> { self.0.forget_file() }
        }
        for step in ["silent", "refuses", "other", "lost", "note"] {
            let places = Places::new(in_the_file(), 0);
            assert_eq!(obtain_mark_key(&Breaks(places.clone(), step), &fresh(0), true, true), Ok(fresh(7)), "{step}");
            let device = places.device.lock().unwrap();
            assert_eq!(
                (device.note, device.file.clone(), device.file_writes),
                (Some(MarkKeyPlace::File), Some(serde_json::Value::String(fresh(7))), 0),
                "{step}: the file is still the place and holds its key"
            );
            drop(device);
            // A later start with a keychain that answers finishes the move with the same key.
            assert_eq!(obtain_mark_key(&places, &fresh(1), true, true), Ok(fresh(7)), "{step}");
            let device = places.device.lock().unwrap();
            assert_eq!((device.note, device.file.clone()), (Some(MarkKeyPlace::Keychain), None), "{step}");
            assert_eq!(device.keychain, Some(serde_json::Value::String(fresh(7))), "{step}");
        }
    }

    #[test]
    fn a_copy_left_in_the_file_after_the_note_is_never_the_key_and_goes() {
        // The move ended between the note and removing the file's copy.
        let places = Places::new(
            Device {
                note: Some(MarkKeyPlace::Keychain),
                keychain: Some(serde_json::Value::String(fresh(7))),
                file: Some(serde_json::Value::String(fresh(3))),
                ..Device::default()
            },
            0,
        );
        assert_eq!(obtain_mark_key(&places, &fresh(0), true, true), Ok(fresh(7)));
        assert_eq!(places.device.lock().unwrap().file, None);
    }

    #[test]
    fn two_windows_starting_at_once_move_the_key_once() {
        for gap_ms in [0, 1, 3, 20] {
            let places = Places::new(in_the_file(), 2);
            let tasks: Vec<_> = (0..3)
                .map(|n| {
                    let places = places.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(gap_ms * n as u64));
                        // Each window may try: the lock makes them take turns.
                        obtain_mark_key(&places, &fresh(n), true, true)
                    })
                })
                .collect();
            let keys: Vec<_> = tasks.into_iter().map(|t| t.join().unwrap()).collect();
            assert!(keys.iter().all(|k| k.as_ref() == Ok(&fresh(7))), "{gap_ms} ms: {keys:?}");
            let device = places.device.lock().unwrap();
            assert_eq!((device.keychain_writes, device.file_writes, device.note), (1, 0, Some(MarkKeyPlace::Keychain)), "{gap_ms} ms");
            assert_eq!(device.file, None, "{gap_ms} ms");
        }
    }

    #[test]
    fn without_a_try_the_file_stays_the_place() {
        let places = Places::new(in_the_file(), 0);
        assert_eq!(obtain_mark_key(&places, &fresh(0), true, false), Ok(fresh(7)));
        let device = places.device.lock().unwrap();
        assert_eq!((device.keychain_writes, device.note), (0, Some(MarkKeyPlace::File)));
    }


    #[test]
    fn a_move_that_failed_is_tried_again_once_the_keychain_answered_another_request() {
        // The start: D-Bus is not ready yet, the keychain does not answer.
        let places = Places::new(Device { keychain_silent: true, ..in_the_file() }, 0);
        let gate = MoveGate::new();
        let answers = std::sync::atomic::AtomicU64::new(0);
        let count = || answers.load(std::sync::atomic::Ordering::SeqCst);
        let ask = || locked(|| mark_key_moving(&places, &fresh(0), true, &gate, &count));
        assert_eq!(ask(), Ok(fresh(7)));
        let tried = places.device.lock().unwrap().keychain_asks;
        assert!(tried > 0);
        // Asked again in the same run with nothing answered meanwhile: no new try, no new request.
        assert_eq!(ask(), Ok(fresh(7)));
        assert_eq!(places.device.lock().unwrap().keychain_asks, tried);
        // A password is read: the keychain answers now.
        places.device.lock().unwrap().keychain_silent = false;
        answers.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        assert_eq!(ask(), Ok(fresh(7)));
        let device = places.device.lock().unwrap();
        assert_eq!((device.note, device.file.clone()), (Some(MarkKeyPlace::Keychain), None));
        assert_eq!(device.keychain, Some(serde_json::Value::String(fresh(7))));
    }

    #[test]
    fn a_dialog_turned_down_asks_for_no_new_one_by_itself() {
        let places = Places::new(Device { keychain_refuses: true, ..in_the_file() }, 0);
        let gate = MoveGate::new();
        let answers = std::sync::atomic::AtomicU64::new(0);
        let count = || answers.load(std::sync::atomic::Ordering::SeqCst);
        for _ in 0..5 {
            assert_eq!(locked(|| mark_key_moving(&places, &fresh(0), true, &gate, &count)), Ok(fresh(7)));
        }
        let device = places.device.lock().unwrap();
        // One try: the write the person turned down; the file stays the place.
        assert_eq!(device.keychain_asks, 1);
        assert_eq!((device.note, device.file.clone()), (Some(MarkKeyPlace::File), Some(serde_json::Value::String(fresh(7)))));
    }

    #[test]
    fn keychain_steps_run_in_the_order_they_arrive() {
        // The first step holds the keychain (its dialog open); forty more arrive meanwhile, one right after the other.
        let order = Arc::new(Mutex::new(Vec::new()));
        let (release, released) = std::sync::mpsc::channel::<()>();
        let first = {
            let order = Arc::clone(&order);
            tauri::async_runtime::spawn(off_main(move || {
                let _ = released.recv();
                order.lock().unwrap().push(0);
                Ok(())
            }))
        };
        let steps: Vec<_> = (1..=40)
            .map(|n| {
                let order = Arc::clone(&order);
                tauri::async_runtime::spawn(off_main(move || {
                    order.lock().unwrap().push(n);
                    Ok(())
                }))
            })
            .collect();
        std::thread::sleep(std::time::Duration::from_millis(30));
        release.send(()).unwrap();
        tauri::async_runtime::block_on(async {
            first.await.unwrap().unwrap();
            for step in steps {
                step.await.unwrap().unwrap();
            }
        });
        assert_eq!(*order.lock().unwrap(), (0..=40).collect::<Vec<_>>());
    }

    #[test]
    fn the_generic_commands_cannot_reach_the_key_of_the_secrets_marks() {
        assert!(generic(MARK_KEY_SLOT).is_err());
        assert_eq!(generic("settingsSyncSecretsMarkKeyX"), Ok("settingsSyncSecretsMarkKeyX"));
    }

    #[test]
    fn the_generic_commands_cannot_reach_an_ai_key() {
        assert!(generic("ai-provider:anthropic").is_err());
        assert!(generic("ai-provider:").is_err());
        assert_eq!(generic("sync-token:v1"), Ok("sync-token:v1"));
        // Only the prefix counts, not a look-alike further in.
        assert_eq!(generic("x-ai-provider:y"), Ok("x-ai-provider:y"));
    }

    #[test]
    fn the_generic_commands_cannot_reach_the_credentials_of_an_mcp_server() {
        assert!(generic("ai-mcp:tracker").is_err());
        assert!(generic("ai-mcp:tracker:API_KEY").is_err());
        assert!(generic("ai-mcp:").is_err());
        assert_eq!(generic("x-ai-mcp:y"), Ok("x-ai-mcp:y"));
    }

    #[test]
    fn read_errors_do_not_become_absence() {
        assert_eq!(
            conditional_update(None, || Err("locked".into()), || panic!("must not write")),
            Err("locked".into())
        );
    }

    #[test]
    fn write_errors_do_not_become_success() {
        assert_eq!(
            conditional_update(None, || Ok(None), || Err("full".into())),
            Err("full".into())
        );
    }

    #[test]
    fn concurrent_windows_cannot_both_create_the_same_intent() {
        let value = Arc::new(Mutex::new(None::<String>));
        let tasks: Vec<_> = (0..2)
            .map(|id| {
                let value = Arc::clone(&value);
                std::thread::spawn(move || {
                    locked(|| {
                        conditional_update(
                            None,
                            || Ok(value.lock().unwrap().clone()),
                            || {
                                *value.lock().unwrap() = Some(id.to_string());
                                Ok(())
                            },
                        )
                    })
                    .unwrap()
                })
            })
            .collect();
        let successes = tasks
            .into_iter()
            .map(|task| task.join().unwrap())
            .filter(|v| *v)
            .count();
        assert_eq!(successes, 1);
    }
}
