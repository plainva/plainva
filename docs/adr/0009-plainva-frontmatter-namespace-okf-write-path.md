# ADR 0009: Plainva frontmatter namespace & OKF write path

Status: Accepted

Date: 2026-07-03

> Verification note: The Obsidian visual check (nested `plainva` key in the
> properties panel, generated/adopted `index.md`, converted files) remains a
> maintainer task (M5 checklist). Before the first real use, the conversion
> should be run once against a copy of the real validation vault.

## Context

Three maintainer requirements (2026-07-03, OKF/icons/header master plan —
internal planning document, maintainer workspace):

1. Per document an optional icon (Notion-like) and a color strip across the
   full width of the document window — persisted in frontmatter.
2. The OKF write path (master plan §9.2, owner decision §18.7): every file
   newly created by Plainva carries at least `type` + `okf_version`.
3. Opt-in conversion of existing vaults including `index.md` support.

The full OKF SPEC text (v0.1 draft, reviewed 2026-07-03) clarifies: `type`
is the only required field per concept; `okf_version` is a **bundle** field
in the root `index.md` (the only allowed index.md frontmatter); reserved
names (`index.md`, `log.md`) must not be concept documents on any level;
unknown keys must be tolerated and preserved on round-trip; presentation
metadata is not defined by the spec.

Maintainer product guideline: **Plainva-first** — Obsidian must still be
able to open the files; that Obsidian's properties UI cannot edit a feature
is accepted.

## Decision

1. **Frontmatter layout:** OKF fields top-level (exact spec names),
   everything Plainva-specific nested under exactly one namespace key:

   ```yaml
   type: Note
   okf_version: "0.1"
   plainva:
     icon: "🚀"              # emoji/grapheme OR icon-set reference "lucide:<name>"
     icon_color: "#c94f4f"   # optional tint for icon-set icons (emojis ignore it)
     header_color: "#2f6f6f"
   ```

   *Addendum 2026-07-03 (maintainer feedback):* In addition to the emoji
   there is a Notion-like icon-set mode. Icon-set icons are persisted as
   `lucide:<kebab-name>` (curated registry from the already-used Lucide set,
   data via the `lucide` package, offline); their color lives in
   `plainva.icon_color` (same hex validation as `header_color`). Unknown
   `lucide:` names are rendered nowhere but break nothing.

   - `type` top-level (spec-required field). `okf_version` top-level per
     file as a Plainva convention beyond the spec (the spec only knows the
     bundle level); when Plainva creates a root `index.md`, it additionally
     carries the spec-conformant bundle `okf_version`.
   - Namespace keys snake_case (`icon`, `header_color`); values: icon = any
     grapheme (emoji), color = hex (`#rgb`/`#rrggbb`/`#rrggbbaa`). Invalid
     values are ignored on read, never treated as errors.
   - Both optional; without them Plainva writes no `plainva` key. A
     namespace that becomes empty is removed when its last sub-key is
     deleted.

2. **Surgical write path:** Bulk and namespace edits go through
   `frontmatter-surgical.ts` (yaml `parseDocument`): only the addressed keys
   are touched; untouched keys/comments/ordering and the body remain
   byte-identical. Unparsable or non-map frontmatter counts as an anomaly →
   the file is skipped and reported, never "repaired".

3. **Write rule for new files:** All creation paths (file tree, daily notes)
   produce content via `ensureOkfFrontmatter` — template frontmatter wins,
   only missing fields are added. Default `type` configurable per vault
   (notes "Note", daily notes "Daily Note").

4. **Conformance criterion (settings visibility):** exactly the hard SPEC §9
   rules — parsable frontmatter, non-empty string `type`, reserved names not
   used as concepts. A missing `okf_version` alone is NOT a violation
   (otherwise permanent nagging when used in parallel with Obsidian). The
   settings entry hangs off the live-computed violation counter (no
   persisted flag) and therefore reappears automatically when new
   non-conformant files show up; the vault-open offer is one-time (decline
   persisted per vault).

5. **Conversion:** Opt-in wizard with dry run; per changed file a backup to
   `.plainva/backups/okf-conversion-<ts>/`; valid existing `type` values are
   kept (they are already valid OKF types), renaming to `<name>` (default
   `type_original`) only as an explicit user choice; non-string `type` is
   always renamed. Exclusions: dot folders, `.trash`, the configured
   template folder.

6. **index.md:** Generation and adoption are always user-driven. Plainva
   suggests candidates (ranking): folder note (file named like its folder) >
   exact names (`MOC`, `Map of Content(s)`, `Index`, `Übersicht`/
   `Überblick`/`Overview`, `Home`, `Start`, `README`) > word-boundary
   matches (`… MOC …`, `… Übersicht …`). Adoption = rename via the
   vault-wide link update (retargeting path-qualified, because `index`
   becomes ambiguous) plus optional preparation (remove frontmatter with
   backup, wiki links of ONLY this file → relative Markdown links;
   embeds/unresolvables stay and are reported). Generated listings are
   spec-shaped (sections with `* [Titel](url) - description`, relative
   links, deterministic sorting); only the root `index.md` carries
   `okf_version`. No automatic background upkeep; refresh only on user
   action, with backup. `log.md` stays out of scope (OKF export/mode C,
   later).

## Consequences

- Obsidian shows the `plainva` key as a non-editable object — deliberately
  accepted (Plainva-first); files remain fully readable/usable in Obsidian.
- The read schema tolerates foreign `okf_version` values (spec versioning
  minor/major); strict validation happens only on write.
- `PropertiesSection` hides the namespace from the generic list; it is
  maintained through the dedicated UI surfaces (icon/color pickers).
- The pulled-forward rename-with-link-update (alpha roadmap) is now
  available to all file-tree renames (files only; folder rename remains
  without link update, a later expansion stage).
- Deferred: automatically adding missing entries to adopted index.md
  (duplicate risk in curated MOCs; the generator covers completeness),
  icon/strip editing in read mode (read stays non-editing), `log.md`.

## Addendum 2026-07-04 (UI/UX package master plan)

1. **Managed marker for generated index.md:** The generator appends the HTML
   comment `<!-- plainva:index generated -->` as the last line. Deliberately
   NOT a frontmatter marker: frontmatter in a non-root index.md is a
   reserved-name violation (point 6), and the comment is invisible in
   Obsidian's reading view. The marker is the permission for automatic
   upkeep; removing it is the supported opt-out.
2. **Automatic upkeep (replaces "no automatic background upkeep"):** File
   operations (create/rename/move/delete, also from `.base` new, the
   relation picker, daily notes, the image editor) report themselves after
   their reindex via the window event `plainva-file-ops`; a debounced
   updater regenerates the index.md of the affected folders — ONLY if it
   exists AND carries the marker, only while the root index.md carries
   `okf_version` (OKF active), without backup copies and without ever
   creating an index.md unasked. Loop-free by construction: index.md writes
   are reserved-name paths and never queue again. Additionally there is
   "Update all index.md files" (vault-root context menu + settings).
