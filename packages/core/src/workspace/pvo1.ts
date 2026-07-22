import { sha256 } from "@noble/hashes/sha2.js";
import { aeadDecrypt, aeadEncrypt, aeadNonce } from "../crypto/aead.js";
import { concatBytes, randomBytes } from "../crypto/cryptoPrimitives.js";
import { canonicalJson } from "../settingsSync/canonicalJson.js";
import { BinaryReader, BinaryWriter } from "./binary.js";
import {
  DEFAULT_CHUNK_BYTES,
  HPKE_AEAD_CHACHA20_POLY1305,
  HPKE_ENCAPSULATED_KEY_BYTES,
  HPKE_KDF_HKDF_SHA256,
  HPKE_KEM_X25519_HKDF_SHA256,
  HPKE_WRAPPED_KEY_BYTES,
  MAX_CHUNKED_FRAME_BYTES,
  MAX_CHUNKS,
  MAX_CHUNK_BYTES,
  MAX_ENVELOPES,
  MAX_FILE_BYTES,
  MAX_INLINE_FRAME_BYTES,
  MAX_INLINE_PLAINTEXT_BYTES,
  MAX_MANIFEST_PLAINTEXT_BYTES,
  MAX_METADATA_PLAINTEXT_BYTES,
  PVC1_HEADER_BYTES,
  PVC1_MAGIC,
  PVO1_ENVELOPE_BYTES,
  PVO1_FLAG_CHUNKED,
  PVO1_HEADER_BYTES,
  PVO1_KNOWN_FLAGS,
  PVO1_MAGIC,
  WORKSPACE_ALGORITHM_SUITE,
  WORKSPACE_PROTOCOL_VERSION,
} from "./constants.js";
import {
  assertWorkspaceHash,
  assertWorkspaceId,
  bytesEqual,
  idBytes,
  sha256Bytes,
  sha256Hex,
  toHex,
  utf8DecodeFatal,
  utf8Encode,
} from "./encoding.js";
import {
  deriveWorkspaceSubkey,
  hpkeOpen,
  hpkeSeal,
  HpkeSealTestingOptions,
  randomWorkspaceKey,
  workspaceDomain,
} from "./crypto.js";
import { protocolAssert, WorkspaceProtocolError } from "./errors.js";
import { assertCanonicalVaultPath } from "./path.js";

export interface Pvo1ObjectMetadata {
  path: string;
  mime: string;
  parentObjectId: string | null;
  plaintextSha256: string;
  createdAt: string;
  modifiedAt: string;
  contentKind: "text" | "binary";
}

export type Pvo1ObjectMetadataInput = Omit<Pvo1ObjectMetadata, "plaintextSha256">;

export interface Pvo1Recipient {
  groupId: string;
  keyEpoch: number;
  publicKey: Uint8Array;
  keyHint?: Uint8Array;
  /** Deterministic RFC-9180 ephemeral key pair. Test vectors only. */
  hpkeTesting?: HpkeSealTestingOptions;
}

export interface Pvo1ReaderKey {
  groupId: string;
  keyEpoch: number;
  privateKey: Uint8Array;
}

export interface Pvo1Envelope {
  groupId: string;
  keyEpoch: number;
  keyHint: Uint8Array;
  enc: Uint8Array;
  ciphertext: Uint8Array;
}

export interface Pvo1ChunkReference {
  index: number;
  plaintextLength: number;
  sha256: string;
}

export interface Pvo1ChunkManifest {
  chunks: Pvo1ChunkReference[];
  totalPlaintextLength: number;
}

export interface ParsedPvo1Frame {
  workspaceId: string;
  objectId: string;
  revisionId: string;
  flags: number;
  chunkSize: number;
  chunkCount: number;
  plaintextLength: number;
  envelopes: Pvo1Envelope[];
  metadataBlock: Uint8Array;
  payloadBlock: Uint8Array;
  headerBytes: Uint8Array;
  envelopeBytes: Uint8Array;
}

export interface OpenedPvo1Frame extends ParsedPvo1Frame {
  dataKey: Uint8Array;
  metadata: Pvo1ObjectMetadata;
  plaintext?: Uint8Array;
  manifest?: Pvo1ChunkManifest;
}

export interface Pvo1SealTestingOptions {
  dataKey?: Uint8Array;
  metadataNonce?: Uint8Array;
  payloadNonce?: Uint8Array;
  chunkNonces?: Uint8Array[];
}

export interface SealedChunkedPvo1 {
  object: Uint8Array;
  chunks: Uint8Array[];
  manifest: Pvo1ChunkManifest;
}

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MIME = /^[\x20-\x7e]{0,255}$/;

function assertTimestamp(value: string, label: string): void {
  const parsed = Date.parse(value);
  protocolAssert(TIMESTAMP.test(value) && Number.isFinite(parsed) && new Date(parsed).toISOString() === value, "format", `${label} is not a canonical UTC timestamp`);
}

