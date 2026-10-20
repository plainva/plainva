# ADR 0003: Markdown Roundtrip Spike

Status: Accepted

Date: 2026-06-22

## Context

Plainva's central product promise depends on preserving plain Markdown vaults without migration, lock-in or silent formatting damage.

The master plan requires that existing Obsidian-style vaults remain usable after Plainva reads and writes them. The highest-risk early question is whether Plainva can open, parse, serialize and save Markdown while preserving meaningful file content and structure.

The validation target eventually includes Marco's real vault with about 500 Markdown files, wikilinks, frontmatter, callouts, embeds and `.base` usage. The first implementation step must not start by mutating that real vault.

## Decision

Plainva treats the Markdown roundtrip spike as a Phase 0 risk spike.

The spike starts with small controlled fixtures committed to the repo. It later expands to a read-only or copied test corpus derived from Marco's real vault.

The spike must verify parse-serialize behavior before any editor, storage adapter or sync implementation is trusted to write files.

The initial parser/serializer baseline follows the master plan's TypeScript-first direction and may use the unified/remark ecosystem for early validation. This ADR does not implement that stack and does not lock every parser option yet.

The spike must not:

- mutate real vault files in place,
- silently migrate or reformat existing vault content,
- require private vault data to be committed to the repo,
- hide differences that would matter to users or Obsidian compatibility.

## Consequences

- Roundtrip safety becomes an explicit gate before write-capable editor/storage work.
- Controlled fixtures can be reviewed and versioned without exposing private vault contents.
- Later real-vault validation must run against a copy or non-mutating harness.
- Diff output becomes part of the spike's value, not just pass/fail.
- Some formatter-normalization questions will need explicit decisions as fixtures reveal edge cases.

## Alternatives

- Start with app-shell work first: faster visible progress, but risks building on an unproven data-safety foundation.
- Test only against Marco's real vault immediately: realistic, but unsafe and unsuitable for a public repo.
- Treat Markdown serialization as an implementation detail: simpler short term, but directly conflicts with Plainva's Markdown-kernel promise.
- Use snapshot-only tests without parsing: useful later, but insufficient to validate parser/serializer behavior.

## Links

- Master project plan, sections 2.1, 3, 14.2 and 16 (internal planning document, maintainer workspace)
- `docs/adr/0001-monorepo-pnpm-turborepo.md`
- `docs/adr/0002-app-stack-baseline.md`

## Addendum 2026-10-09 (a text file keeps its line endings and its byte order mark)

One of the "formatter-normalization questions" this ADR left open, decided by
the maintainer on 2026-10-09. It reverses a rule of 2026-08-13: notes were
"UTF-8/LF project-wide", so the first changed character wrote a note back with
`\n` throughout, and so did every merge. For a vault that came from Windows and
is kept in Git that is the difference between one changed line and the whole
file — a silent reformat of existing vault content, which this ADR rules out.

1. **A file keeps the shape it has.** Line endings and a UTF-8 byte order mark
   are the file's, for a note as for any other text file. Plainva takes them
   when it reads a file and puts them back when it writes it. What Plainva
   creates itself starts with `\n` and without a mark.
2. **An editor holds one text.** `\n` line ends, no mark
   (`packages/core/src/textFileShape.ts`, `editorTextOf`). Whatever is compared
   with what an editor holds is read into that text first; every write of it
   says which shape it leaves in. Both shells open a file through one function
   (`openEditorText` in the UI package), which returns the file's own shape
   for every text file. A place is a place in one of the two texts: one that
   was counted in the file reaches an editor through `editorOffsetOf`, as the
   caret a template leaves in a new note does (ADR 0009, addendum
   2026-10-09, point 4).
3. **A merge decides the shape itself.** The merges in `conflict-resolver.ts`
   work on lines and hand their result back in the shape `mergedTextShape`
   gives: line endings and the mark are merged like a line — where one side
   changed them and the other did not, the change stands. Where no ancestor
   says who changed what, the version that is already there decides: the file
   on disk for a save, the server's version for a sync. A device that joins a
   sync with the same notes in other line endings takes the ones the others
   hold and uploads nothing. A merge that takes nothing from the other side
   hands its own side back byte for byte, stray line endings included. No
   caller puts the shape back, so none can forget to. A sync therefore
   neither turns the line endings of a file two devices changed, nor undoes a
   conversion one device made on purpose.
