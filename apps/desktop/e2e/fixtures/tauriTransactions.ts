/* eslint-disable @typescript-eslint/no-explicit-any -- the page's stand-in of Tauri is untyped, as in every spec */
/**
 * The desktop's transaction commands for the E2E pages' stand-ins of Tauri
 * (stability plan R1).
 *
 * Since R1 a transaction of the index database runs on a connection Rust holds
 * for it (`src-tauri/src/db_tx.rs`): `db_tx_begin`, then `db_tx_select`,
 * `db_tx_execute` and `db_tx_batch` by the transaction's number, then
 * `db_tx_commit` / `db_tx_rollback`, and `db_tx_close` with the database. The
 * specs' stand-ins answer the SQL plugin (`plugin:sql|select`,
 * `plugin:sql|execute`) and `db_batch`, each in its own way, and were written
 * before. This init script hands every transaction command on to them, through
 * the page's CURRENT `invoke` — so a spec that wraps `invoke` later to refuse a
 * statement still sees the statements of a transaction. What a stand-in did with
 * the statements of a transaction before R1 it does now.
 *
 * Installed for every spec by `clockedTest.ts`; a page that sets no
 * `__TAURI_INTERNALS__` is not touched. Runs in the page (addInitScript): no
 * imports, no closures over the runner.
 */
export function installTauriTransactionCommands(): void {
  const w = window as unknown as Record<string, any>;
  let next = 0;
  const databases = new Map<number, string>();
  const top = (cmd: string, args: unknown, options: unknown) => w.__TAURI_INTERNALS__.invoke(cmd, args, options);
  const wrap = (inner: (...a: unknown[]) => unknown) =>
    async function invoke(this: unknown, cmd: string, args: any, options: unknown) {
      switch (cmd) {
        case "db_tx_begin":
          next += 1;
          databases.set(next, String(args?.dbPath ?? ""));
          return next;
        case "db_tx_execute":
          await top("plugin:sql|execute", { db: databases.get(args.id), query: args.sql, values: args.params ?? [] }, options);
          return 0;
        case "db_tx_select":
          return (await top("plugin:sql|select", { db: databases.get(args.id), query: args.sql, values: args.params ?? [] }, options)) ?? [];
        case "db_tx_batch":
          await top("db_batch", { dbPath: databases.get(args.id), statements: args.statements }, options);
          return 0;
        case "db_tx_commit":
        case "db_tx_rollback":
          databases.delete(args?.id);
          return null;
        case "db_tx_close":
          return null;
        default:
          return inner.call(this, cmd, args, options);
      }
    };
  const shim = (internals: any) => {
    if (!internals || typeof internals !== "object") return internals;
    let outer = typeof internals.invoke === "function" ? wrap(internals.invoke) : internals.invoke;
    Object.defineProperty(internals, "invoke", {
      configurable: true,
      enumerable: true,
      get: () => outer,
      set: (fn: unknown) => { outer = typeof fn === "function" ? wrap(fn as (...a: unknown[]) => unknown) : fn; },
    });
    return internals;
  };
  let current: unknown = shim(w.__TAURI_INTERNALS__);
  Object.defineProperty(w, "__TAURI_INTERNALS__", {
    configurable: true,
    get: () => current,
    set: (value: unknown) => { current = shim(value); },
  });
}