3. **Write protection:** Marker-carrying index.md files open read-only
   (reading view only) with a banner, a "Refresh" button and "Edit anyway" —
   the latter removes the marker and hands the file over to manual care.
   Managed listings render as a themed card grid in the reading view.
4. **OKF system fields in the properties panel:** `type` and `okf_version`
   are locked in name/field type/delete (lock indicator); the `type` value
   stays editable (dropdown of configured defaults + values used in the
   vault), `okf_version` is display-only.
5. **Explanation for users:** A "What is OKF?" modal (once per vault after
   opening/creating, settings button, with violations carrying a conversion
   CTA) replaces the earlier native conversion prompt.
6. **Considered and rejected (maintainer, 2026-07-04):** splitting index.md
   into a user part (top) + automatically maintained block (bottom). Without
   frontmatter that would have been OKF-defensible (soft-guidance gray
   area), but the desired icon/color-strip part would not (index.md is
   frontmatter-free per spec; only the root may carry exactly
   `okf_version`). The model from point 3 stands; personal overviews go
   through the marker opt-out or adopted files.

## Addendum 2026-08-21 (OKF 0.2)

1. **Spec level:** Plainva now targets OKF **0.2** (spec commits `780fe9d3`
   and `3fcbb9f8`, published 2026-07-25 in
   `GoogleCloudPlatform/knowledge-catalog`, `okf/SPEC.md`, Apache-2.0). The
   bump is additive — `type` stays the only required field, and a consumer
   must accept fields it does not know. Plainva already met the v0.2 consumer
   obligations (permissive reading, unknown keys round-tripped); what changed
   is its own declaration and what it writes.
2. **Per-note `okf_version` retired.** The per-note key was a Plainva
   convention beyond the spec (v0.1 allows it only in the bundle-root
   `index.md`); the code wrote it and never read it, and the phone wrote a
   hard-coded `"1.0"` — a version that never existed — in four places. No
   write path emits it any more, on either shell. Existing values are
   tolerated: the properties panel keeps `okf_version` a locked,
   display-only system field where it still exists (this amends point 4 of
   the 2026-07-04 addendum), and the bundle upgrade strips it as an opt-in
   checkbox, checked by default.
3. **The bundle version lives in the root `index.md`** (`okf_version: "0.2"`)
   and is lifted by an explicit migration on both shells (`okf-migration.ts`
   through `runOkfTransform`, the generalised conversion run: backup per
   file, undo from the backup folder, dry-run numbers first). The index
   generator keeps the version an existing root declares; lifting it is the
   migration's job, never a side effect of regenerating a listing.
4. **Trust signals are shown, not enforced.** A lifecycle badge for
   `status: draft`/`deprecated` only (`stable` stays silent), a stale banner
   once `stale_after` has passed (display only — no archiving, no write), and
   a trust section in the properties panel / mobile context sheet with a
   derived level (unverified, machine-confirmed, reviewed by a person).
   Shape check before claiming: a `status` value outside the three spec
   words — a task database's `status: Open` — is a user property, never a
   lifecycle state.
5. **Stamping rules (fixed, not configurable).** `generated { by, at }`
   (plus `sources` where the origin is trivially known) is written only by
   the machine write paths: the importer (`plainva-import/<v>`, one instant
   per run, the report too), mail capture (`plainva-mail-capture/<v>`,
   `mid:<Message-ID>` as the source — an IMAP UID or Graph id is local to
   one client and is not a source), and the task sync
   (`plainva-task-sync/<v>`, on creation only; a later remote edit keeps the
   birth stamp). The editor never writes a trust family, and existing notes
   are never stamped after the fact. Actors follow the spec convention
   `human:<name>` / `<producer>/<version>`; the version comes from
   `PlatformServices.appVersion` with a `dev` fallback, so a shell without
   one still names the process.
6. **Mark as reviewed.** The one trust action a person has appends
   `human:<name>` with the current instant to `verified` — the list is the
   review history, a second reviewer never overwrites the first. The name is
   asked for once per vault and kept device-local (desktop settings store
   `verifierName_<vault>`, mobile per-vault scope), deliberately outside the
   profile catalogue: the reviewer is the person at this keyboard.
7. **`log.md` is not built here.** The maintainer questioned the ADR's
   `log.md` line; the entry is assigned to the AI-harness plan as an opt-in
   routine. Today there would be no reader (the version history is the
   better tool in Plainva), mechanical per-save entries would miss the
   spec's prose intent, and a per-save log would be the most conflict-prone
   file in a synced vault.

## Addendum 2026-10-09 (one definition of the properties block)

Finding 2026-10-07: the writers left a block that had lost its last entry
behind as `---` directly on `---`, and no reader in the code took that form
for a block. The next write put a second block on top and the two old fences
stood in the note as rules; with a rule further down in the text, everything
up to it was read as YAML.

1. **One definition.** What a properties block is — it opens on the note's
   first line, which is `---`, and closes on the next line that is `---` — is
   decided in one place: `frontmatterSpan` in
   `packages/core/src/frontmatter-block.ts`. Some thirty places had carried a
   pattern or a search of their own. The definition follows the Markdown
   parser that fills the index and the properties panel
   (`remark-frontmatter`), including what that parser tolerates: blanks
   behind a fence, and a byte order mark in front of the first one. A test
   holds the two together (`frontmatter-block.test.ts`), and
   `frontmatterDefinition.test.ts` fails a file that spells the block out for
   itself again.
2. **The empty block is a block.** `---` directly on `---` is a properties
   block without entries. The Markdown parser reads it that way, the editor
   hides and protects it that way, and Obsidian reads it that way. A closing
   fence is never looked for behind one that already stands there: a rule
   further down belongs to the text.
3. **Writers leave no empty block behind.** This extends the rule for the
   namespace in point 1 of the decision: a block that loses its last entry is
   removed, fences included, and the text stays byte for byte. A property set
   and removed again leaves the note as it was — an icon on a note without
   properties used to leave two fences behind for good. Obsidian's property
   editor removes an emptied section as well (since 1.4.10). Three limits:
   - Where the text itself opens with a `---` line, the empty pair of fences
     stays. Without it that line would open a block at the top of the file,
     and the text below it would turn into properties.
   - An empty block a note already carries is not tidied away in passing: a
     write that has nothing to write returns the note untouched. Existing
     vaults are not reformatted. And no block is created for no entry.
   - A byte order mark stays the first character of the file.
