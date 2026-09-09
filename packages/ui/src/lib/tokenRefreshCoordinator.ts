/** Keeps each grant's read/refresh/persist transaction ordered. Identical
 * concurrent requests share its completed result, including storage errors. */
export function createTokenRefreshCoordinator<T>() {
  const tails = new Map<string, Promise<void>>();
  const flights = new Map<string, { grant: string; task: Promise<T> }>();
  return {
    run(grant: string, request: string, execute: () => Promise<T>): Promise<T> {
      const key = JSON.stringify([grant, request]);
      const existing = flights.get(key);
      if (existing) return existing.task;
      const before = tails.get(grant) ?? Promise.resolve();
      const task = before.then(execute);
      const tail = task.then(() => {}, () => {});
      tails.set(grant, tail);
      flights.set(key, { grant, task });
      void tail.then(() => {
        if (tails.get(grant) === tail) tails.delete(grant);
        if (flights.get(key)?.task === task) flights.delete(key);
      });
      return task;
    },
    /** New attempts stop joining stale work but still wait for its slot lane. */
    forget(grant: string): void {
      for (const [key, value] of flights) if (value.grant === grant) flights.delete(key);
    },
  };
}

const credentialTails = new Map<string, Promise<void>>();

/** Both direct reconnects and conditional rotation writes use the same slot
 * lane. The expected credential is checked INSIDE this lane by the caller. */
export function withAccountCredentialLock<T>(key: string, execute: () => Promise<T>): Promise<T> {
  const before = credentialTails.get(key) ?? Promise.resolve();
  const task = before.then(execute);
  const tail = task.then(() => {}, () => {});
  credentialTails.set(key, tail);
  void tail.then(() => { if (credentialTails.get(key) === tail) credentialTails.delete(key); });
  return task;
}
