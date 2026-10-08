import type { GuestEngine } from "./guest";

/**
 * The engine of the script sandbox (ADR 0020 decision 6): QuickJS as one
 * WebAssembly module, from the package the lockfile pins. Every call makes a
 * new, separate instance — one script, one instance, nothing shared between
 * two runs. It is loaded only when a script runs, never with the app.
 *
 * `apps/desktop/src/ai/scriptWorkerSandbox.test.ts` holds the module's hash and
 * the number of functions it imports: a new version of the package is a new
 * engine, and is looked at before it runs anything.
 */
export async function loadGuestEngine(): Promise<GuestEngine> {
  const { newQuickJSWASMModule, RELEASE_SYNC } = await import("@tootallnate/quickjs-emscripten");
  let heap: { HEAPU8: Uint8Array } | null = null;
  // What the engine itself prints — an assertion's last words — goes nowhere: a script's own output is `console`, through the host.
  const quiet = (): void => {};
  const quickjs = await newQuickJSWASMModule({
    type: "sync",
    importFFI: RELEASE_SYNC.importFFI,
    importModuleLoader: async () => {
      const load = await RELEASE_SYNC.importModuleLoader();
      return (async (options?: Record<string, unknown>) => {
        const loaded = await (load as unknown as (options: Record<string, unknown>) => Promise<{ HEAPU8: Uint8Array }>)({ ...options, print: quiet, printErr: quiet });
        heap = loaded;
        return loaded;
      }) as unknown as typeof load;
    },
  });
  return { quickjs, heapBytes: () => heap?.HEAPU8.byteLength ?? 0 };
}

/** Whether this device can run the engine at all (a WebView without WebAssembly cannot). */
export function guestEngineAvailable(): boolean {
  return typeof WebAssembly === "object" && typeof WebAssembly.instantiate === "function";
}