4. **Only a YAML map is rewritten — in both write paths.** Point 2 of the
   decision ("unparsable or non-map frontmatter … is skipped and reported,
   never repaired") held for the surgical helpers only.
   `updateFrontmatterString` (the properties panel, a database cell) silently
   re-serialised a block that was no map — two rules with text between them at
   the top of a note came back with their lines folded — and dropped the
   property it was asked to write. It now throws `FrontmatterSurgicalError`
   like the surgical helpers; both share one split and one join.
5. **The sanitizer for published slices uses the definition, too.** Its own
   search missed a block closed at the very end of the file, closed by a
   fence with another line ending than the first line, or standing behind a
   byte order mark; such a note left the vault with every property it had.
6. **The editor reads the same rule on its lines.** The editor holds lines,
   not a string, and must not turn the document into one on every
   transaction, so it cannot ask `frontmatterSpan`. It has one reader of its
   own, `frontmatterLines` in
   `packages/ui/src/components/editorFrontmatter.ts`: hiding and protecting
   the block, the decorations, the block model, the live header, the
   spell-check exemptions and the tag pills all ask it, and
   `editorFrontmatter.test.ts` holds it against the definition on the table
   of forms the definition is held against the parser with. (The first
   version of this addendum left the editor's five line scans outside. They
   took the empty block for a block, but wanted a line that is exactly
   `---`: a fence with blanks behind it was a block for the index and the
   properties panel and text in the editor — a rule and a heading, open to
   typing.)
   - **A byte order mark.** An editor holds a note without its mark: the
     mark is part of the file's shape, taken off when the file is opened and
     put back when it is saved (`openEditorText`, since 2026-10-09). So an
     editor's document does not normally start with one. Where one does —
     text that was pasted or set from elsewhere —, the editor still answers
     like the definition: the block behind the mark is the block, and the
     mark counts to its range, hidden with it in live mode and protected
     with it against typing. The editor has no second opinion on where a
     block is.
   - **Line breaks.** The editor's lines are what it split the text at —
     `\n`, `\r\n`, and a carriage return of its own —, and those are the
     three the definition ends a line at (point 10). Of one and the same text
     the two read the same lines, so the editor's answer is the definition's
     for the text it holds. That text has `\n` between its lines; the file's
     own line ends are part of its shape and are put back around it when it
     is saved (`openEditorText`, since 2026-10-09). The file has the same
     lines as that text — but for `\r\r\n`, which an editor has always held
     as one line break where the file has two.
   - **Cost.** The answer is kept per document: a transaction that changes
     nothing asks for free, and an edit costs one pass that ends at the
     closing fence. Only a note that opens with `---` and never closes is
     read to its end, once per edit — about 0.2 ms at 10 000 lines and 2 to
     3 ms at 100 000. The scans it replaces took 0.6 to 0.9 ms and 10 to
     12 ms each on the same notes, four of them per keystroke in live mode.
     The live header no longer gives up after 300 lines: it shares that
     pass and reads the YAML again only when an edit touches the block. A
     longer block had its icon, stripe and badge in the read view and none
     in the live editor.
7. **Deliberately outside the definition:** the readers that only decide what
   a card or a paragraph's direction shows (`noteCardModel.ts`, the card
   search in `VaultQueryService.ts`, `textDirection.ts`). They also hide a
   block closed by the YAML document end `...`, which is no properties
   block. `frontmatterDefinition.test.ts` names them as its exemptions.
8. **"Could not be read" is not "has none".** The writers that go through
   `updateFrontmatterString` work on the whole set: read the note's
   properties, change one, hand all of them back; what the new set no longer
   names is removed. They took their set from the reader of the index and the
   panel, and that reader answers "failed" for more than YAML it cannot
   parse: its schema also rejects a proper YAML map with a value it does not
   take — an empty `tags:`, a year among the tags, a number as `title`, a
   `resource` that is no URL. The writers read "failed" as an empty set, and
   setting one property through a database cell or the properties panel
   removed every other property of such a note. Every whole-set write now
   starts from `writableProperties` (`packages/ui/src/base/writeProperty.ts`),
   which refuses these notes like a block that is no map; the refusal names
   the property the reader stumbled over. Two things are left as they were
   and are known: the reader's schema is stricter than the notes people
   write, so such a note also shows no properties in the panel and in a
   database; and a whole-set write still re-serialises values it does not
   change (a comma-separated `tags` comes back as a list, a flow list as a
   block list without its trailing comment). Both end where the property
   writers set one key surgically, like `setFrontmatterPath` does.
   (Both have ended: the second with the addendum of 2026-10-13 — the
   whole-set writer writes the difference —, the first with the addendum of
   2026-10-22 — the reader takes every value, and this refusal is gone.)
9. **A refused write is said, and nothing is shown that the note does not
   hold.** A database cell and the properties panel of the desktop showed the
   new value first and wrote afterwards; a refusal went to the console and
   the value stayed. Now the value shown goes back to the note's and one
   sentence says why, the same one in both shells; a loop over many notes
   reports one count of the notes it wrote and the notes it could not. The
   reason is put in the user's language where the error is shown
   (`errorText`), without the YAML parser's own text: that quotes the line it
   failed on, and an error message is copied into the diagnostics trail. One
   writer stays quiet on purpose — the reconcile that lets an entry follow
   its appointment runs after every calendar cycle and tries again on the
   next. `silentPropertyWrites.test.ts` lists every call of
   `writeNoteProperty` and of what it is built on, in both shells, with how
   its failure reaches the user. The callers of the surgical helpers (a
   note's icon and colour, a column renamed or removed across its notes, the
   task and pinboard write paths) were not covered by it then; point 11 is
   about them.
10. **A carriage return of its own ends a line** (added 2026-10-11). The
    definition knew `\n` and `\r\n`. The Markdown parser it follows also ends
    a line at a `\r` alone: the line end of a file from a classic Mac, a
    stray one among others, or the first of the two in `\r\r\n` — what a file
    from Windows has when its line ends were converted twice. Such a note had
    a block for the index and the properties panel and none for the writers,
    which put a second one on top of it, and the sanitizer for published
    slices let it leave with every property it had. The definition reads all
    three now; the table of forms and a run over 20 000 generated notes hold
    it against the parser in each.
    - **What the block says.** YAML ends a line at a `\r` alone as well; the
      YAML library does not (measured: two entries are a syntax error for
      it, a list below a key is one string, a comment swallows the line
      behind it, and in a `\r\r\n` file every value ends in a carriage
      return, a number being a string). So a block's YAML reaches the
      library with `\n` in that place (`yamlLinesOf`), from both of its
      readers: the definition (`FrontmatterSpan.yaml`, which stays as long as
      the stretch of the note it stands for) and the index's reader of the
      parser's node (`extractFrontmatter`). The two have to read alike. The
      panel and a database cell start from what the index's reader hands
      them (point 8): where only the definition could read a block, they
      would show no property of a note the other writers edit, and refuse
      every write to it.
    - **What the writers write.** The block in the note's line end, which
      comes from the one definition of it (`readTextShape`) and is `\n` or
      `\r\n`. No writer sets a `\r` alone. In a note from a classic Mac the
      block is written with `\n`, in a `\r\r\n` note with `\r\n`, and the
      text keeps its line ends, byte for byte.
    - **What becomes of the rest of such a file** was left open here and is
      decided in ADR 0003 (addendum 2026-10-09, paragraph of 2026-10-22): a
      `\r` alone is read as a line end everywhere, and the first write
      through the chain that changes the file leaves all of it with the line
      end its shape has, said to the user once. A property set by the
      writers of this point is such a write: the writer changes its entry and
      leaves every other line as it was, and the top of the chain turns the
      rest.
