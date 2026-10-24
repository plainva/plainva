# Vault watcher and indexing

How a change on disk reaches the index, what makes the app walk the whole vault, and why neither may ever hold up typing. Written with issue #122 ("Saving makes typing really hard", Windows, 0.8.4); issue #110 (files moved outside Plainva, macOS) is the reason the watcher reports every path.

The rule behind all of it: **performance comes first — typing must never stall.** A reconcile of the index is background work. It may take its time; it may not take the UI thread, and when it finds nothing changed it may not make anything reload.

## The way of a change (desktop)

```
notify (ReadDirectoryChangesW / FSEvents / inotify)
  └─ vault_watch.rs      classify: create | modify | remove | rename | any | rescan | error
                         gathered for 150 ms, every path of every event kept (issue #110);
                         events of the app's own temp file dropped
      └─ mapNativeWatchBatch (TauriVaultAdapter.ts)   absolute → vault-relative; what cannot be
                                                      attributed becomes the rescan marker
          └─ createWatchBatchCollector (watchBatch.ts) the 1 s debounce window: per path the
                                                       STRONGEST kind; internal paths dropped
              └─ createIncrementalIndexQueue           one batch at a time; per path
                  └─ VaultIndexer.inspectPath          indexed | removed | unchanged |
                                                       directory | folder-gone
                  └─ VaultIndexer.reconcileFolder      a flat look at one folder
                  └─ VaultIndexer.indexVaultFull       the full scan — only when escalated
                      └─ onBatchDone → version bumps   only for what actually changed
```

The phone has no watcher. Nothing there scans because of a save; the full scan runs when a vault opens, on the return to the app (at most once a minute), on pull-to-refresh and after folder operations.

## The way of a change (phone)

Between two full scans the phone's index knows what the app tells it. Every path somebody wrote, moved here or removed is therefore handed to one door, `MobileVault.reindexPaths` (`apps/mobile/src/services/pathReindex.ts`): the savers, the restores, the conflict resolution, the share inbox, the task sync and both sync workers call it — and so does every place that writes a file's bytes itself: a photo or a file put into a note, a voice memo, a mail's attachment saved, a mail filed as a note or as `.eml`, the attachments of something shared to Plainva (`writesTellTheIndex.test.ts` holds that from the sources; until 2026-10-12 these reached the index only with the next full scan). `indexFile` and `indexPath` — the two calls that follow one path — are made nowhere else, with one exception that is not a write: a note opened in an external folder has its timestamp checked (`pathReindex.test.ts` holds that from the sources).

Beside the door stays what is another kind of work, and none of it takes a turn there: the full scan and the folder re-read, which look at the disk themselves (among others the import, a vault template, a folder moved or deleted in the app and the pull-to-refresh end in one); the app's own move, which re-keys rows without reading a file (`relocatePathInIndex`); the app's own deletion (`removePathFromIndex`); and that one look at a note opened in an external folder.

```
a save · a restore · a move · a pull (worker.onFilesChanged)
  └─ MobileVault.reindexPaths       one path at a time, whoever asked
      ├─ the file is there → VaultIndexer.indexFile    as it lies there, no timestamp asked;
      │                                                a note as a note, anything else as an attachment
      ├─ the file is gone  → VaultIndexer.indexPath    the row leaves in a transaction of its own;
      │                                                then onLocalFileDeleted
      └─ the pass failed   → once more: a file a moment later, a removal once the full scan
                             under way is through; then left to the next full scan and counted
```