function validateMetadata(metadata: Pvo1ObjectMetadata): void {
  protocolAssert(metadata !== null && typeof metadata === "object", "format", "object metadata is invalid");
  protocolAssert(Object.keys(metadata).sort().join(",") === "contentKind,createdAt,mime,modifiedAt,parentObjectId,path,plaintextSha256", "format", "object metadata has unknown or missing fields");
  assertCanonicalVaultPath(metadata.path);
  protocolAssert(typeof metadata.mime === "string" && MIME.test(metadata.mime), "format", "metadata MIME hint is invalid");
  if (metadata.parentObjectId !== null) assertWorkspaceId(metadata.parentObjectId, "parentObjectId");
  assertWorkspaceHash(metadata.plaintextSha256, "plaintextSha256");
  assertTimestamp(metadata.createdAt, "createdAt");
  assertTimestamp(metadata.modifiedAt, "modifiedAt");
  protocolAssert(metadata.contentKind === "text" || metadata.contentKind === "binary", "format", "metadata contentKind is invalid");
}

function makeMetadata(input: Pvo1ObjectMetadataInput, plaintextSha256: string): Pvo1ObjectMetadata {
  const metadata: Pvo1ObjectMetadata = { ...input, plaintextSha256 };
  validateMetadata(metadata);
  return metadata;
}

function validateRecipient(recipient: Pvo1Recipient): void {
  assertWorkspaceId(recipient.groupId, "groupId");
  protocolAssert(Number.isInteger(recipient.keyEpoch) && recipient.keyEpoch >= 1 && recipient.keyEpoch <= 0xffffffff, "bounds", "key epoch is out of range");
  protocolAssert(recipient.publicKey.length === 32, "format", "recipient HPKE public key has wrong length");
  if (recipient.keyHint) protocolAssert(recipient.keyHint.length === 8, "format", "key hint has wrong length");
}

function compareEnvelopeKey(left: { groupId: string; keyEpoch: number; keyHint: Uint8Array }, right: { groupId: string; keyEpoch: number; keyHint: Uint8Array }): number {
  const group = left.groupId < right.groupId ? -1 : left.groupId > right.groupId ? 1 : 0;
  if (group !== 0) return group;
  if (left.keyEpoch !== right.keyEpoch) return left.keyEpoch - right.keyEpoch;
  const leftHint = toHex(left.keyHint);
  const rightHint = toHex(right.keyHint);
  return leftHint < rightHint ? -1 : leftHint > rightHint ? 1 : 0;
}

function envelopeAad(
  workspaceId: string,
  objectId: string,
  revisionId: string,
  groupId: string,
  keyEpoch: number,
  keyHint: Uint8Array
): Uint8Array {
  return new BinaryWriter()
    .u8(WORKSPACE_ALGORITHM_SUITE)
    .bytes(idBytes(workspaceId, "workspaceId"))
    .bytes(idBytes(objectId, "objectId"))
    .bytes(idBytes(revisionId, "revisionId"))
    .bytes(idBytes(groupId, "groupId"))
    .u32(keyEpoch)
    .bytes(keyHint)
    .finish();
}

async function sealEnvelopes(input: {
  workspaceId: string;
  objectId: string;
  revisionId: string;
  recipients: Pvo1Recipient[];
  dataKey: Uint8Array;
}): Promise<Pvo1Envelope[]> {
  protocolAssert(input.recipients.length >= 1 && input.recipients.length <= MAX_ENVELOPES, "bounds", "invalid envelope count");
  const prepared = input.recipients.map((recipient) => {
    validateRecipient(recipient);
    return { recipient, keyHint: recipient.keyHint ? new Uint8Array(recipient.keyHint) : randomBytes(8) };
  });
  const recipientKeys = prepared.map(({ recipient }) => `${recipient.groupId}:${recipient.keyEpoch}`).sort();
  for (let index = 1; index < recipientKeys.length; index += 1) {
    protocolAssert(recipientKeys[index - 1] !== recipientKeys[index], "canonical", "duplicate PVO1 recipient group and epoch");
  }
  prepared.sort((left, right) => compareEnvelopeKey({ ...left.recipient, keyHint: left.keyHint }, { ...right.recipient, keyHint: right.keyHint }));
  for (let index = 1; index < prepared.length; index += 1) {
    const left = prepared[index - 1];
    const right = prepared[index];
    protocolAssert(compareEnvelopeKey({ ...left.recipient, keyHint: left.keyHint }, { ...right.recipient, keyHint: right.keyHint }) < 0, "canonical", "duplicate PVO1 recipient envelope");
  }
  const info = utf8Encode(workspaceDomain("object-dek", input.workspaceId, input.objectId, input.revisionId));
  const envelopes: Pvo1Envelope[] = [];
  for (const { recipient, keyHint } of prepared) {
    const sealed = await hpkeSeal(
      recipient.publicKey,
      input.dataKey,
      info,
      envelopeAad(input.workspaceId, input.objectId, input.revisionId, recipient.groupId, recipient.keyEpoch, keyHint),
      recipient.hpkeTesting
    );
    protocolAssert(sealed.enc.length === HPKE_ENCAPSULATED_KEY_BYTES && sealed.ciphertext.length === HPKE_WRAPPED_KEY_BYTES, "crypto", "HPKE envelope has unexpected length");
    envelopes.push({ groupId: recipient.groupId, keyEpoch: recipient.keyEpoch, keyHint, enc: sealed.enc, ciphertext: sealed.ciphertext });
  }
  return envelopes;
}

