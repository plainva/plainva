//! Paired clients, their folders and the audit (plan KI-Harness §17.3).
//!
//! Lives in the app's data folder, never in the vault and never synced:
//! - `mcp/clients.json` — the clients this installation paired: name, the
//!   program that asked, a hash of the secret the helper keeps, when it was
//!   last seen. A secret is never stored in clear here.
//! - `mcp/grants-<vault>.json` — per vault, which folders each client may read
//!   (deny by default: a client with no entry reads nothing of that vault), and
//!   which clients may propose changes there (stage 2; off by default).
//! - `mcp/audit-<vault>.jsonl` — which client asked for what and when; the last
//!   `AUDIT_KEEP` lines are kept.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

pub const AUDIT_KEEP: usize = 500;

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ClientRecord {
    pub id: String,
    pub name: String,
    pub program: String,
    pub secret_sha256: String,
    pub created_at: String,
    pub last_seen: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
pub struct Clients {
    pub clients: Vec<ClientRecord>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
pub struct Grants {
    /// client id → granted folders ("" = the whole vault).
    pub folders: BTreeMap<String, Vec<String>>,
    /// The clients that may propose changes in this vault (stage 2): a
    /// suggestion on a note, a draft, a plan the user confirms. Off for every
    /// client until the user switches it on; a file written before stage 2
    /// names none.
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    pub writes: BTreeSet<String>,
}

impl Grants {
    /// Whether this client may propose changes: only inside folders it reads.
    pub fn may_write(&self, client_id: &str) -> bool {
        self.writes.contains(client_id) && self.folders.get(client_id).is_some_and(|folders| !folders.is_empty())
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    pub at: String,
    pub client_id: String,
    pub client: String,
    pub tool: String,
    pub ok: bool,
    /// How many notes the answer named (paths stay out of the audit's summary line).
    pub notes: usize,
    /// What became of a call that is no plain yes or no: `asked` — the user
    /// was asked in Plainva and the client told that input is required —,
    /// `declined` — the user, or the client's own user, said no. Fixed words,
    /// never text of a note or of a client.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

pub fn hash_secret(secret: &str) -> String {
    let digest = Sha256::digest(secret.as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// Compares two hashes without leaking where they differ.
pub fn same_hash(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// 32 random bytes as hex: the secret a newly paired helper keeps.
pub fn new_secret() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| e.to_string())?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// A short random id for a client record.
pub fn new_id() -> Result<String, String> {
    let mut bytes = [0u8; 8];
    getrandom::fill(&mut bytes).map_err(|e| e.to_string())?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

impl Clients {
    /// The paired client this hello belongs to: same name and the secret it was given.
    pub fn find(&self, name: &str, secret: Option<&str>) -> Option<&ClientRecord> {
        let secret = secret?;
        let hash = hash_secret(secret);
        self.clients.iter().find(|c| c.name == name && same_hash(&c.secret_sha256, &hash))
    }
}

/// A vault key as it may appear in a file name.
pub fn vault_file_key(vault_key: &str) -> String {
    vault_key
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .take(80)
        .collect()
}

pub struct Store {
    dir: PathBuf,
}

impl Store {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    fn clients_path(&self) -> PathBuf {
        self.dir.join("clients.json")
    }

    fn grants_path(&self, vault_key: &str) -> PathBuf {
        self.dir.join(format!("grants-{}.json", vault_file_key(vault_key)))
    }

    fn audit_path(&self, vault_key: &str) -> PathBuf {
        self.dir.join(format!("audit-{}.jsonl", vault_file_key(vault_key)))
    }

    pub fn clients(&self) -> Clients {
        read_json(&self.clients_path()).unwrap_or_default()
    }

    pub fn save_clients(&self, clients: &Clients) -> Result<(), String> {
        write_json(&self.dir, &self.clients_path(), clients)
    }

    pub fn grants(&self, vault_key: &str) -> Grants {
        read_json(&self.grants_path(vault_key)).unwrap_or_default()
    }

    pub fn save_grants(&self, vault_key: &str, grants: &Grants) -> Result<(), String> {
        write_json(&self.dir, &self.grants_path(vault_key), grants)
    }

    /// Forgets a client everywhere: its record, and its folders in every vault.
    pub fn revoke(&self, client_id: &str) -> Result<(), String> {
        let mut clients = self.clients();
        clients.clients.retain(|c| c.id != client_id);
        self.save_clients(&clients)?;
        if let Ok(entries) = fs::read_dir(&self.dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if let Some(key) = name.strip_prefix("grants-").and_then(|n| n.strip_suffix(".json")) {
                    let path = entry.path();
                    let mut grants: Grants = read_json(&path).unwrap_or_default();
                    let read = grants.folders.remove(client_id).is_some();
                    let wrote = grants.writes.remove(client_id);
                    if read || wrote {
                        write_json(&self.dir, &self.grants_path(key), &grants)?;
                    }
                }
            }
        }
        Ok(())
    }

    pub fn audit(&self, vault_key: &str) -> Vec<AuditEntry> {
        fs::read_to_string(self.audit_path(vault_key))
            .unwrap_or_default()
            .lines()
            .filter_map(|line| serde_json::from_str(line).ok())
            .collect()
    }

    /// Appends one line and keeps the last `AUDIT_KEEP`.
    pub fn append_audit(&self, vault_key: &str, entry: &AuditEntry) -> Result<(), String> {
        fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        let path = self.audit_path(vault_key);
        let line = serde_json::to_string(entry).map_err(|e| e.to_string())?;
        let mut file = fs::OpenOptions::new().create(true).append(true).open(&path).map_err(|e| e.to_string())?;
        writeln!(file, "{line}").map_err(|e| e.to_string())?;
        drop(file);
        let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let lines: Vec<&str> = text.lines().collect();
        if lines.len() > AUDIT_KEEP + AUDIT_KEEP / 5 {
            let kept = lines[lines.len() - AUDIT_KEEP..].join("\n");
            write_text(&self.dir, &path, &format!("{kept}\n"))?;
        }
        Ok(())
    }
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Option<T> {
    serde_json::from_str(&fs::read_to_string(path).ok()?).ok()
}

fn write_json<T: Serialize>(dir: &Path, path: &Path, value: &T) -> Result<(), String> {
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    write_text(dir, path, &text)
}

/// Written beside the target and renamed over it: a crash leaves the old file, never half of one.
fn write_text(dir: &Path, path: &Path, text: &str) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let mut tmp = tempfile::NamedTempFile::new_in(dir).map_err(|e| e.to_string())?;
    tmp.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
    tmp.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(id: &str, name: &str, secret: &str) -> ClientRecord {
        ClientRecord {
            id: id.into(),
            name: name.into(),
            program: "p".into(),
            secret_sha256: hash_secret(secret),
            created_at: "t".into(),
            last_seen: "t".into(),
        }
    }

    #[test]
    fn a_client_is_found_only_by_its_name_and_its_own_secret() {
        let clients = Clients { clients: vec![record("a", "Claude Code", "s1"), record("b", "Cursor", "s2")] };
        assert_eq!(clients.find("Claude Code", Some("s1")).map(|c| c.id.as_str()), Some("a"));
        assert!(clients.find("Claude Code", Some("s2")).is_none(), "another client's secret");
        assert!(clients.find("Claude Code", None).is_none(), "no secret, no client");
        assert!(clients.find("Unknown", Some("s1")).is_none());
    }

    #[test]
    fn secrets_are_random_and_only_their_hash_is_kept() {
        let a = new_secret().unwrap();
        let b = new_secret().unwrap();
        assert_eq!(a.len(), 64);
        assert_ne!(a, b);
        assert!(same_hash(&hash_secret(&a), &hash_secret(&a)));
        assert!(!same_hash(&hash_secret(&a), &hash_secret(&b)));
        assert!(!same_hash("ab", "abc"));
    }

    #[test]
    fn grants_are_per_vault_and_revoking_forgets_the_client_everywhere() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().join("mcp"));
        store.save_clients(&Clients { clients: vec![record("a", "A", "s"), record("b", "B", "t")] }).unwrap();
        let mut one = Grants::default();
        one.folders.insert("a".into(), vec!["Projects".into()]);
        one.folders.insert("b".into(), vec!["".into()]);
        store.save_grants("vault one", &one).unwrap();
        let mut two = Grants::default();
        two.folders.insert("a".into(), vec!["Notes".into()]);
        store.save_grants("vault/two", &two).unwrap();
        assert_eq!(store.grants("vault one").folders["a"], vec!["Projects".to_string()]);
        assert!(store.grants("unknown").folders.is_empty(), "deny by default");

        store.revoke("a").unwrap();
        assert_eq!(store.clients().clients.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(), vec!["b"]);
        assert!(!store.grants("vault one").folders.contains_key("a"));
        assert!(!store.grants("vault/two").folders.contains_key("a"));
        assert!(store.grants("vault one").folders.contains_key("b"));
    }

    #[test]
    fn proposing_changes_is_off_until_it_is_granted_and_goes_with_the_client() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().join("mcp"));
        // A grants file written before stage 2 names no client that may write.
        std::fs::create_dir_all(dir.path().join("mcp")).unwrap();
        std::fs::write(dir.path().join("mcp").join("grants-v.json"), r#"{"folders":{"a":["Projects"],"b":[""]}}"#).unwrap();
        let mut grants = store.grants("v");
        assert!(!grants.may_write("a") && !grants.may_write("b"));
        grants.writes.insert("a".into());
        // Named as a writer without a folder to read: still nothing.
        grants.writes.insert("ghost".into());
        store.save_grants("v", &grants).unwrap();
        let read = store.grants("v");
        assert!(read.may_write("a"));
        assert!(!read.may_write("b"), "another client's grant is not this one's");
        assert!(!read.may_write("ghost"), "writing needs folders to read");
        assert!(!store.grants("other").may_write("a"), "a grant is per vault");
        // A file without writers stays the file it was.
        let mut plain = Grants::default();
        plain.folders.insert("a".into(), vec!["Projects".into()]);
        assert!(!serde_json::to_string(&plain).unwrap().contains("writes"));

        store.save_clients(&Clients { clients: vec![record("a", "A", "s")] }).unwrap();
        store.revoke("a").unwrap();
        assert!(!store.grants("v").may_write("a"));
        assert!(!store.grants("v").writes.contains("a"), "revoking forgets the grant too");
    }

    #[test]
    fn the_audit_says_what_became_of_a_call_in_fixed_words() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().join("mcp"));
        let entry = |tool: &str, ok: bool, note: Option<&str>| AuditEntry { at: "1".into(), client_id: "a".into(), client: "A".into(), tool: tool.into(), ok, notes: 0, note: note.map(str::to_string) };
        store.append_audit("v", &entry("read_note", true, None)).unwrap();
        store.append_audit("v", &entry("rename_note", false, Some("asked"))).unwrap();
        let audit = store.audit("v");
        assert_eq!(audit.iter().map(|a| a.note.as_deref()).collect::<Vec<_>>(), vec![None, Some("asked")]);
        // A line written before stage 2 reads as one without a note.
        std::fs::write(dir.path().join("mcp").join("audit-old.jsonl"), "{\"at\":\"1\",\"clientId\":\"a\",\"client\":\"A\",\"tool\":\"read_note\",\"ok\":true,\"notes\":1}\n").unwrap();
        assert_eq!(store.audit("old")[0].note, None);
    }

    #[test]
    fn the_audit_keeps_its_last_lines() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().join("mcp"));
        for i in 0..(AUDIT_KEEP + AUDIT_KEEP / 5 + 3) {
            let entry = AuditEntry { at: format!("{i}"), client_id: "a".into(), client: "A".into(), tool: "read_note".into(), ok: true, notes: 1, note: None };
            store.append_audit("v", &entry).unwrap();
        }
        let audit = store.audit("v");
        assert!(audit.len() <= AUDIT_KEEP + AUDIT_KEEP / 5);
        assert_eq!(audit.last().unwrap().at, format!("{}", AUDIT_KEEP + AUDIT_KEEP / 5 + 2));
    }
}
