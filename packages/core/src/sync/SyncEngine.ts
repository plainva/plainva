import { SyncQueue } from "./SyncQueue.js";
import { ISyncTarget, SyncContentRef } from "./ISyncTarget.js";
import { SyncStateRepository } from "../vault/SyncStateRepository.js";
import { IVaultAdapter, type VaultFileInfo } from "../vault/IVaultAdapter.js";
import { findCollidingPath, foldPathForCollision, foldPathNormalization, isTwinSpelling, toPathIdentity, type NameCollision } from "./pathIdentity.js";
import { withPathSpellings } from "./spellingSyncTarget.js";
import { isTextFile } from "./fileType.js";
import { textOfFileBytes } from "../textFileShape.js";
import { hasAppleDoubleHeader, isAppleDoubleName, isSystemJunkPath } from "../vault/systemJunk.js";

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * From here on a write is streamed from disk instead of read into memory —
 * provided the shell can (`ContentRefResolver`) and the target accepts it.
 *
 * Below the threshold the buffer path stays: it keeps `base_text` for the
 * 3-way merge, and for ordinary notes the extra native round trip would cost
 * more than it saves. Eight megabytes is far above any note and far below the
 * size at which the IPC boundary becomes the problem (issue #48).
 */
export const STREAM_UPLOAD_MIN_BYTES = 8 * 1024 * 1024;

/**
 * Asks the shell for a streaming handle for `filePath`, or null when the file
 * is smaller than `minBytes`, unreachable, or the shell cannot stream at all.
 * Injected like `fetch`, so the core stays free of platform APIs.
 */
export type ContentRefResolver = (
  filePath: string,
  minBytes: number,
) => Promise<SyncContentRef | null>;

export class SyncEngine {
  private readonly maxRetryCount = 5;
  /**
   * Stop the cycle after this many failures in a row: one poisoned file must
   * not starve the others (each op fails independently and we move on), but a
   * streak of failures looks like a provider/network outage where trying every
   * remaining op would only burn their retry budgets.
   */
  private readonly maxConsecutiveFailures = 3;

  /** Paths are identities here; the proxy finds the remote's spelling (ADR 0016). */
  private readonly target: ISyncTarget;

  constructor(
    private readonly queue: SyncQueue,
    target: ISyncTarget,
    private readonly vault: IVaultAdapter,
    private readonly stateRepo?: SyncStateRepository,
    /** Optional; without it every write takes the buffer path, as before. */
    private readonly resolveContentRef?: ContentRefResolver
  ) {
    this.target = withPathSpellings(target);
  }

  /**
   * A queued operation on operating-system bookkeeping (E10). Fixed names by
   * path; an AppleDouble sidecar only for a DELETE, where the bytes are gone
   * and the path-only rule applies: `._x` counts while `x` is still here or
   * still known to sync. Writes of `._*` are decided by their header instead.
   */
  private async isSystemJunkOperation(op: { operation: string; file_path: string; new_path?: string | null }): Promise<boolean> {
    if (op.operation === "rename") return !!op.new_path && isSystemJunkPath(op.new_path) && isSystemJunkPath(op.file_path);
    if (isSystemJunkPath(op.file_path)) return true;
    if (op.operation !== "delete") return false;
    const slash = op.file_path.lastIndexOf("/");
    const name = op.file_path.slice(slash + 1);
    if (!isAppleDoubleName(name)) return false;
    const companion = `${op.file_path.slice(0, slash + 1)}${name.slice(2)}`;
    if (await this.vault.exists(companion).catch(() => false)) return true;
    return !!(this.stateRepo && (await this.stateRepo.getSyncState(companion).catch(() => null)));
  }

  /**
   * Where `path` stands on this device (issue #112, ADR 0016): `present` when
   * the adapter lists exactly this identity, `{ twin }` when it lists a name
   * that differs only in letter case or — for a twin spelling — Unicode
   * normalization, `absent` otherwise. Walks the path one segment at a time
   * through the local listings, so a twin anywhere in the chain counts: an
   * exact segment is followed; a missing one without a twin ends the walk.
   * `listings` caches each folder for one pass.
   *
   * The adapter lists identities, so a folder stored decomposed on disk is
   * `present` under its composed identity — it is the same folder.
   *
   * A listing that fails for any reason other than a missing folder throws:
   * "could not look" must not be read as "no twin" in front of a DELETE.
   */
  private async localPresence(path: string, listings: Map<string, Promise<VaultFileInfo[] | null>>): Promise<"present" | "absent" | { twin: string }> {
    // An adapter without listings (test doubles) cannot hold a twin we could see.
    if (typeof this.vault.listDir !== "function") return "absent";
    const segments = path.replace(/\\/g, "/").split("/").filter((s) => s.length > 0);
    let dir = "";
    for (let i = 0; i < segments.length; i++) {
      let listing = listings.get(dir);
      if (!listing) {
        const folder = dir;
        listing = this.vault.listDir(folder, false).catch((err: unknown) => {
          if ((err as { name?: string } | null)?.name === "VaultFileNotFoundError") return null;
          throw err;
        });
        listings.set(folder, listing);
      }
      const entries = await listing;
      if (!entries) return "absent";
      const names = entries.map((e) => e.name ?? e.path.slice(e.path.lastIndexOf("/") + 1));
      const segment = segments[i]!;
      if (names.includes(segment)) {
        dir = dir ? `${dir}/${segment}` : segment;
        continue;
      }
      const twin = findCollidingPath(segment, names);
      if (!twin) return "absent";
      return { twin: [...(dir ? [dir] : []), twin, ...segments.slice(i + 1)].join("/") };
    }
    return segments.length > 0 ? "present" : "absent";
  }

  /**
   * The spelling under which the remote already holds a FOLDER that `path`
   * would twin — same name up to Unicode normalization or letter case, other
   * bytes — or null (issue #112). Evidence is the sync state: every folder
   * that carries a file the remote confirmed. Walks the chain, so a twin at any
   * level counts; an exact known folder is followed. `index` maps each folded
   * known folder to its actual spellings and is built once per pass.
   */
  private async findRemoteFolderTwin(path: string, index: { value?: Map<string, Set<string>> }): Promise<string | null> {
    if (!this.stateRepo) return null;
    if (!index.value) {
      const folders = new Map<string, Set<string>>();
      for (const [known, state] of await this.stateRepo.getAllStates()) {
        if (!state.remote_etag) continue;
        const parts = known.split("/");
        for (let i = 1; i < parts.length; i++) {
          const folder = parts.slice(0, i).join("/");
          const key = foldPathForCollision(folder);
          const set = folders.get(key) ?? new Set<string>();
          set.add(folder);
          folders.set(key, set);
        }
      }
      index.value = folders;
    }
    const segments = path.replace(/\\/g, "/").split("/").filter((s) => s.length > 0);
    for (let i = 1; i <= segments.length; i++) {
      const prefix = segments.slice(0, i).join("/");
      const spellings = index.value.get(foldPathForCollision(prefix));
      if (!spellings) return null;
      if (spellings.has(prefix)) continue;
      // The same name in the other normalization form is the same folder since
      // ADR 0016: the target finds the spelling the remote holds and writes
      // into it. Only letter case still makes a second folder on a
      // case-sensitive server.
      const nfc = foldPathNormalization(prefix);
      if ([...spellings].some((s) => foldPathNormalization(s) === nfc)) continue;
      const twin = [...spellings].sort()[0]!;
      return [twin, ...segments.slice(i)].join("/");
    }
    return null;
  }

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
      /** The worker's guard snapshot. Later arrivals wait for its next decision. */
      allowedDeleteIds?: ReadonlySet<number>;
      /**
       * Receives the queued DELETEs held back because this device has a twin
       * of the path (issue #112) — the same facts, and so the same card, as the
       * pull side's collisions. Without it they are still held, only unreported.
       */
      collisions?: NameCollision[];
    }
  ): Promise<void> {
    let pending = await this.queue.getPendingOperations();
    if (opts?.skipDeletes) {
      pending = pending.filter((op) => op.operation !== "delete");
    }
    if (opts?.allowedDeleteIds) {
      pending = pending.filter((op) => op.operation !== "delete" || opts.allowedDeleteIds!.has(op.id));
    }
    if (pending.length > 0) {
      console.log(`[SyncEngine] pushing ${pending.length} pending operation(s)`);
    }
    let consecutiveFailures = 0;
    let pushIdx = 0;
    const localListings = new Map<string, Promise<VaultFileInfo[] | null>>();
    const remoteFolders: { value?: Map<string, Set<string>> } = {};
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
      /** Hash of the bytes actually handed to the target, carried to the base
       *  update below. It used to be computed a second time from the same
       *  buffer, which on a large attachment means hashing it twice for nothing. */
      let pushedSha: string | null = null;
      try {
        // Empty-folder sync (2026-07-17): a queued mkdir creates the folder
        // remotely via the optional createVaultFolder every provider implements
        // ("already exists" counts as success there). A provider without it
        // completes the op as a no-op — folders then materialize with their
        // first file, the old behavior. No sync_state is involved: folder
        // existence is not tracked, only files are.
        // Vault-relative, never `createFolder`: that one is the pickers' call
        // and counts from the ACCOUNT root, which made every folder created in
        // Plainva appear a second time, empty, at the top of the cloud (#112).
        // Operating-system bookkeeping never travels (issue #110, E10). A
        // queued upload, folder or remote delete of `.DS_Store` & co. — left
        // over from before the rule, or written by an import — is dropped here.
        // A copy an older version uploaded stays in the cloud untouched.
        if (await this.isSystemJunkOperation(op)) {
          await this.queue.markSynced(op.id, op.file_path, op.file_path);
          consecutiveFailures = 0;
          continue;
        }
        // A twin spelling (ADR 0016): a second name that looks like its
        // composed form and stands next to it. It is never synced — the pair
        // is reported every pass until one of the two is renamed. A queued
        // DELETE of one goes nowhere: this device never put a twin on the
        // remote, and what the remote holds under that spelling is not ours
        // to remove. A spelling that is no twin (a row from before the
        // identity was NFC, a caller's decomposed input) is the composed
        // identity and syncs as such.
        const twinPath = [op.file_path, op.new_path].find((p): p is string => !!p && isTwinSpelling(p));
        if (twinPath) {
          if (op.operation === "delete") {
            console.warn(`[SyncEngine] dropping deletion of the twin spelling ${op.file_path}: never synced under that name`);
            await this.queue.markSynced(op.id, op.file_path, op.file_path);
            consecutiveFailures = 0;
            continue;
          }
          if ((await this.localPresence(twinPath, localListings)) === "present") {
            console.warn(`[SyncEngine] not pushing ${op.operation} of the twin spelling ${twinPath}`);
            const pair = { path: twinPath, twin: toPathIdentity(twinPath) };
            if (opts?.collisions && !opts.collisions.some((c) => c.path === pair.path && c.twin === pair.twin)) {
              opts.collisions.push(pair);
            }
            continue;
          }
          op = {
            ...op,
            file_path: toPathIdentity(op.file_path),
            ...(op.new_path ? { new_path: toPathIdentity(op.new_path) } : {}),
          };
        }
        // The twin lock on the push side (issue #112). A DELETE whose path has
        // a twin here that differs only in letter case is the SAME file for
        // Drive, OneDrive, Dropbox, Windows and macOS — and on a case-sensitive
        // server the one copy it still holds under the old spelling. The pull
        // side has refused to mirror such a deletion since 2026-08-21; pushing
        // it removed the remote file instead. It stays queued without spending
        // a retry and is reported every pass until one of the two names
        // changes.
        //
        // A DELETE of a path that is right here under the very same identity
        // is stale: the file was recreated, or the deletion was read from a
        // listing that saw another spelling (issue #112 before ADR 0016). It is
        // dropped, never pushed: the remote copy is the one this file syncs
        // with, and a recreated file queues its own upload.
        if (op.operation === "delete") {
          const presence = await this.localPresence(op.file_path, localListings);
          if (presence === "present") {
            console.warn(`[SyncEngine] not pushing deletion of ${op.file_path}: it exists on this device`);
            await this.queue.markSynced(op.id, op.file_path, op.file_path);
            consecutiveFailures = 0;
            continue;
          }
          if (presence !== "absent") {
            const twin = presence.twin;
            console.warn(`[SyncEngine] not pushing deletion of ${op.file_path}: this device has ${twin} (capitalization/accents)`);
            if (opts?.collisions && !opts.collisions.some((c) => c.path === op.file_path && c.twin === twin)) {
              opts.collisions.push({ path: op.file_path, twin });
            }
            continue;
          }
        }
        // The same lock for a folder the remote already holds in the other
        // spelling (issue #112): a Finder-made folder is decomposed, the
        // server's copy composed. A byte-exact WebDAV server (HiDrive) takes
        // the MKCOL as a second, identical-looking folder, and a desktop
        // client syncing the same folder renames it to "Name(1)", "Name(2)"…
        // Held and reported like a twin DELETE — since ADR 0016 only for a
        // letter-case twin: a folder the remote holds in the other
        // normalization form is the same folder, and the target writes into
        // the spelling the remote already has (as it does for every PUT).
        if (op.operation === "mkdir") {
          const twin = await this.findRemoteFolderTwin(op.file_path, remoteFolders);
          if (twin) {
            console.warn(`[SyncEngine] not creating folder ${op.file_path}: the remote holds ${twin} (capitalization/accents)`);
            if (opts?.collisions && !opts.collisions.some((c) => c.path === op.file_path && c.twin === twin)) {
              opts.collisions.push({ path: op.file_path, twin });
            }
            continue;
          }
        }
        if (op.operation === "mkdir") {
          if (this.target.createVaultFolder) await this.target.createVaultFolder(op.file_path);
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
              // A large file is handed over as a handle, not as bytes: carrying
              // 90 MB through the IPC boundary is what froze the app (issue
              // #48). The hash comes from the same native pass, so nothing reads
              // the file twice. Everything below the threshold — and every
              // target that has to see the bytes, such as the encryption
              // wrapper — keeps the buffer path unchanged.
              const ref = this.target.acceptsContentRef && this.resolveContentRef
                ? await this.resolveContentRef(op.file_path, STREAM_UPLOAD_MIN_BYTES)
                : null;
              if (ref) {
                op.contentRef = ref;
                op.content = undefined;
              } else {
                op.content = await this.vault.readBinaryFile(op.file_path);
                // An AppleDouble sidecar (E10): with the bytes at hand, the
                // header decides — a user's own `._notes.md` still uploads.
                if (isAppleDoubleName(op.file_path.slice(op.file_path.lastIndexOf("/") + 1)) && hasAppleDoubleHeader(op.content)) {
                  await this.queue.markSynced(op.id, op.file_path, op.file_path);
                  consecutiveFailures = 0;
                  continue;
                }
              }
              const currentSha = ref ? ref.sha256 : await sha256Bytes(op.content!);
              pushedSha = currentSha;

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
          let directory = false;
          try {
            directory = (await this.vault.getFileInfo?.(op.new_path))?.isDirectory ?? false;
          } catch (err: any) {
            if (err.name !== 'VaultFileNotFoundError') throw err;
            // A later rename/delete may already have removed this local path.
            await this.queue.markSynced(op.id, op.file_path, op.new_path);
            consecutiveFailures = 0;
            continue;
          }
          if (directory) {
            if (!this.target.createVaultFolder) throw new Error("Sync target cannot recover a missing rename source folder");
            // A partial walk must not masquerade as a complete recovery.
            const report = this.vault.listDirReport ? await this.vault.listDirReport(op.new_path, true) : null;
            if (report?.skipped.length) throw new Error("Cannot recover renamed folder: local entries could not be read");
            const entries = report?.files ?? await this.vault.listDir(op.new_path, true);
            await this.target.createVaultFolder(op.new_path);
            for (const entry of entries) {
              if (entry.path.startsWith(".plainva") || entry.path.includes(".CONFLICT")) continue;
              if (entry.isDirectory) await this.queue.queueMkdir(entry.path);
              else await this.queue.queueWrite(entry.path, { force: true });
            }
            // Children are durable queue entries before the parent MOVE retires;
            // a restart or failed child upload can resume without losing them.
            await this.queue.markSynced(op.id, op.file_path, op.new_path);
            consecutiveFailures = 0;
            continue;
          }
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
          pushedSha = await sha256Bytes(content);
          if (this.stateRepo) {
            await this.stateRepo.setPendingPushSha(op.file_path, pushedSha);
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

           // A streamed write has no buffer — but its base MUST still advance,
           // or the next cycle would reconcile against a stale base and push
           // the same file forever.
           if (op.operation === "write" && (op.content || op.contentRef)) {
             // Computed once, above, on the very bytes that were pushed.
             const shaStr = pushedSha ?? await sha256Bytes(op.content!);

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
             // A streamed file keeps no base_text either: decoding megabytes
             // just to store them would undo the point of streaming. The hash
             // alone still carries the merge base; the 3-way merge falls back
             // to the binary path, which is what a file that large is anyway.
             if (op.content && isTextFile(syncedPath)) {
               // The base is the file's text as every adapter reads it, mark
               // included: without it the base no longer hashed to the bytes
               // that were pushed, and the next change from elsewhere found
               // "no base version" for a file that starts with a mark.
               const textContent = textOfFileBytes(op.content);
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