function encodeEnvelope(envelope: Pvo1Envelope): Uint8Array {
  return new BinaryWriter()
    .bytes(idBytes(envelope.groupId, "groupId"))
    .u32(envelope.keyEpoch)
    .bytes(envelope.keyHint)
    .u16(HPKE_KEM_X25519_HKDF_SHA256)
    .u16(HPKE_KDF_HKDF_SHA256)
    .u16(HPKE_AEAD_CHACHA20_POLY1305)
    .u16(HPKE_ENCAPSULATED_KEY_BYTES)
    .u16(HPKE_WRAPPED_KEY_BYTES)
    .u16(0)
    .bytes(envelope.enc)
    .bytes(envelope.ciphertext)
    .finish();
}

function encodeEnvelopeTable(envelopes: Pvo1Envelope[]): Uint8Array {
  const bytes = concatBytes(...envelopes.map(encodeEnvelope));
  protocolAssert(bytes.length === envelopes.length * PVO1_ENVELOPE_BYTES, "integrity", "PVO1 envelope table length mismatch");
  return bytes;
}

function encodePvo1Header(input: {
  workspaceId: string;
  objectId: string;
  revisionId: string;
  flags: number;
  chunkSize: number;
  chunkCount: number;
  plaintextLength: number;
  envelopeCount: number;
  metadataLength: number;
}): Uint8Array {
  const header = new BinaryWriter()
    .bytes(PVO1_MAGIC)
    .u8(WORKSPACE_PROTOCOL_VERSION)
    .u8(WORKSPACE_ALGORITHM_SUITE)
    .u16(input.flags)
    .bytes(idBytes(input.workspaceId, "workspaceId"))
    .bytes(idBytes(input.objectId, "objectId"))
    .bytes(idBytes(input.revisionId, "revisionId"))
    .u32(input.chunkSize)
    .u32(input.chunkCount)
    .u64(input.plaintextLength)
    .u16(input.envelopeCount)
    .u32(input.metadataLength)
    .u16(0)
    .finish();
  protocolAssert(header.length === PVO1_HEADER_BYTES, "integrity", "PVO1 header length mismatch");
  return header;
}

function blockAad(header: Uint8Array, envelopeBytes: Uint8Array, purpose: "object-metadata" | "object-content"): Uint8Array {
  return concatBytes(header, sha256Bytes(envelopeBytes), utf8Encode(purpose));
}

function sealBlock(key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): Uint8Array {
  protocolAssert(nonce.length === 24, "format", "XChaCha nonce has wrong length");
  return concatBytes(nonce, aeadEncrypt(key, nonce, plaintext, aad));
}

async function sealObjectFrame(input: {
  workspaceId: string;
  objectId: string;
  revisionId: string;
  recipients: Pvo1Recipient[];
  metadata: Pvo1ObjectMetadata;
  payloadPlaintext: Uint8Array;
  plaintextLength: number;
  chunkSize: number;
  chunkCount: number;
  testing?: Pvo1SealTestingOptions;
}): Promise<Uint8Array> {
  assertWorkspaceId(input.workspaceId, "workspaceId");
  assertWorkspaceId(input.objectId, "objectId");
  assertWorkspaceId(input.revisionId, "revisionId");
  validateMetadata(input.metadata);
  const metadataPlaintext = utf8Encode(canonicalJson(input.metadata));
  protocolAssert(metadataPlaintext.length <= MAX_METADATA_PLAINTEXT_BYTES, "bounds", "PVO1 metadata is too large");
  const dataKey = input.testing?.dataKey ? new Uint8Array(input.testing.dataKey) : randomWorkspaceKey();
  protocolAssert(dataKey.length === 32, "format", "PVO1 data key has wrong length");
  const envelopes = await sealEnvelopes({ ...input, dataKey });
  const envelopeBytes = encodeEnvelopeTable(envelopes);
  const flags = input.chunkCount > 0 ? PVO1_FLAG_CHUNKED : 0;
  const metadataLength = 24 + metadataPlaintext.length + 16;
  const header = encodePvo1Header({ ...input, flags, envelopeCount: envelopes.length, metadataLength });
  const metadataNonce = input.testing?.metadataNonce ?? aeadNonce();
  const payloadNonce = input.testing?.payloadNonce ?? aeadNonce();
  const metadataKey = deriveWorkspaceSubkey(dataKey, "object-metadata", input.workspaceId, input.objectId, input.revisionId);
  const payloadKey = deriveWorkspaceSubkey(dataKey, "object-content", input.workspaceId, input.objectId, input.revisionId);
  const metadataBlock = sealBlock(metadataKey, metadataNonce, metadataPlaintext, blockAad(header, envelopeBytes, "object-metadata"));
  const payloadBlock = sealBlock(payloadKey, payloadNonce, input.payloadPlaintext, blockAad(header, envelopeBytes, "object-content"));
  const frame = concatBytes(header, envelopeBytes, metadataBlock, payloadBlock);
  const maximum = flags === 0 ? MAX_INLINE_FRAME_BYTES : MAX_CHUNKED_FRAME_BYTES;
  protocolAssert(frame.length <= maximum, "bounds", "PVO1 frame exceeds its maximum size");
  return frame;
}

