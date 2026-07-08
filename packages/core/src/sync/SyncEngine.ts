import { SyncQueue } from "./SyncQueue.js";
import { ISyncTarget } from "./ISyncTarget.js";
import { SyncStateRepository } from "../vault/SyncStateRepository.js";
import { IVaultAdapter } from "../vault/IVaultAdapter.js";
import { isTextFile } from "./fileType.js";

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
    onProgress?: (current: number, total: number) => void
  ): Promise<void> {
    const pending = await this.queue.getPendingOperations();
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
      try {
         if (op.operation === "write") {
            try {
              op.content = await this.vault.readBinaryFile(op.file_path);

              // Skip push if local content is identical to base_sha256 (e.g. from a recent pull)
              if (this.stateRepo) {
                const state = await this.stateRepo.getSyncState(op.file_path);
                if (state && state.base_sha256) {
                   const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", op.content as BufferSource);
                   const hashArray = Array.from(new Uint8Array(hashBuffer));
                   const currentSha = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

                   if (currentSha === state.base_sha256 && state.remote_etag) {
                     // Already in sync with the server, skip push.
                     await this.queue.markSynced(op.id, op.file_path, op.file_path);
                     consecutiveFailures = 0;
                     continue;
                   }
                }
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
             const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", op.content as BufferSource);
             const hashArray = Array.from(new Uint8Array(hashBuffer));
             const shaStr = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

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
             if (isTextFile(syncedPath)) {
               const textContent = new TextDecoder().decode(op.content);
               await this.stateRepo.updateLocalHashAndBaseText(syncedPath, shaStr, textContent);
             } else {
               await this.stateRepo.updateLocalHash(syncedPath, shaStr);
             }
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