4. **A file's text is its bytes decoded with the mark** (`textOfFileBytes`). A
   plain `TextDecoder` drops it; a pulled file, a version restored from an
   encrypted workspace's history, and every file in a folder the phone reaches
   through the system's document provider came back without the mark they had.
   **The phone's own storage (added 2026-10-20).** Its adapter asked the system
   for a file's text, and the two systems decode differently: Android's reader
   leaves a leading mark in the text, Foundation skips it. On an iPhone a file
   reached the editor without its mark and was saved without it, a write
   beside the editor dropped it as well, and the sync carried the loss to every
   other device (read in the sources of the plugin's libraries and of
   Foundation, run on no iPhone). The adapter reads the bytes and decodes them
   by this rule on both systems, so no system decoder has a say; only the
   browser build, whose store keeps a text file as the text it was given,
   hands that text out. Bytes that are not UTF-8 come out with replacement
   characters on both systems, as from the folder adapter — iOS' own reader
   refused them —, and the chain refuses such a file either way (the
   paragraph of 2026-10-20 below). A build before this left a local marker
   that is the hash of the text without its mark beside a base the sync
   recorded with it. The write chain and the index take such a marker for the
   file that is there where that base is the file as it lies
   (`isMarkerTakenWithoutMark` in `packages/core/src/vault/localText.ts`), and
   a merge takes that base for the version the marker names; otherwise a whole
   text written over such a file — a version put back, a view that holds its
   text — ended as a conflict copy, and a pass that read the file again called
   it changed elsewhere. A mark another program adds to a file the sync knows
   without one is no such marker: the base has no mark either, and the change
   is reported and merged like any other (a row cannot tell one corner apart:
   such a build wrote the file back without its mark, its upload had not gone
   out, and another program put the mark back — that mark may be lost again,
   never the text). In a vault without sync the merge with the base on record
   decides, and a pass that reads such a file again reports it as changed
   until it is opened or written.
5. **Writers beside an editor follow the same rule.** One that adds or
   replaces a line thinks in `\n` and writes in the file's shape
   (`editInShape`); one that writes a whole text anew over an existing file
   takes that file's shape (`inShapeOf`). The frontmatter writers use the same
   definition of a note's line ending as everything else.
6. **Mixed line endings go to the majority.** A file that mixes both kinds is
   brought to the kind most of its lines have the first time its text is
   changed. Remembering the ending per line would be the only way to be exact,
   and it would preserve a stray ending forever. A write that changes nothing
   writes nothing.
7. **Outside this decision.** A `.base` is serialised anew from its
   configuration, with `\n` and without a mark, whenever that configuration
   changes. A text file in an encoding other than UTF-8 is read as UTF-8, and
   a sync does not carry it over intact — a separate, older question. And the
   Markdown serializer a rename runs over the notes that link to the renamed
   one changes more than line endings (list bullets, emphasis marks, table
   rules); its result is brought back to the note's shape, the rest is a
   separate question.
8. **Whoever reads a file's text meets the mark (added 2026-10-11).** Point 4
   brought the mark to the phone's readers, which had never seen one, and
   showed what the desktop's had done with it all along. A reader that names
   PLACES in a note — the outline, an embedded section, the reading view, the
   journal — counts them in the text it was given, mark included: the
   Markdown parser skips the mark and counts from behind it, so its offsets
   are brought back to the text before anything is laid on it (point 9). What
   is handed to the reading view has no mark, as it has no `\r`. And the
   journal reads and changes the lines behind the mark and puts it back in
   front of them.
9. **Markdown is parsed in one place, and its places are places in the text
   it was given (added 2026-10-12).** The note source was one of three readers
   that laid a parser's offsets on a file's text, each with a parser of its
   own: the import from Joplin kept a link definition unresolved in a body
   that starts with a mark, and `parseMarkdownAst` handed out offsets one
   short — the index reads lines only, and the link rewriter of the addendum
   below cuts the mark off itself before it parses. All three take their tree
   from
   `packages/core/src/markdown-parser.ts` now (`parseMarkdownTree`,
   `parseCommonMarkTree`, `parseMarkdownAst`), which adds the one character
   the parser skipped back to every offset, and to the columns of the first
   line. A reader of places has nothing to remember about a mark, and a
   shipped file that brings a parser of its own fails a guard. The reading
   view's renderer is the one other parse; what it is handed has no mark at
   its start (point 8). A reader that goes through a file's LINES reads them
   as an editor holds them (`editorTextOf`): the context of a backlink took a
   list item in the first line of such a note for plain text, and the reading
   view read the writing direction of an embedded note's blocks from lines of
   which the first began with the mark — a task there ran left to right
   whatever it was written in, and behind a properties block the whole note
   did.