export async function sealInlinePvo1(input: {
  workspaceId: string;
  objectId: string;
  revisionId: string;
  recipients: Pvo1Recipient[];
  metadata: Pvo1ObjectMetadataInput;
  plaintext: Uint8Array;
  testing?: Pvo1SealTestingOptions;
}): Promise<Uint8Array> {
  protocolAssert(input.plaintext.length <= MAX_INLINE_PLAINTEXT_BYTES, "bounds", "inline PVO1 plaintext is too large");
  return sealObjectFrame({
    ...input,
    metadata: makeMetadata(input.metadata, sha256Hex(input.plaintext)),
    payloadPlaintext: input.plaintext,
    plaintextLength: input.plaintext.length,
    chunkSize: 0,
    chunkCount: 0,
  });
}

function fullPlaintextHash(chunks: Uint8Array[]): string {
  const hash = sha256.create();
  for (const chunk of chunks) hash.update(chunk);
  return toHex(hash.digest());
}

export async function sealChunkedPvo1(input: {
  workspaceId: string;
  objectId: string;
  revisionId: string;
  recipients: Pvo1Recipient[];
  metadata: Pvo1ObjectMetadataInput;
  chunks: Uint8Array[];
  testing?: Pvo1SealTestingOptions;
}): Promise<SealedChunkedPvo1> {
  protocolAssert(input.chunks.length >= 1 && input.chunks.length <= MAX_CHUNKS, "bounds", "invalid chunk count");
  let total = 0;
  let chunkSize = 0;
  for (let index = 0; index < input.chunks.length; index += 1) {
    const chunk = input.chunks[index];
    protocolAssert(chunk.length <= MAX_CHUNK_BYTES, "bounds", "chunk plaintext is too large");
    if (index < input.chunks.length - 1) {
      protocolAssert(chunk.length > 0, "format", "non-final chunk must not be empty");
      if (chunkSize === 0) chunkSize = chunk.length;
      protocolAssert(chunk.length === chunkSize, "format", "non-final chunks must have equal size");
    }
    total += chunk.length;
    protocolAssert(total <= MAX_FILE_BYTES, "bounds", "chunked plaintext exceeds file limit");
  }
  if (input.chunks.length === 1) chunkSize = input.chunks[0].length || DEFAULT_CHUNK_BYTES;
  const dataKey = input.testing?.dataKey ? new Uint8Array(input.testing.dataKey) : randomWorkspaceKey();
  protocolAssert(dataKey.length === 32, "format", "PVO1 data key has wrong length");
  const sealedChunks: Uint8Array[] = [];
  const references: Pvo1ChunkReference[] = [];
  for (let index = 0; index < input.chunks.length; index += 1) {
    const sealed = sealPvc1Chunk({
      workspaceId: input.workspaceId,
      objectId: input.objectId,
      revisionId: input.revisionId,
      index,
      plaintext: input.chunks[index],
      dataKey,
      nonce: input.testing?.chunkNonces?.[index],
    });
    sealedChunks.push(sealed);
    references.push({ index, plaintextLength: input.chunks[index].length, sha256: sha256Hex(sealed) });
  }
  const manifest: Pvo1ChunkManifest = { chunks: references, totalPlaintextLength: total };
  const manifestBytes = utf8Encode(canonicalJson(manifest));
  protocolAssert(manifestBytes.length <= MAX_MANIFEST_PLAINTEXT_BYTES, "bounds", "chunk manifest is too large");
  const object = await sealObjectFrame({
    ...input,
    metadata: makeMetadata(input.metadata, fullPlaintextHash(input.chunks)),
    payloadPlaintext: manifestBytes,
    plaintextLength: total,
    chunkSize,
    chunkCount: input.chunks.length,
    testing: { ...input.testing, dataKey },
  });
  return { object, chunks: sealedChunks, manifest };
}