11. **The callers of the surgical helpers say it too, and a rename across
    notes asks first** (added 2026-10-21). Point 9 covered `writeNoteProperty`
    and what it is built on. `setFrontmatterPath` and its siblings have more
    callers, and those failed in three ways: into the console (a note's icon
    and colour, a property renamed or removed across the notes of a
    database), as an unhandled rejection (a reverse relation edited in its
    cell), or with the bare message on screen — the parser's quote of the
    note's line once more (the pinboard's colour and labels, the phone's task
    list, a relation written from the graph). All of them use the sentence of
    point 9 now, and a loop its count. `silentPropertyWrites.test.ts` lists
    every call of the four helpers, and of every function that hands their
    failure on, by the stretch of code it stands in — down to where the
    failure is said, counted, or left quiet for a written reason (a new note
    the app builds itself, the provider sync, a tick redeemed from the
    home-screen widget).
    - **A rename asks first; a removal does not.** A property is renamed in
      the database before its notes, and it has to be: the notes are written
      one after the other. A note that cannot follow — its block is no YAML
      map, or it already carries a property of the new name — was left with
      the old key under a column that no longer existed; where it carried the
      new name already, the column went on to show that other value for it. A
      rename is a move, and half a move is a state nobody asked for. So every
      note is asked first, with the function that will rename it
      (`renamePropertyAcrossNotes`), and where one refuses nothing starts: not
      the question, not the database, not a note. The message names the
      notes. A note that cannot be READ at that moment does not refuse — it
      is gone or held by something else, which correcting the note does not
      settle — and the run counts it if it still cannot be read then; so does
      it count a write that fails, which no check can rule out. Removing a
      property is not asked first: what stays behind in a note that could not
      be written is a key the database no longer shows — the state asked for,
      less tidy — and refusing to drop a column over it would help nobody.
    - **Which notes, and what waits for the database.** A rename and a
      removal go through the notes of the database's sources that carry the
      property, as the index lists them (`notesCarryingProperty`, both
      shells) — not the rows of the view on screen, whose filters may hide
      notes that would be left behind, and not a note that holds no such
      property, which would stop a rename it has nothing to do with. A
      computed column (the links back of a relation, a rollup) goes through
      no note, and a note that carries the property in another casing is
      changed in its own spelling, as a single write is. What
      follows the database's own save — its notes, the other database of a
      relation — waits for that save to land; a save that does not land puts
      the view back on the database it showed, and a change that other files
      follow is not kept for a database file that has moved.
    - **Point 8 again, for relations.** `addRelationLink` and the relation
      cleanup behind a deletion took the links a note holds from the index's
      reader and then set the whole list. For a note that reader does not take
      (the empty `tags:` of point 8) the list read as empty: ONE added link
      replaced the links the note carried (measured), and a link to a deleted
      note stayed without a word. They read the list from the note now, with
      the reader of the writer that sets it (`readFrontmatterPath`) — as the
      graph's relation writers have done since a change of a note goes
      through the chain's one entry (ADR 0031).

## Addendum 2026-10-09 (the write rule for new files, on the phone too)

Finding 2026-10-09: point 3 of the decision — every creation path produces
its content via `ensureOkfFrontmatter`, template frontmatter wins, only
missing fields are added — did not hold on the phone. Three places there set
the header as a string of their own (`---`, `type`, `---` and a blank line):
the plain new note, and two that took a template's text and set the header
only where that text carried no properties block.

1. **One writer, both shells.** The header of a new note comes from
   `withOkfDefaults` in `packages/ui/src/lib/newNoteContent.ts`: directly,
   through `buildNewNoteContent` (a note without a template) or through
   `templateAsNewNote` (a template the engine has resolved). `type` goes into
   the block the content carries — also the empty one, `---` directly on
   `---` — and a block is put in front only where there is none. On the phone
   a template whose block named no `type` made a note without one.
   `frontmatterDefinition.test.ts` fails a shipped file that sets the header
   as a string again.
2. **Nothing stands between the header and the text.** The phone's strings
   set a blank line behind the header, and for a template dropped the blank
   lines it opened with; the shared writer sets none and hands the text on
   byte for byte, line endings included. The shared writer's form is the one
   for both shells. It is what every other new note had on both shells all
   along — the daily note, the meeting note, a pinboard entry, a captured
   mail — and what the property writers produce when a note gets its first
   property (`composeNote`); the phone's three strings were the only places
   that wrote something else, so the phone itself made two kinds of new
   notes. This concerns new notes only: a note that carries a blank line
   behind its block keeps it, because no writer touches the text.
3. **Where a template's `{{cursor}}` stands in the note is one rule, too:**
   `templateCaretInNote` in `packages/ui/src/lib/templateCaret.ts`. A caret in
   the text keeps its distance from where the template's text starts in the
   note. A caret the template puts in front of its text — into its properties
   block — goes to the start of the text: the block may have been written
   anew, and the live editor hides it and takes no caret in it. Every builder
   had counted the offset on by what the note had grown, which is the same
   for a caret in the text and pointed a caret from the block at wherever
   that sum fell.
4. **That rule counts in the file; the editor is handed a place in its own
   text.** A note keeps the line endings and the byte order mark of its
   template (point 2), and an editor holds a note with `\n` and without the
   mark (ADR 0003, addendum 2026-10-09). The builders therefore answer with a
   place in the file as it was written, and can be asked on from one rewrite
   of the block to the next. The place is converted once, where it is parked
   for the editor: `parkTemplateCaret(path, note, caret)` in
   `packages/ui/src/lib/templateCaret.ts` is the only way into that store on
   both shells, and it takes the note the place was counted in. The desktop's
   pinboard entry window, which reads its caret from the draft instead, asks
   the same conversion (`pinboardEntryCaret`). Before, the file's number went
   to the editor as it was: for a template written on Windows the caret stood
   one character too far right for every line above it, and one more behind
   a mark.

## Addendum 2026-10-13 (a property is changed where it stands)

Finding 2026-10-11: point 2 of the decision calls the surgical write path
"byte-identical" for untouched keys. It was not. Every writer of a property —
the surgical helpers and `updateFrontmatterString` alike — ended in one
function that printed the document the YAML library had read
(`doc.toString()`): the WHOLE block, in the library's form and from the values
as it had read them. Setting, removing or renaming one property turned
`plz: 01067` into `1067`, took the plus off `phone: +4915112345678` and the
last digits off `id: 12345678901234567890`, wrote `.5` as `0.5`, `1e3` as
`1e+3` and `0x1F` as `0x1f`, folded a long line at 80 characters (a quoted
address got a backslash at the line end, inside the value), padded `[a, b]`
to `[ a, b ]`, indented a list and made one blank line of several. It also
ran over notes nobody had opened: a tag renamed vault-wide, a column removed
from a database, the OKF conversion.

