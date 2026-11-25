use std::sync::Mutex;

// All windows share this lane, including ordinary credential writers. A
// conditional journal update must not race a different webview's reconnect.
static STORE_LOCK: Mutex<()> = Mutex::new(());

fn locked<T>(run: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    let _guard = STORE_LOCK
        .lock()
        .map_err(|_| "secure store lock failed".to_string())?;
    run()
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
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn write(entry: &keyring::Entry, value: Option<&str>) -> Result<(), String> {
    match value {
        Some(value) => entry.set_password(value).map_err(|e| e.to_string()),
        None => match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        },
    }
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
/// under `locked`.
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
pub(crate) fn mark_key(places: &impl MarkKeyPlaces, fresh: &str, marks_on_device: bool) -> Result<String, String> {
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
            Some(key) => Ok(key),
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
}

/// The key of the secrets marks, for every window of the app (round fourteen).
#[tauri::command]
pub fn secrets_mark_key(app: tauri::AppHandle, fresh: String, marks_on_device: bool) -> Result<String, String> {
    use tauri_plugin_store::StoreExt;
    if !is_mark_key(&fresh) {
        return Err("a new secrets mark key must be 64 hex digits".into());
    }
    let settings = app.store(SETTINGS_STORE).map_err(|e| e.to_string())?;
    let credentials = app.store(CREDENTIALS_STORE).map_err(|e| e.to_string())?;
    obtain_mark_key(&AppMarkKeyPlaces { app: &app, settings, credentials }, &fresh, marks_on_device)
}

/// `mark_key` under the lock every window shares.
pub(crate) fn obtain_mark_key(places: &impl MarkKeyPlaces, fresh: &str, marks_on_device: bool) -> Result<String, String> {
    locked(|| mark_key(places, fresh, marks_on_device))
}

#[tauri::command]
pub fn keychain_get(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    let key = generic(&key)?;
    locked(|| read(&entry(&app, key)?))
}

#[tauri::command]
pub fn keychain_set(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    let key = generic(&key)?;
    locked(|| write(&entry(&app, key)?, Some(&value)))
}

#[tauri::command]
pub fn keychain_delete(app: tauri::AppHandle, key: String) -> Result<(), String> {
    let key = generic(&key)?;
    locked(|| write(&entry(&app, key)?, None))
}

#[tauri::command]
pub fn keychain_compare_and_set(
    app: tauri::AppHandle,
    key: String,
    expected: Option<String>,
    value: Option<String>,
) -> Result<bool, String> {
    let key = generic(&key)?;
    locked(|| {
        let entry = entry(&app, key)?;
        conditional_update(
            expected.as_deref(),
            || read(&entry),
            || write(&entry, value.as_deref()),
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::sync::Arc;

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
            self.step(|d| match place {
                MarkKeyPlace::Keychain if d.keychain_silent => Err("keychain does not answer".to_string()),
                MarkKeyPlace::Keychain if d.keychain_answers_other => Ok(Some(serde_json::Value::String("a".repeat(64)))),
                MarkKeyPlace::Keychain => Ok(d.keychain.clone()),
                MarkKeyPlace::File => {
                    d.file_reads += 1;
                    Ok(d.file.clone())
                }
            })
        }
        fn write(&self, place: MarkKeyPlace, key: &str) -> Result<(), String> {
            self.step(|d| match place {
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
                    obtain_mark_key(&places, &fresh(n), false)
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
                    assert_eq!(obtain_mark_key(&places, &fresh(9), true).as_ref(), Ok(&keys[0]), "{case}");
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
        assert_eq!(obtain_mark_key(&places, &fresh(0), false), Ok("a".repeat(64)));
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
        }
        assert_eq!(obtain_mark_key(&Other(places.clone()), &fresh(0), false), Ok("c".repeat(64)));
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
        }
        let places = Places::new(Device::default(), 0);
        assert_eq!(obtain_mark_key(&Gone(places.clone()), &fresh(0), false), Err("secrets mark key could not be stored".into()));
        assert_eq!({ let d = places.device.lock().unwrap(); (d.file_writes, d.note) }, (0, None));
    }

    #[test]
    fn a_silent_keychain_where_the_key_lives_stops_the_run() {
        let places = Places::new(Device { note: Some(MarkKeyPlace::Keychain), keychain_silent: true, ..Device::default() }, 0);
        assert_eq!(obtain_mark_key(&places, &fresh(0), false), Err("keychain does not answer".into()));
        let device = places.device.lock().unwrap();
        assert_eq!((device.file_reads, device.file_writes, device.note), (0, 0, Some(MarkKeyPlace::Keychain)));
    }

    #[test]
    fn a_silent_keychain_before_any_note_makes_a_key_only_where_no_mark_exists() {
        let places = Places::new(Device { keychain_silent: true, ..Device::default() }, 0);
        assert_eq!(obtain_mark_key(&places, &fresh(0), true), Err("keychain does not answer".into()));
        assert_eq!(places.device.lock().unwrap().file_writes, 0);
        assert_eq!(obtain_mark_key(&places, &fresh(0), false), Ok(fresh(0)));
        assert_eq!(places.device.lock().unwrap().note, Some(MarkKeyPlace::File));
        // From then on the file is the place, the keychain is not asked again.
        places.device.lock().unwrap().keychain_silent = false;
        assert_eq!(obtain_mark_key(&places, &fresh(5), true), Ok(fresh(0)));
    }

    #[test]
    fn a_key_in_the_file_is_the_files_and_is_noted() {
        let places = Places::new(Device { file: Some(serde_json::Value::String(fresh(7))), ..Device::default() }, 0);
        assert_eq!(obtain_mark_key(&places, &fresh(0), true), Ok(fresh(7)));
        let device = places.device.lock().unwrap();
        assert_eq!((device.keychain_writes, device.note), (0, Some(MarkKeyPlace::File)));
    }

    #[test]
    fn an_unreadable_key_is_an_error_never_a_new_one() {
        let places = Places::new(Device { note: Some(MarkKeyPlace::File), file: Some(serde_json::json!({ "x": 1 })), ..Device::default() }, 0);
        assert_eq!(obtain_mark_key(&places, &fresh(0), false), Err("secrets mark key is unreadable".into()));
        assert_eq!(places.device.lock().unwrap().file_writes, 0);
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
