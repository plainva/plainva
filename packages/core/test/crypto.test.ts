import { describe, it, expect } from "vitest";
import {
  aeadDecrypt,
  aeadEncrypt,
  changePassphrase,
  createKeyfile,
  deriveKek,
  exportRecoveryCode,
  ForeignKeyError,
  fromBase32Groups,
  fromBase64,
  fromHex,
  isKeyfile,
  isSealedBlob,
  NotSealedError,
  openBlob,
  parseRecoveryCode,
  readBlobKeyId,
  sealBlob,
  toBase32Groups,
  toBase64,
  toHex,
  unlockKeyfile,
  utf8Decode,
  utf8Encode,
  WrongPassphraseError,
  type MasterKeyBundle,
} from "../src/crypto/index.js";

const FAST_PARAMS = { algo: "argon2id", m: 8, t: 1, p: 1 } as const;

describe("crypto primitives", () => {
  it("round-trips hex, base64 and utf8", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 128, 64]);
    expect(fromHex(toHex(bytes))).toEqual(bytes);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
    const text = "hello — wörld ✓";
    expect(utf8Decode(utf8Encode(text))).toBe(text);
  });

  it("round-trips base32 groups and ignores dashes/case", () => {
    const bytes = new Uint8Array(40).map((_, i) => (i * 37) & 0xff);
    const code = toBase32Groups(bytes);
    expect(code).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{1,4})*$/);
    expect(fromBase32Groups(code)).toEqual(bytes);
    expect(fromBase32Groups(code.toLowerCase().replace(/-/g, " "))).toEqual(bytes);
  });

  it("base64 is byte-safe for high bytes", () => {
    const bytes = new Uint8Array(256).map((_, i) => i);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });
});

describe("kdf (Argon2id)", () => {
  it("matches the pinned golden vector", async () => {
    const key = await deriveKek("correct horse battery staple", utf8Encode("plainva-salt-0001"), FAST_PARAMS);
    expect(toHex(key)).toBe("fa8868ac83b22dc1623becfefdd2ca1be0da771157b254997ccd052f8d288af8");
  });

  it("is deterministic and salt-sensitive", async () => {
    const a = await deriveKek("pw", utf8Encode("saltAAAAAAAAAAAA"), FAST_PARAMS);
    const b = await deriveKek("pw", utf8Encode("saltAAAAAAAAAAAA"), FAST_PARAMS);
    const c = await deriveKek("pw", utf8Encode("saltBBBBBBBBBBBB"), FAST_PARAMS);
    expect(toHex(a)).toBe(toHex(b));
    expect(toHex(a)).not.toBe(toHex(c));
    expect(a.length).toBe(32);
  });

  it("NFC-normalizes the passphrase (composed == decomposed)", async () => {
    const salt = utf8Encode("saltAAAAAAAAAAAA");
    const decomposed = "café"; // e + U+0301 combining acute (NFD)
    const composed = "café"; // é (NFC)
    expect(decomposed).not.toBe(composed); // genuinely different byte sequences
    const a = await deriveKek(decomposed, salt, FAST_PARAMS);
    const b = await deriveKek(composed, salt, FAST_PARAMS);
    expect(toHex(a)).toBe(toHex(b));
  });
});

describe("aead (XChaCha20-Poly1305)", () => {
  it("round-trips with matching AAD", () => {
    const key = new Uint8Array(32).fill(7);
    const pt = utf8Encode("secret payload");
    const aad = utf8Encode("purpose-x");
    const sealed = aeadEncrypt(key, pt, aad);
    expect(sealed.nonce.length).toBe(24);
    expect(utf8Decode(aeadDecrypt(key, sealed.nonce, sealed.ciphertext, aad))).toBe("secret payload");
  });

  it("fails on wrong AAD, wrong key, or tampered ciphertext", () => {
    const key = new Uint8Array(32).fill(7);
    const sealed = aeadEncrypt(key, utf8Encode("x"), utf8Encode("aad"));
    expect(() => aeadDecrypt(key, sealed.nonce, sealed.ciphertext, utf8Encode("other"))).toThrow();
    expect(() => aeadDecrypt(new Uint8Array(32).fill(8), sealed.nonce, sealed.ciphertext, utf8Encode("aad"))).toThrow();
    const tampered = sealed.ciphertext.slice();
    tampered[0] ^= 1;
    expect(() => aeadDecrypt(key, sealed.nonce, tampered, utf8Encode("aad"))).toThrow();
  });

  it("uses a fresh nonce each call (semantic security)", () => {
    const key = new Uint8Array(32).fill(1);
    const a = aeadEncrypt(key, utf8Encode("same"));
    const b = aeadEncrypt(key, utf8Encode("same"));
    expect(toHex(a.nonce)).not.toBe(toHex(b.nonce));
    expect(toHex(a.ciphertext)).not.toBe(toHex(b.ciphertext));
  });
});

