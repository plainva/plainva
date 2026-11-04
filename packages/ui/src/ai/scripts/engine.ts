import type { GuestEngine } from "./guest";
import engineWasmUrl from "@jitl/quickjs-ng-wasmfile-release-sync/wasm?url";

/**
 * The engine of the script sandbox (ADR 0020 decision 6): QuickJS-ng as one
 * WebAssembly module, from the package the lockfile pins. Every call makes a
 * new, separate instance — one script, one instance, nothing shared between
 * two runs. It is loaded only when a script runs, never with the app.
 *
 * The module is a file of its own beside the code (`emscripten-module.wasm`).
 * In a shell the bundler gives it an address (`?url`), and that address is
 * where the engine reads it from: the emscripten loader's own guess, a path
 * next to a module the bundler moved or pre-bundled, does not hold in a
 * worker. Under Node (the unit tests) the package's Node build reads the file
 * from its own folder.
 *
 * `apps/desktop/src/ai/scriptWorkerSandbox.test.ts` holds the module's hash and
 * the number of functions it imports: a new version of the package is a new
 * engine, and is looked at before it runs anything.
 */
export async function loadGuestEngine(): Promise<GuestEngine> {
  const [{ newQuickJSWASMModuleFromVariant }, { default: variant }] = await Promise.all([
    import("quickjs-emscripten-core"),
    import("@jitl/quickjs-ng-wasmfile-release-sync"),
  ]);
  let heap: { HEAPU8: Uint8Array } | null = null;
  // What the engine itself prints — an assertion's last words — goes nowhere: a script's own output is `console`, through the host.
  const quiet = (): void => {};
  const located = inNode() ? {} : { locateFile: (file: string) => (file.endsWith(".wasm") ? engineWasmUrl : file) };
  const quickjs = await newQuickJSWASMModuleFromVariant({
    ...variant,
    importModuleLoader: async () => {
      const load = await variant.importModuleLoader();
      return (async (options?: Record<string, unknown>) => {
        const loaded = await (load as unknown as (options: Record<string, unknown>) => Promise<{ HEAPU8: Uint8Array }>)({ ...options, ...located, print: quiet, printErr: quiet });
        heap = loaded;
        return loaded;
      }) as unknown as typeof load;
    },
  });
  return { quickjs, heapBytes: () => heap?.HEAPU8.byteLength ?? 0 };
}

function inNode(): boolean {
  const node = (globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node;
  return typeof node === "string" && node.length > 0;
}

/** Whether this device can run the engine at all (a WebView without WebAssembly cannot). */
export function guestEngineAvailable(): boolean {
  return typeof WebAssembly === "object" && typeof WebAssembly.instantiate === "function";
}
