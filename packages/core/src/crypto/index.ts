/**
 * Crypto foundation for the settings-sync + encryption feature (P0). All parts
 * build on WebCrypto (random) + `@noble/hashes` (Argon2id) + `@noble/ciphers`
 * (XChaCha20-Poly1305), run identically in Node (tests), the Tauri WebView and
 * the Capacitor WebView, and never log secrets.
 */
export * from "./cryptoPrimitives.js";
export * from "./kdf.js";
export * from "./aead.js";
export * from "./keyfile.js";
export * from "./sealedBlob.js";