describe("keyfile", () => {
  it("creates, validates and unlocks with the correct passphrase", async () => {
    const { keyfile, bundle } = await createKeyfile("hunter2", { params: FAST_PARAMS, createdAt: "2026-07-21T00:00:00Z" });
    expect(isKeyfile(keyfile)).toBe(true);
    expect(keyfile.createdAt).toBe("2026-07-21T00:00:00Z");
    expect(fromBase64(keyfile.kdf.salt).length).toBe(16);
    const unlocked = await unlockKeyfile(keyfile, "hunter2");
    expect(unlocked.keyId).toBe(bundle.keyId);
    expect(toHex(unlocked.masterKey)).toBe(toHex(bundle.masterKey));
  });

  it("rejects a wrong passphrase with WrongPassphraseError", async () => {
    const { keyfile } = await createKeyfile("right", { params: FAST_PARAMS });
    await expect(unlockKeyfile(keyfile, "wrong")).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it("changePassphrase keeps identity, old passphrase stops working", async () => {
    const { keyfile, bundle } = await createKeyfile("old", { params: FAST_PARAMS });
    const changed = await changePassphrase(bundle, "new", { params: FAST_PARAMS });
    expect(changed.keyfile.keyId).toBe(keyfile.keyId);
    expect(toHex(changed.bundle.masterKey)).toBe(toHex(bundle.masterKey));
    await expect(unlockKeyfile(changed.keyfile, "old")).rejects.toBeInstanceOf(WrongPassphraseError);
    const unlocked = await unlockKeyfile(changed.keyfile, "new");
    expect(toHex(unlocked.masterKey)).toBe(toHex(bundle.masterKey));
    expect(changed.keyfile.kdf.salt).not.toBe(keyfile.kdf.salt);
  });

  it("recovery code reconstructs the identity and can re-key", async () => {
    const { keyfile, bundle } = await createKeyfile("forgotten-later", { params: FAST_PARAMS });
    const code = exportRecoveryCode(bundle);
    const recovered = parseRecoveryCode(code);
    expect(recovered.keyId).toBe(bundle.keyId);
    expect(toHex(recovered.masterKey)).toBe(toHex(bundle.masterKey));
    const rekeyed = await createKeyfile("brand-new", { params: FAST_PARAMS, identity: recovered });
    expect(rekeyed.keyfile.keyId).toBe(keyfile.keyId);
    const unlocked = await unlockKeyfile(rekeyed.keyfile, "brand-new");
    expect(toHex(unlocked.masterKey)).toBe(toHex(bundle.masterKey));
  });

  it("parseRecoveryCode rejects malformed input", () => {
    expect(() => parseRecoveryCode("TOO-SHORT")).toThrow();
  });
});

describe("sealed blob (PVE1)", () => {
  const bundleA: MasterKeyBundle = { keyId: "0011223344556677", masterKey: new Uint8Array(32).fill(9) };
  const bundleB: MasterKeyBundle = { keyId: "aabbccddeeff0011", masterKey: new Uint8Array(32).fill(3) };

  it("seals and opens with matching purpose", () => {
    const blob = sealBlob(bundleA, utf8Encode("note body"), "vault-file");
    expect(isSealedBlob(blob)).toBe(true);
    expect(readBlobKeyId(blob)).toBe("0011223344556677");
    expect(utf8Decode(openBlob(bundleA, blob, "vault-file"))).toBe("note body");
  });

  it("fails to open with a different purpose", () => {
    const blob = sealBlob(bundleA, utf8Encode("x"), "secrets-bundle");
    expect(() => openBlob(bundleA, blob, "vault-file")).toThrow();
  });

  it("detects a blob from a different key as ForeignKeyError", () => {
    const blob = sealBlob(bundleB, utf8Encode("x"), "vault-file");
    expect(readBlobKeyId(blob)).toBe("aabbccddeeff0011");
    expect(() => openBlob(bundleA, blob, "vault-file")).toThrow(ForeignKeyError);
  });

  it("treats plaintext as NotSealedError and detects magic", () => {
    const plaintext = utf8Encode("# a plain markdown note");
    expect(isSealedBlob(plaintext)).toBe(false);
    expect(readBlobKeyId(plaintext)).toBeNull();
    expect(() => openBlob(bundleA, plaintext, "vault-file")).toThrow(NotSealedError);
  });

  it("rejects a tampered blob", () => {
    const blob = sealBlob(bundleA, utf8Encode("payload"), "vault-file");
    blob[blob.length - 1] ^= 1;
    expect(() => openBlob(bundleA, blob, "vault-file")).toThrow();
  });

  it("round-trips binary content of any byte value", () => {
    const binary = new Uint8Array(1000).map((_, i) => (i * 131) & 0xff);
    const blob = sealBlob(bundleA, binary, "vault-file");
    expect(openBlob(bundleA, blob, "vault-file")).toEqual(binary);
  });
});