export function splitPvo1Chunks(plaintext: Uint8Array, chunkSize = DEFAULT_CHUNK_BYTES): Uint8Array[] {
  protocolAssert(Number.isInteger(chunkSize) && chunkSize >= 1 && chunkSize <= MAX_CHUNK_BYTES, "bounds", "chunk size is invalid");
  protocolAssert(plaintext.length <= MAX_FILE_BYTES, "bounds", "plaintext exceeds file limit");
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < plaintext.length; offset += chunkSize) chunks.push(plaintext.subarray(offset, Math.min(offset + chunkSize, plaintext.length)));
  if (chunks.length === 0) chunks.push(new Uint8Array());
  return chunks;
}

function parseEnvelope(reader: BinaryReader): Pvo1Envelope {
  const groupId = toHex(reader.bytes(16));
  const keyEpoch = reader.u32();
  const keyHint = new Uint8Array(reader.bytes(8));
  protocolAssert(reader.u16() === HPKE_KEM_X25519_HKDF_SHA256, "unsupported", "unsupported PVO1 envelope KEM");
  protocolAssert(reader.u16() === HPKE_KDF_HKDF_SHA256, "unsupported", "unsupported PVO1 envelope KDF");
  protocolAssert(reader.u16() === HPKE_AEAD_CHACHA20_POLY1305, "unsupported", "unsupported PVO1 envelope AEAD");
  protocolAssert(reader.u16() === HPKE_ENCAPSULATED_KEY_BYTES, "format", "invalid PVO1 encapsulated-key length");
  protocolAssert(reader.u16() === HPKE_WRAPPED_KEY_BYTES, "format", "invalid PVO1 wrapped-key length");
  protocolAssert(reader.u16() === 0, "unsupported", "non-zero PVO1 envelope reserved bytes");
  const enc = new Uint8Array(reader.bytes(HPKE_ENCAPSULATED_KEY_BYTES));
  const ciphertext = new Uint8Array(reader.bytes(HPKE_WRAPPED_KEY_BYTES));
  assertWorkspaceId(groupId, "groupId");
  protocolAssert(keyEpoch >= 1, "format", "PVO1 key epoch must be positive");
  return { groupId, keyEpoch, keyHint, enc, ciphertext };
}

export function parsePvo1Frame(bytes: Uint8Array): ParsedPvo1Frame {
  protocolAssert(bytes.length >= PVO1_HEADER_BYTES && bytes.length <= MAX_INLINE_FRAME_BYTES, "bounds", "PVO1 frame size is invalid");
  const reader = new BinaryReader(bytes);
  protocolAssert(bytesEqual(reader.bytes(4), PVO1_MAGIC), "format", "invalid PVO1 magic");
  protocolAssert(reader.u8() === WORKSPACE_PROTOCOL_VERSION, "unsupported", "unsupported PVO1 version");
  protocolAssert(reader.u8() === WORKSPACE_ALGORITHM_SUITE, "unsupported", "unsupported PVO1 algorithm suite");
  const flags = reader.u16();
  protocolAssert((flags & ~PVO1_KNOWN_FLAGS) === 0, "unsupported", "unknown PVO1 flags");
  const workspaceId = toHex(reader.bytes(16));
  const objectId = toHex(reader.bytes(16));
  const revisionId = toHex(reader.bytes(16));
  const chunkSize = reader.u32();
  const chunkCount = reader.u32();
  const plaintextLength = reader.u64();
  const envelopeCount = reader.u16();
  const metadataLength = reader.u32();
  protocolAssert(reader.u16() === 0, "unsupported", "non-zero PVO1 reserved bytes");
  assertWorkspaceId(workspaceId, "workspaceId");
  assertWorkspaceId(objectId, "objectId");
  assertWorkspaceId(revisionId, "revisionId");
  protocolAssert(plaintextLength <= MAX_FILE_BYTES, "bounds", "PVO1 plaintext length exceeds limit");
  protocolAssert(envelopeCount >= 1 && envelopeCount <= MAX_ENVELOPES, "bounds", "invalid PVO1 envelope count");
  protocolAssert(metadataLength >= 40 && metadataLength <= MAX_METADATA_PLAINTEXT_BYTES + 40, "bounds", "invalid PVO1 metadata length");
  const chunked = (flags & PVO1_FLAG_CHUNKED) !== 0;
  if (chunked) {
    protocolAssert(bytes.length <= MAX_CHUNKED_FRAME_BYTES, "bounds", "chunked PVO1 frame exceeds limit");
    protocolAssert(chunkSize >= 1 && chunkSize <= MAX_CHUNK_BYTES, "bounds", "invalid PVO1 chunk size");
    protocolAssert(chunkCount >= 1 && chunkCount <= MAX_CHUNKS, "bounds", "invalid PVO1 chunk count");
  } else {
    protocolAssert(chunkSize === 0 && chunkCount === 0, "format", "inline PVO1 contains chunk fields");
    protocolAssert(plaintextLength <= MAX_INLINE_PLAINTEXT_BYTES, "bounds", "inline PVO1 plaintext exceeds limit");
  }
  const envelopeTableLength = envelopeCount * PVO1_ENVELOPE_BYTES;
  protocolAssert(envelopeTableLength <= reader.remaining && metadataLength <= reader.remaining - envelopeTableLength, "format", "truncated PVO1 variable sections");
  const envelopeStart = reader.offset;
  const envelopes: Pvo1Envelope[] = [];
  for (let index = 0; index < envelopeCount; index += 1) envelopes.push(parseEnvelope(reader));
  for (let index = 1; index < envelopes.length; index += 1) protocolAssert(compareEnvelopeKey(envelopes[index - 1], envelopes[index]) < 0, "canonical", "PVO1 envelopes are not sorted and unique");
  const envelopeRecipients = envelopes.map((envelope) => `${envelope.groupId}:${envelope.keyEpoch}`).sort();
  for (let index = 1; index < envelopeRecipients.length; index += 1) protocolAssert(envelopeRecipients[index - 1] !== envelopeRecipients[index], "canonical", "duplicate PVO1 recipient group and epoch");
  const envelopeBytes = new Uint8Array(bytes.subarray(envelopeStart, reader.offset));
  const metadataBlock = new Uint8Array(reader.bytes(metadataLength));
  const payloadBlock = new Uint8Array(reader.bytes(reader.remaining));
  protocolAssert(payloadBlock.length >= 40, "format", "PVO1 payload block is truncated");
  if (!chunked) protocolAssert(payloadBlock.length === 24 + plaintextLength + 16, "format", "inline PVO1 payload length mismatch");
  const headerBytes = new Uint8Array(bytes.subarray(0, PVO1_HEADER_BYTES));
  return { workspaceId, objectId, revisionId, flags, chunkSize, chunkCount, plaintextLength, envelopes, metadataBlock, payloadBlock, headerBytes, envelopeBytes };
}

