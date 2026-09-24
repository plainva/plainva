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
    let service = crate::app_identity::keychain_service_for(&app.config().identifier);
    keyring::Entry::new(&service, key).map_err(|e| e.to_string())
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

#[tauri::command]
pub fn keychain_get(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    locked(|| read(&entry(&app, &key)?))
}

#[tauri::command]
pub fn keychain_set(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    locked(|| write(&entry(&app, &key)?, Some(&value)))
}

#[tauri::command]
pub fn keychain_delete(app: tauri::AppHandle, key: String) -> Result<(), String> {
    locked(|| write(&entry(&app, &key)?, None))
}

#[tauri::command]
pub fn keychain_compare_and_set(
    app: tauri::AppHandle,
    key: String,
    expected: Option<String>,
    value: Option<String>,
) -> Result<bool, String> {
    locked(|| {
        let entry = entry(&app, &key)?;
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
