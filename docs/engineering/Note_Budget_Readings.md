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

**A stand-in changes nothing outside itself.** What decides how the rest of
the note is read never stands in a stretch read as text: the line of a `---`
nothing closes, which sets the whole note's reading, is never read as text, as
a properties block is not, and a fence, an HTML block or a comment stays one
block with all it holds open. The budget's blocks are the parser's: a fence
ends where the parser ends it — one in no list item at its closing line,
whatever stands between, one behind an item's marker also where a line leaves
the item —, and where the scan cannot know which (a fence or HTML that runs on,
indented where a list item may be open, or behind a quote's or an item's
marker), it cuts nothing from there to the note's end: no blank line ends a
block there, no heading is one of its own. Outside the stretches read as text
(and the places of the next rule) the note's tree is the tree of the note read
whole, node for node, by kind, both ends and depth;
`note-budget-trees.test.ts` holds that for notes of every building block
(among them fences indented by one to three blanks with their code from the
margin, fences in items and quotes, HTML of all seven kinds over blank lines)
in every wrapping, with a heavy block first, in the middle or last, at budgets
of 5 to 95 percent; it excuses three things, each for the case it needs (open
places, the edges of text in a container that asks for a label, a list or a
quote cut in two).

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
6. In a container that asks the parser anything, a tag is read only where its
   reading is the same under every set of definitions: in text whose
   characters are the note's own up to the tag's end, behind a blank, outside
   what is open, its name without `_` and ending where the note's name ends.
   What the parser makes a reference of moves the edges of the text around it
   (`[a]#tag` is a tag beside a reference, none beside text), and emphasis
   pairs otherwise across it (`#a_b_`).

What is open is not read for links (`NoteLinks.unread`): the index lists no
link and no tag there, a rename writes nothing there and counts each
link-shaped target there that its resolver leads to the renamed note (`unreadLinksTo`),
and the conversion of wiki links converts nothing there. A note without a `]:` is read
exactly; so is every reading of a note whose definitions all stand in its
formatted text, for its tree. `definitionReach.test.ts` checks the rule
itself: paragraphs full of brackets, read whole under many sets of defined
labels (none, all, footnotes, `[ ^a]`), every link and every tag the rule calls
fixed read alike in all of them.

## Table A — what a block needs from outside it

A block read alone reads as in the note when it knows these facts of the rest
of the note.

| Fact from outside | Where it may stand | The note's tree (formatted blocks) | Each piece | A row of a table over its budget | The reading view's tree | Text not read (`unread`) |
|---|---|---|---|---|---|---|
| Link reference definitions `[label]: dest` and footnote definitions `[^label]: …` | anywhere in the note, also in a quote, a list item, a footnote | its own; where the note holds a `]:` in a stretch read as text, its places a definition may change are not read (the rule above) | its own; where the note holds a `]:` outside it, as the note's tree | as a piece | its own: a reference whose definition stands in a block read as text reads as the text it is, and `[foo][bar](x.md)` may show a link there that the note read whole does not have — the reading view only shows, nothing is written or listed from it | none: no reading |
| Whether the note begins with a `---` nothing closes | the note's first line | the parser reads no blocks within blocks anywhere; the `---` line is never read as text (`noteBudgetRanges`), so the tree keeps that reading | read behind a `---` of its own, with the properties block's reading (`pieceLead`): the same mode; the note has no line that would close it | the same | the reading view reads no properties block, and opens blocks within blocks there | — |
| Whether a block continues the one before | the line before it: an indented block, or one behind a line indented by four blanks or more | — | the block is cut only where the note itself begins a block; such a block stays with the one before it, in the budget's choice (`noteBudgetRanges`) as in its pieces | — | — | — |

A heading whose text holds a reference reads it as written where the heading
or the definition stands in a part read as text: the outline, a search hit and
the heading's anchor show `[[[A]]][bar] heading` where the note read whole
shows `[[A]]bar heading`, and a heading in a block read as text, its piece read
without the definition outside it, shows `[Use][bar] inner heading` for `Use
inner heading`. Nothing is written from it.

## Table B — a part not read, by why

