# The vault's adapter chain

How a write reaches a vault's files, what each link of the way adds, who may reach below it, and which of its two ways in a writer takes. Written with the finding of 2026-10-09: seven writers of the phone were handed the storage below the chain. The section on a change of a file that exists came with the finding of 2026-10-12, and so did the one on the app's own files and the last one, on the sync queue's entry and the phone's one database connection.

## The chain

It is built once, when a vault opens — by the vault context on the desktop (`VaultContext.tsx`), by `boot` on the phone (`vaultService.ts`) — and it is the same on both:

```
the files                    TauriVaultAdapter · CapacitorVaultAdapter · ExternalVaultAdapter
  └─ BackupVaultAdapter      a version of the file as it was, before it is written over —
                             at most one per file and snapshot interval (two minutes by default)
      └─ QueueingVaultAdapter   the entry in the sync queue (in an encrypted workspace: the
                                permission check and the workspace's own queue)
          └─ ConflictAwareVaultAdapter   is the file on disk still the one the app knows?
                                         if not: merge, or a conflict copy — never a silent overwrite
                                         (what the app writes to its own files under .plainva excepted)
```

The index reads through the top of it and asks it whether a changed file is the app's own write (`wasWrittenByUs`); what is not counts as a change from outside.

The top of the chain is what the app is handed: `vaultAdapter` from `useVault()` on the desktop, `vault.files` on the phone.

## The rule

**What the user sees — a note, a database, an attachment, a folder — is written through the top of the chain.**