async function unwrapDataKey(frame: ParsedPvo1Frame, readerKeys: Pvo1ReaderKey[]): Promise<Uint8Array> {
  const info = utf8Encode(workspaceDomain("object-dek", frame.workspaceId, frame.objectId, frame.revisionId));
  for (const readerKey of readerKeys) {
    const envelope = frame.envelopes.find((candidate) => candidate.groupId === readerKey.groupId && candidate.keyEpoch === readerKey.keyEpoch);
    if (!envelope) continue;
    try {
      const key = await hpkeOpen(
        readerKey.privateKey,
        envelope.enc,
        envelope.ciphertext,
        info,
        envelopeAad(frame.workspaceId, frame.objectId, frame.revisionId, envelope.groupId, envelope.keyEpoch, envelope.keyHint)
      );
      if (key.length === 32) return key;
    } catch {
      // Try another matching reader key without exposing which binding failed.
    }
  }
  throw new WorkspaceProtocolError("crypto", "no reader key can open the PVO1 data key");
}

function openBlock(key: Uint8Array, block: Uint8Array, aad: Uint8Array, label: string): Uint8Array {
  protocolAssert(block.length >= 40, "format", `${label} block is truncated`);
  try {
    return aeadDecrypt(key, block.subarray(0, 24), block.subarray(24), aad);
  } catch (cause) {
    throw new WorkspaceProtocolError("crypto", `${label} decryption failed`, { cause });
  }
}

function parseCanonicalJson<T>(bytes: Uint8Array, label: string): T {
  const text = utf8DecodeFatal(bytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new WorkspaceProtocolError("format", `${label} is not JSON`, { cause });
  }
  protocolAssert(canonicalJson(parsed) === text, "canonical", `${label} is not canonical JSON`);
  return parsed as T;
}

function validateChunkManifest(manifest: Pvo1ChunkManifest, frame: ParsedPvo1Frame): void {
  protocolAssert(manifest !== null && typeof manifest === "object" && Object.keys(manifest).sort().join(",") === "chunks,totalPlaintextLength", "format", "chunk manifest has invalid fields");
  protocolAssert(Array.isArray(manifest.chunks) && manifest.chunks.length === frame.chunkCount, "integrity", "chunk manifest count mismatch");
  protocolAssert(manifest.totalPlaintextLength === frame.plaintextLength, "integrity", "chunk manifest total mismatch");
  let total = 0;
  for (let index = 0; index < manifest.chunks.length; index += 1) {
    const reference = manifest.chunks[index];
    protocolAssert(reference !== null && typeof reference === "object" && Object.keys(reference).sort().join(",") === "index,plaintextLength,sha256", "format", "chunk manifest reference has invalid fields");
    protocolAssert(reference.index === index, "canonical", "chunk manifest indexes are not contiguous");
    protocolAssert(Number.isInteger(reference.plaintextLength) && reference.plaintextLength >= 0 && reference.plaintextLength <= MAX_CHUNK_BYTES, "bounds", "chunk manifest length is invalid");
    if (index < manifest.chunks.length - 1) protocolAssert(reference.plaintextLength === frame.chunkSize, "integrity", "non-final chunk length mismatch");
    assertWorkspaceHash(reference.sha256, "chunk sha256");
    total += reference.plaintextLength;
  }
  protocolAssert(total === frame.plaintextLength, "integrity", "chunk manifest lengths do not sum to plaintext length");
}