A part is not read where no reading reads it for its facts
(`ReadAsTextParts.unread`), or where a definition the reading does not see may
change it (the rule above). What is read in pieces otherwise is not in this
table: its links, tags, tasks, headings, block ids and its rename are the note
read whole's. Nothing is read only up to a limit: every block read as text is
read in pieces, the whole note.

| Why | From what size | Index (links) | Tags | Tasks | Headings, block ids | Rename | What the user sees | What helps |
|---|---|---|---|---|---|---|---|---|
| A paragraph over the inline budget, as on `main` | 5 478 characters at the least (`SMALLEST_UNREAD_CHARS`: a paragraph of `]`); prose from about 0.9 MB | none of it | outside a block read as text from the note's tree, inside one from its piece's tree, each once; the tag rule over raw characters is not used | found: the line scan (`taskScan.ts`) reads no tree | none of it | leaves its links; counts each link-shaped target that its resolver leads to the renamed note, with the links it could not rewrite (`unreadLinksTo`) | the strip "Part of this note is shown as text, and its links are not read." (warning) and its ⓘ; after a rename the warning "Renamed — but links could not be checked and updated" | blank lines in it, or the note split into smaller notes |
| A unit of a block read as text heavier than a piece may weigh (`PIECE_SHARE`, half the note's budget) that cannot be cut: no list at its outermost level, or one item only (a quote of one paragraph, a list under one item, one paragraph) | over the note's budget, so on the phone from 41 KB (dense tables) to 2.4 MB, on the desktop four times that | none of it | none: no tag rather than a wrong one (the tag rule over raw characters read `#include` in code as a tag) | found: the line scan | none of it | as above | as above | blank lines in it (outside the quote: a line `>` keeps one quote one paragraph), or the note split into smaller notes |
| Behind an unclosed `---` in the first line | as either above: in this mode a list is no list, so a unit is not cut at its items | — | — | — | — | — | — | the same; or the `---` closed |
| A table over the table budget whose rows hold more links than its reading can keep | rows read alone hold what each finds to the note's end: each Markdown link, address or mail address of a row weighs 250 beyond the row read as text, a wiki link 30 (`NOTE_ROW_FACT_WEIGHT`, `NOTE_ROW_WIKI_WEIGHT`); on the phone a table of rows with three Markdown links from about 21 000 rows | none of it | none | found: the line scan | none of it | as above | as above | the table split into smaller notes |
| Where a definition the reading does not see may change the brackets (the rule above) | a note over its budget with a `]:` outside the part — a definition, a footnote, or the characters `]:` anywhere, in code too | none from the first bracket that asks for a label, to the end of its paragraph (or of the bracket alone, rule 4) | only those that read alike (rule 6) | found: the line scan | as its reading gives them: a heading's text with a reference reads it as written (outline, search, anchor) | as above | the ⓘ of the strip names `]:` and what it costs | the note split into smaller notes, or no `]:` outside the part |

A rename plans from the backlinks, which hold no link of a part not read. So
it also reads every note of at least `SMALLEST_UNREAD_CHARS` characters (a
file's size in bytes is never less) that the backlinks do not name
(`notesThatMayNameUnread`); no search narrows them, since a link may write its
target in ways no phrase of the name finds (`Note%20\(1\).md`, an entity,
`%4eame`). A note under its budget has no such part, and one in which no
link-shaped target anywhere leads to the renamed note has none that does: for
these the scan is all (no parse). In the others, and in the notes the rename
rewrites, it counts every link-shaped target in a part not read
(`linkShapedTargets`: a wiki link or an embed, a destination behind `](` or a
definition's `[label]:`, across the markers of a line's start), each read as
the index reads a link's target — the destination as the parser reads it, its
escapes, entities and angle brackets, by a parse of the destination alone,
then `markdownLinkTarget` — and asked of the rename's own resolver, the one
that chose the links it rewrites (`unreadLinksTo`); it writes nothing there.
The name in prose counts nothing. `renameOracle.test.ts` draws link forms at
random from the name, keeps those the index of a small note resolves to the
old note, and writes each into a part read, not read, across two quote lines
and open, with and without a link read beside it: each is rewritten or
reported. No new index format: the cost is the reading of the large notes.

Both shells read alike but by their own budget (the desktop four times the
phone's): a unit heavy enough to be not read on the phone may be read on the
desktop. That is the parity catalog's decision `note-read-formatted-up-to`.
