// Vitest-only setup, registered BEFORE test-setup.ts (vite.config.ts).
//
// Node >= 25 defines a globalThis.localStorage of its own (web storage
// without --localstorage-file: an object whose methods are all missing). It
// shadows jsdom's storage AND any per-test shim guarded on `typeof
// localStorage === "undefined"` — 7 baseViewState tests failed locally on
// Node 25 while CI's Node 22 stayed green. Replace the ambient storage with
// a working in-memory one whenever the probe fails; real browsers and jsdom
// pass it untouched.
(() => {
  const isWorking = () => {
    try {
      const s = (globalThis as { localStorage?: Storage }).localStorage;
      if (!s || typeof s.setItem !== "function" || typeof s.clear !== "function") return false;
      s.setItem("__pv_probe__", "1");
      s.removeItem("__pv_probe__");
      return true;
    } catch {
      return false;
    }
  };
  if (isWorking()) return;
  const store = new Map<string, string>();
  const shim = {
    getItem: (k: string) => (store.has(String(k)) ? store.get(String(k))! : null),
    setItem: (k: string, v: string) => { store.set(String(k), String(v)); },
    removeItem: (k: string) => { store.delete(String(k)); },
    clear: () => { store.clear(); },
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  };
  Object.defineProperty(globalThis, "localStorage", { value: shim, configurable: true, writable: true });
})();

export {};
