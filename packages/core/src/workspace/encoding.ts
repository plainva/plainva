import { sha256 } from "@noble/hashes/sha2.js";
import {
  bytesEqual,
  fromBase64,
  fromHex,
  toBase64,
  toHex,
  utf8Encode,
} from "../crypto/cryptoPrimitives.js";
import { WORKSPACE_HASH_BYTES, WORKSPACE_ID_BYTES } from "./constants.js";
import { protocolAssert, WorkspaceProtocolError } from "./errors.js";

const fatalUtf8Decoder = new TextDecoder("utf-8", { fatal: true });
const ID_HEX = /^[0-9a-f]{32}$/;
const HASH_HEX = /^[0-9a-f]{64}$/;

export { bytesEqual, fromBase64, fromHex, toBase64, toHex, utf8Encode };

export function utf8DecodeFatal(bytes: Uint8Array): string {
  try {
    return fatalUtf8Decoder.decode(bytes);
  } catch (cause) {
    throw new WorkspaceProtocolError("format", "invalid UTF-8", { cause });
  }
}

export function sha256Bytes(bytes: Uint8Array): Uint8Array {
  return sha256(bytes);
}

export function sha256Hex(bytes: Uint8Array): string {
  return toHex(sha256Bytes(bytes));
}

export function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

export function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

export function assertWorkspaceId(value: string, label = "identifier"): string {
  protocolAssert(ID_HEX.test(value), "format", `${label} must be 16-byte lowercase hex`);
  return value;
}

export function assertWorkspaceHash(value: string, label = "hash"): string {
  protocolAssert(HASH_HEX.test(value), "format", `${label} must be SHA-256 lowercase hex`);
  return value;
}

export function idBytes(value: string, label = "identifier"): Uint8Array {
  assertWorkspaceId(value, label);
  const bytes = fromHex(value);
  protocolAssert(bytes.length === WORKSPACE_ID_BYTES, "format", `${label} has wrong length`);
  return bytes;
}

export function hashBytes(value: string, label = "hash"): Uint8Array {
  assertWorkspaceHash(value, label);
  const bytes = fromHex(value);
  protocolAssert(bytes.length === WORKSPACE_HASH_BYTES, "format", `${label} has wrong length`);
  return bytes;
}

export function decodeBase64Exact(value: string, length: number, label: string): Uint8Array {
  protocolAssert(typeof value === "string" && value.length <= Math.ceil(length / 3) * 4 + 4, "bounds", `${label} is too large`);
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(value);
  } catch (cause) {
    throw new WorkspaceProtocolError("format", `${label} is invalid base64`, { cause });
  }
  protocolAssert(bytes.length === length, "format", `${label} has wrong length`);
  protocolAssert(toBase64(bytes) === value, "canonical", `${label} is not canonical base64`);
  return bytes;
}

export function assertSafeInteger(value: unknown, min: number, max: number, label: string): number {
  protocolAssert(typeof value === "number" && Number.isSafeInteger(value), "format", `${label} must be a safe integer`);
  protocolAssert(value >= min && value <= max, "bounds", `${label} is out of range`);
  return value;
}

export function assertExactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  protocolAssert(actual.length === expected.length && actual.every((key, index) => key === expected[index]), "format", `${label} has unknown or missing fields`);
}

export function asRecord(value: unknown, label: string): Record<string, unknown> {
  protocolAssert(value !== null && typeof value === "object" && !Array.isArray(value), "format", `${label} must be an object`);
  return value as Record<string, unknown>;
}

export function asArray(value: unknown, max: number, label: string): unknown[] {
  protocolAssert(Array.isArray(value), "format", `${label} must be an array`);
  protocolAssert(value.length <= max, "bounds", `${label} has too many entries`);
  return value;
}
