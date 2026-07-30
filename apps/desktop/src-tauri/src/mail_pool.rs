//! Session reuse for the blocking IMAP client (findings round P7.2).
//!
//! Until now every mail command opened its own connection: TCP handshake, TLS
//! handshake, `LOGIN`, work, `LOGOUT`. Opening a folder and reading three
//! messages therefore cost four full logins — the single largest latency
//! contributor on a remote mailbox, and enough consecutive logins to make some
//! servers throttle.
//!
//! This module keeps at most ONE idle session per account and hands it out
//! again. The policy is deliberately conservative, because a stale or
//! half-consumed IMAP connection is worse than a slow one:
//!
//! - **Health check before reuse.** A pooled session is only handed out after a
//!   cheap round trip (`NOOP` at the call site) succeeds. Servers close idle
//!   connections without telling us.
//! - **Any error retires the session.** A failed command may have left unread
//!   server output in the socket, so the next command would read the wrong
//!   reply. The session is closed instead of returned.
//! - **Idle expiry.** A session older than the TTL is closed rather than
//!   probed — it is almost certainly gone, and probing costs a round trip.
//! - **Exclusive while in use.** `with` takes the session out of the pool for
//!   the duration of the call, so two overlapping commands never share one
//!   connection (the second opens its own; only one is kept afterwards).
//! - **Explicit release.** Switching accounts or closing the app drains the
//!   pool, so no socket and no logged-in session outlives its reason to exist.
//!
//! The pool is generic over the session type so the policy can be tested
//! without a server: `mail_imap` instantiates it with the real `imap::Session`.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// How long an idle session may wait for its next command before it is closed.
/// Two minutes covers a burst of reading in one folder; beyond that the odds of
/// the server having dropped the connection outweigh the saved handshake.
pub const IDLE_TTL: Duration = Duration::from_secs(120);

struct Idle<S> {
    session: S,
    /// When the session last finished a command (start of its idle period).
    since: Instant,
}

pub struct SessionPool<S> {
    idle: Mutex<HashMap<String, Idle<S>>>,
    ttl: Duration,
}

impl<S> SessionPool<S> {
    pub fn new(ttl: Duration) -> Self {
        Self { idle: Mutex::new(HashMap::new()), ttl }
    }

    /// A panicking command must not take mail down for the rest of the session,
    /// so a poisoned lock is recovered instead of unwrapped.
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Idle<S>>> {
        self.idle.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Runs `f` on a session for `key`.
    ///
    /// `open` builds a fresh session, `healthy` is the cheap round trip that
    /// decides whether a pooled session may be reused, and `close` logs a
    /// session out. Sessions that are expired, unhealthy or left behind by a
    /// failed command are handed to `close`.
    pub fn with<T>(
        &self,
        key: &str,
        open: impl FnOnce() -> Result<S, String>,
        healthy: impl FnOnce(&mut S) -> bool,
        close: impl Fn(S),
        f: impl FnOnce(&mut S) -> Result<T, String>,
    ) -> Result<T, String> {
        let (pooled, retired) = self.take(key);
        for session in retired {
            close(session);
        }
        let mut session = match pooled {
            Some(mut session) => {
                if healthy(&mut session) {
                    session
                } else {
                    close(session);
                    open()?
                }
            }
            None => open()?,
        };
        match f(&mut session) {
            Ok(value) => {
                if let Some(evicted) = self.put(key, session) {
                    close(evicted);
                }
                Ok(value)
            }
            // A half-finished command leaves the connection in an unknown state.
            Err(err) => {
                close(session);
                Err(err)
            }
        }
    }

    /// Takes the idle session for `key` (if any is still fresh) and every
    /// session that has since expired — including other accounts', so an idle
    /// pool does not sit on open sockets after the user stopped reading mail.
    fn take(&self, key: &str) -> (Option<S>, Vec<S>) {
        let mut idle = self.lock();
        let now = Instant::now();
        let mut retired = Vec::new();
        let expired: Vec<String> = idle
            .iter()
            .filter(|(_, entry)| now.duration_since(entry.since) >= self.ttl)
            .map(|(k, _)| k.clone())
            .collect();
        for k in expired {
            if let Some(entry) = idle.remove(&k) {
                retired.push(entry.session);
            }
        }
        let taken = idle.remove(key).map(|entry| entry.session);
        (taken, retired)
    }

    /// Returns a finished session to the pool. Yields whatever it replaces —
    /// two overlapping commands both finish, only one session is kept.
    fn put(&self, key: &str, session: S) -> Option<S> {
        let mut idle = self.lock();
        idle.insert(key.to_string(), Idle { session, since: Instant::now() })
            .map(|entry| entry.session)
    }

    /// Drops every session whose key contains `marker` (one account, once the
    /// user switches away from it) and returns them for logout. The marker is a
    /// delimited fragment, not a prefix: the account sits between the port and
    /// the password fingerprint, so `:ada#` matches "host:993:ada#f00" and
    /// cannot match "host:993:nada#f00".
    pub fn drain_account(&self, marker: &str) -> Vec<S> {
        let mut idle = self.lock();
        let keys: Vec<String> = idle.keys().filter(|k| k.contains(marker)).cloned().collect();
        keys.into_iter().filter_map(|k| idle.remove(&k)).map(|entry| entry.session).collect()
    }

    /// Drops every pooled session (app exit, vault close).
    pub fn drain_all(&self) -> Vec<S> {
        let mut idle = self.lock();
        idle.drain().map(|(_, entry)| entry.session).collect()
    }

    /// Number of idle sessions — the policy tests assert on this; the app only
    /// ever goes through `with`, so it is dead code outside them.
    #[cfg(test)]
    pub fn idle_count(&self) -> usize {
        self.lock().len()
    }
}

/// The pool key for an account. The password is not part of the key verbatim
/// (keys end up in diagnostics), but its fingerprint is: a rotated password must
/// not reuse a session that was logged in with the old one. Host/port/user stay
/// readable so `drain_account` can release one account by its user fragment.
pub fn session_key(host: &str, port: u16, user: &str, pass: &str) -> String {
    format!("{host}:{port}:{user}#{:016x}", fingerprint(pass))
}

/// The account fragment of `session_key` — the delimited user part, so
/// releasing an account covers its rotated passwords too.
pub fn account_marker(user: &str) -> String {
    format!(":{user}#")
}

/// FNV-1a. Not a security primitive: it only has to change when the password
/// changes, and a dedicated hash dependency would be dead weight for that.
fn fingerprint(value: &str) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    /// A stand-in for `imap::Session`: it only has to be openable, probeable and
    /// closeable so the POLICY can be tested without a server.
    #[derive(Debug)]
    struct Fake {
        id: u32,
        /// Whether the health probe on this session succeeds.
        healthy: bool,
    }