1. **The block stays text.** A block that is there is changed entry by entry,
   as text (`packages/core/src/frontmatter-entry.ts`). The library reads it
   and says where a key and a value stand (its source tokens); what is
   written is a list of changes to the text:
   - a value is replaced by replacing its characters — a scalar in the quotes
     it has, the comment behind it left alone;
   - a new key is a new line behind the last entry of its map, indented as
     the others are, in front of whatever comment ends the block;
   - an entry is removed by removing its lines;
   - a key is renamed by replacing the characters of the key;
   - a list changes item by item: the items that stay keep their characters,
     one that goes takes its line, a new one gets a line in the list's own
     form — at the list's indentation, or between its brackets where it is
     written in brackets; an item that only moves keeps its characters too
     (a value the list already holds is written the way it stands there),
     however long the list is; a map changes entry by entry in the same way,
     also a map in braces and a block that is one such map.

   Written anew — from the value, in the library's form — is only an entry
   whose value changes its SHAPE (a text that becomes a list, a list that
   becomes empty), and of it only what stands behind its colon. The library
   writes nothing else of a note: `written()` in that module is the one place
   it prints, and it is handed a value, never a document that was read.
2. **Nothing is taken on trust.** Before a note is handed back, its block is
   read again and has to say exactly what the change was meant to make it
   say, with the text behind it untouched. Where a change cannot be made in
   its place, the entry is written anew (in the order given below); where
   that does not give the expected block either, the note is refused
   (`FrontmatterSurgicalError`) and stays as it is. That is what happens to a
   value another entry refers to (`a: &x 1`, `b: *x`): changed or removed, it
   would change `b` as well. The refusal begins like the refusal of a block
   that is no map, so the user is told what point 9 of the addendum of
   2026-10-09 tells them: correct the block in the note's text.

   The measure a write is read back against is the value as it was handed. A
   text, a number and a boolean are themselves — not what the library reads
   back from what it writes for them: measured that way, at the root of a
   document, a text of several lines that begins with a blank came back
   changed, and the changed text was written (found by the review before this
   landed). Where the library's own form cannot say a text at the place it
   has to stand — one that ends in empty lines, as the last entry of the block
   or in front of an empty line; one of two lines between brackets — that
   text is written between double quotes, on one line, and what stands beside
   it keeps its characters. The order is: the value where it stands, with
   what is new in the library's own form; the same with what is new between
   double quotes; the entry at the end of the path written anew behind its
   colon, both ways; and only then the entry at the top of the path, both
   ways. A block that cannot say what it holds, because a
   reference in it leads nowhere (`title: *Draft*` is a reference for YAML,
   not emphasis), is refused the same way; the index reads no property from
   it either. A tag rename, which runs over every note of a vault, passes
   such a block by.
3. **An entry is its own lines.** Removing an entry removes the lines from
   its key through the last line of its value, and no line above or below
   it. The library used to take the comment lines above a key along; such a
   line may as well be an entry somebody commented out. A map this leaves
   without an entry still goes with its last entry (the namespace rule of
   point 1 of the decision). An entry ends with its last line that says
   something: the library counts the empty lines and comments behind a last
   entry without a value (`icon:`, `-`) to the map or list that holds it, and
   they are not taken at its word. Behind a text that keeps its empty lines
   (`|+`) the empty lines behind a removed entry go with it, or one stays in
   its place — whichever leaves the text saying what it said.
4. **This amends the addendum of 2026-10-09 in four places.**
   - Point 3: a block goes with its last entry where nothing but blank lines
     is left in it. One that still holds a comment stays, and takes the next
     entry.
   - Point 8: a whole-set write no longer re-serialises what it does not
     change. `updateFrontmatterString` writes the DIFFERENCE between the set
     it is handed and what the note says: a key whose handed value is what
     the YAML says — or what the index's reader hands out for it, since the
     set comes from that reader, which reads `tags: a, b` as two tags — stays
     byte for byte; a key the set no longer names loses its lines; one key
     gone and one key new with the same value is a rename in place. The
     properties panel's rename used to move the entry to the end of the
     block. A key the reader does not hand out (`__proto__`) was never
     offered to whoever made the set; its absence from the set removes
     nothing.
   - Point 10, "what the writers write": the block is no longer written anew
     in the note's line end. A line that is new ends in it (`\n` or `\r\n`,
     from `readTextShape`); the lines that are there keep the line end they
     have, a carriage return of its own included. No writer sets one. `\r\r\n`
     ends ONE line of an entry, as it does for an editor: a new line goes
     behind all three characters.
   - The fences are never written: blanks behind a fence stay, and a note
     that ends on its closing fence gets no line end behind it.
5. **A key has the name the index gives it.** The index reads the block as
   data, where every key is a text: `2024:` is the property "2024". The
   writers asked the library for the key's own text and found none — a write
   put a second entry `"2024":` beside the first, and removing or renaming did
   nothing and said nothing. Now a key is found by its name; where two keys
   have one name, it is the last, whose value the block says under it.
6. **A line that is new is not folded,** and nothing is written as `null`
   (the library printed a key without a value as `? key`). Several keys for a
   note without a block (`upsertFrontmatterKeys`, the importers) are written
   in one go: nothing is there that a line could be set beside.
7. **Tests and the guard.** `packages/core/test/frontmatter-entry.test.ts`
   sends one block that holds every form above
   (`test/helpers/propertyBlock.ts`) through every writer, in each shape a
   note lies on disk in (`\n`, `\r\n`, `\r\n` behind a byte order mark), and
   compares the whole note; 3000 generated notes hold every other line in
   place. The same block runs through each shell's own write path: the
   desktop's properties panel and database cell
   (`PropertiesSection.entryBytes.test.tsx`,
   `useBaseCells.entryBytes.test.tsx`) and the phone's cell and selection
   over its adapter chain (`apps/mobile/src/services/propertyEntryBytes.test.ts`).
   `apps/desktop/src/yamlWriters.test.ts` lists every shipped file that takes
   more from the YAML library than `parse`, and fails a file that starts to.
8. **Not changed here.** The copy of a note that leaves the vault
   (`publishedSlices.ts`) still writes the properties its allow-list lets
   through anew: a comment or a line left standing could carry what was
   withheld, so values the library reads as numbers leave in the library's
   form. `readFrontmatterPath` and `frontmatterKeys` still ask the library
   for a key's own text and do not see a property whose key is a number.

## Addendum 2026-10-21 (published slices: a block that names no properties)

Finding 2026-10-09, seen while the sanitizer was moved onto the definition
(point 5 of the first addendum of 2026-10-09): `projectPublishedMarkdown`
read a block's YAML as a record, whatever it was. Text between two rules at
the top of a note parses as one string and a list as an array, and the
string's characters and the list's places were walked as properties. The
report named "0", "1", "2" as removed properties, the preview counted them,
and the block was gone from the published note without a word. A number, or
a `null` that is spelt out, went the same way with no entry in the report at
all.

1. **Such a note is refused**, as a note whose YAML does not parse always
   was. Point 2 of the decision holds for the sanitizer, too: a block that is
   unparsable or no YAML map is an anomaly, and the note is refused and
   reported, never repaired. So is a map that cannot say what it holds: a
   reference that leads nowhere (`title: *Draft*` is one for YAML, not
   emphasis) or references that multiply past the library's limit. The
   sanitizer used to read such a block like the others and failed only when
   it turned it into data, with the library's own sentence: no note named,
   the reference quoted. What the anomaly is, is asked in one place by the
   writers and the sanitizer alike — `parseBlockYaml` in
   `packages/core/src/frontmatter-block.ts`, then `dataOfBlock` in
   `packages/core/src/frontmatter-entry.ts` —, and a test holds the two
   together on the table of forms the definition is held on. A block without
   content (no line, blank lines, comments only) is a block without entries:
   the note is published without a block, and no comment leaves with it. A
   `null` that is spelt out says something, and it is no map.
