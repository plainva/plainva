# Sync path identity

How Plainva names a file inside the app, on disk and on a remote, and why
those can differ. The decision and its reasons are in
[ADR 0016](../adr/0016-path-identity-nfc.md); this page is the working map for
anyone touching the sync, an adapter or a provider.

## Two words

- **Identity** — the NFC form of the vault-relative path
  (`toPathIdentity`). Everything inside Plainva uses it: the index (`files`,
  `fts_notes`), `sync_state`, the offline queue, tabs, links, the UI.
- **Stored spelling** — the bytes a store actually holds. A folder made in
  Finder is decomposed; a WebDAV server keeps whatever was sent; APFS finds
  either form, ext4, NTFS, Android and S3 only the exact bytes.

A path without spelling variants (`hasSpellingVariants` is false: ASCII,
scripts without composed characters) has identity = spelling and never touches
any of the machinery below.

## Where identities are made

| Boundary | Code |
|---|---|
| Local walk, stat, watcher | `LocalVaultAdapter` (core), `TauriVaultAdapter` (desktop), `CapacitorVaultAdapter` and `ExternalVaultAdapter` (mobile) — each holds a `PathSpellings` and calls `observe` on every listing and `identityOfStored` on single paths and watcher events |
| Remote listings, full and incremental | `withPathSpellings(target)` (`spellingSyncTarget.ts`), applied by `SyncEngine` and `SyncWorker` to whatever target they are given; one proxy per target object |
| Names a person types | desktop `FileTree` (new item), `renameToName`; mobile `renameReport`, `createFolder`, `renameFolder` |
| Stored rows from older versions | `migratePathIdentity` at schema init (`meta.path_identity_version`) |

## Where spellings are resolved

Every base adapter resolves the identity before each native call (`realPath`,
`withStoredSpelling` for reads, which retries once when a remembered spelling
went stale). Wrappers (backup, queue, conflict awareness) pass identities
through untouched. A native call that bypasses the adapter — the streamed
upload's content reference — asks `adapter.realPath` first (both shells'
`createContentRefResolver`).

Remotely, the proxy resolves before `push` (PUT, MKCOL via `ensureDir`, MOVE
source and destination, DELETE), `createVaultFolder`, `download`,
`downloadConditional`, `remoteEtag`, `stat` and `probeExists`. What the
cycle's listing showed is used first; where it showed nothing, a target with
`listVaultFolder` (WebDAV: one PROPFIND with Depth 1) is asked once per folder
and pass. The pickers' `listFolders`/`createFolder` count from the account
root and are not touched.

The rule for a segment, in order: a spelling remembered for the identity
prefix; the exact name (an existence check, cheap on disk); the other
normalization form in the parent's listing; otherwise the name is new and is
created in NFC — and so is everything below it.

## Twins

Two spellings of one name side by side in one folder (only a byte-exact store
can hold them) are twins. The NFC one — or the first in code-point order —
takes the identity; the other keeps its bytes, which makes its identity
non-NFC (`isTwinSpelling`). Everything under a twin folder stays in the twin.

A twin identity is never synced:

- the worker excludes it from reconcile, deletion mirroring and the
  empty-folder pass, and reports it (`reportTwinSpellings`) on the "Two
  spellings, one file" card; a sync row of a twin that is gone here and on the
  remote is forgotten on the next full listing;
- the engine holds a queued write, mkdir or rename of a twin that exists here
  (reported), drops a queued DELETE of one (Plainva never uploaded a twin, so
  it does not delete one), and rewrites a non-NFC path that is no twin to its
  identity;
- `enqueueLocalOnlyFiles` skips it.

The O2 locks from issue #112 remain as the safety net for what identity does
not cover: a queued DELETE whose name exists here only in other letter case is
held and reported, and so is a MKCOL of a folder the remote holds in other
letter case. A DELETE of a path that exists here under the same identity is
dropped as stale.

### The card and its two actions

