import { ed25519 } from "@noble/curves/ed25519.js";
import { blake2b } from "@noble/hashes/blake2.js";
import { concatBytes, fromBase64, randomBytes, toBase64, toHex, utf8Encode } from "../../crypto/cryptoPrimitives.js";
import { sha256Hex } from "../../workspace/encoding.js";
import { SCRIPT_SIGNATURE_FILE } from "./manifest.js";

/**
 * What a script is, in one line of bytes — and who vouches for it (ADR 0020
 * decision 6, plan KI-Harness P5.5).
 *
 * The **seal** lists every file of a script with its SHA-256, in a fixed
 * form. Two signatures can stand on it:
 *
 * - a **publisher's**, in the script's own folder (`signature`): made with
 *   the key the app's updates are signed with, in minisign's format. It says
 *   where a script comes from. It never makes a script run.
 * - **this device's**, kept with the approval in the app's data: made when
 *   the user approves the script here, with a key that lives in the device's
 *   keychain. It is what a run checks before the engine is started — so an
 *   approval copied from another device, or written into the app's data by
 *   whoever could, approves nothing.
 *
 * No script runs without a manifest and a valid signature of this device.
 */

const SEAL_HEAD = "plainva-script-seal v1";

/** The seal: one line per file, in path order — the publisher's signature itself is not part of what it signs. */
export function scriptSeal(files: readonly { path: string; sha256: string }[]): Uint8Array {
  const lines = files
    .filter((file) => file.path !== SCRIPT_SIGNATURE_FILE)
    .map((file) => [file.path, file.sha256] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    // As JSON, so that no name of a file can pass for the end of a line.
    .map((entry) => JSON.stringify(entry));
  return utf8Encode([SEAL_HEAD, ...lines, ""].join("\n"));
}

/** A seal's own hash — how an approval names what it approved. */
export function sealHash(seal: Uint8Array): string {
  return sha256Hex(seal);
}

// --- a publisher's signature (minisign) ------------------------------------------------------

export interface PublisherKey {
  /** Who this is, as the workshop names it. */
  label: string;
  /** The eight bytes minisign names a key by. */
  keyId: Uint8Array;
  publicKey: Uint8Array;
}

/**
 * The publishers this app knows: the key its own updates are signed with
 * (`plugins.updater.pubkey` of the desktop app; a test holds the two
 * together). A script signed by nobody on this list is still a script — its
 * signature just says nothing here.
 */
export const SCRIPT_PUBLISHER_KEYS: readonly { label: string; key: string }[] = [{ label: "Plainva", key: "RWR2RpNwIsg3MjnBLorVkoBGerKOy5mC+k5YERe8LHJH7YyhsZCIRewR" }];

const decoder = new TextDecoder("utf-8", { fatal: false });
const BASE64_LINE = /^[A-Za-z0-9+/]+={0,2}$/;

function decodeBase64(text: string): Uint8Array | null {
  const value = text.trim();
  if (!value || value.length % 4 !== 0 || !BASE64_LINE.test(value)) return null;
  try {
    return fromBase64(value);
  } catch {
    return null;
  }
}

/** Text that is either minisign's own lines or — as the app's release tooling writes it — base64 of them. */
function minisignLines(text: string): string[] {
  let source = text;
  if (!source.includes("comment:")) {
    const decoded = decodeBase64(source.replace(/\s+/g, ""));
    const inner = decoded ? decoder.decode(decoded) : "";
    // A bare key is base64 as well: only what decodes to minisign's lines is taken as them.
    if (inner.includes("comment:")) source = inner;
  }
  return source
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}

/** A minisign public key: its one base64 line, the two-line file, or base64 of that file. */
export function readPublisherKey(label: string, text: string): PublisherKey | null {
  const lines = minisignLines(text);
  const raw = decodeBase64(lines[lines.length - 1] ?? "");
  if (!raw || raw.length !== 42 || raw[0] !== 0x45 || raw[1] !== 0x64) return null;
  return { label, keyId: raw.slice(2, 10), publicKey: raw.slice(10) };
}

export function scriptPublishers(): PublisherKey[] {
  return SCRIPT_PUBLISHER_KEYS.flatMap((entry) => readPublisherKey(entry.label, entry.key) ?? []);
}

/** A key's id as minisign prints it. */
export function publisherKeyId(keyId: Uint8Array): string {
  return toHex(Uint8Array.from(keyId).reverse()).toUpperCase();
}

export type PublisherCheck =
  /** Signed by a publisher this app knows; the signature holds for this seal. */
  | { state: "valid"; publisher: string; keyId: string }
  /** A signature in the right form, made with a key this app does not know: it says nothing here. */
  | { state: "unknown-key"; keyId: string }
  /** No signature in minisign's form, or one of a known key that does not hold: the script was changed after it was signed. */
  | { state: "invalid" };

function verifyEd25519(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  if (publicKey.length !== 32 || signature.length !== 64) return false;
  try {
    return ed25519.verify(signature, message, publicKey, { zip215: false });
  } catch {
    return false;
  }
}

/**
 * Holds a publisher's signature against a seal. Both of minisign's forms are
 * read: `Ed` signs the bytes, `ED` their BLAKE2b-512 (what the release
 * tooling writes). The second signature — over the first and the trusted
 * comment — must hold as well, as minisign demands it.
 */
export function checkPublisherSignature(seal: Uint8Array, signatureText: string, publishers: readonly PublisherKey[] = scriptPublishers()): PublisherCheck {
  const lines = minisignLines(signatureText);
  const at = lines.findIndex((line) => line.startsWith("untrusted comment:"));
  const signatureLine = at >= 0 ? lines[at + 1] : undefined;
  const commentLine = at >= 0 ? lines[at + 2] : undefined;
  const globalLine = at >= 0 ? lines[at + 3] : undefined;
  const TRUSTED = "trusted comment: ";
  if (!signatureLine || !commentLine?.startsWith(TRUSTED) || !globalLine) return { state: "invalid" };
  const raw = decodeBase64(signatureLine);
  const global = decodeBase64(globalLine);
  if (!raw || raw.length !== 74 || !global || global.length !== 64 || raw[0] !== 0x45) return { state: "invalid" };
  const prehashed = raw[1] === 0x44;
  if (!prehashed && raw[1] !== 0x64) return { state: "invalid" };
  const keyId = raw.slice(2, 10);
  const signature = raw.slice(10);
  const publisher = publishers.find((candidate) => candidate.keyId.length === 8 && candidate.keyId.every((byte, index) => byte === keyId[index]));
  if (!publisher) return { state: "unknown-key", keyId: publisherKeyId(keyId) };
  const message = prehashed ? blake2b(seal, { dkLen: 64 }) : seal;
  if (!verifyEd25519(publisher.publicKey, message, signature)) return { state: "invalid" };
  if (!verifyEd25519(publisher.publicKey, concatBytes(signature, utf8Encode(commentLine.slice(TRUSTED.length))), global)) return { state: "invalid" };
  return { state: "valid", publisher: publisher.label, keyId: publisherKeyId(keyId) };
}

// --- this device's signature: the approval ---------------------------------------------------

/** The device's signing key as the keychain keeps it: the seed, base64. */
export interface DeviceScriptKey {
  seed: string;
}

export function newDeviceScriptKey(): DeviceScriptKey {
  return { seed: toBase64(randomBytes(32)) };
}

function seedOf(key: DeviceScriptKey): Uint8Array | null {
  const seed = decodeBase64(key.seed);
  return seed && seed.length === 32 ? seed : null;
}

/** The public half, base64; null for a key that is none. */
export function deviceScriptPublicKey(key: DeviceScriptKey): string | null {
  const seed = seedOf(key);
  return seed ? toBase64(new Uint8Array(ed25519.getPublicKey(seed))) : null;
}

/**
 * What the device signs: this script, in this vault, with this seal. The
 * vault and the script's id are part of it, so an approval moved to another
 * vault's file — or to another script of the same content — holds for nothing.
 */
function approvalMessage(vaultKey: string, id: string, seal: Uint8Array): Uint8Array {
  return utf8Encode(`plainva-script-approval v1\n${JSON.stringify([vaultKey, id, sealHash(seal)])}\n`);
}

/** Signs an approval; null where the key is none. */
export function signScriptApproval(key: DeviceScriptKey, vaultKey: string, id: string, seal: Uint8Array): string | null {
  const seed = seedOf(key);
  if (!seed) return null;
  return toBase64(new Uint8Array(ed25519.sign(approvalMessage(vaultKey, id, seal), seed)));
}

/** Whether an approval's signature is this device's, for this script as it is now. */
export function verifyScriptApproval(publicKey: string, vaultKey: string, id: string, seal: Uint8Array, signature: string): boolean {
  const key = decodeBase64(publicKey);
  const sig = decodeBase64(signature);
  if (!key || !sig) return false;
  return verifyEd25519(key, approvalMessage(vaultKey, id, seal), sig);
}