2. **Why the block is not left out and the rest published.** Both answers
   are safe: nothing of the block leaves either way. They differ in what the
   publisher is told. An allowlist judges names, and such a block has none,
   so there is no property to pass and none to name in a report. Without its
   block the published note is not the note its author holds, for a reason
   no line of the policy gives — and the one place that could say so is the
   preview, which is shown once, before the publication exists. Every
   refresh after that runs where nobody watches: a note that gets such a
   block later would lose it on the way out, silently. And "could not be
   read" is not "has none" (point 8 of the first addendum of 2026-10-09). A
   refusal stays on the publication's row until the note is corrected.
3. **The refusal names the note, in the user's language, and carries nothing
   the note says.** `projectPublishedNote` adds the vault path where the
   caller knows it — the preview and the refresh —, and
   `publicationErrorText` in
   `packages/ui/src/lib/publicationInstructions.ts` says the sentence on
   both shells. A note with unparsable YAML used to be refused by a protocol
   sentence without a note in it, and a slice is many notes. The YAML
   parser's message, which quotes the line it stumbled over, never reaches
   the reason: the reason is shown in the app and kept in the publication's
   record. A vault path may stand there, as it may in the diagnostics log; a
   note's text may not.
4. **Both shells say it in the same two places:** where the preview would
   stand — the review step of the desktop's slice wizard, the banner of the
   phone's publish sheet —, and on the publication's row. The preview ends
   at the note instead of counting on: numbers for the notes around it would
   describe a publication that does not come about. The reason belongs to
   the mode it was asked in, as the numbers do: an exact copy hands the note
   out as it is. The desktop used to say a failed preview in a toast while
   the review step went on promising that the notes were being read; the
   phone showed the thrown message as it came, protocol sentence or error
   code.
5. **No withdrawal waits behind a refused note.** A refresh stops at the
   first note that will not publish and leaves the rest of its plan to the
   next run (it stops rather than skips, so that a refresh is never reported
   as done while a note kept its old text). The withdrawals stood at the end
   of the plan, so a note taken out of the slice stayed published until an
   unrelated note was corrected — and a note with text between two rules,
   which used to go out without its block, now stops the run. The plan puts
   the withdrawals first (`planPublicationRefresh`): they need no projection
   and cannot be refused. What still waits behind a refused note are the
   changes to other notes of the slice — the refresh's rule for every
   failure, now with the note named that ends the wait. Whether a refresh
   should go on past a note it cannot publish, and say all of them, is a
   question for the refresh and is left open.
6. **Not affected:** an exact publication, which projects nothing and hands
   every note out as it is; and what is already published — the plan
   compares revisions, so a note that went out without its block before
   stays as it is until its source changes, and only then is the next
   publish refused.
7. **Known and left as it is:** the sanitizer reads every text file a slice
   covers as a note (`publishableObjects` takes `contentKind: "text"`), so a
   `.txt` or a `.yaml` of several documents that opens with a `---` line and
   has a second one is judged by the same rule. Where what stands between
   the two is no map, the file is now refused and named; before, those lines
   were dropped from the published copy.

## Addendum 2026-10-21 (the type of a new file, on the phone too)

Finding 2026-10-09, seen while the phone's header moved to the shared writer:
point 3 of the decision makes the default `type` a setting of the vault, and
every creation path owes a new file that type. On the phone the setting did
not reach two creation paths, a blank setting reached the others as an empty
`type`, and one path wrote no properties block at all; on the desktop two
ways to a task note wrote a type of their own.

1. **One place on the phone names the type of a new note:**
   `configuredNoteType` and `configuredDailyNoteType`
   (`apps/mobile/src/services/newNote.ts`). Every creation path of the phone
   that writes the vault's type asks there: the capture button, a note made
   from a link, a note from a template, a database and a pinboard entry,
   every way a task note comes about, a new template, the target of a broken
   link, a shared note and the daily note. A meeting note (`Meeting`) and a
   captured mail (`Email`) keep types of their own, on both shells. The
   capture button and the note made from a link wrote `Note` whatever the
   setting said, so a "note type → template" rule for the configured type
   never applied on capture. `vaultOps.createNote` takes no type any more;
   it asks. The desktop wrote a fixed `Task` for a task made from a mail or
   from a comment, where its own task view wrote the vault's type; it asks
   there too now, and `apps/mobile/src/services/newNote.test.ts` fails a call
   of either shell to the shared functions that make a task note
   (`createTaskInDatabase`, `prepareTaskNote`, `promoteTask`) with a type
   written into the call. The
   desktop reads the setting by the same rule in
   `getConfiguredNoteType` and `getConfiguredDailyNoteType`
   (`apps/desktop/src/services/newNote.ts`) and in two copies beside them
   (the daily note in `apps/desktop/src/services/dailyNotes.ts`, the task
   reconciler in `apps/desktop/src/contexts/VaultContext.tsx`).
2. **A blank setting is an unset one, on both shells.** The setting is read
   as the name without the blanks around it, and as the default (`Note`,
   `Daily Note`) where nothing is left. The phone handed the stored text on
   as it was, and a field that had been cleared wrote `type: ""` — a note
   that fails point 4 of the decision, made by Plainva itself. The phone's
   two settings fields save by the same rule now, as the desktop's always
   did, and name the default while they are empty.
3. **The rule sits where the setting is read, not where it is loaded.**
   Eleven places on the phone read the setting themselves, and all of them
   moved to the one function. The alternative — tidying the stored value
   when the settings record is filled — would have had to hold at each way
   into that record (the store on start and on a vault switch, the settings
   fields, the settings sync, which writes its patch into the live record
   directly) and at every way added later, with nothing to notice one that
   was missed. It would also have changed what the settings sync publishes —
   and, with the next save, the stored value — on a device where nobody
   changed the setting. A reader that asks the one function is something a
   test can hold: `apps/mobile/src/services/newNote.test.ts` fails a shipped
   phone file that reads the setting itself or names the default type as a
   literal. The desktop reads its store the same way, at the places named in
   point 1, and the phone already read the journal heading so.
4. **A shared note is a new note.** The share import
   (`apps/mobile/src/services/shareImport.ts`) built the note from a
   heading, the shared text and the attachment links, without a properties
   block. The text now goes through `withOkfDefaults` with the vault's type
   for new notes, which the host names like the folder — before the plan is
   made, so the header is part of the durable plan: a retry writes the
   planned note, and a plan an earlier version made without a block is
   finished as planned. A share that becomes a task brings the task's header;
   a share that goes into the journal is an entry of the daily note and no
   file of its own. The desktop has no share target (parity catalog,
   `share-target`), so this path is the phone's alone.
