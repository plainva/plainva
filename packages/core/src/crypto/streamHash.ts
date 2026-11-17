import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/**
 * A SHA-256 taken part by part, for bytes that are never all in memory at
 * once - a vault archive written as it is made (release list F51): Web Crypto
 * hashes only a whole buffer.
 */
export interface StreamHash {
  update(bytes: Uint8Array): void;
  /** The hex digest; the hash takes no more parts after it. */
  hex(): string;
}

export function createSha256Stream(): StreamHash {
  const hash = sha256.create();
  return {
    update: (bytes) => { hash.update(bytes); },
    hex: () => bytesToHex(hash.digest()),
  };
}