    #[derive(Default)]
    struct Log {
        opened: Vec<u32>,
        closed: Vec<u32>,
        probed: Vec<u32>,
    }

    struct Harness {
        pool: SessionPool<Fake>,
        log: RefCell<Log>,
        next_id: RefCell<u32>,
        /// Health of the NEXT session handed out by `open`.
        healthy: RefCell<bool>,
    }

    impl Harness {
        fn new(ttl: Duration) -> Self {
            Self {
                pool: SessionPool::new(ttl),
                log: RefCell::new(Log::default()),
                next_id: RefCell::new(0),
                healthy: RefCell::new(true),
            }
        }

        fn run(&self, key: &str, outcome: Result<(), String>) -> Result<u32, String> {
            self.pool.with(
                key,
                || {
                    let mut next = self.next_id.borrow_mut();
                    *next += 1;
                    let session = Fake { id: *next, healthy: *self.healthy.borrow() };
                    self.log.borrow_mut().opened.push(session.id);
                    Ok(session)
                },
                |session| {
                    self.log.borrow_mut().probed.push(session.id);
                    session.healthy
                },
                |session| self.log.borrow_mut().closed.push(session.id),
                |session| outcome.clone().map(|()| session.id),
            )
        }

        fn ok(&self, key: &str) -> u32 {
            self.run(key, Ok(())).expect("command succeeded")
        }
    }

    #[test]
    fn five_actions_on_one_account_produce_a_single_login() {
        let h = Harness::new(IDLE_TTL);
        let ids: Vec<u32> = (0..5).map(|_| h.ok("acct")).collect();
        assert_eq!(ids, vec![1, 1, 1, 1, 1], "every action ran on the same session");
        let log = h.log.borrow();
        assert_eq!(log.opened, vec![1], "exactly one login for five actions");
        assert!(log.closed.is_empty(), "a healthy session stays pooled");
        // Probed on every reuse, i.e. four times — never blindly reused.
        assert_eq!(log.probed, vec![1, 1, 1, 1]);
    }

    #[test]
    fn a_failed_command_retires_its_session() {
        let h = Harness::new(IDLE_TTL);
        assert_eq!(h.ok("acct"), 1);
        assert!(h.run("acct", Err("fetch failed".into())).is_err());
        assert_eq!(h.pool.idle_count(), 0, "the broken session is not pooled");
        assert_eq!(h.ok("acct"), 2, "the next action opens a fresh session");
        let log = h.log.borrow();
        assert_eq!(log.opened, vec![1, 2]);
        assert_eq!(log.closed, vec![1], "the failed session was logged out");
    }

