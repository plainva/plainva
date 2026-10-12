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
     lines as that text — but for `\r\r\n`, of which the editor is handed
     `\r\n`: one line break where the file has two.
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
   task and pinboard write paths) are not covered by it and have not all
   been read for this.
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
    - **Not decided here:** what a save from the editor leaves of such a
      file. A file's shape knows two line ends, so the editor reads a `\r`
      alone as a line break and writes `\n`: a file from a classic Mac does
      not keep the line ends it came with.

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
