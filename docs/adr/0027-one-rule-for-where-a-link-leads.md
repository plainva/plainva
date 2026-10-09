# ADR 0027: One rule for where a wiki link leads; a note's `title` is its last name

Status: Accepted

Date: 2026-10-09

## Context

`[[Brief]]` is the most common thing a vault contains besides text, and until
this decision Plainva answered "which file is that?" in more than a dozen
places by rules that had grown apart:

- The **desktop** asked the index for a note whose `title` column or whole
  path equalled the target — the same SQL written out five times (the editor,
  the reading view, the heading completion, the note embed, the query
  service), `COLLATE NOCASE`, `LIMIT 1` without an order. The `title` column
  holds the `title` of a note's properties where it has one and the file's
  name otherwise.
- The **phone** probed paths from the note and from the vault's root and then
  walked the directory listing for the first note of that **file name**.
- The **graph, the backlinks, the relations, the cascade and the clean-up**
  used `resolveLinkTarget`: the exact path, then the end of a path, the note
  in the linking note's folder first, then the shortest path — comparing
  letter case exactly.
- The dashed "not created yet" drawing, the "broken" chips of a database, the
  sub-items of a table, the dependencies of a timeline and the relation
  pickers each kept a set of lowercased titles and paths of their own.

Tests over a real index showed what that meant (finding 2026-10-08, the cases
are `packages/core/test/helpers/linkCases.ts`):

- A note `Projekte/Brief.md` whose properties say `title: Angebotsbrief` was a
  dead link under `[[Brief]]` on the desktop — drawn as "not created yet", and
  a click created a second `Brief.md` — while the phone opened it and the
  graph drew the edge. `[[Angebotsbrief]]` did the reverse. Obsidian vaults
  whose notes carry a `title` (common where a site generator reads them) were
  full of such links.
- `[[Hafenkante/Brief]]` for `Projekte/Hafenkante/Brief.md` was an edge in the
  graph and nothing in either editor.
- Of two notes with one name the desktop opened whichever row SQLite handed
  out, the phone the first of the directory listing, the graph the one beside
  the linking note.
- `[[übersicht]]` did not find `Übersicht.md` on the desktop (SQLite's
  `NOCASE` folds A to Z only), did on the phone, and was a broken link in the
  graph, which compared case exactly.

The app also *wrote* links the rules disagreed about: the `[[` completion, the
`@` mention and two relation pickers wrote a note's title, while the graph's
"link this mention", the task promotion and the reverse columns wrote the
file's name.

## Decision

1. **One rule, in the core.** `resolveLinkTargetIndexed`
   (`packages/core/src/vault/LinkResolver.ts`) is the answer for every surface
   in both shells. A target is tried in this order:

   1. An explicit path: `/Folder/Note` from the vault's root, `./Note` and
      `../Folder/Note` from the folder of the linking note. Nothing else is
      tried for such a target.
   2. The vault path as written — a file spelled exactly so —, then the note
      at that path (`.md`).
   3. The end of a note's path — the file's name alone, or with folders in
      front of it — as Obsidian finds a note anywhere in a vault.
   4. A file that is no note (`plan.pdf`, `Tasks.base`, `LICENSE`): at the
      vault path in another spelling, then by the end of its path. After the
      notes, so a target without an extension names a note wherever one
      answers: `[[Tasks]]` never becomes `Tasks.base`, and `[[License]]` is
      the note `License.md` although a file `LICENSE` lies beside it.
   5. The `title` of a note's properties.

   Names are compared without regard to letter case, and a composed and a
   decomposed spelling of a letter are one name (ADR 0016 made the stored path
   NFC; a typed link need not be). Where several files answer: the spelling as
   written first, then the path read from the linking note's folder — for a
   bare name, the note beside it —, then the shortest path, then the alphabet.
   The last step makes the answer independent of the order a database or a
   directory listing returns its rows in, so it is the same on every device.

2. **A note's `title` is a link target, and the last one tried.** The desktop
   followed titles from the start and Plainva's own completion wrote them, so
   vaults contain such links and they must keep leading where they led. It
   comes after the file's name because the name is what Obsidian resolves and
   what every other writer in the app writes: a file that is *called* like the
   target always comes before a note that is merely *titled* so.

3. **One corpus.** `VaultQueryService.linkTargets()` — path, title and mode of
   every file that is not queued for deletion — is the one answer to "which
   files are there". A surface that means notes only (a rollup, a reverse
   column, the cascade, the clean-up of a relation) resolves over the whole
   corpus and looks at what was found afterwards (`noteLinkResolver`); a
   corpus of notes alone would make the same link lead somewhere else there
   than in the editor.

