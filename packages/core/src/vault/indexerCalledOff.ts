import type { IVaultAdapter } from "./IVaultAdapter.js";
import type { BatchStatement, IDatabaseAdapter, SqlStatements } from "../db/IDatabaseAdapter.js";

/**
 * What the index's own signal (`VaultIndexerOptions.scanSignal`) does to the
 * two adapters the indexer works with, once the owner calls it off — the
 * vault is being closed or switched.
 *
 * Closing waited for the index's runs to settle (`VaultIndexer.whenIdle`),
 * and a run settled only when its read came back. A read that never answers —
 * a share that dropped, a provider that does not fetch, the header check of
 * an AppleDouble file on such a share — held the close until the operating
 * system gave up, which for a dead network mount may be never: the desktop's
 * next open of the same vault waits for the old teardown, the phone's switch
 * waits before it closes the database.
 *
 * Reads: every call the indexer makes to the vault adapter is answered with
 * the signal's reason the moment the signal is called off, whether the read
 * underneath has come back or not; one asked for afterwards is not even
 * started. The read itself goes on where it is (nothing can take it back) and
 * whatever it brings is dropped.
 *
 * Writes: after the signal, the indexer writes nothing — no statement of its
 * own, no batch, and no transaction that had not begun its body yet (one
 * waiting for its turn is refused as its turn comes). A body that is already
 * running finishes: everything it reads came before it,
 * and the owner closes the database only after a commit that has begun. So a
 * reading that arrives late writes neither into the database being closed
 * nor into the one the same vault opens next — on the desktop that is the
 * same file, reached by its path, and the old indexer's adapter stays usable
 * after the vault was switched.
 */
export function readsCalledOffBy(adapter: IVaultAdapter, signal: AbortSignal): IVaultAdapter {
  return new Proxy(adapter, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]): unknown => {
        if (signal.aborted) return Promise.reject(calledOff(signal));
        const result: unknown = value.apply(target, args);
        return isPromise(result) ? answeredOrCalledOff(result, signal) : result;
      };
    },
  });
}

/**
 * The database adapter whose writes stop with the signal (`readsCalledOffBy`).
 * A class with every method spelled out, not a proxy: `transaction-nesting.test.ts`
 * reads which functions open a transaction by their names.
 */
export function writesRefusedAfter(adapter: IDatabaseAdapter, signal: AbortSignal): IDatabaseAdapter {
  return new WritesRefusedAfter(adapter, signal);
}

class WritesRefusedAfter implements IDatabaseAdapter {
  readonly runBatch?: (statements: BatchStatement[]) => Promise<void>;

  constructor(private readonly inner: IDatabaseAdapter, private readonly signal: AbortSignal) {
    if (inner.runBatch) {
      this.runBatch = (statements) => (signal.aborted ? Promise.reject(calledOff(signal)) : inner.runBatch!(statements));
    }
  }

  initialize(): Promise<void> {
    return this.inner.initialize();
  }

  close(): Promise<void> {
    return this.inner.close();
  }

  execute(query: string, params?: unknown[] | Record<string, unknown>): Promise<void> {
    if (this.signal.aborted) return Promise.reject(calledOff(this.signal));
    return this.inner.execute(query, params);
  }

  query<T = unknown>(query: string, params?: unknown[] | Record<string, unknown>): Promise<T[]> {
    return this.inner.query<T>(query, params);
  }

  queryOne<T = unknown>(query: string, params?: unknown[] | Record<string, unknown>): Promise<T | null> {
    return this.inner.queryOne<T>(query, params);
  }

  transaction<T>(body: (tx: SqlStatements) => Promise<T>): Promise<T> {
    const signal = this.signal;
    if (signal.aborted) return Promise.reject(calledOff(signal));
    return this.inner.transaction(async (tx) => {
      // Its turn came after the signal: rolled back before it wrote.
      signal.throwIfAborted();
      return body(tx);
    });
  }
}

function calledOff(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The index was called off", "AbortError");
}

function isPromise(value: unknown): value is Promise<unknown> {
  return typeof (value as { then?: unknown } | null)?.then === "function";
}

function answeredOrCalledOff<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const off = () => reject(calledOff(signal));
    signal.addEventListener("abort", off, { once: true });
    work.then(
      (value) => { signal.removeEventListener("abort", off); resolve(value); },
      (error: unknown) => { signal.removeEventListener("abort", off); reject(error); },
    );
  });
}
