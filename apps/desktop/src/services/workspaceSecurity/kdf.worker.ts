/**
 * Web Worker that runs the memory-hard KDF off the main thread (A4).
 * scrypt (N=2^16 ≈ 64 MiB) on the JS main thread freezes the WebView for the
 * whole derivation; `@noble/hashes`' asyncTick only yields to microtasks, not to
 * the paint/input loop. Moving it here keeps the UI responsive while a passphrase
 * unlock derives its key. Only the fallback ("passphrase every start") path uses
 * it; a native OS keychain derives nothing on open.
 */
import { deriveKek, type KdfParams } from "@plainva/core";

interface KdfRequest {
  id: number;
  passphrase: string;
  salt: number[];
  params: KdfParams;
}

self.onmessage = async (event: MessageEvent<KdfRequest>) => {
  const { id, passphrase, salt, params } = event.data;
  try {
    const kek = await deriveKek(passphrase, new Uint8Array(salt), params);
    // Transfer the buffer so the key material is not cloned into a lingering copy.
    (self as unknown as Worker).postMessage({ id, ok: true, kek: [...kek] });
  } catch (error) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