    #[test]
    fn an_idle_session_past_the_ttl_is_closed_not_reused() {
        let h = Harness::new(Duration::from_millis(30));
        assert_eq!(h.ok("acct"), 1);
        std::thread::sleep(Duration::from_millis(50));
        assert_eq!(h.ok("acct"), 2, "the expired session is not handed out again");
        let log = h.log.borrow();
        assert_eq!(log.closed, vec![1], "it was logged out, not leaked");
        assert!(log.probed.is_empty(), "an expired session is dropped without a round trip");
    }

    #[test]
    fn an_unhealthy_session_is_replaced_before_the_command_runs() {
        let h = Harness::new(IDLE_TTL);
        assert_eq!(h.ok("acct"), 1);
        // The server dropped the connection while it sat idle.
        *h.healthy.borrow_mut() = false;
        {
            let mut idle = h.pool.lock();
            idle.get_mut("acct").expect("pooled").session.healthy = false;
        }
        assert_eq!(h.ok("acct"), 2, "the probe failure forced a fresh login");
        let log = h.log.borrow();
        assert_eq!(log.probed, vec![1]);
        assert_eq!(log.closed, vec![1]);
    }

    #[test]
    fn accounts_do_not_share_a_session() {
        let h = Harness::new(IDLE_TTL);
        assert_eq!(h.ok("a"), 1);
        assert_eq!(h.ok("b"), 2);
        assert_eq!(h.ok("a"), 1, "each account keeps its own connection");
        assert_eq!(h.ok("b"), 2);
        assert_eq!(h.pool.idle_count(), 2);
        assert!(h.log.borrow().closed.is_empty());
    }

    #[test]
    fn overlapping_commands_never_share_one_session() {
        let h = Harness::new(IDLE_TTL);
        assert_eq!(h.ok("acct"), 1);
        // The inner call runs while the outer one holds the pooled session.
        let outer = h.pool.with(
            "acct",
            || {
                let mut next = h.next_id.borrow_mut();
                *next += 1;
                let session = Fake { id: *next, healthy: true };
                h.log.borrow_mut().opened.push(session.id);
                Ok(session)
            },
            |session| {
                h.log.borrow_mut().probed.push(session.id);
                session.healthy
            },
            |session| h.log.borrow_mut().closed.push(session.id),
            |session| {
                let inner = h.ok("acct");
                assert_ne!(inner, session.id, "the in-use session was not handed out twice");
                Ok(session.id)
            },
        );
        assert_eq!(outer, Ok(1));
        assert_eq!(h.pool.idle_count(), 1, "only one session is kept afterwards");
        assert_eq!(h.log.borrow().closed.len(), 1, "the surplus session was logged out");
    }

    #[test]
    fn draining_releases_sessions_for_logout() {
        let h = Harness::new(IDLE_TTL);
        h.ok(&session_key("mail.example", 993, "ada", "pw"));
        h.ok(&session_key("mail.example", 993, "bob", "pw"));
        // Guard for the bug this test caught: a name that merely ENDS with the
        // released one must stay connected.
        h.ok(&session_key("mail.example", 993, "nada", "pw"));
        let released = h.pool.drain_account(&account_marker("ada"));
        assert_eq!(released.len(), 1, "only the named account was released");
        assert_eq!(h.pool.idle_count(), 2, "bob and nada keep their sessions");
        assert_eq!(h.pool.drain_all().len(), 2);
        assert_eq!(h.pool.idle_count(), 0);
    }

    #[test]
    fn a_rotated_password_does_not_reuse_the_old_session() {
        let old = session_key("mail.example", 993, "ada", "old-pw");
        let new = session_key("mail.example", 993, "ada", "new-pw");
        assert_ne!(old, new);
        assert!(!old.contains("old-pw"), "the password itself never lands in the key");
        // Both still belong to the same account for release purposes.
        let marker = account_marker("ada");
        assert!(old.contains(&marker) && new.contains(&marker));
        let h = Harness::new(IDLE_TTL);
        h.ok(&old);
        assert_eq!(h.ok(&new), 2, "the new credentials open their own session");
    }

    #[test]
    fn the_key_separates_hosts_ports_and_users() {
        let base = session_key("mail.example", 993, "ada", "pw");
        assert_ne!(base, session_key("other.example", 993, "ada", "pw"));
        assert_ne!(base, session_key("mail.example", 143, "ada", "pw"));
        assert_ne!(base, session_key("mail.example", 993, "bob", "pw"));
    }
}
