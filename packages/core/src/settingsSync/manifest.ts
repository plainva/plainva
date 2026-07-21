/**
 * E2E connection manifest `.plainva/sync/encryption.json` (v3 §3.5). The single
 * remote control document for content encryption on ONE sync connection. It is
 * human-readable canonical JSON whose HMAC-SHA256 (keyed by the manifest subkey)
 * authenticates every field after unlock. Its mere presence never implies
 * content-E2E — the `state` does. An authenticated `plain` is the terminal
 * deactivation tombstone so other devices never have to guess a vanished
 * manifest.
 *
 * The parse path is key-free (for the pre-unlock guard read); verification needs
 * the master key (K_manifest via HKDF).
 */
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesEqual, toBase64, utf8Encode } from "../crypto/cryptoPrimitives.js";
import { deriveSubkey } from "../crypto/hkdf.js";
import type { MasterKeyBundle } from "../crypto/keyfile.js";
import { canonicalJson } from "./canonicalJson.js";

/** Content-E2E lifecycle states (v3). */
export type EncryptionState = "preparing" | "migrating" | "strict" | "decrypting" | "rotating" | "plain";

/** The authenticated manifest body (everything except the MAC). */
export interface ManifestBody {
  formatVersion: 1;
  /** Minimum guard/app version required to participate safely. */
  minGuardVersion: number;
  /** Stable id of this E2E connection (provider + remote root). */
  connectionId: string;
  /** Active key id (the MK whose content subkey encrypts new writes). */
  keyId: string;
  /** During rotation, the incoming key id. */
  newKeyId?: string;
  state: EncryptionState;
  /** Device that owns the current sweep/lease (empty in steady state). */
  ownerDeviceId: string;
  /** Epoch ms until which the owner lease is valid. */
  ownerLeaseUntil: number;
  /** Monotonic counter: a new activation/deactivation must raise it. */
  generation: number;
  createdAt: string;
  updatedAt: string;
}

/** The manifest as stored (body + base64 HMAC). */
export interface Manifest extends ManifestBody {
  mac: string;
}

export class ManifestError extends Error {
  constructor(message: string) {
    super(`invalid encryption manifest: ${message}`);
    this.name = "ManifestError";
  }
}

/** States in which the connection's content is (or is becoming) ciphertext. */
export function isEncryptedState(state: EncryptionState): boolean {
  return state === "preparing" || state === "migrating" || state === "strict" || state === "rotating";
}

/** States that tolerate a mix of plaintext and valid ciphertext during a sweep. */
export function allowsMixed(state: EncryptionState): boolean {
  return state === "migrating" || state === "decrypting" || state === "rotating";
}

/** The strict state accepts ONLY valid ciphertext for the active key. */
export function isStrict(state: EncryptionState): boolean {
  return state === "strict";
}

function macFor(bundle: MasterKeyBundle, body: ManifestBody): Uint8Array {
  const kManifest = deriveSubkey(bundle.masterKey, "manifest");
  return hmac(sha256, kManifest, utf8Encode(canonicalJson(body as unknown as Record<string, unknown>)));
}

/** Produces a signed manifest from a body (attaches the HMAC). */
export function signManifest(bundle: MasterKeyBundle, body: ManifestBody): Manifest {
  if (body.keyId !== bundle.keyId) throw new ManifestError("manifest keyId does not match the signing key");
  return { ...body, mac: toBase64(macFor(bundle, body)) };
}

/** Validates the SHAPE of a parsed manifest object without a key (guard pre-read). */
export function parseManifest(value: unknown): Manifest | null {
  const m = value as Manifest | null;
  const states: EncryptionState[] = ["preparing", "migrating", "strict", "decrypting", "rotating", "plain"];
  if (
    !m ||
    m.formatVersion !== 1 ||
    typeof m.minGuardVersion !== "number" ||
    typeof m.connectionId !== "string" ||
    typeof m.keyId !== "string" ||
    !states.includes(m.state) ||
    typeof m.ownerDeviceId !== "string" ||
    typeof m.ownerLeaseUntil !== "number" ||
    typeof m.generation !== "number" ||
    typeof m.mac !== "string"
  ) {
    return null;
  }
  return m;
}

/** Verifies a manifest's MAC with the master key; returns the body or throws. */
export function verifyManifest(bundle: MasterKeyBundle, manifest: Manifest): ManifestBody {
  const { mac, ...body } = manifest;
  const expected = macFor(bundle, body as ManifestBody);
  let provided: Uint8Array;
  try {
    provided = new Uint8Array(atob(mac).split("").map((c) => c.charCodeAt(0)));
  } catch {
    throw new ManifestError("mac is not valid base64");
  }
  if (!bytesEqual(expected, provided)) throw new ManifestError("manifest MAC does not verify");
  return body as ManifestBody;
}