4. **What the app writes leads back.** A pick from a list writes what the
   other writers write: the file's name where it is the only one of that name,
   otherwise the path (`wikiTargetForPath`), and keeps a title that reads
   differently as the link's text — `[[Brief|Angebotsbrief]]`
   (`wikiLinkTextFor`). Such a link resolves in Obsidian too; a link by title
   never did.

5. **A rename does not rewrite a link that names the note by its title.** The
   title stays when the file's name changes, so the link keeps leading there.

6. **A Markdown link stays a path.** `[text](Folder/Note.md)` is read from the
   linking note's folder as before; the rule above is for wiki links, embeds
   and relation values. On the phone `resolveWikiTarget` tells the two apart
   by how the link was written (`kind`), no longer by the shape of the target,
   and a Markdown link whose path leads nowhere leads nowhere: the rule's "a
   file anywhere that ends so" is a wiki link's reading and is not lent to it.

7. **Whoever asks about many links, or about one link while typing, does not
   read the vault per question.** The lookup keeps each file's path in both
   readings (`LinkIndexEntry`), so a link onto one of a thousand `index.md`
   files folds no path again. `resolveNotePath` shares one read among the
   callers of one turn and starts it only after they have all asked — a
   caller that asks once a read has begun gets a read of its own, so an
   answer is never older than its question and a note the indexer has just
   taken in is not answered with "no such note". Nothing is cached beyond
   that: a stale "no such note" is how a click creates a second note.

## Consequences

- A click, the dashed drawing, an embed, the graph, the backlinks and a
  database give one answer. `apps/desktop/src/lib/wikiLinkOneRule.test.ts`
  fails any shipped file that compares a link with the `title` column in SQL
  again.
- Links that were "broken" in the graph only because of letter case or
  because they named a title are edges now; the clean-up list gets shorter.
- A note at the vault's root whose path equals the target as written wins over
  a note of the same name beside the linking note. That is step 2 before step
  3, it is how the graph already resolved, and it is what Obsidian does.
- An embed shows the note the link opens; "matches more than one note" no
  longer appears for a note (it still does for a heading that occurs twice).
- A click reads the list of indexed files (path, title, mode) instead of one
  indexed row. That is one query and a few milliseconds per click; surfaces
  that resolve many links build the lookup once. The backlinks keep their SQL
  pre-filter. It is anchored at the END of a link's target — a link leads to
  a file by naming it there, or by being the note's title as a whole — and
  spells the name every way the rule reads as one (`likeAnySpelling`): a
  letter beyond ASCII that has a second case is one character of any kind, so
  a name written entirely in such letters still asks for its own length
  instead of for every link row.
- The phone no longer walks the directory for every tap. It falls back to the
  files on disk — by the same rule — only where the index finds nothing, so a
  note the index has not seen yet is opened instead of created twice.
- A picture or a sound embedded by its bare file name (`![[foto.png]]`) is
  found by the rule in both shells (`findByFileName`); the desktop's own query
  for it folded A to Z only and left ties to the database's order.
- What has to know WHICH note a stored link means asks the rule over the
  whole vault and then looks whether that note is one of its own: the
  sub-items of a table, the dependencies of a timeline, "linked already" in a
  relation editor, the conversion of a listing's wiki links.
- The clean-up's "create note" puts the note where a click on the broken link
  would (`createBrokenLinkTarget`), so the link is no longer broken afterwards
  when its target names a folder.
- A rename changes only the name at the end of an explicit path
  (`[x](./Brief.md)` becomes `[x](./Letter.md)`); such links are found since
  the rule reads them.

## Alternatives

- **Drop the title (pure Obsidian).** Rejected: it breaks links the desktop
  has followed since the first release and that the app itself wrote.
- **Title before file name.** Rejected: a note titled like another note's file
  name would capture that note's links, and Obsidian would disagree with
  Plainva about every such vault.
- **Keep the lookup in SQL.** Rejected: SQLite cannot fold case beyond ASCII
  or compare normalization forms without an extension, so a SQL rule and a
  JavaScript rule would keep disagreeing on exactly the names that brought
  ADR 0016 about.
- **Report an ambiguous name instead of picking one** (as the embed did).
  Rejected for links: a link has to lead somewhere, the graph has to draw one
  edge, and a deterministic order is something a person can learn — "the note
  beside this one, then the shortest path".

## Links

- Finding: workspace open-items plan § 3.51 (2026-10-08); plan
  `Gesamtplan_Wiki_Link_Aufloesung_2026-10-09`.
- ADR 0016 (path identity is NFC).
- Numbers 0017 to 0026 are taken by the AI-harness branch and arrive on
  `main` with it; this ADR took the next free one.
