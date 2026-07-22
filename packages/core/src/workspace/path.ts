import { hasControlCharacters, hasUnpairedSurrogate, utf8Encode } from "./encoding.js";
import { MAX_VAULT_PATH_BYTES, MAX_VAULT_SEGMENT_BYTES } from "./constants.js";
import { protocolAssert } from "./errors.js";

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const RESERVED_CHARS = /[<>:"|?*\\]/;

/** Normalises a user path for creation and rejects cross-platform ambiguities. */
export function normalizeVaultPath(input: string): string {
  protocolAssert(typeof input === "string" && input.length > 0, "format", "vault path is empty");
  protocolAssert(!hasUnpairedSurrogate(input), "format", "vault path contains an unpaired surrogate");
  const path = input.normalize("NFC");
  protocolAssert(!path.startsWith("/") && !path.endsWith("/"), "format", "vault path must be relative");
  protocolAssert(!RESERVED_CHARS.test(path) && !hasControlCharacters(path), "format", "vault path contains a reserved character");
  protocolAssert(utf8Encode(path).length <= MAX_VAULT_PATH_BYTES, "bounds", "vault path is too long");
  const segments = path.split("/");
  protocolAssert(segments[0].toLowerCase() !== ".pvws", "format", "vault path uses the reserved workspace namespace");
  for (const segment of segments) {
    protocolAssert(segment.length > 0 && segment !== "." && segment !== "..", "format", "vault path contains an invalid segment");
    protocolAssert(!segment.endsWith(" ") && !segment.endsWith("."), "format", "vault path segment has an unsafe suffix");
    protocolAssert(!WINDOWS_RESERVED.test(segment), "format", "vault path uses a reserved device name");
    const byteLength = utf8Encode(segment).length;
    protocolAssert(byteLength >= 1 && byteLength <= MAX_VAULT_SEGMENT_BYTES, "bounds", "vault path segment is too long");
  }
  return path;
}

/** Requires that a path was already encoded in its canonical NFC form. */
export function assertCanonicalVaultPath(input: string): string {
  const normalized = normalizeVaultPath(input);
  protocolAssert(normalized === input, "canonical", "vault path is not NFC-canonical");
  return input;
}

const OBJECT_KEY = /^\.pvws\/[a-z0-9][a-z0-9._/-]*$/;

export function assertWorkspaceObjectKey(key: string): string {
  protocolAssert(typeof key === "string" && key.length <= 1024, "bounds", "workspace object key is too long");
  protocolAssert(OBJECT_KEY.test(key), "format", "invalid workspace object key");
  protocolAssert(!key.includes("//") && !key.split("/").some((part) => part === "." || part === ".."), "format", "invalid workspace object key segment");
  return key;
}