5. **The OKF conversion offers the vault's type on the phone too.** The
   phone's wizard offered a lowercase `note` of its own as the type for files
   without one, so one vault converted on the phone and on the desktop got two
   types (finding 2026-10-21). It offers the vault's type for new notes now,
   as the desktop always did, and an emptied field means the default type, as
   there (`apps/mobile/src/screens/okfConversionOptions.test.tsx`).

## Addendum 2026-10-22 (what a note takes over from its template)

Finding 2026-10-11: point 3 of the decision — template frontmatter wins, only
missing fields are added — was read as "everything the template carries".
A template carries some keys that say something about the template itself,
and a note a person made from it kept them.

1. **Three keys stay with the template.** `plainva.tasks: false` keeps its
   checkboxes out of the Tasks view — every template the app creates has it,
   and so do the templates of the shipped vault structures —,
   `plainva.templateFor` names the databases that offer it, and a legacy
   template still has the per-note `okf_version` (addendum 2026-08-21,
   point 2). A note made from the template takes none of the three over;
   every other key is the note's, `plainva.icon` and `plainva.header_color`
   included.
2. **The builder takes them out, for every note.** `templateAsNewNote` in
   `packages/ui/src/lib/newNoteContent.ts` removes them, and every note that
   is made from a template is built with it, on both shells and whether or
   not anybody is asked a question: a new note, the daily note, a database
   item, a pinboard entry, a meeting note, a task that became a note. They
   used to be taken out by `applyTemplatePlaceholders`, which only the paths
   without questions run. A note a person made goes through the shell's
   questions instead and kept all three: its tasks counted as hidden and
   were missing from the Tasks view, and it carried its template's database
   assignment. For the daily note a person opens this had held since v0.6.0
   — the very release that moved the daily note onto that resolver to put an
   end to it. The resolvers fill a template now and leave its properties as
   they stand. Removing the keys changes their entries and nothing else of the
   block (addendum 2026-10-13), one key at a time — an entry the writer cannot
   take out where it stands stays, the other keys still go —, and the
   template's text arrives byte for byte, which is what the caret is found by
   (addendum 2026-10-09 on the write rule for new files, point 3).
3. **No way around the builder.** The function that removes the keys is not
   exported. `apps/desktop/src/sharedShellWiring.test.ts` lists every place
   that hands a text to the header's writer (`withOkfDefaults`) or to
   `finalizeItemContent`, with what it hands over, and every place that
   fills a template (the engine's `resolveTemplate`,
   `applyTemplatePlaceholders`, `applyTemplateInteractive`) with where the
   filled text goes — so that a new way of making a note shows
   up there before it can set the header on a template's text by itself, as
   the pinboard entry did, or write a filled template that names its own
   `type` without any header writer. The same test holds the four shared
   modules that make a note from a template to the builder.
4. **A daily template that leaves nothing of itself in the note** — an empty
   file, or one that carries these keys only — gives the note the heading a
   daily note without a template starts with, also when a person opens it.
   The capture path wrote it all along; opened by a person, such a note was
   the template's block and no heading.
5. **Notes that exist keep the keys.** Nothing rewrites a note that exists;
   the user guide's FAQ says how to find the notes made before and how to
   take the keys out.

## Addendum 2026-10-22 (a note's properties are read field by field)

Finding 2026-10-09: the reader that hands a note's properties to the index,
the desktop's properties panel and the phone's sheet (`extractFrontmatter` in
`packages/core/src/metadata-extractor.ts`) checked the block against a schema
and refused the WHOLE block when one value did not fit the form of its field:
an empty `tags:` or `aliases:`, a number among them, `title`, `description` or
`type` as a number, a list or empty, a `resource` that is no URL, a
`timestamp` without a time zone, `.inf` under any key. The index then held no
property of such a note, no tag from its block and the file name for its
title; the panel showed "No properties", the phone's sheet no row and no word
why, and every write was refused (point 8 of the addendum of 2026-10-09).
Counted on 2026-10-22 in the local test vaults: 24 of 2,081 notes with a
block, twelve paths in two copies of one vault — nine with
`timestamp: 2026-06-22`, two templates with `- {{title}}` under `aliases` (a
map to YAML), one with an empty `aliases:`. A new item made from such a
template lost the template's tags to the inherited ones, and a pre-fill won
against the template's own value (`finalizeItemContent`).

1. **Every YAML map is read.** No value makes a block unreadable. The fields
   Plainva gives a meaning have a reading; every other key holds what YAML
   says. One sentence carries every case: a value that is not of its field's
   kind is the text it is written with.

   | Field | In the note | What the index, the panel and a cell get |
   |---|---|---|
   | `tags`, `aliases` | empty (`tags:`, `~`, `? tags`) | an empty list |
   | | a text with commas | its parts, as before |
   | | a number or a truth value, as an entry or as the value (`- 2024`, `tags: 2024`) | the text as written: the tag `2024`; `- 1.10` stays `1.10` |
   | | a list or a map as an entry (`- {{title}}`) | the text as written, on one line: `{{title}}` |
   | | an empty entry | no entry |
   | `title`, `description`, `type`, `okf_version` | a number or a truth value (`title: 2024.10`) | the text as written |
   | | empty | null: the key is there and says nothing — the title is the file name, the note is not OKF |
   | | a list or a map (`title: [a, b]`) | the text as written |
   | `resource`, `timestamp` | anything | what YAML says: an ordinary property |
   | any key | a value the index cannot hold (`.inf`, `.nan`, `!!binary`, `!!set`, a reference to itself) | the text as written |

   A number is read by its text because read as a number it changes: `1.10`
   would be the tag `1.1` and fall together with another, `007` would be `7`,
   `2024.10` would be `2024.1`. A quoted `"2024"` among the tags was a tag
   before; whether it is quoted no longer decides. The other way was to leave
   such a value out for its field. It hides what the note holds, and the next
   change of that row would write over something nobody was shown. `resource`
   and `timestamp` are read as what they say because nothing in Plainva takes
   them as a URL or a moment: the trust signals read `timestamp` with
   `timestampString` (`okf-trust.ts`), which takes a bare date. A key is named
   as the YAML names it — a key that is an alias (`*k :`) by what it stands
   for, the last of two keys of one name with that one's value.
2. **What stays unread:** YAML that does not parse — a key twice included —,
   a reference that leads nowhere (`title: *Draft*`), and a block that is a
   list. A block that holds no entry reads as one without properties, and so
   does one that holds only a text or a number (the writers refuse it), or a
   set, an ordered map or a date at its top (`!!set`, `!!omap`,
   `!!timestamp`), as before.
3. **For every block the schema took, the answer is the same,** value for
   value and in the same order: the fields with a meaning first, in the
   schema's order — the order the panel has always shown —, then the note's
   own; `__proto__` is no property, at no depth. One answer is not: a number
   under `okf_version` is the text it is written with, `1.0` and not `1`. The
   schema in `packages/core/src/metadata.ts` describes the answer now and
   checks no note. The forms the spec gives its fields — `resource` a URL,
   `timestamp` with a time zone, texts where texts are asked for — are
   `okfFieldFormsSchema`, and with a non-empty `type`
   `okfConceptFrontmatterSchema`: checks against the spec. The linter
   (`lintMarkdownAst`, `okf-linter.ts`) checked them through the reader; it
   checks them itself now, on the block as the YAML says it, and still calls
   such a block invalid. `classifyOkfFile` reads the file itself and still
   reports `type: 5` as a type that is no text, where the index reads the type
   "5": the two answer different questions.
