# Sync retry, local writes and verified recovery

The encrypted workspace worker distinguishes transient transport failures, account authentication, integrity/authorization failures and other actionable errors. Transient failures use exponential equal jitter with a five-minute ordinary ceiling. A provider's `Retry-After` survives conversion of the HTTP response to an error; its separate ceiling is one hour. Queue attempt counts belong to individual attempted writes, while `lastSyncFailure` records the last failed cycle. Stopping an aborted request does not persist a failure or consume a queue attempt.

Local edit notifications respect an active backoff or a stopped integrity check. `runNow()` and `retryFailed()` request one coordinated manual attempt. Concurrent requests never create a second active worker. Restarting a worker starts a fresh scheduling counter, without erasing the persisted diagnosis. Desktop and mobile receive the same status, retry deadline and failure kind.

## Local mutation ordering

`vault/pathMutation.ts` shares a gate between the worker and the conflict-aware adapter for the same vault state. Keys fold slash direction, Unicode normalization and case only for locking; file identity remains unchanged. Multi-path operations acquire their complete sorted key set, including ancestors, so a directory move cannot overlap a descendant write. Failed operations release their gates.

Downloads precede the gate. The ordinary worker re-reads current sync state inside it. The editor captures its comparison base before waiting behind an incoming write, so that write cannot retroactively become the basis of an older draft. Encrypted materialization and preparation use the workspace state as the corresponding scope. A rejected payload does not advance accepted operation heads.

## Conditional uploads

A vault sync cycle pulls first and pushes after, and that order is no comparison at the moment of writing: another device that uploaded between this device's download and its upload had its version overwritten, and the next cycle on that device took the overwrite over as an ordinary remote change — its change was gone on the server and on both devices, without a conflict copy (finding 2026-10-12, reproduced against a byte-exact WebDAV server). So every upload names the version it expects on the remote (`SyncOperation.expectedRemote`, set by `SyncEngine.processQueue` from the row: `expectedRemoteOf`), and the target writes only while the remote still holds it:

| Target | Base version (`base_etag`) | No file yet (no row, or a row without base and without a remote marker) | Refused |
|---|---|---|---|
| WebDAV | `If-Match: "<getetag>"` (strong tags only) | `If-None-Match: *` | 412 |
| S3 | `if-match: "<ETag>"`, signed (a `LastModified` marker gets none: compared to the second before the upload) | `if-none-match: *` | 412; 404 for a key that is gone; 409 (another conditional write in flight) |
| OneDrive | metadata first, `cTag` (or, for a row a Business delta wrote, `eTag`) compared, then `if-match` with that answer's `eTag` (simple PUT and `createUploadSession`) | `conflictBehavior=fail` | 412; 409 `nameAlreadyExists`, also at a session's last chunk |
| Dropbox | `files/get_metadata` first, `content_hash` compared, then mode `update` on that answer's `rev` (also a session's commit) | mode `add` | 409 `path/conflict/file` |

A refusal is `RemoteChangedError`, and nothing was written. The engine leaves the write queued, due at once and without spending a retry (`SyncQueue.deferToReconcile`), and names the path to the worker (`takeRefusedPaths`): the next pull reconciles it whatever the listing says — a listing that lags, or a service whose answers disagree, would otherwise never bring that reconcile. The reconcile merges the remote version in, or keeps this device's version as a conflict copy, and the upload after it expects the version it found. A path refused five times in a row (a remote deletion whose mirroring waits for the user's answer, for example) needs a person, as after five failures (`requires_manual_intervention`), instead of waiting unseen. A newer write of the file supersedes such a write (the user's answer to the deletion question, the next edit; not the sync's own reconcile, which would lift it every cycle), and the count starts again once no write of the path waits any more or a person asks to retry. Paths the next pull does not reach (not in an incremental listing, a cycle that ends early) stay asked for. A file another device created in the window ends like any first sync of two different files: the remote version in place, the local one beside it as `.CONFLICT`.

Where a service refuses although the remote, asked for its metadata, still holds what was expected, that upload is written right after the question (the window of one request, as for Google Drive). After three such refusals on one connection — weak entity tags, a gateway that compares differently — and at once for a store that rejects the condition (501), `ConditionalWrites` (`sync/conditionalWrite.ts`) stops sending it and asks before each upload instead. A refused "no file" where, asked, there is none (a folder at the path) is no evidence and turns nothing off. OneDrive and Dropbox retry once on the new `eTag`/`rev` where only the item's metadata moved. For a large OneDrive upload Graph evaluates `if-match` when the session is created; whether it checks again at the last chunk is not documented, so the window there is the length of the upload. Dropbox checks the `rev` at the session's commit. Not conditional, as before: Google Drive (its API has no conditional update; the engine's probe of `remoteEtag` before the push stays its guard), a forced re-encrypt write, a row with a base but no marker (a server that sent no ETag on the last upload, until the next listing), the upload a rename falls back to when its remote source is gone, and deletes and moves.

None of this ran against a real provider in development; the services are played by in-memory fakes that answer as their documentation describes.

## Missing signed operations

An already verified successor may trigger a bounded direct lookup of its missing predecessor at the canonical object key. This handles incomplete provider listings. A manual sync also inspects locally retained operation chains and restores byte-identical signed copies through the immutable object-store contract. Each complete local chain must match its pinned hashes, sequence, workspace, accepted policy and signatures before anything from that chain is restored. Inspection is capped at 20,000 operations per device, and direct predecessor discovery at 512 objects per pull.

No replacement operation is signed, no checkpoint is reset and no absence is treated as successful quarantine validation. A device without a complete valid copy cannot reconstruct a lost operation. Existing local files, revisions and quarantine remain available. Restoring an operation does not recreate a separately lost encrypted payload.

## Sideband traffic

Comment bundles and the device roster use a bounded cache per target/vault adapter pair, retained across step instances. WebDAV and S3 provide atomic conditional GETs. Only well-formed strong ETags are cached. Cached bytes are committed after decoding and durable processing succeed. The cache holds at most 128 entries and 8 MiB, and it never crosses target identities. Cleanup verification still performs a fresh unconditional read.

Providers without conditional reads keep their original GET path. An extra metadata request for each tiny sideband file would increase request count; there is no speculative stat-before-download optimization. Transfer counters distinguish requests, payload bytes and 304 responses. Headers, encryption and protocol checks remain part of the provider/consumer contract.

## Targeted checks

- `workspace-sync-retry.test.ts`: offline recovery, bounded scheduling, account/integrity stops, cancellation, restart and concurrent manual requests.
- `sync/local-write-interleaving.test.ts` and `workspace-personal.test.ts`: held incoming writes overlapping actual local saves; both versions remain available.
- `sync/upload-window.test.ts` and `sync/conditional-upload.test.ts`: another device's upload between this device's pull and its push, a file created on both sides in that moment, a note whose conflict is open and another device that contradicts its own text; the condition each target sends, its refusal and the fallback for services that do not evaluate it.
- `workspace-operation-recovery.test.ts`: exact signed restoration, incomplete/damaged copies, immutable remote conflicts and unchanged heads after payload rejection.
- `sideband-read-cache.test.ts`, `comments-files.test.ts`, `comment-recovery.test.ts`: unchanged/changed/unreliable validators, failed processing, fallback traffic and retained foreign sources.
- Mobile `profileConvergence.test.ts`: 60 idle cycles with device switching, one actual profile change, then quiet convergence.
