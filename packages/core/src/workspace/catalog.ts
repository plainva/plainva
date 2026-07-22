import { aeadDecrypt, aeadEncrypt, aeadNonce } from "../crypto/aead.js";
import { canonicalJson } from "../settingsSync/canonicalJson.js";
import { MAX_CATALOG_BODY_BYTES } from "./constants.js";
import { deriveWorkspaceContextKey } from "./crypto.js";
import {
  signWorkspaceDocument,
  WorkspaceDocumentSigner,
  WorkspaceSignedDocument,
} from "./documents.js";
import {
  assertWorkspaceHash,
  assertWorkspaceId,
  decodeBase64Exact,
  sha256Hex,
  toBase64,
  utf8DecodeFatal,
  utf8Encode,
} from "./encoding.js";
import { protocolAssert, WorkspaceProtocolError } from "./errors.js";

export interface WorkspaceCatalogReference {
  objectId: string;
  revisionId: string;
  payloadHash: string;
}

export interface WorkspaceCatalogBody {
  objectRefs: WorkspaceCatalogReference[];
}

export interface WorkspaceCatalogPayload {
  groupId: string;
  keyEpoch: number;
  catalogVersion: number;
  previousCatalogHash: string | null;
  bodyHash: string;
  bodySize: number;
  nonce: string;
  ciphertext: string;
}

function catalogAad(input: {
  workspaceId: string;
  groupId: string;
  keyEpoch: number;
  catalogVersion: number;
  previousCatalogHash: string | null;
}): Uint8Array {
  return utf8Encode(canonicalJson(input));
}

function validateCatalogBody(body: WorkspaceCatalogBody): void {
  protocolAssert(body !== null && typeof body === "object" && Array.isArray(body.objectRefs), "format", "catalog body is invalid");
  protocolAssert(Object.keys(body).length === 1 && body.objectRefs.length <= 100_000, "bounds", "catalog body has invalid fields or size");
  let previous = "";
  for (const reference of body.objectRefs) {
    protocolAssert(reference !== null && typeof reference === "object" && Object.keys(reference).sort().join(",") === "objectId,payloadHash,revisionId", "format", "catalog reference is invalid");
    assertWorkspaceId(reference.objectId, "catalog.objectId");
    assertWorkspaceId(reference.revisionId, "catalog.revisionId");
    assertWorkspaceHash(reference.payloadHash, "catalog.payloadHash");
    const key = `${reference.objectId}:${reference.revisionId}:${reference.payloadHash}`;
    protocolAssert(key > previous, "canonical", "catalog references must be sorted and unique");
    previous = key;
  }
}

export function createWorkspaceCatalog(input: {
  workspaceId: string;
  groupId: string;
  keyEpoch: number;
  catalogVersion: number;
  previousCatalogHash: string | null;
  catalogKey: Uint8Array;
  objectRefs: WorkspaceCatalogReference[];
  signer: WorkspaceDocumentSigner;
  signerPrivateKey: Uint8Array;
  nonce?: Uint8Array;
}): WorkspaceSignedDocument<"catalog", WorkspaceCatalogPayload> {
  assertWorkspaceId(input.workspaceId, "workspaceId");
  assertWorkspaceId(input.groupId, "groupId");
  if (input.previousCatalogHash !== null) assertWorkspaceHash(input.previousCatalogHash, "previousCatalogHash");
  protocolAssert(input.catalogKey.length === 32, "format", "catalog key has wrong length");
  protocolAssert(Number.isSafeInteger(input.keyEpoch) && input.keyEpoch >= 1, "bounds", "catalog key epoch is invalid");
  protocolAssert(Number.isSafeInteger(input.catalogVersion) && input.catalogVersion >= 1, "bounds", "catalog version is invalid");
  const body: WorkspaceCatalogBody = { objectRefs: [...input.objectRefs] };
  validateCatalogBody(body);
  const plaintext = utf8Encode(canonicalJson(body));
  protocolAssert(plaintext.length <= MAX_CATALOG_BODY_BYTES, "bounds", "catalog body is too large");
  const nonce = input.nonce ?? aeadNonce();
  protocolAssert(nonce.length === 24, "format", "catalog nonce has wrong length");
  const aad = catalogAad({
    workspaceId: input.workspaceId,
    groupId: input.groupId,
    keyEpoch: input.keyEpoch,
    catalogVersion: input.catalogVersion,
    previousCatalogHash: input.previousCatalogHash,
  });
  const key = deriveWorkspaceContextKey(input.catalogKey, "catalog", input.workspaceId, input.groupId, input.keyEpoch, input.catalogVersion);
  const ciphertext = aeadEncrypt(key, nonce, plaintext, aad);
  const payload: WorkspaceCatalogPayload = {
    groupId: input.groupId,
    keyEpoch: input.keyEpoch,
    catalogVersion: input.catalogVersion,
    previousCatalogHash: input.previousCatalogHash,
    bodyHash: sha256Hex(ciphertext),
    bodySize: plaintext.length,
    nonce: toBase64(nonce),
    ciphertext: toBase64(ciphertext),
  };
  return signWorkspaceDocument(
    { kind: "catalog", protocolVersion: 1, workspaceId: input.workspaceId, payload },
    input.signer,
    input.signerPrivateKey
  );
}

export function openWorkspaceCatalog(
  document: WorkspaceSignedDocument<"catalog", WorkspaceCatalogPayload>,
  catalogKey: Uint8Array
): WorkspaceCatalogBody {
  protocolAssert(document.kind === "catalog", "format", "document is not a catalog");
  const payload = document.payload;
  const ciphertext = decodeBase64Exact(payload.ciphertext, payload.bodySize + 16, "catalog.ciphertext");
  protocolAssert(sha256Hex(ciphertext) === payload.bodyHash, "integrity", "catalog body hash mismatch");
  const key = deriveWorkspaceContextKey(catalogKey, "catalog", document.workspaceId, payload.groupId, payload.keyEpoch, payload.catalogVersion);
  const aad = catalogAad({
    workspaceId: document.workspaceId,
    groupId: payload.groupId,
    keyEpoch: payload.keyEpoch,
    catalogVersion: payload.catalogVersion,
    previousCatalogHash: payload.previousCatalogHash,
  });
  let plaintext: Uint8Array;
  try {
    plaintext = aeadDecrypt(key, decodeBase64Exact(payload.nonce, 24, "catalog.nonce"), ciphertext, aad);
  } catch (cause) {
    throw new WorkspaceProtocolError("crypto", "catalog decryption failed", { cause });
  }
  protocolAssert(plaintext.length === payload.bodySize, "integrity", "catalog body size mismatch");
  const text = utf8DecodeFatal(plaintext);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new WorkspaceProtocolError("format", "catalog body is not JSON", { cause });
  }
  protocolAssert(canonicalJson(parsed) === text, "canonical", "catalog body is not canonical JSON");
  const body = parsed as WorkspaceCatalogBody;
  validateCatalogBody(body);
  return body;
}
