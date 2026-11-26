# What every reading of a note over its budget knows

Status: 2026-11-26. A note over the parse budget is read by several readings
(`packages/core/src/inlineParseBudget.ts`, `markdown-parser.ts`): the note's
tree, in which every block read as text is one paragraph of stand-ins; each
piece of such a block, parsed alone (`forEachReadPiece`); the rows of a table
over the table budget, parsed alone under its header (`readRowLinks`); and the
reading view's tree of the text it shows (`boundReaderMarkdown`). For a note
under its budget there is one reading, the note's tree. This page holds the
rule every one of them keeps, so that each reads what it reads as the note
read whole does, and what happens where a part is not read at all.
`Performance_Notes.md` ("Calibration per shell", "Named limits") has the
numbers.

## Table A — what a block needs from outside it

A block read alone reads as in the note when it knows these facts of the rest
of the note. The first definition of a label in the order of the note wins, as
in the parser; a later one of the same label changes nothing, wherever it
stands.

| Fact from outside | Where it may stand | The note's tree (formatted blocks) | Each piece | A row of a table over its budget | The reading view's tree | Text not read (`unread`) |
|---|---|---|---|---|---|---|
| Link reference definitions `[label]: dest` | anywhere in the note, also in a quote, a list item, a footnote | its own; and for each label its text refers to that is defined only in a block read as text or not read, a line `[label]: #` given behind the properties block (`givenDefinitions`), its node taken out again | a line `[label]: #` behind it for each label of brackets in it that run into a `(` (`appendixFor`: only there does a definition change a link), and read for the note's source for each label on a line that may be a heading's content (a heading's text is its reference's text: `forEachHeadingLine`), from every definition of the note outside the piece; the piece weighs them (`pieceWeight`) | as a piece | as the note's tree, from the original's definitions | none: no reading |
| Footnote definitions `[^label]: …` | as above | as above, the line `[^label]: .` | as above, `[^label]: .` | as a piece | as the note's tree | none |
| A label's key | — | the parser's own: micromark's `normalizeIdentifier` over the label as written, lower case (mdast's `identifier`: `ß` is `ss`, `[b\]c]` is `b\]c`) | the same, over the label in brackets as written | the same | the same | — |
| Whether the note begins with a `---` nothing closes | the note's first line | the parser reads no blocks within blocks anywhere | read behind a `---` of its own, with the properties block's reading (`pieceLead`): the same mode; the note has no line that would close it | the same | the reading view reads no properties block, and opens blocks within blocks there | — |
| Whether a block continues the one before | the line before it: an indented block, or one behind a line indented by four blanks or more | — | the block is cut only where the note itself begins a block; such a block stays with the one before it, in the budget's choice (`noteBudgetRanges`) as in its pieces | — | — | — |

Where the definitions come from: those of the formatted blocks from the note's
tree; those of a block read in pieces from each piece that holds `]:`, parsed
for them first (`readAsTextDefinitions`); those of a part not read from each
line of it that holds `]:`, parsed with the line before and after it. Read so,
a line that the note read whole would not take for a definition (in a fence,
inside a paragraph) only makes its label defined: `[x][label]` then reads as a
reference, and no link is made that the note does not have — the reading errs
to the side that writes nothing. A definition spanning more than three lines
(a label over several lines inside a part not read) is not seen there.

A definition names nothing to the index, and a reference link is no link of
the index (`extractLinksAndTags` reads links, wiki links and embeds): a given
line only changes what the parser makes of the brackets around it. Without
them `[foo][bar](x.md)` read as text `[foo]` and a link to `x.md` where the
note read whole reads a reference and the text `(x.md)`, and a rename wrote
into that text. `note-budget-mixed.test.ts` reads notes of every kind of block
and these references, a part formatted, a part in pieces, a part not read,
with the budget of each shell, against the note read whole.

A given line is part of the note's tree, so the note's budget weighs it
(`noteBudgetRanges`): what the definitions read as text weigh — those of a
block it reads as text, and those of a paragraph the paragraph's budget reads
as written — counts again, up to one given line of the most a line of
`[label]: #` weighs for each reference still formatted. A reference weighs by
its brackets, `[text][label]`, `[label][]` and `[label]` alike (not a link's
`](`, a wiki link, a definition's label, a task's box or a callout's type): more
references than the parser resolves, never fewer. So a note of references and
their definitions reads its references as text as well, until what stays
formatted and what is given back fits; before, it read the definitions as text,
weighed them gone, and its tree held every one of them again
(`note-budget-given.test.ts`; `perf:notes` forms `refsdefs` and `sharedrefs`).

## Table B — a part not read, by why

A part is not read where no reading reads it for its facts
(`ReadAsTextParts.unread`). What is read in pieces is not in this table: its
links, tags, tasks, headings, block ids and its rename are the note read
whole's. Nothing is read only up to a limit: every block read as text is read
in pieces, the whole note.

| Why | From what size | Index (links) | Tags | Tasks | Headings, block ids | Rename | What the user sees | What helps |
|---|---|---|---|---|---|---|---|---|
| A paragraph over the inline budget, as on `main` | 5 478 characters at the least (`SMALLEST_UNREAD_CHARS`: a paragraph of `]`); prose from about 0.9 MB | none of it | outside a block read as text from the note's tree, inside one from its piece's tree, each once; the tag rule over raw characters is not used | found: the line scan (`taskScan.ts`) reads no tree | none of it | leaves its links; counts each stretch that names the renamed note with the links it could not rewrite (`unreadNaming`) | the strip "Part of this note is shown as text, and its links are not read." (warning) and its ⓘ; after a rename the warning "Renamed — but links could not be checked and updated" | blank lines in it, or the note split into smaller notes |
| A unit of a block read as text heavier than a piece may weigh (`PIECE_SHARE`, half the note's budget) that cannot be cut: no list at its outermost level, or one item only (a quote of one paragraph, a list under one item, one paragraph) | over the note's budget, so on the phone from 41 KB (dense tables) to 2.4 MB, on the desktop four times that | none of it | none: no tag rather than a wrong one (the tag rule over raw characters read `#include` in code as a tag) | found: the line scan | none of it | as above | as above | blank lines in it, or the note split into smaller notes |
| Behind an unclosed `---` in the first line | as either above: in this mode a list is no list, so a unit is not cut at its items | — | — | — | — | — | — | the same; or the `---` closed |

A rename plans from the backlinks, which hold no link of a part not read. So
it also asks the full-text index once for the notes whose text holds the old
name (`notesThatMayNameUnread`, the phrase the search reads), keeps those of
at least `SMALLEST_UNREAD_CHARS` characters (a file's size in bytes is never
less), reads each and counts what its parts not read name; it writes nothing
there. No new index format: the cost is a query a name and the reading of the
large notes that hold it.

A part not read is read for its definitions only where one may begin, on a
line of at most 4 096 characters and with the short lines behind it
(`readAsTextDefinitions`): beside a definition may stand the paragraph the
parser may not read. A definition on a longer line there is not seen. The
notes the performance workflow's hunt found on 2026-11-26 ran the phone's
index out of 128 MB on each of these: a piece weighed without its
definitions, a piece of 2 000 definitions read with them again behind it, a
piece read with the definitions of every label in brackets, a definition read
with a paragraph of megabytes (`note-budget-given.test.ts`).

Both shells read alike but by their own budget (the desktop four times the
phone's): a unit heavy enough to be not read on the phone may be read on the
desktop. That is the parity catalog's decision `note-read-formatted-up-to`.
