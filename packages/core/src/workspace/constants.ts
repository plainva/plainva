export const WORKSPACE_PROTOCOL_VERSION = 1 as const;
export const WORKSPACE_ALGORITHM_SUITE = 1 as const;

export const WORKSPACE_ID_BYTES = 16;
export const WORKSPACE_HASH_BYTES = 32;
export const WORKSPACE_KEY_BYTES = 32;
export const WORKSPACE_SIGNATURE_BYTES = 64;

export const PVO1_MAGIC = new Uint8Array([0x50, 0x56, 0x4f, 0x31]);
export const PVC1_MAGIC = new Uint8Array([0x50, 0x56, 0x43, 0x31]);
export const PVO1_HEADER_BYTES = 80;
export const PVO1_ENVELOPE_BYTES = 120;
export const PVC1_HEADER_BYTES = 92;

export const PVO1_FLAG_CHUNKED = 0x0001;
export const PVO1_KNOWN_FLAGS = PVO1_FLAG_CHUNKED;

export const HPKE_KEM_X25519_HKDF_SHA256 = 0x0020;
export const HPKE_KDF_HKDF_SHA256 = 0x0001;
export const HPKE_AEAD_CHACHA20_POLY1305 = 0x0003;
export const HPKE_ENCAPSULATED_KEY_BYTES = 32;
export const HPKE_WRAPPED_KEY_BYTES = 48;

export const MAX_INLINE_PLAINTEXT_BYTES = 8 * 1024 * 1024;
export const DEFAULT_CHUNK_BYTES = 4 * 1024 * 1024;
export const MAX_CHUNK_BYTES = 4 * 1024 * 1024;
export const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_METADATA_PLAINTEXT_BYTES = 1024 * 1024;
export const MAX_MANIFEST_PLAINTEXT_BYTES = 4 * 1024 * 1024;
/** Leaves room for base64 expansion and signed JSON inside the 16 MiB catalog document limit. */
export const MAX_CATALOG_BODY_BYTES = 12 * 1024 * 1024 - 4 * 1024;
export const MAX_INLINE_FRAME_BYTES = 16 * 1024 * 1024;
export const MAX_CHUNKED_FRAME_BYTES = 8 * 1024 * 1024;
export const MAX_CHUNK_FRAME_BYTES = MAX_CHUNK_BYTES + PVC1_HEADER_BYTES + 16;
export const MAX_ENVELOPES = 1024;
export const MAX_CHUNKS = 65_535;

export const MAX_VAULT_PATH_BYTES = 4096;
export const MAX_VAULT_SEGMENT_BYTES = 255;

export type WorkspaceDocumentKind =
  | "genesis"
  | "policy"
  | "grant"
  | "operation"
  | "catalog"
  | "checkpoint"
  | "head";

export const DOCUMENT_MAX_BYTES: Readonly<Record<WorkspaceDocumentKind, number>> = {
  genesis: 64 * 1024,
  policy: 4 * 1024 * 1024,
  grant: 64 * 1024,
  operation: 64 * 1024,
  catalog: 16 * 1024 * 1024,
  checkpoint: 4 * 1024 * 1024,
  head: 16 * 1024,
};