A write below it is not a smaller write, it is a different one. Read from a vault after the phone had set one property on five notes through the storage below the chain (`vaultChainWrites.test.ts`, with the phone's own statement and real files):

- none of the notes had a version to go back to;
- nothing stood in the sync queue — the change went up only after an index run had come by and taken it for a change from outside;
- the table went on showing the old values: it asks the index, and the index had not heard of the write;
- the next cell written in one of those rows was refused as a conflict, with a conflict copy of a note nobody else had touched. The chain compares the file with what it wrote last; a file it does not know it tries to merge ("conflicting changes"), and where it has no text left to merge against it gives up ("base version not found").

A new file fares better, but not well: it is queued by the next index run instead of by the write that made it, and a folder that stays empty is never queued at all.

## A change of a file that exists: the one entry

The top of the chain has two ways in for a text file, and which one a writer takes says what it is.

**`writeTextFile(path, text)` is for a whole text that is held or made**: a new file, a generated one, a file put back, the configuration a database view holds. The chain is told nothing but the text. It compares the file on disk with what it wrote last; a file that changed in between it merges into, or it keeps the text as a conflict copy — the right answer for a text that may be minutes old.

**`updateTextFile(path, change)` is for whoever changes a place of a file that exists**: a property, a task's box, a link, a line appended. Nearly everything the app writes into a note outside an editor has that shape — a cell of a database, a value set across a selection, the task list, the journal, a rename's links, a tag renamed across the vault, the pinboard's cards, the anchors of appointments and provider tasks, a `.base` that gets a column. Such a writer used to read the file itself and hand the chain the whole text; the chain judged it like an editor that had held an old text (finding 2026-10-12, [ADR 0031](../adr/0031-a-change-of-a-file-goes-through-one-entry-of-the-chain.md)):

- at a note with an open conflict the text went in place of the user's own version: the writer had read the note, which carries the other side, and the chain redirected its write into the working copy. What was typed there was gone, and the write was reported as failed;
- a note somebody else had changed was refused with a conflict copy — "conflicting changes" for the same property or the one on the next line, "base version not found" after an own save —, although the writer had read exactly what stood on disk.

The entry reads the file inside the gate the chain holds for the path (`withPathMutation`, the gate the sync worker takes as well), calls `change` with that text and writes what it answers through the lower links: a version of the file as it was, the entry in the sync queue. `null` or the same text writes nothing. There is nothing to merge and no conflict copy to cut. Of the file's row in `sync_state` only the local marker moves, as for every write of the chain's own.

**A file with an open conflict takes the change in both versions.** The file is changed like any other, and the same `change` is then made in the user's own version, through the conflict session's journal (`writeLocked`) — the working copy is never replaced, only changed by what `change` makes of it. Each version takes what `change` makes of it: one that finds no place in the user's version, or throws there, leaves that version as it is — and where the file itself has nothing to change, the user's version still may (a link to a renamed note that only that version carries). What `change` throws for the file itself is the caller's, and then neither is written. A path that names the working copy changes that one alone. A conflict that is being resolved is not written into.

**`writeTextFile` at a file with an open conflict** replaces the working copy only where that copy is what such a write left there itself — the session keeps the hash of it (`plainDraft`), and an editor's save or a change carried into the copy clears it. Otherwise nothing is written and the write is refused: an `OpenConflictError`, whose message begins with `OPEN_CONFLICT_MESSAGE` (a `ConflictError` otherwise says the text was kept, in the working copy it names; this one says nothing was written anywhere). So a database view cannot save at a database with an open conflict until it is resolved; it no longer writes the other side's configuration over the user's own. A whole text that names the working copy itself — a version of it put back, a database opened from its own conflict copy — is written into that copy and nowhere else: that writer read the copy.

### `change`

`(text: string) => string | null`, pure and synchronous. It runs inside the gate, so what takes time — a query, a question to the user, a provider's answer — happens before it; a `change` that wrote into the chain again would wait for itself. And it is called more than once: a second time with the working copy of an open conflict, and again where a window's attempt lost (below). So it keeps nothing on the way. What its caller wants to know about it — how many links, which entry, whether the line was found — the caller reads from the result's `before`, usually by calling the same pure function once more:

```ts
const cleaned = (text: string) => { /* … */ return { removed, next }; };
const update = await updateVaultText(files, path, (text) => cleaned(text).next);
const { removed } = cleaned(update.before);
```

Two things follow from the second text. A change that addresses its place by position — the n-th checkbox — checks the text of that place as well: in the user's own version another line may stand there. And a change that sets a list builds it from the text it is handed, not from what the index or an earlier read said: set whole, the file's list would go in place of the one the user's version carries (a relation only that version has, an anchor only it has).

### A whole file made anew from its text

A transformation of a whole file that somebody keeps a backup for — an overview prepared as `index.md`, the conversion of a note's header — calls **`replaceVaultText(files, path, prepare)`**. `prepare` is handed the file's text, may take its time (write the backup, ask the index) and answers the new text. The file is replaced only if it still is the text `prepare` was handed, so the backup holds exactly what was replaced; where the file changed meanwhile, `prepare` is asked again, a few times. A file with an open conflict is refused, whichever of its two texts the path names (`OpenConflictError`), and nothing is prepared: the file made anew from the other side's text, beside a user's version nobody transformed, is a state no undo takes back — the backup put back is a whole text for a file with an open conflict, which the chain refuses, and after the conflict is resolved it would go over the version the user decided for. So the conversion reports such a note as skipped, and preparing an overview says to resolve the conflict first, as moving the note would. It asks the chain through the two halves a window uses (below): what the file is, then the new text for exactly that — a conflict that opens while the file is prepared is seen there, and nothing is written. Files that carry the entry alone, or no chain at all, compare inside a change.

### How a writer reaches it

Every writer calls **`updateVaultText(files, path, change)`** (`@plainva/core`). Where `files` is a chain it is the chain's entry. Where it is a storage with nothing above it — a vault that is not open, the double of a test — nothing knows anything about the file, and it reads and writes. Where an object hands on a chain's methods without the entry it throws: that wrapper would bring the finding back in the app while every test still passed.

- **Desktop:** `vaultAdapter` carries the entry. A window beside the main one cannot send a function to the owner: `RemoteVaultAdapter.updateTextFile` asks for what the file is (`update-read`: the file's text and the working copy's), makes the change in its own window and hands both texts back with what they were made of (`update-write`). The owner writes only if the file still is that, inside the lane that keeps a file's writes in order, and indexes what it wrote. Otherwise the window reads again — four attempts, then `TextFileChangedError`.
- **Phone:** `vaultOps.update(vault, path, change)` lands the pending text of an open editor first, takes the entry and lets the index follow what was written — the note, and the working copy where it took the change too. A shared function is handed `vaultTextFiles(vault)`, which carries that as `updateTextFile` beside the read and the write.

### Who stays on `writeTextFile`

| Who | Why |
|---|---|
| An editor | it holds a text and the text it started from: `writeEditorText` |
| A new file — a note, a database, a template, an attachment's note, the next occurrence of a task | there is no file to read |
| A generated file — a folder's overview (`generateIndexForFolder`) | it is made whole; on the entry it would generate the user's own version of an open conflict anew as well |
| A database view's configuration | the view holds it and saves it whole (see above for what that costs at an open conflict) |
| A file put back — the undo of a deletion, the rollback of a conversion, a version restored | a whole text that was kept |
| Comments and suggestions | their own compare-and-write under the editor's write lock |

Two guards keep it that way, one per shell (`readChangeWrite.test.ts`; the desktop's covers the shared package): a function that reads a text file and writes a whole text to the same path, and a pair of read and write built to hand on without the entry, are each listed there with why they may stay. They do not see a read and a write that name their path differently.

## Who may reach below it

Reading is free — a read through any link is the same read. For everything else there are few reasons, and each place that has one is listed with it in `rawVaultAdapter.test.ts` of its shell. A new place turns that test red.

| Reason | Who |
|---|---|
| It builds the chain | the vault context, `boot` |
| The vault is not open | a vault created, prepared or filled a moment ago has no chain yet; its first index run takes every file as new (new-vault scaffolds, an import into a new vault, the target of a transfer) |
| It is the sync | what the sync pulls must not be queued to go up again; it takes its own versions and decides conflicts itself (sync worker, deletion journal, settings profile, key file, comment files, the encrypted workspace) |
| The file is the app's own | the phone's bookmarks and recent notes under `.plainva` — what is kept of such a file does not depend on the level (see "The app's own files") |
| A control of the versions layer | retention settings, the version taken before a restore |

The desktop's context keeps the files to itself and hands out the chain, plus its lowest link as `backupAdapter`; so its list is short. The phone's vault carries the storage as `vault.adapter` right beside `vault.files`, with the same methods — which is how a shared writer came to be handed the wrong one seven times, and why the phone's list names every place.

## One file, one level

A file must not be written through the chain in one place and below it in another: the chain then meets a text it did not write, and refuses the next write as a conflict. That is the finding above in small.

## The app's own files

What the app writes under `.plainva` itself — the bookmarks, the notes opened last, the pins of a map, the sideband files of the sync — passes all three links without a trace: no version, no entry in the sync queue, no marker and no conflict, through either way in (`writeTextFile`, `updateTextFile` and its two halves). What is kept of such a file therefore does not depend on the level it is written on, and the rule above does not have to be kept for it by each of its writers. Two things hold for it as for any file: the top refuses a text over a file that is no text (`NotTextFileError`), and it lets one write to a path through at a time. Between two devices that write the same own file in a folder they share, the one that writes last has it. On one device every change of the list — a star, taking one away, a rename, a new order, the import from Obsidian, an arriving profile — takes turns on the bookmarks' lane (`setBookmarksLaneScope`); only the rollback of a profile import that failed or was interrupted writes past it.

The local forks of an encrypted workspace are no such files: they lie under `.plainva` (`WORKSPACE_FORKS_FOLDER`), but they are copies of a person's notes — the desktop opens them from the quarantine card in a window of their own — and are guarded like any note. An editor's save is no such write: it keeps every protection wherever the file lies, and where such a conflict is open at a file under `.plainva`, what the app writes to it takes the way of any file as well. Everything else under `.plainva` counts as the app's: a note kept there — only a setting typed to point into the hidden folder puts one there — keeps the protections of an editor's save, not those of a note against what the app writes to it.

The third link came to that late (finding of 2026-10-12, built on 2026-10-20). Until then it kept what it had written last for an own file as for a note — and it could never decide a conflict over one: without a version and without a merge base there is no text to merge against. A file that anything else had written in between ended as "base version not found", with a conflict copy inside `.plainva` and an entry in the vault's list of conflicts — the desktop's sync-error dialog offered to resolve it, the phone's first screen counted it —, and every write after it was refused as well. The desktop wrote the bookmarks through the chain's top and let an arriving settings profile write them through its lowest link: once a profile had brought a bookmark from another device, none could be set or removed on the desktop. The pins of the map and the desktop's list of recent notes met the same in a vault folder that a second device writes to. Now the pins, which the map writes as it holds them, go to the device that writes last, as below the chain; the list of recent notes is read before each write and goes on from what the other device left. The writers that knew of it stayed below the chain and said why where they are handed their adapter — the settings profile, the deletion journal, the comment files; the others were found one at a time.

A conflict such a version left on an own file — opened by the adapter for a write of the app's own, not by an editor — is neither listed nor handed out, a write passes it by, and it is ended in the background once the vault is open: the first write of an own file and the first look at the vault's conflicts start it, and none of them waits for it (`endOwnFileConflicts`, `ConflictSessions.release`). The file stays as it is, unless a resolution had been confirmed and not yet carried out — then that is carried out as confirmed, and records its marker as any resolution does; nothing on the app's way reads it, as nothing reads the rows older versions left for own files. Otherwise the session's draft is first put in the working copy, as every step of a session does, a copy of the working copy is kept under `.plainva/conflict-revisions/`, where the sessions keep the versions they set aside, and only once that copy reads back the same do the working copy and the entry go. One that cannot be ended — a write that fails — stays, unlisted, and is tried again the next time the vault is open; the console says which were ended, how, and which not. What such a working copy held was the text of a write that never reached the file: reported as failed for a bookmark, dropped in silence for a pin or the list of recent notes. Conflict copies under `.plainva` from versions before conflicts had a journal (2026-09-16) are left where they are; nothing shows them.

`own-files-chain.test.ts` in the core reads what each link leaves behind for an own file through either way in, that a note and a fork are still guarded, that an editor's save under `.plainva` keeps its protections, and how an old conflict is ended — with the database and without it, when its working copy is gone, and when a step fails. `ownFilesChain.test.tsx` on the desktop runs the desktop's own writers over real files: a star set after a profile brought one, a star and an arriving list on their lane, the list of recent notes and the pins in a shared folder, and a vault that still carries the old conflict. `services/ownFilesChain.test.ts` on the phone runs the phone's: its bookmarks after a profile, the pins in a shared folder, and a vault that still carries the old conflict on the pins.

## What the chain records, and what it leaves to the sync

Of a file's row in `sync_state` the chain writes one thing: the local marker (`local_sha256`) — after every write of its own, and when an editor opens a file (`acknowledgeExternalUpdate`); for what the app itself writes to its files under `.plainva`, not even that. The common ancestor with the remote is the sync's: `base_sha256`, `base_etag` and, on a row that carries a `base_sha256`, the base text. That holds after the chain merged a change from outside into a write, too: the merged text is this device's new text, not a version the remote has seen. Only for a file no sync has seen does the chain keep a text of its own in that column, to merge against the next time. What went wrong while it wrote there, and what the rule costs: [Vault watcher and indexing](Vault_Watcher_and_Indexing.md), "The merge base belongs to the sync".

## The entry in the sync queue, and the database that keeps it

`QueueingVaultAdapter` changes the disk first and records the change in the sync queue second. In that order a failure on the way leaves a change not yet announced — never an announced change that did not happen, such as a deletion queued for a file that is still there.

**An entry that fails for a while does not fail the write** (since 2026-10-12). It used to fail it at once: the caller heard "not saved" for a file that was saved, the chain above did not take note of its own write — the next write met a disk it did not know, and an editor that typed on ended in a conflict copy of a note nobody else had touched — and nothing was queued. Now the write waits while its entry is made up for: tried again a quarter of a second and 1.25, 5.25, 15.25 and 30.25 seconds after the change, and at once whenever a later entry comes along. Entries are written in the order their changes happened, so one that waits holds back the ones after it — a write queued after the rename of its file is not the write queued before it. The write returns once its entry is in the queue, and the diagnostics export has a line for every entry that needed more than one attempt (`formatQueueEntryReport`, the same in both shells).

**An entry that still fails 30 seconds after its change is given up, and its write fails** — as every failed entry's did before; the waiting for the database counts. That is on purpose (found by the reviews of the change, 2026-10-19). The chain takes no note of a write that failed, so a later index pass finds the file differing from what the chain knows and announces it — a changed file as a change, a deletion as an unconfirmed one, a new folder not at all, and a rename as what the index saw of it meanwhile: a deletion and a new file, or, where a shell let the rename pass because the file landed (`landedAtDestination`), a new file next to the old one. A write that returned while its entry was still owed would have been taken note of, and an entry lost after that — given up, or the app ending first — would never have been announced by anybody. Thirty seconds, because the desktop's pool answers a lock only after it has waited five seconds itself: a shorter time would give up a locked database's entry at its first answer. While the database keeps failing — an entry was given up and none has been written since — the next entries are given up at their first failure, so a loop of writes fails as fast as the database answers instead of waiting the full time for each one. Before the phone closes a vault's database it gives every owed entry its last attempt, for at most ten seconds (`QueueingVaultAdapter.flush`): an entry waiting for its next attempt is no transaction the database could wait for. The desktop does not close its database when a vault closes. A floating window of the desktop gives the main window 15 seconds for a write (`RPC_TIMEOUT_MS`, `windowBus.ts`); a write that takes longer — one whose entry waits out a lock, and, as before this change, one that waits for the lock in front of the pool while a full scan holds it — is reported there as failed although it lands.

**The phone's database is one connection, and its transactions take turns.** Every write through the chain opens a transaction for its entry in the sync queue and one for the index; the sync, the index and the calendar cache open theirs. The phone's SQLite plugin refuses a second transaction while one is open ("Already in transaction" on Android; on iOS SQLite itself refuses the second `BEGIN`), and the phone's adapter used to pass the refusal on: whichever came second failed. Since 2026-10-12 the adapter has them wait for one another (`apps/mobile/src/adapters/transactionTurns.ts`), as the desktop's adapter always has. A batch is a transaction of its own and takes its turn as well — except the one a caller sends from inside the body of its own transaction and marks so (`{ inOpenTransaction: true }`; the index's full scan flushes its writes that way). Without the mark it would wait for its own caller.

Three things follow:

- A transaction must not open another one inside its body and wait for it, nor write through the vault's chain (the write waits for its entry, the entry for the transaction) or close the database there: on a queue that waits for ever, and everything after it with it. `packages/core/test/transaction-nesting.test.ts` reads the database layer for it.
- A transaction that never ends holds every one after it, and every write through the chain with them. A turn has no time limit — on the desktop it never had one —, so a body that reads a file waits as long as that read does.
- A single statement sent outside any transaction is not held back: the one connection runs it in whichever transaction is open, and commits or rolls it back with that one.

The chain's own gate (`withPathMutation`) holds apart writes below a common folder only; the database's turns hold apart its transactions. So the phone writes a selection several notes at a time, with the loop and the gate the desktop uses (`commitBulkValue`), and none is refused. Measured on 2026-10-19 with a probe outside the repository, against the simulated connection with 1 and 3 milliseconds added to each call (48 notes): one note after the other took 425 to 435 milliseconds per note, two to six at a time 200 to 285 milliseconds per note. On a device it is not measured.
