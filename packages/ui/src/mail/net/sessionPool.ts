/**
 * Session reuse for the socket IMAP transport (findings round P7.3) — the
 * TypeScript twin of the desktop's `mail_pool.rs`, with the same five rules, so
 * both platforms behave the same under a flaky network:
 *
 * - **Health check before reuse.** A pooled connection is handed out only after
 *   a cheap `NOOP` still gets a reply; servers close idle sockets silently.
 * - **Any error retires the connection.** A failed command may leave unread
 *   server output in the socket, so the next command would read the wrong
 *   reply — a wrong body under the right subject is worse than a slow fetch.
 * - **Idle expiry.** Past the TTL the connection is closed rather than probed.
 * - **Exclusive while in use.** `with` takes the connection out for the
 *   duration of the call: a second overlapping operation opens its own (IMAP
 *   cannot interleave commands on one connection), and only one is kept.
 * - **Explicit release.** One account, or all of them — the phone must drop
 *   every session when it goes to the background, because the OS suspends the
 *   sockets and a resumed connection is dead without saying so.
 *
 * Generic over the connection type so the policy is testable without a server.
 */

/** How long an idle connection may wait for its next command. */
export const SESSION_IDLE_TTL_MS = 120_000;

interface Idle<C> {
  conn: C;
  /** When the connection last finished an operation. */
  since: number;
}

export interface SessionPoolHooks<C> {
  /** The cheap round trip that decides whether a pooled connection is alive. */
  healthy(conn: C): Promise<boolean>;
  /** Closes a connection (logout + socket). Must never throw. */
  close(conn: C): Promise<void>;
  /** Injectable clock — the expiry tests must not sleep. */
  now?(): number;
}

export class SessionPool<C> {
  private readonly idle = new Map<string, Idle<C>>();

  constructor(
    private readonly hooks: SessionPoolHooks<C>,
    private readonly ttlMs = SESSION_IDLE_TTL_MS,
  ) {}

  private now(): number {
    return this.hooks.now ? this.hooks.now() : Date.now();
  }

  /**
   * Runs `fn` on a connection for `key`, opening one with `open` when nothing
   * reusable is pooled. `open` is passed per call because it carries THIS call's
   * credentials (the same shape as the desktop's `SessionPool::with`).
   *
   * Everything between taking and putting back is synchronous on the map, so two
   * overlapping calls never share one connection.
   */
  async with<T>(key: string, open: () => Promise<C>, fn: (conn: C) => Promise<T>): Promise<T> {
    const retired: C[] = [];
    const pooled = this.take(key, retired);
    for (const conn of retired) await this.hooks.close(conn).catch(() => undefined);

    let conn: C;
    if (pooled === undefined) {
      conn = await open();
    } else if (await this.hooks.healthy(pooled).catch(() => false)) {
      conn = pooled;
    } else {
      await this.hooks.close(pooled).catch(() => undefined);
      conn = await open();
    }

    try {
      const value = await fn(conn);
      const evicted = this.put(key, conn);
      if (evicted !== undefined) await this.hooks.close(evicted).catch(() => undefined);
      return value;
    } catch (err) {
      // A half-finished command leaves the connection in an unknown state.
      await this.hooks.close(conn).catch(() => undefined);
      throw err;
    }
  }

  /** Takes the fresh connection for `key`; collects every expired one to close. */
  private take(key: string, retired: C[]): C | undefined {
    const now = this.now();
    for (const [k, entry] of [...this.idle]) {
      if (now - entry.since >= this.ttlMs) {
        this.idle.delete(k);
        retired.push(entry.conn);
      }
    }
    const entry = this.idle.get(key);
    if (!entry) return undefined;
    this.idle.delete(key);
    return entry.conn;
  }

  /** Returns a finished connection; yields whatever it replaces. */
  private put(key: string, conn: C): C | undefined {
    const previous = this.idle.get(key);
    this.idle.set(key, { conn, since: this.now() });
    return previous?.conn;
  }

  /** Closes pooled connections: one account when `marker` is given, all otherwise. */
  async release(marker?: string): Promise<void> {
    const keys = [...this.idle.keys()].filter((k) => marker === undefined || k.includes(marker));
    const closing: Promise<void>[] = [];
    for (const key of keys) {
      const entry = this.idle.get(key);
      this.idle.delete(key);
      if (entry) closing.push(this.hooks.close(entry.conn).catch(() => undefined));
    }
    await Promise.all(closing);
  }

  /** Idle connections — for tests and diagnostics. */
  get size(): number {
    return this.idle.size;
  }
}

/**
 * The pool key for an account. The password is not in the key verbatim (keys
 * show up in diagnostics) but its fingerprint is: a rotated password must not
 * reuse a connection logged in with the old one. Host/port/user stay readable so
 * `release` can drop one account by its delimited fragment.
 */
export function sessionKey(creds: { host: string; port: number; user: string; pass: string }): string {
  return `${creds.host}:${creds.port}:${creds.user}#${fingerprint(creds.pass)}`;
}

/**
 * The account fragment of `sessionKey`. Delimited on both sides, so releasing
 * "ada" cannot also release "nada" — the bug the desktop policy tests caught.
 */
export function accountMarker(user: string): string {
  return `:${user}#`;
}

/** FNV-1a. Not a security primitive: it only has to change when the password does. */
function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i) & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