- **Every kind of file.** Until 2026-10-09 `indexFile` took `.md` and did nothing for anything else, without a word. On the desktop the watcher passed by a moment later; on the phone a database saved there, a table or a settings file a pull brought, and a restored file stayed unknown to the index until the next full scan. `indexFile` now makes the split every other route makes. It does not ask the file's timestamp — the caller knows the file changed, and a storage provider that rounds its timestamps must not talk the index out of it. `indexPath` asks, and is the door for "something may have happened here".
- **A removed path leaves.** A file a pull deleted used to stay in the index — a path that is gone could not be read and was skipped. Only "it is not there" counts as gone; a read that failed for another reason concludes no deletion. The removal is reported to the shell like any other (`onLocalFileDeleted`, with the index row that went); for a file the plain sync worker removed, its mark answers "that was mine" and nothing is queued. The mark is bound to the file the worker removes, not to its name (since 2026-10-12): to the row the index holds for it when the worker asks, and to the file's own time — the read stamp (`IndexedRowStamp`) every row a pass writes for exactly this file carries, also one written or read again after the question, by a scan that had read the file before it went. A later file of that name carries a time of its own and is not answered. Before, the mark was a name and an hour, and a mark nobody asked for — the index held no row for the file — swallowed the next real deletion of that name. What the worker of an encrypted workspace wrote or removed, the workspace answers itself, in both shells: a report of a file whose bytes are those of its object's current revision, or of a path where neither a file nor a live object is, goes neither into the workspace's queue nor into a copy for a change the member may not make (`PermissionedVaultAdapter.authorizeExternalChange`, asked under the worker's path lock). Until 2026-10-12 the phone queued every note another device changed again, as a revision of the same text, and a member who may only read got a copy of it; the desktop kept a list of the paths the worker had just written, which a report that never came left standing for the next real change.
- **One at a time.** The phone's index database is a single connection, and its SQLite plugin refuses a second transaction while one is open; since 2026-10-12 the phone's adapter has its transactions wait for one another, as the desktop's always has ([Vault adapter chain](Vault_Adapter_Chain.md), last section). Besides, the single paths of all callers, and the queue entries a pass sets off through the indexer's hooks, take turns in the order they were asked for (`createIndexTurns`): a caller waits for the turns asked for before its own. Everything else that opens a transaction on that database is not in that row — a full scan, a folder re-read, the app's own move in the index, the look at a note opened in an external folder, every save's entry in the sync queue, the sync worker's queue operations, the calendar cache; a pass that meets one of them waits for it at the database. A full scan that found something to write holds its transaction until it is through: a file the index is told of meanwhile is indexed after it, and its caller waits that long. A pass that fails for a reason of its own is tried once more 400 ms later; what fails twice is left to the next full scan and counted. A call with a removal that failed waits for the scan under way before its second attempt: the worker's mark lives in memory, for an hour, and a removal that is left to the next full scan is reported by that scan — to the mark only if this run of the app and that hour still last. Where the second attempt changed the index, the screens are told once more (`m-vault-changed`).
- **What a pass announces is not let go at a failure.** The uploads and remote deletions a pass sets off are queued by the shell's hooks — for the plain sync each in a transaction of its own. For a file another program changed or removed that is the only word the sync gets, and it is said once. An entry that fails waits for a full scan under way and a moment more, and is tried once again (`createAnnouncer`); what fails then is written to the diagnostics instead of being dropped without a trace. The entries have a row of their own, so that none announced later overtakes one that waits, and take a turn in the door's row only for each attempt — the door does not stand behind an entry that waits. A deletion is asked before each attempt whether the file is still gone: an entry can be seconds old by the time its turn comes, and a file that is back has nothing to delete.

## The merge base belongs to the sync

A `sync_state` row carries two things that are easy to take for one: what the app last saw on this device (`local_sha256`), and the common ancestor with the remote (`base_sha256`, `base_etag`, `base_text`). The index renews the first. The second belongs to the sync: `base_sha256` and `base_etag` are written by the sync worker and the sync engine and by nothing else.

The index writes a base text only for a file no sync has seen: no row, or a row without `base_sha256` (the leftover of a deleted, never-synced file whose name a new file took — feedback Build 91). A row that carries `base_sha256` keeps its base text whatever the index knows about the path (`VaultIndexer.judgeSyncState`, `keepsSyncedBase`); only the local marker is renewed, and the file is announced so the shell can queue it.

