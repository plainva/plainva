/**
 * Content-E2E decorator for the settings-sync + encryption feature (v3 §3.5).
 * Wraps any `ISyncTarget`; it transforms exactly two methods and passes
 * everything else straight through:
 *
 *  - `push`: for a WRITE to a normal vault path, seals a COPY of `op.content`
 *    under K_content (the original plaintext must survive so the engine's
 *    post-push `base_sha256` stays a plaintext hash). Rename/delete/mkdir are
 *    metadata ops with no content — pure passthrough, which is why the path is
 *    NOT part of the AAD.
 *  - `download`: decrypts a sealed blob to plaintext; passes `null` through; in
 *    strict mode a plaintext (unsealed) result is a downgrade and throws
 *    FatalSyncProtocolError; in a mixed sweep plaintext is returned unchanged.
 *
 * The `.plainva/sync/*` control/sideband files are NEVER touched — `keyfile.json`
 * and `encryption.json` must be readable before unlock, and `settings.enc` /
 * `secrets.enc` carry their own AEAD layer (no double encryption).
 *
 * Optional provider methods (`remoteEtag`/`getStartCursor`/`listFolders`/
 * `createFolder`) are exposed only when the inner target has them, so the
 * worker's capability checks keep reflecting real abilities; token-refresh hooks
 * are forwarded.
 */
import type { ISyncTarget, PullResult, PushResult, SyncOperation } from "../sync/ISyncTarget.js";
import type { MasterKeyBundle } from "../crypto/keyfile.js";
import { isSealedBlob, openBlob, sealBlob } from "../crypto/sealedBlob.js";
import { FatalSyncProtocolError } from "./errors.js";

/** Path prefix of the control/sideband files the content decorator never encrypts. */
export function isSidebandControlPath(path: string): boolean {
  return path.startsWith(".plainva/sync/");
}

export interface EncryptingSyncTargetOptions {
  contentKey: MasterKeyBundle;
  /** True while the connection is in the strict state (only ciphertext allowed). */
  isStrict: () => boolean;
}

export class EncryptingSyncTarget implements ISyncTarget {
  constructor(
    private readonly inner: ISyncTarget,
    private readonly options: EncryptingSyncTargetOptions
  ) {
    // Forward token-refresh hooks (class fields, not interface methods).
    const anyInner = inner as unknown as Record<string, unknown>;
    for (const hook of ["onTokenRefreshed", "onTokensRefreshed"]) {
      if (hook in anyInner) {
        Object.defineProperty(this, hook, {
          get: () => anyInner[hook],
          set: (v) => {
            anyInner[hook] = v;
          },
          configurable: true,
        });
      }
    }
    // Conditionally expose optional methods so worker capability checks match.
    if (inner.remoteEtag) this.remoteEtag = (p) => inner.remoteEtag!(p);
    if (inner.getStartCursor) this.getStartCursor = () => inner.getStartCursor!();
    if (inner.listFolders) this.listFolders = (p) => inner.listFolders!(p);
    if (inner.createFolder) this.createFolder = (p) => inner.createFolder!(p);
  }

  async push(op: SyncOperation): Promise<PushResult | void> {
    if (op.operation !== "write" || !op.content || isSidebandControlPath(op.file_path)) {
      return this.inner.push(op);
    }
    // Encrypt a COPY; never mutate the op (its plaintext content is re-hashed
    // after the push for base_sha256).
    const sealed = sealBlob(this.options.contentKey, op.content, "content");
    return this.inner.push({ ...op, content: sealed });
  }

  pull(cursor?: string): Promise<PullResult> {
    return this.inner.pull(cursor);
  }

  async download(filePath: string): Promise<Uint8Array | null> {
    const bytes = await this.inner.download(filePath);
    if (bytes === null || isSidebandControlPath(filePath)) return bytes;
    if (isSealedBlob(bytes)) {
      return openBlob(this.options.contentKey, bytes, "content");
    }
    // Unsealed (plaintext) content.
    if (this.options.isStrict()) {
      throw new FatalSyncProtocolError("plaintext-in-strict", `unencrypted content in strict mode: ${filePath}`);
    }
    return bytes; // mixed sweep: plaintext allowed
  }

  // Optional methods assigned in the constructor when the inner target has them.
  remoteEtag?: (filePath: string) => Promise<string | null>;
  getStartCursor?: () => Promise<string>;
  listFolders?: (path: string) => Promise<string[]>;
  createFolder?: (path: string) => Promise<void>;
}