4. **The index catches up: format 8.** A row cannot tell a note whose block
   was refused from a note whose block holds nothing, so every note that
   begins with a block — after a byte order mark too, found by its text in
   `fts_notes` — and that the index holds no property for is read again by the
   next full scan, and no other (`packages/core/src/db/Schema.ts`). No note is
   written, and no sync state moves. A number under `okf_version` keeps its
   old reading in the index until the note changes; nothing reads it there.
5. **The refusal of a value is gone.** The reader refuses no value, so
   neither does `writableProperties`: the sentence that named the property
   (`inputRejected.propertyValue`) is removed from the ten locales. A block
   after point 2 is refused as before, with the same sentence. The whole-set
   writer is unchanged: since the addendum of 2026-10-13 it writes the
   difference, and a reading that is not what the YAML says — `tags:` read as
   an empty list, `title: 2024` as "2024" — is not written back. The property
   writers keep handing it the whole set; with a reader that names every key
   of every map, the set they hand back is the note's. One way through it did
   write a reading: a rename handed over as a set, whose new key the writer
   fills with what the old one was read as — `title: 2024` renamed in the
   panel became `heading: "2024"`, a list under `description` one line of
   text. The panel hands over the two names now (`renameFrontmatterKey`), as a
   database's rename of a column does: the entry changes its name and not a
   character of its value. `tags: a, b` renamed stays `a, b` under the new
   name, a text there, where the set wrote a list of two lines (addendum of
   2026-10-13). A rename that finds no entry of the name — a key that is an
   alias, which the reader names after what it stands for — changes
   nothing; it is refused and said, as an entry the writers cannot change
   where it stands.
6. **A block that cannot be read is said.** For a block after point 2 the
   desktop's panel showed "No properties" and the phone's sheet nothing. Both
   say now that the block at the top of the note cannot be read as properties
   (`properties.unreadableBlock`) — and so they do for a block the reader
   reads as one without properties and every write is refused for: a line of
   prose or a number between the two rules, an ordered map or a date at its
   top. Both ask one question (`unreadablePropertiesBlock`: the reader's
   refusal, or the writers', `propertiesBlockRefused`).
7. **A tag is renamed as it is read.** With point 1 the index lists a number
   among the tags as a tag. The vault-wide rename (`renameFrontmatterTag`)
   compared texts only and passed it by; and it passed by a tag inside a text
   with commas directly under `tags` (`tags: a, b`), which the index has
   listed as two tags all along. It finds an entry by the text the reader
   reads now: a number as it is written, and a part of a text with commas,
   renamed where it stands in it — such a text over several lines is written
   anew, on one line, and a new name YAML would read as a number stands
   between quotes (`- "2025"`). An entry of a list stays one text, commas and
   all, as the index reads it. The singular `tag`, from which the index reads
   no tags, is renamed as before: a text compared whole. A tag another value
   of the block refers to (`tags: &t work, home` and `other: *t`) cannot be
   renamed where it stands: the writer refuses that note, the rename counts it
   among the notes it could not change, and goes on — the search for the notes
   with the tag (`contentHasTag`) threw there and stopped the rename for every
   note.
8. **A placeholder is no name.** A template's `- {{title}}` under `aliases`
   is read now. The search for unlinked mentions (`GraphService`) takes a
   title or an alias with a placeholder in it for no name a note is mentioned
   by: as a phrase for the full-text index it was the word inside, and every
   note with `title` in it mentioned the template. A placeholder as the title
   (`title: {{title}}`, read now as the text it is written with) is the
   template's title in the index, as `title: "{{title}}"` was before, and a
   link `[[{{title}}]]` finds the template by it; that is left as it is here.
9. **More notes meet rules.** Databases and filters show notes they missed,
   the tag tree and the graph as well, and template rules by `type` take
   effect. So does a rule of a workspace slice (`tag equals …`,
   `property equals …`, `packages/core/src/workspace/slices.ts`): a note whose
   block was refused is shown to the slice's members with the next
   reconciliation. The rule says so, and the tag stands in the note; it is new
   all the same. Accepted by the maintainer (2026-10-19), for the release note.
10. **Tests.** `packages/core/test/metadata-extractor.test.ts` holds every
   form above, and the old schema as the measure for every block it took — on
   the table of forms, on keys named another way and on generated blocks —,
   and that the reader answers for every YAML map and names every key of it.
   The index on a real database (`properties-read-per-field.test.ts`): each
   form with its other properties, its tags and its title, and the step to
   format 8. The shells' writers on such a note change the one property and
   not another byte (`apps/desktop/src/lib/writeProperty.test.ts`, the cell
   and the panel, the phone's `commitCellValue.test.ts`); a rename in the
   panel changes the name alone, and one that finds no entry of the name is
   refused and said (`PropertiesSection.refusedWrite.test.tsx`); the panel
   and the phone's sheet say a block they cannot read, a line of prose and a
   number among them (`NoteContextSheet.properties.test.tsx`); the tag rename
   (`rename-tag.test.ts`, `renameTagVault.test.ts`); the linter
   (`okf-linter.test.ts`); the mentions (`graph-service.test.ts`); the new
   item from such a template (`newItemFlow.test.ts`).
   `apps/desktop/src/yamlWriters.test.ts` knows the reader and holds that it
   prints nothing; `silentPropertyWrites.test.ts` knows the panel's rename.

## Addendum 2026-10-24 (`log.md`, kept by a routine)

Point 7 of the addendum of 2026-08-21 gave `log.md` to the AI-harness plan as
an opt-in routine. It is built there (ADR 0033, decision 13): a routine keeps
the `log.md` of one folder or of the whole vault in the format the OKF
describes — a title, entries under `## YYYY-MM-DD` headings, newest first,
prose in a list. The objections of point 7 hold, and the build answers them:

1. **No entry per save.** An entry is written at the routine's time, one per
   run; a second run on the same day puts its lines under that day's heading.
   Where nothing changed, nothing is written and no model is asked.
2. **Prose with a reason.** The device knows which notes are new or updated
   and links them; a model finds one sentence per note from the lines it
   gained. A note without a sentence is still named — that it changed is the
   device's knowledge.
3. **Conflicts.** The file is changed through the chain's one entry for a
   change (ADR 0031): the entry goes into the file as it lies there at that
   moment, an entry another device wrote meanwhile stays, and nothing else of
   the file moves — its line ends and its byte order mark included. The
   settings say to keep a folder's log on one device.
4. **A reserved name.** `log.md` and `index.md` never count as notes of a
   log, and a run shows a model nothing of a log file.
5. **Its rules.** `log.md` carries no properties, so the rules of its folder
   hold for it; a note with stricter rules than its folder is not named in it.
