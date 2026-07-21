import { SyncQueue } from "./SyncQueue.js";
import { ISyncTarget } from "./ISyncTarget.js";
import { SyncStateRepository } from "../vault/SyncStateRepository.js";
import { IVaultAdapter } from "../vault/IVaultAdapter.js";
import { isTextFile } from "./fileType.js";

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export class SyncEngine {
  private readonly maxRetryCount = 5;
  /**
   * Stop the cycle after this many failures in a row: one poisoned file must
   * not starve the others (each op fails independently and we move on), but a
   * streak of failures looks like a provider/network outage where trying every
   * remaining op would only burn their retry budgets.
   */
  private readonly maxConsecutiveFailures = 3;

  constructor(
    private readonly queue: SyncQueue,
    private readonly target: ISyncTarget,
    private readonly vault: IVaultAdapter,
    private readonly stateRepo?: SyncStateRepository
  ) {}

  public async processQueue(
    isAborted?: () => boolean,
    onProgress?: (current: number, total: number) => void,
    opts?: {
      /**
       * Leave queued DELETE operations untouched this pass (mass-deletion guard:
       * the worker holds remote deletions until the user confirms them). Writes
       * and renames of other files proceed normally; skipped deletes stay queued
       * and burn no retry budget.
       */
      skipDeletes?: boolean;
    }
  ): Promise<void> {
    let pending = await this.queue.getPendingOperations();
    if (opts?.skipDeletes) {
      pending = pending.filter((op) => op.operation !== "delete");
    }
    if (pending.length > 0) {
      console.log(`[SyncEngine] pushing ${pending.length} pending operation(s)`);
    }
    let consecutiveFailures = 0;
    let pushIdx = 0;
    for (let op of pending) {
      if (isAborted && isAborted()) break;
      // Progress ticks for the status bar (WP6); the desktop throttles rendering.
      if (onProgress) onProgress(pushIdx, pending.length);
      pushIdx++;
      // The local marker recorded at push start; the guarded post-push update
      // only adopts the pushed hash while local_sha256 still equals this value,
      // so an editor save landing during the upload keeps its newer hash and the
      // follow-up save is not mistaken for an external modification (the
      // single-device autosave race that produced spurious .CONFLICT files).
      let expectedLocalSha: string | null = null;
      try {
        // Empty-folder sync (2026-07-17): a queued mkdir creates the folder
        // remotely via the optional createFolder every provider implements
        // ("already exists" counts as success there). A provider without it
        // completes the op as a no-op — folders then materialize with their
        // first file, the old behavior. No sync_state is involved: folder
        // existence is not tracked, only files are.
        if (op.operation === "mkdir") {
          if (this.target.createFolder) await this.target.createFolder(op.file_path);
          await this.queue.markSynced(op.id, op.file_path, op.file_path);
          consecutiveFailures = 0;
          continue;
        }
         if (op.operation === "write") {
            try {
              // Read the marker BEFORE the file content: `expected` may be older
              // than the pushed content, never newer, or the guard could still
              // clobber a concurrent save's hash.
              const state = this.stateRepo ? await this.stateRepo.getSyncState(op.file_path) : null;
              expectedLocalSha = state?.local_sha256 ?? null;
              op.content = await this.vault.readBinaryFile(op.file_path);
              const currentSha = await sha256Bytes(op.content);

              // Skip push if local content is identical to base_sha256 (e.g. from a recent pull).
              // A forced re-encrypt write (content-E2E migration/rotation) bypasses
              // BOTH this shortcut and the optimistic-concurrency deferral below, so
              // the file is re-uploaded as ciphertext even though its plaintext is
              // unchanged and the remote may already hold ciphertext under a different
              // etag. The push journal + guarded base update below run unchanged.
              if (!op.force && state && state.base_sha256) {
                 if (currentSha === state.base_sha256 && state.remote_etag) {
                   // Already in sync with the server, skip push.
                   await this.queue.markSynced(op.id, op.file_path, op.file_path);
                   consecutiveFailures = 0;
                   continue;
                 }

                 // 3b — optimistic-concurrency guard. Local diverged from the base we
                 // last synced against (a real edit). If the target can cheaply report
                 // the CURRENT remote marker and it no longer matches our base_etag,
                 // another writer moved the remote after our base. Overwriting now would
                 // clobber that change with NO .CONFLICT (the reported data loss). Defer
                 // instead: the next cycle's reconcile (which runs before this push)
                 // downloads the remote and 3-way-merges it or preserves a conflict.
                 // Providers without remoteEtag fall back to the worker's
                 // reconcile-before-push guarantee (3a).
                 if (state.base_etag && this.target.remoteEtag) {
                   let currentRemote: string | null = null;
                   try {
                     currentRemote = await this.target.remoteEtag(op.file_path);
                   } catch (probeErr) {
                     // A metadata probe failure must not block the pipeline; fall through
                     // to the normal push and let its own error handling run.
                     console.warn(`[SyncEngine] remoteEtag probe failed for ${op.file_path}:`, probeErr);
                   }
                   if (currentRemote != null && currentRemote !== state.base_etag) {
                     console.warn(`[SyncEngine] deferring push of ${op.file_path}: remote moved since base (remote=${currentRemote.slice(0, 8)}, base=${state.base_etag.slice(0, 8)})`);
                     await this.queue.incrementRetry(op.id, Date.now() + 5000, "remote changed since base; deferring to reconcile");
                     continue;
                   }
                 }
              }

              // Push journal (2026-07-16): persist the content hash BEFORE the
              // upload starts. If the app dies (or the response is lost) after
              // the server committed the write but before the base advanced
              // below, the next reconcile finds the remote content equal to
              // this journal entry and adopts it as our own echo instead of
              // 3-way-merging it against the stale base — which fabricated
              // .CONFLICT files from nothing but typing with pauses.
              if (this.stateRepo) {
                await this.stateRepo.setPendingPushSha(op.file_path, currentSha);
              }
            } catch (err: any) {
              if (err.name === 'VaultFileNotFoundError') {
                // File deleted before we could sync the write. Skip this op.
                await this.queue.markSynced(op.id, op.file_path, op.file_path);
                consecutiveFailures = 0;
                continue;
              }
              throw err;
            }
         }
        let result = await this.target.push(op);

        if (op.operation === "rename" && op.new_path && result && result.renameSourceMissing) {
          // The remote source vanished (deleted or moved by another device).
          // Treating that as success would leave the file under NO remote path;
          // upload the local content at the new path instead.
          console.warn(`[SyncEngine] rename source missing remotely, uploading ${op.new_path} instead`);
          let content: Uint8Array;
          try {
            content = await this.vault.readBinaryFile(op.new_path);
          } catch (err: any) {
            if (err.name === 'VaultFileNotFoundError') {
              // Local file is gone too (a delete op follows in the queue) — nothing to upload.
              await this.queue.markSynced(op.id, op.file_path, op.new_path);
              consecutiveFailures = 0;
              continue;
            }
            throw err;
          }
          op = { ...op, operation: "write", file_path: op.new_path, new_path: undefined, content };
          if (this.stateRepo) {
            await this.stateRepo.setPendingPushSha(op.file_path, await sha256Bytes(content));
          }
          result = await this.target.push(op);
        }
        const syncedPath = op.operation === "rename" && op.new_path ? op.new_path : op.file_path;
        console.log(`[SyncEngine] pushed ${op.operation} ${op.file_path}`);
        await this.queue.markSynced(op.id, op.file_path, syncedPath);

        // A delete is only safe to forget once the remote delete succeeded; clean the
        // sync_state here (the indexer no longer purges it eagerly, to avoid resurrection).
        if (this.stateRepo && op.operation === "delete") {
          await this.stateRepo.deleteSyncState(op.file_path);
        }

        if (this.stateRepo) {
           const etag = result && result.etag ? result.etag : null;
           // Persist the remote id/etag for providers that return one (Drive always; many
           // WebDAV servers omit the ETag header on PUT). Only touch remote_etag when we
           // actually got one.
           if (etag) {
             await this.stateRepo.updateRemoteState(syncedPath, etag, (result && result.remoteId) ?? null, Date.now());
           }

           if (op.operation === "write" && op.content) {
             const shaStr = await sha256Bytes(op.content);

             // Advance the merge base to the just-pushed content. This MUST happen even
             // when the server returns no ETag on PUT: if the base never advances, the next
             // pull reconciles the user's *next* local edit against a stale base and
             // produces spurious .CONFLICT files (and overwrites local config such as a
             // .base file's view settings). Without an etag we leave remote_etag untouched;
             // the next pull reconciles once (local == base -> fast-forward, no conflict)
             // and records the etag then.
             await this.stateRepo.updateBaseState(syncedPath, shaStr, etag);
             // Only text files keep a base_text for 3-way merge; decoding binary content
             // to text would corrupt the stored base. Binary files record only the hash.
             // Guarded (P1 conflict-race): local_sha256 is only adopted while it still
             // equals the value read at push start — a save that landed during the
             // upload keeps its newer hash (the base still advances unconditionally).
             if (isTextFile(syncedPath)) {
               const textContent = new TextDecoder().decode(op.content);
               await this.stateRepo.updateLocalHashAndBaseTextGuarded(syncedPath, shaStr, textContent, expectedLocalSha);
             } else {
               await this.stateRepo.updateLocalHashGuarded(syncedPath, shaStr, expectedLocalSha);
             }
             // The push round-trip completed and the base advanced: retire the
             // push-journal entry (see setPendingPushSha above).
             await this.stateRepo.clearPendingPushSha(syncedPath);
           }
        }
        consecutiveFailures = 0;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[SyncEngine] push failed for ${op.operation} ${op.file_path}: ${message}`);
        const nextRetryCount = op.retry_count + 1;
        if (nextRetryCount >= this.maxRetryCount) {
          await this.queue.markRequiresManualIntervention(op.id, message);
        } else {
          // Exponential backoff strategy: 10s, 30s, 2m, 5m, 10m
          const backoffMinutes = [0.166, 0.5, 2, 5, 10];
          const index = Math.min(op.retry_count, backoffMinutes.length - 1);
          const delayMs = backoffMinutes[index] * 60 * 1000;
          const nextRetryAt = Date.now() + delayMs;

          await this.queue.incrementRetry(op.id, nextRetryAt, message);
        }

        // One failing file must not block the push of all the others (they are
        // independent) — but a failure streak means the provider itself is down.
        consecutiveFailures++;
        if (consecutiveFailures >= this.maxConsecutiveFailures) break;
      }
    }
  }
}
