import { describe, it, expect } from "vitest";
import {
  aeadDecrypt,
  aeadEncrypt,
  aeadNonce,
  addRotationKey,
  BlobFormatError,
  changePassphrase,
  createKeyfile,
  deriveKek,
  deriveSubkey,
  dropKey,
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
  readU64BE,
  sealBlob,
  toBase32Groups,
  toBase64,
  toHex,
  unlockAllKeys,
  unlockKeyfile,
  utf8Decode,
  utf8Encode,
  validateKdfParams,
  writeU64BE,
  WrongPassphraseError,
  type MasterKeyBundle,
} from "../src/crypto/index.js";

const FAST_KDF = { algo: "scrypt", N: 16, r: 1, p: 1 } as const;

describe("crypto primitives", () => {
  it("round-trips hex, base64, base32 and utf8", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 128, 64]);
    expect(fromHex(toHex(bytes))).toEqual(bytes);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
    const b32 = new Uint8Array(41).map((_, i) => (i * 37) & 0xff);
    expect(fromBase32Groups(toBase32Groups(b32).toLowerCase().replace(/-/g, " "))).toEqual(b32);
    const text = "hello — wörld ✓";
    expect(utf8Decode(utf8Encode(text))).toBe(text);
  });

  it("round-trips big-endian u64 including large sizes", () => {
    for (const n of [0, 1, 255, 256, 65535, 16777216, 4294967295, 4294967296, 123456789012345]) {
      expect(readU64BE(writeU64BE(n), 0)).toBe(n);
    }
  });
});

describe("kdf (scrypt default)", () => {
  it("matches the pinned golden vector", async () => {
    const key = await deriveKek("correct horse battery staple", utf8Encode("plainva-salt-0001"), FAST_KDF);
    expect(toHex(key)).toBe("d666efb626705c96e3888a057e7f52f56681b74d6e9c2dcd4348350a79337ff7");
  });

  it("is deterministic, salt-sensitive and NFC-normalized", async () => {
    const a = await deriveKek("pw", utf8Encode("saltAAAAAAAAAAAA"), FAST_KDF);
    const b = await deriveKek("pw", utf8Encode("saltAAAAAAAAAAAA"), FAST_KDF);
    const c = await deriveKek("pw", utf8Encode("saltBBBBBBBBBBBB"), FAST_KDF);
    expect(toHex(a)).toBe(toHex(b));
    expect(toHex(a)).not.toBe(toHex(c));
    const salt = utf8Encode("saltAAAAAAAAAAAA");
    const decomposed = "cafe" + String.fromCharCode(0x0301); // NFD: e + combining acute
    const composed = "caf" + String.fromCharCode(0x00e9); // NFC: precomposed é // é precomposed (NFC)
    expect(decomposed).not.toBe(composed);
    expect(toHex(await deriveKek(decomposed, salt, FAST_KDF))).toBe(toHex(await deriveKek(composed, salt, FAST_KDF)));
  });

  it("rejects DoS / invalid params before allocation", () => {
    expect(() => validateKdfParams({ algo: "scrypt", N: 3, r: 8, p: 1 })).toThrow(); // not power of two
    expect(() => validateKdfParams({ algo: "scrypt", N: 1 << 24, r: 32, p: 1 })).toThrow(); // memory budget
    expect(() => validateKdfParams({ algo: "argon2id", m: 4, t: 3, p: 1 })).toThrow();
    expect(() => validateKdfParams(FAST_KDF)).not.toThrow();
  });

  it("supports argon2id as an optional algorithm", async () => {
    const key = await deriveKek("pw", utf8Encode("saltAAAAAAAAAAAA"), { algo: "argon2id", m: 8, t: 1, p: 1 });
    expect(key.length).toBe(32);
  });
});

describe("hkdf subkeys", () => {
  it("derives distinct 32-byte subkeys per purpose, deterministically", () => {
    const mk = new Uint8Array(32).fill(5);
    const content = deriveSubkey(mk, "content");
    const settings = deriveSubkey(mk, "settings");
    expect(content.length).toBe(32);
    expect(toHex(content)).toBe(toHex(deriveSubkey(mk, "content")));
    expect(toHex(content)).not.toBe(toHex(settings));
    expect(toHex(content)).not.toBe(toHex(new Uint8Array(32).fill(5))); // not the raw MK
  });
});

describe("aead (XChaCha20-Poly1305, explicit nonce)", () => {
  it("round-trips and fails on wrong AAD/key/tamper", () => {
    const key = new Uint8Array(32).fill(7);
    const nonce = aeadNonce();
    const ct = aeadEncrypt(key, nonce, utf8Encode("secret"), utf8Encode("aad"));
    expect(utf8Decode(aeadDecrypt(key, nonce, ct, utf8Encode("aad")))).toBe("secret");
    expect(() => aeadDecrypt(key, nonce, ct, utf8Encode("other"))).toThrow();
    expect(() => aeadDecrypt(new Uint8Array(32).fill(8), nonce, ct, utf8Encode("aad"))).toThrow();
    const t = ct.slice();
    t[0] ^= 1;
    expect(() => aeadDecrypt(key, nonce, t, utf8Encode("aad"))).toThrow();
  });
});

