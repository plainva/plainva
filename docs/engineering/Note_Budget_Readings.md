# What every reading of a note over its budget knows

Status: 2026-11-27. A note over the parse budget is read by several readings
(`packages/core/src/inlineParseBudget.ts`, `markdown-parser.ts`): the note's
tree, in which every block read as text is one paragraph of stand-ins; each
piece of such a block, parsed alone (`forEachReadPiece`); the rows of a table
over the table budget, parsed alone under its header (`readRowLinks`); and the
reading view's tree of the text it shows (`boundReaderMarkdown`). For a note
under its budget there is one reading, the note's tree. This page holds the
rule every one of them keeps, so that what each reads it reads as the note
read whole does, and what happens where it cannot know.
`Performance_Notes.md` ("Calibration per shell", "Named limits") has the
numbers.

## Two rules

**Text stays text.** No reading changes the text it reads: no line is
inserted in front of it or behind it, no node is taken out of its tree
afterwards, no place is moved back. A reading reads its text as it is written
and is given nothing of the rest of the note. (The one exception is the lead
of a piece, a blank line or a `---` of its own, read in front of it and
dropped with everything it holds; and the stand-ins of a block read as text,
one character for each of its own, which keep every place where it is.)

**Writing needs proof.** In a note over its budget a place is taken for a link
— by the index, a rename, the conversion of wiki links, any update of links —
only where its reading is the same under every set of defined labels. A place
whose reading may depend on a definition is not read: no link of the index,
nothing written, counted where a rename leaves it. The rule that decides it,
at the text, is the next section.

## What a definition reaches

What the parser makes of brackets depends on the definitions of the whole
note (`[label]: …`, `[^label]: …`): `[foo][bar](x.md)` is a reference and the
text `(x.md)` where `bar` is defined, a link to `x.md` where not. A part read
alone does not see the definitions outside it. So each reading asks of its
places whether a definition could change them (`definitionReach.ts`):

1. A reading is exact where the note holds no `]:` outside the text it parses
   (a definition ends its label with `]:`): the note's tree where no stretch
   read as written holds one, a piece or a row where the note holds none
   outside it. Every other reading is open.
2. In an open reading each paragraph, heading and table cell is read from the
   left. Code spans, HTML, autolinks and wiki links are read as a whole by the
   tokenizer before any bracket, and so is a backslash with what it escapes:
   nothing in them counts. Every other `[` opens a bracket.
3. A `]` that ends the text of an inline link the reading made — its opener
   the bracket open last, a `(` behind it, the text not beginning with `^` — is
   read alike under every definition (the destination is read as written) and
   closes that bracket. A `]` with no bracket open is text.
4. Every other `]` asks the parser whether a label is defined. Where it closes
   the only bracket open, is not followed by `[`, and is not a `[^…]` followed
   by `(`, what it changes is the bracket itself: a reference or text, and with
   it what stands inside. That stretch is open, and the reading goes on behind
   it as under every other definition. So is it for `[text][label]` and
   `[text][]` with a label of plain characters behind which no `(` or `[`
   follows.
5. Any other such `]` — behind another bracket still open, or one that may
   take the brackets behind it for its label — may change all that follows:
   the container is open from its first bracket still open to its end.
6. A container that asks the parser anything gives no tags: what the parser
   makes a reference of moves the edges of the text around it.

What is open is not read for links (`NoteLinks.unread`): the index lists no
link there, a rename writes nothing there and counts each such stretch that
names the renamed note where a link can name it (`unreadNaming`), and the
conversion of wiki links converts nothing there. A note without a `]:` is read
exactly; so is every reading of a note whose definitions all stand in its
formatted text, for its tree. `definitionReach.test.ts` checks the rule
itself: paragraphs full of brackets, read whole under many sets of defined
labels (none, all, footnotes, `[ ^a]`), every place the rule calls fixed read
alike in all of them.

## Table A — what a block needs from outside it

A block read alone reads as in the note when it knows these facts of the rest
of the note.

