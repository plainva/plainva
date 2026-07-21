/**
 * Fatal sync-protocol error for the settings-sync + encryption feature (v3 §3.5,
 * A3). Thrown by the fail-closed guard and the encrypting decorator on any
 * protocol violation — an encryption marker without a usable key, PVE1 magic
 * that cannot be decrypted, a key-id switch, corrupted protected sideband data,
 * or plaintext in strict mode. It must propagate straight through the per-file
 * pull guard (never counted as an ordinary single-file failure), abort the
 * prefetcher and end the whole cycle BEFORE the push phase, so ciphertext never
 * lands in a note and no plaintext is pushed into an encrypted remote.
 */
export class FatalSyncProtocolError extends Error {
  constructor(
    readonly reason:
      | "encrypted-without-key"
      | "plaintext-in-strict"
      | "key-mismatch"
      | "manifest-invalid"
      | "guard-too-old",
    message: string
  ) {
    super(message);
    this.name = "FatalSyncProtocolError";
  }
}
