/**
 * A runtime of a vault that dies mid-step, as in a crash: from `crash()` on,
 * every further call of its index database and its storage fails — the
 * process is gone, nothing of it runs on — while what already landed stays
 * on the disk and at the provider. The next runtime opens the same folder
 * and the same database.
 */
export interface Crashable {
  /** The process is gone from now on. */
  crash(): void;
  readonly crashed: boolean;
  wrap<T extends object>(target: T): T;
}

export function crashable(): Crashable {
  let crashed = false;
  return {
    crash: () => { crashed = true; },
    get crashed() { return crashed; },
    wrap: <T extends object>(target: T): T =>
      new Proxy(target, {
        get(obj, key, receiver) {
          const value = Reflect.get(obj, key, receiver);
          if (typeof value !== "function") return value;
          return (...args: unknown[]) => {
            if (crashed) return Promise.reject(new Error("the runtime crashed"));
            return (value as (...a: unknown[]) => unknown).apply(obj, args);
          };
        },
      }),
  };
}