| Fact from outside | Where it may stand | The note's tree (formatted blocks) | Each piece | A row of a table over its budget | The reading view's tree | Text not read (`unread`) |
|---|---|---|---|---|---|---|
| Link reference definitions `[label]: dest` and footnote definitions `[^label]: …` | anywhere in the note, also in a quote, a list item, a footnote | its own; where the note holds a `]:` in a stretch read as text, its places a definition may change are not read (the rule above) | its own; where the note holds a `]:` outside it, as the note's tree | as a piece | its own: a reference whose definition stands in a block read as text reads as the text it is, and `[foo][bar](x.md)` may show a link there that the note read whole does not have — the reading view only shows, nothing is written or listed from it | none: no reading |
| Whether the note begins with a `---` nothing closes | the note's first line | the parser reads no blocks within blocks anywhere | read behind a `---` of its own, with the properties block's reading (`pieceLead`): the same mode; the note has no line that would close it | the same | the reading view reads no properties block, and opens blocks within blocks there | — |
| Whether a block continues the one before | the line before it: an indented block, or one behind a line indented by four blanks or more | — | the block is cut only where the note itself begins a block; such a block stays with the one before it, in the budget's choice (`noteBudgetRanges`) as in its pieces | — | — | — |

A heading whose text holds brackets a definition elsewhere may change keeps
the text its reading gives it in the note's source (outline, search): it is
open, and not compared.

## Table B — a part not read, by why

A part is not read where no reading reads it for its facts
(`ReadAsTextParts.unread`), or where a definition the reading does not see may
change it (the rule above). What is read in pieces otherwise is not in this
table: its links, tags, tasks, headings, block ids and its rename are the note
read whole's. Nothing is read only up to a limit: every block read as text is
read in pieces, the whole note.

| Why | From what size | Index (links) | Tags | Tasks | Headings, block ids | Rename | What the user sees | What helps |
|---|---|---|---|---|---|---|---|---|
| A paragraph over the inline budget, as on `main` | 5 478 characters at the least (`SMALLEST_UNREAD_CHARS`: a paragraph of `]`); prose from about 0.9 MB | none of it | outside a block read as text from the note's tree, inside one from its piece's tree, each once; the tag rule over raw characters is not used | found: the line scan (`taskScan.ts`) reads no tree | none of it | leaves its links; counts each stretch that names the renamed note where a link can name it, with the links it could not rewrite (`unreadNaming`) | the strip "Part of this note is shown as text, and its links are not read." (warning) and its ⓘ; after a rename the warning "Renamed — but links could not be checked and updated" | blank lines in it, or the note split into smaller notes |
| A unit of a block read as text heavier than a piece may weigh (`PIECE_SHARE`, half the note's budget) that cannot be cut: no list at its outermost level, or one item only (a quote of one paragraph, a list under one item, one paragraph) | over the note's budget, so on the phone from 41 KB (dense tables) to 2.4 MB, on the desktop four times that | none of it | none: no tag rather than a wrong one (the tag rule over raw characters read `#include` in code as a tag) | found: the line scan | none of it | as above | as above | blank lines in it (outside the quote: a line `>` keeps one quote one paragraph), or the note split into smaller notes |
| Behind an unclosed `---` in the first line | as either above: in this mode a list is no list, so a unit is not cut at its items | — | — | — | — | — | — | the same; or the `---` closed |
| Where a definition the reading does not see may change the brackets (the rule above) | a note over its budget with a `]:` outside the part | none from the first bracket that asks for a label, to the end of its paragraph (or of the bracket alone, rule 4) | none from that paragraph | found: the line scan | as its reading gives them | as above | the ⓘ of the strip says that links beside a reference whose definition stands elsewhere are not read | the definitions moved next to their references, or the note split |

A rename plans from the backlinks, which hold no link of a part not read. So
it also asks the full-text index once for the notes whose text holds the old
name, as written and as a Markdown link encodes it (`%20`, `%C3%B6`)
(`notesThatMayNameUnread`, the phrase the search reads), keeps those of at
least `SMALLEST_UNREAD_CHARS` characters (a file's size in bytes is never
less), reads each and counts what its parts not read name where a link can
name it; it writes nothing there. Where the search cannot find for sure — a
name without a letter or a digit, a note without its row in the full-text
index — it reads every note of that size. No new index format: the cost is a
query a name and the reading of the large notes that hold it.

Both shells read alike but by their own budget (the desktop four times the
phone's): a unit heavy enough to be not read on the phone may be read on the
desktop. That is the parity catalog's decision `note-read-formatted-up-to`.