That rule exists because "a row without an index entry" is also what a live file looks like for a while: a file a pull just wrote, every file after the index was dropped to be rebuilt (until 2026-10-12 the desktop's `rebuildIndex` dropped the files and kept `sync_state` on purpose; see "Rebuild the index" below), and — until the same change — a file that is no note and had just been moved in the app, whose index row was looked up by id alone. Each of them had its current text written over its merge base. A local change that had not gone up yet then counted as contained in the remote, and the next change from another device replaced it without a conflict copy (finding 2026-10-09; `packages/core/test/sync/merge-base-and-index.test.ts` walks both ways there on two devices).

The write chain follows the same rule since 2026-10-12. `ConflictAwareVaultAdapter.writeTextFileLocked` wrote a base text without a sync in two places — after it merged a change from outside into a write of the app, and where it puts right a local marker an earlier reading of the file left (still met where a platform's text reader hands a file out without its byte order mark, while the sync recorded the hash of its bytes) — and left `base_sha256` standing. Walked on two devices: another program changes line 1 of a note, the app writes line 4 outside an editor, the chain merges both and keeps the merged text as the base; before that device uploads, the other one changes line 7. The next sync then merged against the device's own text — the other device's version came out, both local changes were gone, no conflict copy. Both places now call `SyncStateRepository.updateLocalHashAndUnsyncedBaseText`: the marker is renewed, the text is recorded only on a row without `base_sha256`. The condition stands in the SQL statement, not in a look at the row beforehand, so a first upload that finishes in between does not find its base text replaced a moment later.

### Two readers of one column, and what that costs

The base text has two readers. For the sync it is the common ancestor with the remote. For the write chain it is the text the app last knew, which it merges against when a file changed under it: `local_sha256` names that text, and the chain takes the base text only where it hashes to that marker (and looks among the version snapshots where it does not). On a row a sync has recorded a base for, the sync's reading stands.

The price is paid by the chain. After a merge of its own on such a row it has no text for its new marker — the snapshots hold what was there before a write, not what was written. A **second** change from outside before the upload therefore ends, for a plain `writeTextFile`, in "base version not found" and a conflict copy instead of a merge in silence. Nothing is lost by that write: the note keeps what the other program wrote, the copy holds what the app wrote, and the upload gives the row its text back (the pushed version becomes the base, hash and text). An editor's save is not asked that price — it hands in the text it loaded (`writeEditorText`); a writer that says which text it started from needs no stored one. A file no sync has seen keeps what it had: there the column is the chain's own, and a second change from outside merges as before.

Two things about the price are not small. Where no upload comes, it stays: a vault whose sync was disconnected keeps its rows and their `base_sha256`, and nothing gives such a row its text back. And the conflict copy it leaves is an open conflict like any other, with what that brings: while it is open, the note itself may hold text that has not been uploaded yet, and a change from another device that conflicts with it is not kept a second time — the worker's "preserve the local version" returns the copy that is already there, and the note takes the remote version (the version snapshot before that write is the only trace, where the snapshot interval allows one). That gap is older than this rule and not closed by it. Should the price show in practice, the answer is a column of its own for the chain's text, not a second writer of this one.

### The sync writes hash and text together

The same disagreement had come about inside the sync (finding 2026-10-12). `SyncWorker.reconcileDownloadedFile` recorded the *result* of a reconcile as the base text and the remote version as the base hash. Where the result was ahead of the remote — both sides merged, or a local change that still waited for its upload when the server re-stamped the file — the row named the remote version and held the local one until the upload was through. An upload that was refused, deferred by the engine's look at the remote marker, or cut off left it that way, and the next change from the other device replaced the change made here, again without a conflict copy. The worker now records the remote version as the base text; the engine records the pushed version, hash and text, once the upload has gone through. Until then the write chain has no text for the marker of a merged file — the price above, for the moment between a pull and its push.

Below all writers there is a net. Before the worker merges against a base text it asks whether that text is the version `base_sha256` names (`SyncWorker.commonAncestorText`). One that is not counts as none, and the file takes the way without an ancestor: journal entries are united by their time, every other difference keeps the local version as a conflict copy and adopts the remote one. That is what happens to rows earlier versions left behind (after the chain's merge, after the index, after the worker's own), to a text file of 8 MB and more after its upload (streamed: the hash moves on, the text stays that of an earlier version), to a row torn by a crash between the two statements that write hash and text, and to whatever writes such a row in future. One kind of row is let through: until 2026-10-09 the base text of an upload was kept without the file's byte order mark while the hash was taken with it — that text is the ancestor's, short of its mark, and the mark is put back before it is merged against.

Where the remote did not change at all — its content hashes to `base_sha256`; the server only handed out a new ETag, or sends none on an upload, so that the next listing is the first to bring one — no stored text is asked for: the remote content is the ancestor. The local change merges against it and stands. Without that, a row with an unusable text turned a change nobody else had touched into a conflict copy and put the note back to the version before it; a row with a hash and no text at all did so before this rule existed.

`packages/core/test/sync/merge-base-and-write-adapter.test.ts` walks the write chain's two places, the worker's reconcile and the net on two devices, and the price with them. Who writes `base_text`:

| Writer | In a sync | What it writes |
|---|---|---|
| `SyncEngine.processQueue`, after an upload | yes | The pushed version, hash and text; no text where the pushed bytes are not UTF-8. A streamed upload moves the hash and writes no text. |
| `SyncWorker.reconcileDownloadedFile` | yes | The remote version, hash and text — whatever the reconcile made of the local file. |
| `SyncWorker`, own-push echo (text and bytes) | yes | The echoed remote version, hash and text. |
| `SyncWorker.reconcileBinaryFile` | yes | The remote version's text where it is one, none where it is not. |
| `VaultIndexer` | no | A text only for a file no sync has seen; judged from what the pass read of the row (`keepsSyncedBase`). No text for a file that is not UTF-8. |
| `ConflictAwareVaultAdapter` | no | A text only on a row without `base_sha256`; judged by the statement. |
| `SyncQueue.queueRename`, the path-identity migration | — | Move a row as it is. |

## Passes overlap

A full scan runs for seconds and lets go in between. A single path — a save, a pull, a watcher event — comes in meanwhile, and so does the app removing a file. Three rules hold where passes meet, since 2026-10-12 (`packages/core/test/vault-indexer-overlapping-passes.test.ts`):

- **What a pass found is its own.** New files and foreign changes are announced after the pass's transaction committed (`onNewLocalFile`, `onExternalModification`). The lists were fields of the indexer, emptied by every pass on its way in: a single path that met a scan threw away what the scan had found so far — even when its own transaction was refused a moment later — and those files were not announced. A new file was then queued only by the sweep of the next sync start; a foreign change of a file the remote knew, not at all. Each pass now carries its own (`IndexPass`); a pass that fails takes its findings with it and nobody else's.
- **A pass leaves alone what another pass touched since it began.** A pass decides from what it read when it began, and removes and reports when it is through; a full scan can be seconds away from its own reading. A path whose row another pass removed and reported in between was reported a second time — and the sync worker's "that deletion was mine" (`OwnDeletionRegister`) answers one question, so the second report queued a remote deletion. On the phone the overlap is built in: a return to the app starts the re-read and the sync in the same moment (each at most once a minute), and a warm start does the same. A path another pass indexed in between fared worse: a file that came back after the scan had listed its folder lost its fresh row and was reported gone while it lay on disk. A pass now neither removes nor reports a path somebody indexed or reported after it began (`VaultIndexer.stillMine`); a row that is stale after all is found by the next pass, with a reading of its own. "Indexed" starts with the asking: a single path that holds a file marks the path before it tries to write, so that a scan which is already writing — and on the phone refuses that single path — at least does not report the file gone. The app's own removal (`removePathFromIndex`) always reports — its caller knows the file went.
- **A single path that finds its file gone asks and removes in a transaction of its own, and reports after it** (`inspectPathIn`). With plain statements both rode in whatever transaction was open on the phone's one connection. The removal was reported there, the worker's mark spent — and the row back in the index when that transaction was rolled back, for the next scan to report to a register that had answered already. And the question could be answered wrongly: a scan's own removal of the row, not committed yet, read as "nothing here". On that connection the pass is now refused while another transaction is open, and the door comes again; on the desktop it waits its turn — and because that wait can be seconds, it looks at the disk once more before it removes: a file that is back keeps its row.

Three more since 2026-10-12, for the app's own moves and for a pass that fails (`vault-indexer-moved-in-the-app.test.ts`, `vault-indexer-failed-pass.test.ts`):

- **A file the app moves while a scan is under way is no deletion and no new file.** `relocatePathInIndex` re-keys the row while the scan holds its own reading of both paths; the scan reported the old path gone and announced the new one as new — a remote deletion and an upload for one move. The move now marks both ends as touched for every pass under way, and the scan leaves them to the next one.
- **A moved row is the same row.** Rows are found by path, in the full scan as in the single path; the full scan tells a row the app moved from a file that vanished by its SQLite `rowid`. Looked up by `id` — the hash of the path the row was first indexed under, which a move does not change — a moved file was taken for a new one: its creation time, its sync label and what hung on the row went. And a new file under a moved file's old name gets an id of its own (`rowIdFor`): its write deletes the id it inserts, and under the hash of its path that was the moved file's row.
- **What a failed pass already wrote is announced.** A full scan writes in batches and removes last, and decides what it removes right before it does: whatever another pass indexed or reported while the scan read the changed files is left to it (`stillMine`). On the desktop its statements commit one by one (`TauriDatabaseAdapter`, `keepsWhatAFailedTransactionWrote`): a scan that failed after a batch left those rows written, and the new files and foreign changes in them were never announced — the next scan found nothing to report. The pass now announces what stays when it fails on an adapter that keeps it; on the phone a failed transaction is rolled back, and the next scan finds everything again.

Known and left as it is: a full scan still indexes a file from a listing that may be older than another pass's row (the file is then announced twice — cost, not loss); the app's own removal (`removePathFromIndex`) still removes with plain statements and reports at once, so on the phone's one connection it rides in an open transaction like any plain statement; and so do the queue entries of an encrypted workspace, which are single statements — never refused, and gone with the rollback of whatever transaction they rode in.

## What the watcher really reports

The event KIND is what separates a harmless report from a structural one, and it used to be thrown away on the way to the queue (only paths and a `moved` set arrived). The kinds per platform, for the three cases that matter:

| Case | Windows (ReadDirectoryChangesW) | Linux (inotify) | macOS (FSEvents) |
|---|---|---|---|
| The app's own save of `Sub/note.md` (temp file beside the note, renamed over it) | modify `Sub` · create + modify temp · modify `Sub` · remove `note.md` · modify `Sub` · rename `note.md` — **the parent folder three times** | create + modify temp · rename temp → note (paired or as two halves) — no folder event | rename events for temp and note, each on its own path — no folder event expected |
| Another program writes one file in place | modify file (once or more) | modify file | modify file |
| Another program creates a file in `Sub` | create + modify file · modify `Sub` | create + modify file | create (+ modify) file |

Windows was measured on this code base with the watcher's own filter (`notify` 8.2; the filter includes `LAST_WRITE` and `ATTRIBUTES`). A save in the vault ROOT reports no folder — the root's own events are dropped (`""`). The Linux and macOS columns follow the `notify` backends' documented behaviour and the cases pinned in `vault_watch.rs`; they were not re-measured for #122.

**A vault inside a cloud-files folder (OneDrive)** adds a second wave: seconds after a save the sync client updates the file's sync state and attributes, and — because the filter includes attribute changes — the note and the folders above it are reported as modified again. Nothing was created, renamed or removed, and no modification time moved. These later echoes are handled exactly like the first one: the note's row has the same mtime (`unchanged`), each folder gets a flat look that finds nothing, and nothing is bumped.

## What escalates to a full scan, and why

A batch is indexed path by path. It gives up on that and runs `indexVaultFull()` for exactly these reasons (`EscalationReason` in `incrementalIndexQueue.ts`); each writes a diagnostics line:

| Reason | What triggers it | Why it stays |
|---|---|---|
| `rescan requested` | The rescan marker: the watcher reported lost events or an error, the native side folded more than 2 000 changes into one request, or an event named a path outside every known root. | The watcher itself says it no longer knows what changed. Slower, never wrong. |
| `batch above the limit` | More than 50 paths in one batch (a `git checkout`, a first sync). | Fifty per-path inspections cost more round-trips than one walk. |
| `folder created or renamed` | A path that is a folder and was created, renamed, moved in, reported without a kind, or enqueued by a caller that knows no event (a sync pull). | Many paths changed under one name; only the folder's own event announces them. |
| `folder removed or moved away` | A vanished path with indexed files still below it; or a removed file whose parent folder is gone too. | The full scan purges the rows and reports **every** deletion to the sync layer. Data safety: this is not to be approximated. |
| `path could not be indexed` | One path failed twice, or a folder reconcile failed. | The fail-safe. |

What no longer escalates (issue #122):

- **A folder that was only modified.** `inspectPath` answers `directory`; the queue knows the path carried nothing but `modify` events and reconciles that one folder flat (`reconcileFolder(folder, { recursive: false })`). A flat look that finds the folder as the index knows it writes nothing and bumps nothing. A folder that was modified AND created/renamed/removed in the same window counts as the stronger kind.
- **The app's own temp file.** `.plainva-tmp-…` is an internal path (`internalPath.ts`): dropped in the watcher (Rust), in the collector, in `inspectPath` before any disk probe or query, and by both vault walkers. A leftover after a hard kill is never indexed; one that an older version indexed leaves the index without being reported as a deletion. A user's own dot-file (`.env-notes.md`) is not affected — the rule is the prefix, not the dot.
- **A path that fails once.** A file another program still holds open, or one that vanished between the look and the read, is tried again 1.5 s later before anything escalates. A full scan would have met the same file.

What was looked at and left as it is:

- The limit of 50 counts folder paths too, so thirty files written into thirty folders by another program still become one full scan. That is the limit doing its job; the scan it buys is now cheap.
- A folder created, renamed or moved by the app itself is reported like any other and runs a full scan. It usually finds nothing left to index; the folder list differs from the last scan, so the tree is told once more.
- On Linux and macOS an EMPTY folder deleted outside the app sends an event for the folder that the index has no row for (`unchanged`); the tree drops it on the next refresh. On Windows the parent's `modify` leads to a flat look, which notices (see `foldersChanged` below).

## The internal-path rules are data

`INTERNAL_PATH_RULES` (`packages/core/src/vault/internalPath.ts`) is the one list of what is never indexed, listed or synced: four generic matchers (exact, exact ignoring case, prefix, leading-dot-and-suffix). The native walk does not carry a copy — it receives the rules with every call. A folder skipped natively but not by the frontend would look like a mass deletion to the index and to sync, so there must not be two lists. `internalPathRules.fixture.json` pins the rules and a list of verdicts; the core unit test and the Rust test both read that file.

## A full scan that does not block

Even a justified full scan — a first sync, many external changes, F5, the automatic refresh on window focus — runs while somebody may be typing.

1. **The walk is one native call** (`vault_walk.rs`, command `vault_walk`). The frontend walker cost two IPC round-trips per folder; a vault with a few thousand folders meant thousands of round-trips per scan, and the file tree repeated the walk after every structural bump. The native walk runs on blocking worker threads (eight directory reads in flight, for network shares), follows the frontend walker's rules exactly — links followed, loops cut by identity where the platform has one and by the depth cap everywhere, unreadable folders and entries reported, internal folders not entered, start folder resolved through the same root registry as every checked read — and returns once, entries as compact tuples. It can be cancelled when the vault closes. It never opens or reads a file: sizes and times come from the directory listing, so a placeholder in a cloud-files folder is not downloaded by a walk. Hosts without the command (browser fixtures, the E2E mock) keep the frontend walker.
2. **The loops let go.** Comparing the listing with the index is synchronous work over every file. Each loop yields once it has run for about a frame (`createYielder`, core) — on the desktop and on the phone, which share the indexer. `isAppleDoubleOnDisk` only ever looks at names of the `._*` shape and caches its verdicts; no other file is read by an unchanged scan.
3. **The scan says what it changed.** `IndexScanReport` carries `walked`, the three counts and `foldersChanged` (the set of folders on disk against what the previous scan of this indexer saw; `true` on the first scan). A flat folder reconcile keeps that set current and reports `foldersChanged` for its own level.
4. **Only what changed reloads.** A changed folder list bumps the tree's structure; changed files bump the file version; a scan that found the vault as it was bumps nothing. That holds for the queue's scans and for the automatic refresh (window focus, the interval net; on the phone the return to the app, which no longer announces `m-vault-changed` for an unchanged vault). A refresh somebody asked for (F5, the tree's button, pull-to-refresh) still redraws everything.

## What a full scan cannot read

Issue #125: one link in an iCloud vault, to a folder that exists only on the reporter's Mac, stopped every full scan on the iPhone. The folder plugin listed the link as a file, its read failed, the first scan of the vault threw — and the phone's start caught that and ran the vault without its database: no search, no tags, no databases, no sync queue, no calendar ("pim runtime not started"), and nothing on screen said why. Since 2026-10-12 (`vault-indexer-unreadable-entry.test.ts`, `workspace-migration-unreadable.test.ts`, `externalVaultAdapter.test.ts`, `tests/VaultFolderListingTests.swift`):

- **A file a pass over many cannot read is left out and named.** The full scan and the folder re-read report it in `skipped` (reason `unreadable`), like a folder the walk could not list, and index the rest. A file whose read fails because it is gone was removed between the listing and the read: left out without a word, the next pass reports it gone. A row the index already holds for an unreadable file stays and is not reported gone. A single path is still one question: there a read that fails fails the pass, and its caller comes again.
- **The iPhone lists a picked folder by the desktop's rules** (`VaultFolderListing.swift`, the walk in `ExternalVaultAdapter`): a link stands for what it points at — a folder is walked, a file carries its own size and times —, a link that points nowhere and anything neither file nor folder is named instead of listed, a folder carries its identity (device and inode), and the walk cuts a folder it has already walked — met again through a link, or met after a link to it, whichever comes first — or a chain deeper than 32, as a `cycle`: the desktop's rule (a platform that gave two folders one identity would have the second cut; no such case is known). A folder below that cannot be listed is named and the walk goes on; the folder asked for itself, and every folder of the backup inventory, still fails the call. The backup inventory leaves links out (the plugin marks them, `link`), as the desktop's backup does: what lies behind a link is not the vault's to pack. It stays whole or fails: a link that points nowhere and an entry that is neither file nor folder are nothing to pack, anything else it cannot list fails it; without links there is no loop to cut, so two folders the platform gives one identity are both packed, and only a depth beyond 256 fails it. Before a folder is deleted for good on the phone, the snapshot keeps the files the delete takes and the tree shows — the folder's own (none of a folder that is itself a link), not what a link in it points at, which the delete leaves, and nothing under a dot-named entry (`listDirReport` with `followLinks: false` and `dotEntries: false`; the walk does not go into such a folder, and `BackupVaultAdapter` holds the rule as well) —, and first says when a folder below could not be listed. In a picked folder a tree deeper than 256 levels fails the walk, and the snapshot says so instead of keeping a part; in the app's own folder the walk is the tree's, as on main — no depth bound, and a folder below that cannot be listed fails it, which the snapshot says as well. The desktop's walk follows links and lists dot-named entries, and refuses either request instead of answering with more; nothing on the desktop makes it. The app's own folder on the phone (Capacitor Filesystem) is not walked by these rules: a link there is whatever the platform's listing makes of it (iOS lists it as a file, Android follows a link to a folder); Plainva puts none there.
- **What lies under a named path is no deletion** — for the index (as before) and now for the start-up reconcile of an encrypted workspace, which took the plain listing for the whole vault and queued a deletion for every object under a folder the walk could not read: on the desktop since #72, for a link to a drive that is not mounted (`initializePersonalWorkspaceMigration` asks for the report now).
- **A failed scan is said, and keeps the vault.** `onFullScanFailed` tells the host once per scan that failed (not for one called off because the vault closes, nor is `onFullScan` said for one that got through after the vault began to close). A failed first scan keeps the vault open in both shells with what the index holds — the desktop used to refuse to open the vault, the phone dropped its database — and the next full scan tries again; a load that is called off still ends there. Until a full scan has gone through, the task reconciler creates no notes (its anchors come from the index; desktop `coldIndexOwed`, phone `indexSettled`), and the desktop keeps deferring the uploads of files new to the index (3c) — and sweeps the local-only files once more when the first sync swept them over the part the failed scan had reached. The index remembers whether it is owed a full scan (`VaultIndexer.indexComplete`): a scan that begins on an empty index leaves a mark in `meta` with its first rows — on the desktop a batch that went through stays when the app is closed mid-scan — and, if it does not go through, at the end at the latest, however early it failed (the walk, the lookups, a tail that was its only batch); a scan that goes through takes it away with its last rows, or, on an index that holds rows, right away when it had nothing to write (an empty vault keeps the mark a failed first scan left until it has rows). An unchanged scan still writes nothing, and a scan called off because the vault closes leaves no mark of its own. On the desktop a failed first scan keeps the rows it wrote, saves and the watcher write rows after it, and the next start took that index for a whole one; a warm index that carries the mark is treated as one still owed a scan. A scan that went through counts even where it left out a folder it could not read: an index owed a scan until then would hold the task notes of a vault with one dead link back for good.
- **On screen, once.** Both shells say what a scan left out, by name, and why one failed, through `createIndexNotices` (`packages/ui/src/lib/indexNotices.ts`): the same set of names again, or the same failure again, is not said twice; a scan that leaves out something else, or a failure after a scan that went through, is. A link loop (`cycle`) is no news — what lies there is indexed under its first path; the walks report the depth cap of 32 levels the same way, so a tree deeper than that is cut without a notice. `$RECYCLE.BIN` and `System Volume Information`, which a vault at the root of a Windows drive cannot list, are system bookkeeping like `.Trashes` (`SYSTEM_JUNK_NAMES`). The phone also says when its index database does not open on a device.

## Rebuild the index

"Rebuild the index" (Maintenance, the palette) is one way in both shells since 2026-10-12, `VaultIndexer.rebuildIndex` (`vault-indexer-rebuild.test.ts`). The phone's ran the ordinary scan, which reads only what changed by its timestamp — a note whose index entry was out of step with it under a matching timestamp stayed as it was, the one case the button is for. The desktop's dropped the files and indexed the vault as a new one: every file was announced as new, and what only the row held went with it — its creation time, by which the pinboard orders the cards nobody arranged, and its sync label. The rebuild now forgets the timestamp each row was read at, so the scan that follows reads every file; it keeps what cannot be read again, removes and reports a row whose file is gone, and drops what belongs to no row (search entries, links, tags and properties of rows that went). A scan that began before the reset read the old timestamps; the rebuild waits it out and runs its own.

## Diagnostics

Full scans used to leave no trace, so a user could not show us this problem. Both shells now write, under the source `index` (counts and tokens only — no file names, no paths, no vault name):

```
batch of 2 path(s) from watcher escalated to a full scan: folder created or renamed
full scan (watcher: folder created or renamed): 20120 files walked in 412 ms — 2 added, 0 changed, 0 removed, folders changed
full scan (automatic refresh): 20120 files walked in 180 ms — nothing changed
full scan (open): 2810 files walked in 2350 ms — 2810 added, 0 changed, 0 removed, folders changed, 1 skipped
full scan (return to the app) failed: UNKNOWN
```

A failed scan names the kind of its error, never the message, which may name a file; the names of what a scan left out are on screen, and in the diagnostics only as the warning toast the user saw.

The trigger is the token the caller of `indexVaultFull(trigger)` passed: `open`, `manual refresh`, `automatic refresh`, `return to the app`, `sync: batch above the limit`, `watcher: rescan requested`, `folder moved in the app`, `index rebuild`, and so on.

The phone adds two lines of its own: when a path it was told about could not be followed even on the second attempt, and when an upload or a deletion the index announced could not be queued at either attempt:

```
2 path(s) the index was told of could not be followed — left to the next full scan
an upload or a deletion the index announced could not be queued
```

## Measuring

The scripts under `apps/desktop/scripts/perf/` make the measurement repeatable (`cdp.mjs` is their shared attachment to the window). They need a dev build running under its OWN identity and port, with the WebView's debugging port open — never the installed app, never port 1420:

```
# a synthetic vault (never inside a real one; the script refuses a folder it did not make)
node apps/desktop/scripts/perf/make-synthetic-vault.mjs <dir>/v20000 20000

# dev server and an isolated build of this checkout
cd apps/desktop && pnpm exec vite --port 1470 --strictPort
cd apps/desktop/src-tauri && TAURI_CONFIG='{"productName":"Plainva Perf","identifier":"com.plainva.desktop.perf","build":{"devUrl":"http://localhost:1470"},"plugins":{"updater":{"endpoints":[]}}}' cargo build
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9333" ./target/debug/plainva-desktop.exe

# the walk and an unchanged full scan, both walkers, in the real window
node apps/desktop/scripts/perf/measure-full-scan.mjs <dir>/v20000

# real typing with the vault open: tree expanded, a note four folders deep in the editor
node apps/desktop/scripts/perf/measure-typing.mjs <dir>/v20000 --open
```

`PLAINVA_WALK_BENCH_DIR=<vault> cargo test --release walk_benchmark -- --ignored --nocapture` times the native walk alone.

### Measured (2026-10-07)

One machine: Windows 11, local SSD, a fast desktop CPU, WebView2. An optimized build (`cargo build --release`, same `TAURI_CONFIG`) of this checkout, frontend from the dev server. Synthetic vaults of 5 000 notes (5 994 entries, 951 folders) and 20 000 notes (22 959 entries, 2 792 folders). "Before" is the frontend of the commit this work started from (`4d11416b`), served to the same binary; the native side then merely goes unused.

**Typing in a note four folders deep, 20 000 notes, tree expanded** — 20 s of typing at a character every 150 ms, then 40 s of watching; three rounds each (`measure-typing.mjs`):

| | Before | After |
|---|---|---|
| IPC round-trips in the minute | 10 400 – 23 000 | 75 – 89 |
| Long tasks (> 50 ms) | 2 – 5 per round, the longest 84 – 156 ms | none |
| Longest stall of the UI thread | 150 – 187 ms | 15 – 24 ms |
| Slowest single keystroke | 22 – 72 ms | 13 – 20 ms |
| Full scans caused by the saves | yes — the round-trips above are those walks | none |

**The walk and an unchanged full scan**, median of five (`measure-full-scan.mjs`):

| | 5 000 notes | 20 000 notes |
|---|---|---|
| Frontend walker: walk | 8.9 s, 1 906 IPC round-trips | 25.4 s, 5 586 IPC round-trips |
| Native walk: walk | 34 ms, 3 IPC round-trips | 68 ms, 3 IPC round-trips |
| Unchanged full scan with the native walk | 64 ms, longest stall 17 ms | 161 ms, longest stall 26 ms |

How to read this:

- The frontend walker never held the thread in one piece — its longest stall was about 30 ms. What it did was keep the IPC bridge busy for the length of the walk, and the stalls a person feels came after it: the scan ended by bumping both tree versions, the file tree walked the vault a second time and every view hanging on the versions reloaded. On this machine that was 150 – 190 ms per save at 20 000 notes. A slower machine, a larger vault and a slower disk all stretch it, and every save started the next round.
- **Not measured: a vault inside a OneDrive folder**, which is where the reporter of #122 has his. Listing a cloud-files folder is answered by the sync client and is slower per call, so the old walk hurt most there, and the client's later attribute changes started further scans. The fix removes the scans for both waves; that the client's echo consists of `modify` events only is taken from the event filter and pinned by a unit test, not observed on a real OneDrive folder.
- Not measured either: macOS and Linux (the watcher there reports no folder for a save, so #122 as reported is a Windows behaviour; the native walk and the reload rules apply on all three), and the phone (no watcher; its walk is one bridge call per folder and was not changed — the loops after it, and the reload on return to the app, were).
- A debug build is slower per IPC call but shows the same picture (20 000 notes: frontend walker 35 s, native walk 205 ms).
