/**
 * Purpose-separated subkeys for the settings-sync + encryption feature (v3 §3.2).
 * The random 32-byte master key (MK) is never used directly as an AEAD key;
 * HKDF-SHA256 with fixed domain strings derives separate keys per purpose, so a
 * content key and a settings key are cryptographically independent (not merely
 * separated by AAD).
 */
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8Encode } from "./cryptoPrimitives.js";

/** Cryptographic purposes that get their own derived key. */
export type KeyPurpose = "content" | "settings" | "secrets" | "manifest";

const DOMAIN: Record<KeyPurpose, string> = {
  content: "plainva/e2e/content/v1",
  settings: "plainva/e2e/settings/v1",
  secrets: "plainva/e2e/secrets/v1",
  manifest: "plainva/e2e/manifest/v1",
};

/** Derives the 32-byte subkey for `purpose` from the master key (HKDF-SHA256). */
export function deriveSubkey(masterKey: Uint8Array, purpose: KeyPurpose): Uint8Array {
  // MK is already uniformly random, but the full extract-then-expand keeps a
  // clean, standard HKDF with a fixed empty salt and the domain as info.
  return hkdf(sha256, masterKey, undefined, utf8Encode(DOMAIN[purpose]), 32);
}