**2026-10-12 — the encoding question of point 7, answered for the sync.** A
file is text when its name says so AND its bytes are UTF-8 (`mergeableText` in
`packages/core/src/sync/fileType.ts`). Every other file travels byte for byte,
like an image: it has no merge base text, it is never merged, and where both
sides changed it the local version is kept as a `.CONFLICT` copy. Until then
the name alone decided: a pull wrote the decoded text of a `.csv` in
Windows-1252 or a `.txt` in UTF-16 as the file — every byte that is not UTF-8
replaced —, and a change on both sides merged the two decoded texts and sent
the result to everyone. The sync worker asks the question for both sides of a
pull and reads both as bytes; the sync engine asks it for what it pushed. The
indexer, and the marker the conflict-aware adapter records when a file is
opened, read a file of the device through `readLocalText`
(`packages/core/src/vault/localText.ts`), which answers the same question and
gives the one hash all of them compare by — the hash of the file's bytes —
whether the platform's text reader replaces such bytes or refuses the file.
Rows an older version left behind are marked (`sync_state.recheck`,
`packages/core/src/db/lossyTextBaseMigration.ts`): the file is compared with
the server's copy once more, and nothing of it is pushed before. As long as
a device with an older version can still send a decoded text: such a version,
arriving over an unchanged file in another encoding, is taken like any other,
and that file is kept next to it as a `.CONFLICT` copy.
What the app itself does with such a file is answered in the next paragraph.
Tests: `packages/core/test/sync/non-utf8-text-sync.test.ts` (two devices, both
kinds of text reader, bytes on both disks and on the server),
`packages/core/test/local-text.test.ts`.

**2026-10-20 — the same question, answered for the app.** The app asks what
the sync asks. The adapter chain both shells hand out
(`ConflictAwareVaultAdapter`) hands out a file's text or refuses the file
(`NotTextFileError`, through `readExactText` in
`packages/core/src/vault/localText.ts`), whether the platform's text reader
replaces such bytes or refuses them; and it writes no text over a file it could
not read as one — not an editor's save, not a change through its one entry for
reading, changing and writing back (`updateTextFile`), not a whole text. An
editor shows such a file as not text on both shells, a note included, and an
auxiliary window of the desktop reads the same way. The version kept before a
write is the file's bytes where the file is no text. A restored version, a
duplicate and the copy of a conflict that takes a file's place are written as
text only where they are text, and byte for byte otherwise
(`writeFileVersion`, `copyFileContent`); the version history keeps no list of
text extensions of its own. What an editor held when its file turned into such
a file is kept beside it as a conflict copy (`keepTextBeside`), both shells
lead from such a file to the newest copy beside it, kept there or left by the
sync (`newestConflictCopy`), and the comparison of both shells settles a copy
that cannot be laid out as text byte for byte, through one way
(`settleConflictCopy`) — an open conflict through its own gate
(`resolveConflictBytes`); while a conflict is open, no bytes are written into
either side of it. Which files a comparison reads as text is one rule of both
shells (`comparesAsText`). Until then the extension decided: where the reader
replaces, an editor opened a `.csv` in Windows-1252 with replacement
characters, its first save wrote them, and the version kept before that save
was the same reading; where it refuses, the desktop's editor called the file
missing. A read-only view that offers to convert such a file to UTF-8 is a
separate question (maintainer, 2026-10-19). Tests:
`packages/core/test/non-utf8-text-in-app.test.ts` (both kinds of text reader,
bytes read), `apps/mobile/src/services/notTextFiles.test.ts`,
`apps/desktop/e2e/not-text.spec.ts`, `apps/mobile/e2e-prod/not-text.spec.ts`.

Tests: `packages/core/test/text-file-shape.test.ts`,
`packages/core/test/conflict-resolver.test.ts`,
`packages/core/test/sync/text-shape-sync.test.ts` (two devices, bytes on both
disks and on the server), `apps/desktop/src/services/editorSaveRecovery.test.ts`,
`apps/mobile/src/services/editorTextSpace.test.ts`,
`apps/desktop/src/noteLineEnds.test.ts`, and
`apps/mobile/e2e-prod/note-line-ends.spec.ts` against the phone's production
bundle. For point 8: `packages/core/test/noteSource.test.ts`,
`packages/core/test/journal.test.ts`, and
`apps/mobile/src/adapters/externalVaultAdapter.test.ts`, which reads the same
files with and without a mark through the phone's adapter for a picked folder.
For the phone's own storage (point 4):
`apps/mobile/src/adapters/capacitorVaultAdapter.test.ts`, against a fake of
the storage plugin that answers a read as text the way each system's library
does, with the same note between a phone and another device.
For point 9: `packages/core/test/markdown-places.test.ts`, the guard
`apps/desktop/src/markdownParseSites.test.ts`, and a daily note with a mark
taken through every change the journal makes, on each shell's own way and
with the bytes read back — `apps/desktop/src/journalByteOrderMark.test.ts`,
`apps/mobile/src/services/journalByteOrderMark.test.ts` —, and through the
reading view: `apps/desktop/src/lib/readerByteOrderMark.test.tsx`.

## Addendum 2026-10-12 (a note is never written back from its parsed tree)

