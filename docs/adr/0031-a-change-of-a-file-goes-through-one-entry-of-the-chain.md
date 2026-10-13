# ADR 0031: A change of a file goes through one entry of the chain; a note with an open conflict takes it in both versions

Status: Accepted

Date: 2026-10-13

(The numbers 0017 to 0030 are in use on a feature branch that has not been
merged yet.)

## Context

Most of what Plainva writes into a note is not an editor's text. A cell of a
database, a value set across a selection, a task's box, a line of the journal,
a link rewritten after a rename, a tag renamed across the vault, the anchor of
an appointment, the fields a task provider changed: each reads the note,
changes a place and writes it back. Around sixty places in both shells and
the shared package had that shape, and all of them wrote through
`writeTextFile` of the vault's chain (see
[The vault's adapter chain](../engineering/Vault_Adapter_Chain.md)).

`writeTextFile` takes a whole text and nothing else. The chain was built for
an editor, which holds a text that may be minutes old: it compares the file on
disk with what it knew last, merges, and keeps a conflict copy where it cannot.
It was never told that such a writer had read the file a moment ago. Two things
followed, both reproduced with the shells' own code against real files
(finding 2026-10-12):

1. **A note with an open conflict lost what the user had typed.** While a
   conflict is open, the note carries the other side's text and a working copy
   carries the user's own. The writer read the note — the other side —, and
   the chain redirected what it wrote into the working copy, in place of the
   user's text. The write was reported as failed. The text survived only in a
   version older than two minutes.
2. **A note somebody else had changed was refused.** A note changed below the
   chain — by another program in a folder the user picked, by an older build
   of this app — is one the chain does not know. The same property with
   another value, or the property on the next line, ended as "conflicting
   changes" with a conflict copy of a note the user had not edited; after an
   own save and a change elsewhere, as "base version not found".

## Decision

**One entry of the chain for a change of a file that exists:**
`updateTextFile(path, change)`, reached by every writer through
`updateVaultText(files, path, change)` (the phone: `vaultOps.update`). The
chain reads the file inside the gate it holds for the path, calls `change`
with that text and writes the result through its lower links — a version of
the file as it was, the entry in the sync queue. There is nothing to merge and
no conflict copy to cut: what stands on disk is exactly the text the change
started from. Of what the chain records, only the local marker moves; the
merge base stays the sync's.

**E1 — a note with an open conflict takes the change in both versions.** The
note is changed like any other, and the same `change` is then made in the
user's own version (the working copy), through the conflict session's
journal. The working copy is never replaced, only changed by what `change`
makes of it; a change that finds no place there — a task whose wording was
changed in that version — leaves it as it is, and the comparison shows the
difference. Each version answers for itself: where the note has nothing to
change, the user's version still may (a link to a renamed note that only that
version carries). A writer that names the working copy itself (its row in a
table) changes that one alone.

**E2 — a whole text without a starting text does not replace the user's own
version.** `writeTextFile` stays the way for a text that is held or made
whole: a new file, a generated one, a database view's configuration, a file
put back. At a file with an open conflict it replaces the working copy only
where that copy is what such a write left there itself (the session records
the hash of it); otherwise nothing is written and the writer is told that the
file has an open conflict — as moving or deleting such a file is refused
today. The refusal is an error of its own (`OpenConflictError`): a
`ConflictError` says the text was kept in the working copy, this one says it
was kept nowhere. A whole text that names the working copy itself is written
into that copy — its writer read the copy, not the other side.

**A whole file made anew keeps to the text it was made of.** A transformation
somebody takes a backup for — an overview prepared as `index.md`, the
conversion of a note's header — goes through `replaceVaultText`: the file is
replaced only if it still is the text that was backed up and transformed. A
file with an open conflict is refused there, whichever of its two texts is
named, and nothing is prepared: made anew from the other side's text beside a
user's version nobody transformed, the file would be in a state no undo takes
back. The conversion reports such a note as skipped; preparing an overview
says to resolve the conflict first.

**`change` is pure and synchronous.** It runs inside the gate, so whatever
takes time — a query, a question to the user, a call to a provider — happens
before. It is called more than once: a second time for the working copy of an
open conflict, and again where a window's attempt lost against another writer.
What a caller wants to know about a change it reads from the result's
`before`, not from inside the change.

**A window beside the main one cannot send a function.** Its adapter asks the
owner's window for what the file is (the note's text and, where a conflict is
open, the working copy's), makes the change itself and hands both texts back
with what they were made of; the owner writes only if the file still is that.
Otherwise the window reads again — four attempts, then it gives up
(`TextFileChangedError`) rather than write over somebody.

## Consequences

- A cell, a tick, a journal entry or a renamed link at a note with an open
  conflict works and says nothing: the table shows the value, the task is
  ticked, and whichever version the user keeps carries the change. No new
  wording on any surface; two error messages and the conflict copies behind
  them are gone.
- A note with an open conflict is written while the conflict is open. It
  carries text the remote has not seen more often than before; the comparison
  checks the files again before it resolves, as it does after a pull.
- A writer that reads a file and hands the chain a whole text is still
  possible, and still judged like an editor. Two guards keep the class
  closed (`readChangeWrite.test.ts` in both shells): a function that reads a
  text file and writes a whole text to the same path, and a pair of read and
  write that is handed on without the entry, are each listed with the reason
  they may stay.
- A database view still reads the other side's version of a database with an
  open conflict and cannot save there until the conflict is resolved. It no
  longer loses the user's version; reading and writing like an editor is its
  own piece of work.
- `updateVaultText` reads and writes plainly where the files carry no chain
  (a vault that is not open, the double of a test) and throws where an object
  hands on a chain without its entry: such a wrapper would bring the finding
  back in the app while every test still passed.

## Alternatives

- **The change goes into the working copy only**, the way an editor's save
  does. A table, a task list and the other devices read the note, not the
  working copy: the cell would jump back to the old value, the task would not
  stay ticked, and a notice would have to say where the change went.
- **Refuse it until the conflict is resolved.** Safe, and wrong for what
  cannot wait: a thought captured into the journal, a link that follows a
  rename, the anchor of an appointment that already exists at the provider.
- **Pass the starting text along with the whole text** (`writeEditorText` for
  every writer). It closes the second consequence and not the first — the
  chain would still redirect the write into the working copy —, and every
  caller would have to carry a text across its own awaits.
- **Leave the callers and teach `writeTextFile` to guess** that the writer
  had just read the file. Nothing in a whole text says where it came from.

## Links

- [The vault's adapter chain](../engineering/Vault_Adapter_Chain.md), "A change of a file that exists".
- Tests: `packages/core/test/update-text-file.test.ts`, `apps/desktop/src/readChangeWriteChain.test.ts`, `apps/mobile/src/services/vaultChainWrites.test.ts`; guards `readChangeWrite.test.ts` in `apps/desktop/src` and `apps/mobile/src`.