The worker reports the pairs (`onNameCollisions`) and, right after, the same
collisions as one case per name (`onNameCollisionCases`, `nameTwins.ts`):
where the second copy lives (here, in the cloud), size and time of each copy,
and whether its bytes are the same as the composed file's. A cloud copy is
downloaded once per ETag. The worker keeps what the last full listing showed
(`remoteView`, updated by change listings), so a cloud twin stays on the card
between two full listings. Both shells render it with `NameCollisionsNotice`
(`packages/ui`) and offer two actions, each behind a question:

- **Remove duplicates** (`resolveNameCollisions("remove-duplicate")`): only a
  twin whose every copy has the same bytes as the composed file at that
  moment. Here, through the backup adapter (it snapshots the file first);
  in the cloud, after a snapshot of the bytes in the composed file's version
  history (`BackupVaultAdapter.keepSnapshot`), by the twin's own stored
  spelling through the same target call every remote deletion takes.
- **Keep both** (`"keep-both"`): a twin with other bytes becomes a file of its
  own under a free composed name (`freeCopyPath`: `Name (2).md`, free in
  letter case and Unicode form, here and in the cloud). The copy here is
  renamed; the cloud's copy is written here first and checked; either is
  queued as a new file, then the twin goes. A copy that equals the composed
  file or an existing numbered copy is not written twice. A letter-case pair
  is kept by renaming this device's file to a free name through the shell's
  own rename, so links follow (`resolveNameCollisionCases`).

Both run between cycles, never beside one, on a fresh full listing, and
compare again before they act. A twin's removal never goes through the queue
(the engine drops a queued twin DELETE) or the deletion journal (it names
paths by identity, so an entry would make every other device delete the
composed note). After a cloud removal the worker lists again; should the
composed file be gone too, the copy here goes up again as a new file. The
composed file is never touched.

## Migration

`migratePathIdentity` runs in one transaction and skips rows that are
already NFC, so an interrupted run changes nothing and a repeated run is a
no-op. It never merges: a sync row whose NFC key is taken keeps its spelling
(and becomes a twin as above); a derived index row in that situation is
dropped and re-read by the next scan; a queued DELETE of a spelling while the
index held the same name in another spelling is dropped. Its report is kept in
`meta.path_identity_report` and logged once.

The encrypted workspace's object table is NFC by protocol already
(`workspace/path.ts`) and is not touched.

## Cost

Measured with `packages/core/scripts/benchmark-path-identity.ts` (3000 notes,
four of twelve folders accented, two of those stored decomposed, byte-exact
in-memory WebDAV). Two alternating runs each on 2026-09-30, a shared
four-core machine under load, so the spread is noise more than signal:

| Step | before (ms) | after (ms) |
|---|---|---|
| cold full index | 7702 / 9635 | 7680 / 7563 |
| warm full index, unchanged | 112 / 93 | 128 / 321 |
| steady sync cycle, full listing, nothing to do | 452 / 409 | 324 / 347 |
| full index after 60 edits | 734 / 514 | 600 / 592 |
| sync cycle pushing 60 edits | 3267 / 1337 | 2375 / 800 |

No step got measurably slower. Only accented paths pay: a full walk fills the spelling map, so the
reads after it need no extra call; a new accented name costs one existence
check or one folder listing; on the remote, one PROPFIND per folder the
listing did not show, per pass.

## Tests

- `test/sync/path-spellings.test.ts` — the resolver and the local adapter on a
  byte-exact disk.
- `test/sync/path-identity-webdav.test.ts` — PUT, MKCOL (`ensureDir` and
  queued mkdir), MOVE, DELETE, downloads and probes against a byte-exact
  WebDAV server (`test/helpers/byteExactDav.ts`); decomposed hrefs under a
  composed base URL.
- `test/sync/issue-112-loop.test.ts` — the whole chain: decomposed folder
  here, composed on the server, two cycles, no second folder, no DELETE;
  remote twins reported, not copied; empty folders; `enqueueLocalOnlyFiles`.
- `test/path-identity-migration.test.ts` — with and without twins,
  idempotent, interrupted.
- `test/sync/push-twin-delete.test.ts` — the O2 locks as they stand now.
- `test/sync/name-twins.test.ts` — the card's cases and both actions through
  the whole chain against a byte-exact WebDAV server, here and in the cloud.