The question point 7 above left open, decided the way this ADR decides it:
parse-serialize is no way to change a note that is already there.

Finding 2026-10-09: renaming a note sent every note that links to it through
the Markdown serializer — parse the note, change the link in the tree, write
the tree back. So did preparing a note as the overview of its folder. The
serializer writes in its own form, and the note came back in it: `- ` for
whatever list marker the note uses, `_emphasis_`, a table rule as `| - | - |`
with its cells padded, a blank line behind the properties block, a line end at
the end of the file. An aliased link in a table cell, `[[Note\|alias]]`, came
back without the backslash that keeps its `|` in the cell, and the row had one
cell more. A link in the properties was renamed by writing the whole block
anew through the YAML library: a long line folded at 80 characters, `[a, b]` as
`[ a, b ]`, an unquoted `007` as `7`. Measured on real vaults (3 139 notes):
written back from its tree, 3 122 of them come back changed. For a vault kept
in Git, renaming one note was a diff across every note that links to it — a
silent reformat of existing vault content.

1. **A change stands where it is made.** A rename changes, in every note that
   links to the renamed one, the part of each link that names the file — and
   no other byte. Anchor, alias, label, title, line endings and a byte order
   mark stay. Of the name itself, what the old and the new one begin and end
   with stays as it is spelled: a folder in another tool's encoding
   (`Projects%20(old)/`), an escaped character (`My\_Note`), the extension;
   what is written anew follows the form the destination had (percent-encoded,
   between angle brackets, with letters beyond ASCII left as they are). A
   destination is read back before it is written: where what is kept and what
   is new would read as something else together — `&amp;` in a name is a
   character reference, `41` behind a `%` the note left bare an encoded
   letter —, all of it is written in Plainva's own encoding, with `&` encoded
   as well. A wiki link's name is written as the name it is. The same holds
   for a link in the properties: the target changes inside its scalar, the
   block is not written anew.
2. **The parser says where, the text is what is changed.**
   `packages/core/src/linkRewrite.ts` reads a note's links with their places
   (`readNoteLinks`) from the same tree the index lists a note's links from, so
   a link that counts as a backlink is a link that is rewritten, and what the
   index does not take for a link — code, HTML, the properties block — is left
   alone. `rewriteNoteLinks` and `renameNoteLinks` replace characters of the
   text as it was read. The parser hands out a text with its backslash escapes
   and character references resolved; a link is therefore placed by finding it
   in the source lines with their escapes taken out — `\|` in a table cell is
   the common one — and only where the source spells it out: the n-th link
   read is the n-th link spelled, where the two are spelled the same. A link
   the source does not spell (a character reference inside it,
   `[[A &amp; B]]`) is reported and left as it is: the rename says that a link
   could not be updated, as it does when the index cannot be read, and nothing
   is guessed. Where the two readings do not even hold the same number of
   links (`&#91;` spells a bracket), a place is only tried, and the note is
   read once more with a name of its own there: a link is handed out only
   where the parser reads it.
3. **Preparing an overview changes two things.** The properties block goes by
   the rule every writer follows when a block goes (`noteWithoutProperties`,
   over `composeNote`), and each wiki link that leads to a listed note is
   replaced, where it stands, by a Markdown link. The rest of the note stays
   byte for byte.
4. **The serializer writes new text only.** Its one use in the app is the
   Markdown link that takes a wiki link's place (`serializeMarkdownLink`).
   `apps/desktop/src/markdownSerializerUse.test.ts` fails a shipped file that
   reaches for `serializeMarkdownAst` or for a package that writes Markdown
   from a tree. It stays in the core for tools outside the app that build a
   note from a tree of their own.
5. **Outside this decision.** The writers of a note's properties other than a
   rename — the properties panel, a database cell, a renamed tag or key —
   still write the block anew through the YAML library when one entry
   changes, and the other entries come back in the library's form. That is
   the same question for another writer, and a separate one. So is what the
   index takes for a wiki link: it scans Markdown text, and a link whose name
   carries marks that pair up (`[[_draft_]]`) is none for it, typed by hand
   or written by a rename. The rename writes the name as it is — a backslash
   in it would be part of the name for every reader that takes a wiki link
   as it stands — and leaves that to the scan.

Tests: `packages/core/test/link-rewrite.test.ts` (every form of link and of
note; the rewriter lists the links the index lists),
`packages/core/test/frontmatter-surgical.test.ts`,
`packages/core/test/okf-index.test.ts`, and each shell's own rename over real
files, a real index and bytes read back —
`apps/desktop/src/renameLinkBytes.test.ts` and
`apps/mobile/src/services/renameLinkBytes.test.ts`, over the notes in
`packages/core/test/helpers/renameNotes.ts`.
