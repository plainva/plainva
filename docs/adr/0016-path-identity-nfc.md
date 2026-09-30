# ADR 0016: Path identity is NFC; stored spellings are resolved, never renamed

Status: Accepted

Date: 2026-09-30

## Context

A name with an accent can be written in two Unicode normalization forms:
composed (NFC, `ä` = U+00E4) or decomposed (NFD, `a` + U+0308). Both look the
same. The systems Plainva syncs with disagree about them:

- macOS and iOS (APFS) look both forms up as the same name but store the form
  a file was created in. Finder and the iOS Files app create decomposed names.
- Linux, Android, Windows (NTFS), WebDAV servers such as Strato HiDrive and
  S3 buckets store and compare bytes: the two forms are two different names.
- Google Drive, OneDrive and Dropbox resolve names by their own rules.

Until this decision a vault path was identified byte for byte everywhere in
Plainva — the index (`files`, `fts_notes`), `sync_state`, the offline queue.
Issue #112 shows what that costs. The reporter syncs a vault over HiDrive
WebDAV from two Macs while the HiDrive desktop app syncs the same folder. A
folder made in Finder is decomposed on disk; the server's copy is composed. The
index saw the decomposed file as new and the composed one as gone, the upload
of the "new" file failed with 409, `ensureDir` created a second,
identical-looking folder with MKCOL, the queued DELETE removed the composed
original, and the desktop app renamed the new folder "Neutralität(1)",
"Neutralität(2)" — about forty times.

`pathIdentity.ts` had so far only *detected* such twins, to report them instead
of mirroring a deletion (2026-08-21). Its header deferred the real fix on
purpose: making the identity normalization-insensitive re-keys `sync_state` and
the index of every existing vault and needs its own migration. Package O2
(2026-09-30) added the same lock on the push side and held a MKCOL that would
twin a known remote folder, but a write into such a folder could not be held
without stopping every edit in accented folders. Both were symptom locks: every
new code path had to remember them. Plan decision E6 chose to close the class.

The encrypted workspace protocol already made NFC canonical for its own paths
(`normalizeVaultPath`), so the decision is not new to the codebase — only to
the plain-file sync.

## Decision

1. **The identity of a vault path is its NFC form.** The index, `sync_state`,
   the offline queue and the other path-keyed local tables (`conflicts`,
   `pim_task_state`, the workspace queue and outbox) carry NFC paths.
   `toPathIdentity` is the one definition. Letter case is not folded: `Notes`
   and `notes` stay two identities, and the existing twin locks keep reporting
   them.

2. **Paths are normalized where they enter.** A directory walk, a watcher
   event and a single-file stat (desktop `TauriVaultAdapter`, mobile
   `CapacitorVaultAdapter` and `ExternalVaultAdapter`, core
   `LocalVaultAdapter`) and every remote listing (WebDAV hrefs, Drive,
   OneDrive, Dropbox, S3 — incremental changes included) hand out identities.
   A name the user types is created in NFC on both shells (the file tree and
   rename on the desktop, notes and folders on the phone) — the step the
   mobile-feedback plan of 2026-08-21 called P6e.

3. **The stored spelling is resolved at each access and never renamed.**
   `PathSpellings` keeps, per store, the spelling of every identity that has
   variants. Before a read, write, rename, delete or mkdir the identity is
   turned back into the stored spelling segment by segment: a known segment
   from the last listing, an exact name, or the other form found in the
   parent's listing. A segment that is not there at all is new and is created
   in NFC. Locally this happens inside the base adapters (a remembered spelling
   that went stale is looked up once more). Remotely a proxy around the sync
   target (`withPathSpellings`) does it before PUT, MKCOL, MOVE and DELETE and
   before every download, using the cycle's listing first and, where the
   listing did not show a folder, a one-level listing (`listVaultFolder`,
   WebDAV). Nothing on a disk or a server is ever renamed to "fix" a
   spelling.

4. **Two spellings side by side are twins, not one file.** Where a
   byte-exact store really holds both forms in one folder, the NFC one takes
   the identity and the other keeps its own bytes as its identity. A non-NFC
   identity is never synced: the worker reports it on the existing "Two
   spellings, one file" card, the engine holds its writes and drops its
   deletions (Plainva never put a twin on the remote and does not remove one),
   and a sync row for a twin that is gone on both sides is forgotten.

5. **Migration at first start.** `migratePathIdentity` (index DB,
   `meta.path_identity_version = 1`) re-keys every row whose path is not NFC,
   in one transaction; an interrupted run leaves the database unchanged and
   runs again at the next start, a repeated run changes nothing. Two rows that
   would collapse into one key are **not merged**: the NFC sync row keeps its
   key, the other keeps its old spelling and falls under rule 4. Derived index
   rows of such a pair are dropped for the old spelling; the next scan reads
   the disk. A queued DELETE of a spelling while the index knew the same name
   under another spelling — the misreading that sent #112's deletions — is
   dropped. The report stays in `meta.path_identity_report`.

6. **A queued DELETE of a path that exists here under the same identity is
   stale** and is dropped instead of pushed. The remote copy is the one this
   file syncs with; a recreated file queues its own upload.

## Consequences

- One folder is one folder, whatever spelling the Mac, the phone or the
  server keeps. The #112 loop cannot start: no MKCOL of the other form, no
  DELETE of a file that is still here. O2's MKCOL lock now only holds letter
  case twins; its DELETE lock holds letter-case twins and non-NFC twins.
- Paths without accents never pay: the lookup is skipped for every path whose
  characters have no second normalization form. For accented paths the full
  walk fills the spelling map, so later reads need no extra call; a write of a
  new accented name costs one existence check or one folder listing.
- Comments and move markers written with a decomposed path by an older version
  are matched by identity.
- Values stored outside the index DB keep the spelling they were written with
  (bookmarks, session tabs, pinboard orders). Opening such a path still works —
  the adapter resolves it — but a comparison with a fresh identity can miss
  until the value is written again.
- A second spelling that exists next to its composed form is not synced until
  one of the two is renamed. That is a deliberate limit: merging two files
  that happen to share a name is a guess, reporting them is not.
- Remote spellings are learned from listings. Providers without a one-level
  listing (S3, OneDrive, Dropbox, Drive) rely on the full listing each cycle
  runs; Drive keeps its own name-tolerant folder lookup.

## Alternatives

- **Symptom locks only (E6 option b).** Resolve the remote spelling before
  writes, hold twin DELETEs and MKCOLs, keep the byte identity. Smaller, but
  every new path in the sync had to remember the locks, and the index would
  still read a decomposed walk as new files next to composed sync rows.
- **Rename to NFC on disk or on the server.** Would make the identity trivial,
  but renaming the user's files is exactly what Plainva promises not to do,
  and on a shared folder it would fight every other client.
- **Case-insensitive identity as well.** Case differences are real names on
  case-sensitive stores; folding them would make a write land in the wrong
  folder. They stay reported, not resolved.

## Links

- Issue #112; plan "Issues und Diskussionen" 2026-09-30, § 4 Teil O (O3, O4)
  and decision E6.
- `packages/core/src/sync/pathIdentity.ts`, `pathSpellings.ts`,
  `spellingSyncTarget.ts`, `packages/core/src/db/pathIdentityMigration.ts`.
- `docs/engineering/Sync_Path_Identity.md`.
- Related: the encrypted workspace path rules
  (`packages/core/src/workspace/path.ts`, ADR 0014).