export async function openPvo1Frame(bytes: Uint8Array, readerKeys: Pvo1ReaderKey[]): Promise<OpenedPvo1Frame> {
  const frame = parsePvo1Frame(bytes);
  const dataKey = await unwrapDataKey(frame, readerKeys);
  const metadataKey = deriveWorkspaceSubkey(dataKey, "object-metadata", frame.workspaceId, frame.objectId, frame.revisionId);
  const contentKey = deriveWorkspaceSubkey(dataKey, "object-content", frame.workspaceId, frame.objectId, frame.revisionId);
  const metadataPlaintext = openBlock(metadataKey, frame.metadataBlock, blockAad(frame.headerBytes, frame.envelopeBytes, "object-metadata"), "PVO1 metadata");
  protocolAssert(metadataPlaintext.length <= MAX_METADATA_PLAINTEXT_BYTES, "bounds", "PVO1 metadata plaintext exceeds limit");
  const metadata = parseCanonicalJson<Pvo1ObjectMetadata>(metadataPlaintext, "PVO1 metadata");
  validateMetadata(metadata);
  const payloadPlaintext = openBlock(contentKey, frame.payloadBlock, blockAad(frame.headerBytes, frame.envelopeBytes, "object-content"), "PVO1 payload");
  if ((frame.flags & PVO1_FLAG_CHUNKED) === 0) {
    protocolAssert(payloadPlaintext.length === frame.plaintextLength, "integrity", "PVO1 plaintext length mismatch");
    protocolAssert(sha256Hex(payloadPlaintext) === metadata.plaintextSha256, "integrity", "PVO1 plaintext hash mismatch");
    return { ...frame, dataKey, metadata, plaintext: payloadPlaintext };
  }
  protocolAssert(payloadPlaintext.length <= MAX_MANIFEST_PLAINTEXT_BYTES, "bounds", "PVO1 manifest exceeds limit");
  const manifest = parseCanonicalJson<Pvo1ChunkManifest>(payloadPlaintext, "PVO1 chunk manifest");
  validateChunkManifest(manifest, frame);
  return { ...frame, dataKey, metadata, manifest };
}

export interface ParsedPvc1Chunk {
  workspaceId: string;
  objectId: string;
  revisionId: string;
  index: number;
  plaintextLength: number;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
  headerBytes: Uint8Array;
}

function encodePvc1Header(input: {
  workspaceId: string;
  objectId: string;
  revisionId: string;
  index: number;
  plaintextLength: number;
  nonce: Uint8Array;
}): Uint8Array {
  protocolAssert(input.nonce.length === 24, "format", "PVC1 nonce has wrong length");
  const header = new BinaryWriter()
    .bytes(PVC1_MAGIC)
    .u8(WORKSPACE_PROTOCOL_VERSION)
    .u8(WORKSPACE_ALGORITHM_SUITE)
    .u16(0)
    .bytes(idBytes(input.workspaceId, "workspaceId"))
    .bytes(idBytes(input.objectId, "objectId"))
    .bytes(idBytes(input.revisionId, "revisionId"))
    .u32(input.index)
    .u32(input.plaintextLength)
    .bytes(input.nonce)
    .u32(input.plaintextLength + 16)
    .finish();
  protocolAssert(header.length === PVC1_HEADER_BYTES, "integrity", "PVC1 header length mismatch");
  return header;
}

export function sealPvc1Chunk(input: {
  workspaceId: string;
  objectId: string;
  revisionId: string;
  index: number;
  plaintext: Uint8Array;
  dataKey: Uint8Array;
  nonce?: Uint8Array;
}): Uint8Array {
  protocolAssert(Number.isInteger(input.index) && input.index >= 0 && input.index < MAX_CHUNKS, "bounds", "PVC1 index is invalid");
  protocolAssert(input.plaintext.length <= MAX_CHUNK_BYTES, "bounds", "PVC1 plaintext is too large");
  const nonce = input.nonce ?? aeadNonce();
  const header = encodePvc1Header({ ...input, plaintextLength: input.plaintext.length, nonce });
  const key = deriveWorkspaceSubkey(input.dataKey, "object-chunk", input.workspaceId, input.objectId, input.revisionId, input.index);
  return concatBytes(header, aeadEncrypt(key, nonce, input.plaintext, header));
}