describe("keyfile", () => {
  it("creates, validates and unlocks with the correct passphrase", async () => {
    const { keyfile, bundle } = await createKeyfile("hunter2", { params: FAST_KDF, createdAt: "2026-07-21T00:00:00Z" });
    expect(isKeyfile(keyfile)).toBe(true);
    expect(keyfile.keys).toHaveLength(1);
    expect(keyfile.activeKeyId).toBe(bundle.keyId);
    const unlocked = await unlockKeyfile(keyfile, "hunter2");
    expect(toHex(unlocked.masterKey)).toBe(toHex(bundle.masterKey));
  });

  it("rejects a wrong passphrase via the verifier", async () => {
    const { keyfile } = await createKeyfile("right", { params: FAST_KDF });
    await expect(unlockKeyfile(keyfile, "wrong")).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it("changePassphrase re-wraps all keys, old passphrase stops working", async () => {
    const { keyfile, bundle } = await createKeyfile("old", { params: FAST_KDF });
    const changed = await changePassphrase(keyfile, "old", "new", { params: FAST_KDF });
    expect(changed.activeKeyId).toBe(keyfile.activeKeyId);
    await expect(unlockKeyfile(changed, "old")).rejects.toBeInstanceOf(WrongPassphraseError);
    expect(toHex((await unlockKeyfile(changed, "new")).masterKey)).toBe(toHex(bundle.masterKey));
    expect(changed.kdf.salt).not.toBe(keyfile.kdf.salt);
  });

  it("rotation: adds a new active key, keeps both unlockable, then drops the old", async () => {
    const { keyfile, bundle } = await createKeyfile("pw", { params: FAST_KDF });
    const { keyfile: rotating, newBundle } = await addRotationKey(keyfile, "pw");
    expect(rotating.keys).toHaveLength(2);
    expect(rotating.activeKeyId).toBe(newBundle.keyId);
    const all = await unlockAllKeys(rotating, "pw");
    expect(toHex(all.get(bundle.keyId)!.masterKey)).toBe(toHex(bundle.masterKey));
    expect(toHex(all.get(newBundle.keyId)!.masterKey)).toBe(toHex(newBundle.masterKey));
    const done = dropKey(rotating, newBundle.keyId);
    expect(done.keys).toHaveLength(1);
    expect(done.keys[0].keyId).toBe(newBundle.keyId);
  });

  it("recovery code reconstructs the identity, rejects a typo, and can re-key", async () => {
    const { keyfile, bundle } = await createKeyfile("forgotten", { params: FAST_KDF });
    const code = exportRecoveryCode(bundle);
    const recovered = parseRecoveryCode(code);
    expect(recovered.keyId).toBe(bundle.keyId);
    expect(toHex(recovered.masterKey)).toBe(toHex(bundle.masterKey));
    // A single flipped character trips the checksum.
    const idx = code.search(/[A-Z2-7]/);
    const flipped = code.slice(0, idx) + (code[idx] === "A" ? "B" : "A") + code.slice(idx + 1);
    if (flipped !== code) expect(() => parseRecoveryCode(flipped)).toThrow();
    const rekeyed = await createKeyfile("brand-new", { params: FAST_KDF, identity: recovered });
    expect(rekeyed.keyfile.activeKeyId).toBe(keyfile.activeKeyId);
    expect(toHex((await unlockKeyfile(rekeyed.keyfile, "brand-new")).masterKey)).toBe(toHex(bundle.masterKey));
  });
});

describe("sealed blob (PVE1 v3 frame)", () => {
  const bundleA: MasterKeyBundle = { keyId: "0011223344556677", masterKey: new Uint8Array(32).fill(9) };
  const bundleB: MasterKeyBundle = { keyId: "aabbccddeeff0011", masterKey: new Uint8Array(32).fill(3) };

  it("seals and opens with matching purpose", () => {
    const blob = sealBlob(bundleA, utf8Encode("note body"), "content");
    expect(isSealedBlob(blob)).toBe(true);
    expect(readBlobKeyId(blob)).toBe("0011223344556677");
    expect(utf8Decode(openBlob(bundleA, blob, "content"))).toBe("note body");
  });

  it("purpose is cryptographically separated (content blob != settings)", () => {
    const blob = sealBlob(bundleA, utf8Encode("x"), "secrets");
    expect(() => openBlob(bundleA, blob, "content")).toThrow(BlobFormatError);
  });

  it("detects a different key as ForeignKeyError", () => {
    const blob = sealBlob(bundleB, utf8Encode("x"), "content");
    expect(() => openBlob(bundleA, blob, "content")).toThrow(ForeignKeyError);
  });

  it("treats plaintext as NotSealedError", () => {
    const plaintext = utf8Encode("# a plain markdown note");
    expect(isSealedBlob(plaintext)).toBe(false);
    expect(readBlobKeyId(plaintext)).toBeNull();
    expect(() => openBlob(bundleA, plaintext, "content")).toThrow(NotSealedError);
  });

  it("rejects tamper and malformed frames", () => {
    const blob = sealBlob(bundleA, utf8Encode("payload"), "content");
    const t = blob.slice();
    t[t.length - 1] ^= 1;
    expect(() => openBlob(bundleA, t, "content")).toThrow();
    // A PVE1 magic with garbage header is a format error, not a silent success.
    const garbage = new Uint8Array(40);
    garbage.set(utf8Encode("PVE1"), 0);
    expect(() => openBlob(bundleA, garbage, "content")).toThrow(BlobFormatError);
  });

  it("round-trips binary content of any byte value", () => {
    const binary = new Uint8Array(2000).map((_, i) => (i * 131) & 0xff);
    const blob = sealBlob(bundleA, binary, "content");
    expect(openBlob(bundleA, blob, "content")).toEqual(binary);
  });
});
