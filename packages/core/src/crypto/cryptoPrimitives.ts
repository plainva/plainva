/**
 * Byte and encoding helpers shared by the Plainva crypto modules (settings-sync +
 * encryption plan, P0). Node-and-WebView-neutral: only WebCrypto `getRandomValues`
 * and the global `btoa`/`atob` (available in Tauri/Capacitor WebViews and Node ≥ 16).
 * No secrets are logged here.
 */

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** UTF-8 encode a string to bytes. */
export function utf8Encode(text: string): Uint8Array {
  return textEncoder.encode(text);
}

/** UTF-8 decode bytes to a string. */
export function utf8Decode(bytes: Uint8Array): string {
  return textDecoder.decode(bytes as BufferSource);
}

/** Cryptographically secure random bytes via WebCrypto. */
export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/** Concatenate byte arrays into one. */
export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Lowercase hex of bytes. */
export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/** Parse a hex string (even length) to bytes. */
export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("invalid hex length");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error("invalid hex");
    out[i] = byte;
  }
  return out;
}

/** Standard base64 of bytes (byte-safe, not the UTF-8 string btoa trap). */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Parse standard base64 to bytes. */
export function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Constant-time equality for two byte arrays (used for keyId / magic checks;
 * the AEAD tag itself is verified inside the cipher). Length difference returns
 * false immediately — the length is not secret.
 */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Best-effort zeroing of sensitive bytes (JS gives no hard guarantee). */
export function wipeBytes(bytes: Uint8Array): void {
  bytes.fill(0);
}

// RFC 4648 base32 (uppercase, no padding) — used for the human-writable recovery
// code. Chosen over base64 because the alphabet avoids look-alike characters and
// is case-insensitive on input.
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Encodes bytes as RFC 4648 base32, grouped into dash-separated 4-char blocks. */
export function toBase32Groups(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out.replace(/(.{4})/g, "$1-").replace(/-$/, "");
}

/** Parses a base32 string (dashes/spaces and case ignored) back to bytes. */
export function fromBase32Groups(code: string): Uint8Array {
  const clean = code.replace(/[\s-]/g, "").toUpperCase();
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error("invalid recovery code character");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}
