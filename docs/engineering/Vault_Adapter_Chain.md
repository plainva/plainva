# The vault's adapter chain

How a write reaches a vault's files, what each link of the way adds, and who may reach below it. Written with the finding of 2026-10-09: seven writers of the phone were handed the storage below the chain.

## The chain

It is built once, when a vault opens — by the vault context on the desktop (`VaultContext.tsx`), by `boot` on the phone (`vaultService.ts`) — and it is the same on both:

```
the files                    TauriVaultAdapter · CapacitorVaultAdapter · ExternalVaultAdapter
  └─ BackupVaultAdapter      a version of the file as it was, before it is written over
      └─ QueueingVaultAdapter   the entry in the sync queue (in an encrypted workspace: the
                                permission check and the workspace's own queue)
          └─ ConflictAwareVaultAdapter   is the file on disk still the one the app knows?
                                         if not: merge, or a conflict copy — never a silent overwrite
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

## Who may reach below it

Reading is free — a read through any link is the same read. For everything else there are few reasons, and each place that has one is listed with it in `rawVaultAdapter.test.ts` of its shell. A new place turns that test red.

| Reason | Who |
|---|---|
| It builds the chain | the vault context, `boot` |
| The vault is not open | a vault created, prepared or filled a moment ago has no chain yet; its first index run takes every file as new (new-vault scaffolds, an import into a new vault, the target of a transfer) |
| It is the sync | what the sync pulls must not be queued to go up again; it takes its own versions and decides conflicts itself (sync worker, deletion journal, settings profile, key file, comment files, the encrypted workspace) |
| The file is the app's own and is written on this level only | the phone's bookmarks and recent notes under `.plainva` |
| A control of the versions layer | retention settings, the version taken before a restore |

The desktop's context keeps the files to itself and hands out the chain, plus its lowest link as `backupAdapter`; so its list is short. The phone's vault carries the storage as `vault.adapter` right beside `vault.files`, with the same methods — which is how a shared writer came to be handed the wrong one seven times, and why the phone's list names every place.

## One file, one level

A file must not be written through the chain in one place and below it in another: the chain then meets a text it did not write, and refuses the next write as a conflict. That is the finding above in small, and it holds for the app's own files under `.plainva` as well — the chain keeps what it knows of them like of any other file.

## The phone writes many notes one after the other

Every write through the chain opens a transaction for the sync queue and one for the index. The desktop's database adapter queues transactions. The phone's is a single connection whose plugin refuses a second transaction while one is open ("Already in transaction") — the note would be changed on disk and counted as failed, with no entry in the queue. The chain's own gate (`withPathMutation`) does not prevent that: it holds apart writes below a common folder only, and the index is written outside it.

So `commitBulkValue` hands the shared loop a gate of one, where the desktop writes six notes at a time. Anything else on the phone that writes many files through the chain has to do the same.
