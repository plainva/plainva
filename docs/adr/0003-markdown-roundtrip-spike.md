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
   for every text file.
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

Tests: `packages/core/test/text-file-shape.test.ts`,
`packages/core/test/conflict-resolver.test.ts`,
`packages/core/test/sync/text-shape-sync.test.ts` (two devices, bytes on both
disks and on the server), `apps/desktop/src/services/editorSaveRecovery.test.ts`,
`apps/mobile/src/services/editorTextSpace.test.ts`,
`apps/desktop/src/noteLineEnds.test.ts`, and
`apps/mobile/e2e-prod/note-line-ends.spec.ts` against the phone's production
bundle.