export function parsePvc1Chunk(bytes: Uint8Array): ParsedPvc1Chunk {
  protocolAssert(bytes.length >= PVC1_HEADER_BYTES + 16 && bytes.length <= PVC1_HEADER_BYTES + MAX_CHUNK_BYTES + 16, "bounds", "PVC1 frame size is invalid");
  const reader = new BinaryReader(bytes);
  protocolAssert(bytesEqual(reader.bytes(4), PVC1_MAGIC), "format", "invalid PVC1 magic");
  protocolAssert(reader.u8() === WORKSPACE_PROTOCOL_VERSION, "unsupported", "unsupported PVC1 version");
  protocolAssert(reader.u8() === WORKSPACE_ALGORITHM_SUITE, "unsupported", "unsupported PVC1 algorithm suite");
  protocolAssert(reader.u16() === 0, "unsupported", "unknown PVC1 flags");
  const workspaceId = toHex(reader.bytes(16));
  const objectId = toHex(reader.bytes(16));
  const revisionId = toHex(reader.bytes(16));
  const index = reader.u32();
  const plaintextLength = reader.u32();
  const nonce = new Uint8Array(reader.bytes(24));
  const ciphertextLength = reader.u32();
  protocolAssert(index < MAX_CHUNKS, "bounds", "PVC1 index exceeds limit");
  protocolAssert(plaintextLength <= MAX_CHUNK_BYTES && ciphertextLength === plaintextLength + 16, "bounds", "PVC1 length is invalid");
  protocolAssert(reader.remaining === ciphertextLength, "format", "PVC1 ciphertext length mismatch");
  const ciphertext = new Uint8Array(reader.bytes(ciphertextLength));
  assertWorkspaceId(workspaceId, "workspaceId");
  assertWorkspaceId(objectId, "objectId");
  assertWorkspaceId(revisionId, "revisionId");
  return { workspaceId, objectId, revisionId, index, plaintextLength, nonce, ciphertext, headerBytes: new Uint8Array(bytes.subarray(0, PVC1_HEADER_BYTES)) };
}

export function openPvc1Chunk(input: {
  bytes: Uint8Array;
  expected: Pvo1ChunkReference;
  frame: Pick<OpenedPvo1Frame, "workspaceId" | "objectId" | "revisionId" | "dataKey">;
}): Uint8Array {
  protocolAssert(sha256Hex(input.bytes) === input.expected.sha256, "integrity", "PVC1 object hash mismatch");
  const chunk = parsePvc1Chunk(input.bytes);
  protocolAssert(chunk.workspaceId === input.frame.workspaceId && chunk.objectId === input.frame.objectId && chunk.revisionId === input.frame.revisionId, "integrity", "PVC1 identifiers do not match PVO1");
  protocolAssert(chunk.index === input.expected.index && chunk.plaintextLength === input.expected.plaintextLength, "integrity", "PVC1 manifest binding mismatch");
  const key = deriveWorkspaceSubkey(input.frame.dataKey, "object-chunk", chunk.workspaceId, chunk.objectId, chunk.revisionId, chunk.index);
  try {
    const plaintext = aeadDecrypt(key, chunk.nonce, chunk.ciphertext, chunk.headerBytes);
    protocolAssert(plaintext.length === chunk.plaintextLength, "integrity", "PVC1 plaintext length mismatch");
    return plaintext;
  } catch (cause) {
    if (cause instanceof WorkspaceProtocolError) throw cause;
    throw new WorkspaceProtocolError("crypto", "PVC1 decryption failed", { cause });
  }
}

export function verifyChunkedPlaintextHash(opened: OpenedPvo1Frame, plaintextChunks: Uint8Array[]): boolean {
  if (!opened.manifest || plaintextChunks.length !== opened.manifest.chunks.length) return false;
  return fullPlaintextHash(plaintextChunks) === opened.metadata.plaintextSha256;
}

/** Small mutation entry point for fuzz/property harnesses: always terminates or throws a typed error. */
export function fuzzParseWorkspaceFrame(bytes: Uint8Array): "pvo1" | "pvc1" | "unknown" {
  try {
    if (bytes.length >= 4 && bytesEqual(bytes.subarray(0, 4), PVO1_MAGIC)) {
      parsePvo1Frame(bytes);
      return "pvo1";
    }
    if (bytes.length >= 4 && bytesEqual(bytes.subarray(0, 4), PVC1_MAGIC)) {
      parsePvc1Chunk(bytes);
      return "pvc1";
    }
    return "unknown";
  } catch (error) {
    if (error instanceof WorkspaceProtocolError) return "unknown";
    throw error;
  }
}
