/**
 * Runs the KDF in a Web Worker so a passphrase unlock does not freeze the
 * WebView (A4). Falls back to the main-thread `deriveKek` when a worker cannot
 * be constructed (e.g. a test/jsdom environment) so behaviour stays correct
 * everywhere — only the UI responsiveness differs.
 */
import { deriveKek, type KdfParams } from "@plainva/core";

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (kek: Uint8Array) => void; reject: (error: Error) => void }>();

function ensureWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./kdf.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<{ id: number; ok: boolean; kek?: number[]; error?: string }>) => {
      const { id, ok, kek, error } = event.data;
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      if (ok && kek) entry.resolve(new Uint8Array(kek));
      else entry.reject(new Error(error || "kdf worker failed"));
    };
    worker.onerror = () => {
      // A worker-level error rejects every in-flight derivation; the next call
      // rebuilds the worker (or falls back to the main thread).
      for (const [, entry] of pending) entry.reject(new Error("kdf worker crashed"));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
    return worker;
  } catch {
    worker = null;
    return null;
  }
}

export async function deriveKekOffThread(passphrase: string, salt: Uint8Array, params: KdfParams): Promise<Uint8Array> {
  const active = ensureWorker();
  if (!active) return deriveKek(passphrase, salt, params);
  const id = nextId++;
  return new Promise<Uint8Array>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    active.postMessage({ id, passphrase, salt: [...salt], params });
  }).catch((error) => {
    // If the worker path failed, still produce a correct key on the main thread.
    console.warn("[deriveKekOffThread] worker path failed, deriving on main thread", error);
    return deriveKek(passphrase, salt, params);
  });
}
