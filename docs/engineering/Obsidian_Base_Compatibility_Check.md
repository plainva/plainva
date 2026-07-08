# Obsidian `.base` Compatibility Check (Plan D6)

Last reviewed: 2026-07-03

This document describes how Plainva's additional keys in `.base` files are
cross-checked against Obsidian's Bases plugin, and records the result.
Background: Obsidian compatibility is a core promise of Plainva, so
a `.base` enriched by Plainva must not break in Obsidian.

## Contract: graceful degradation via the `plainva` namespace

On disk, a `.base` uses only Obsidian's canonical top-level keys
(`filters`, `formulas`, `properties`, `views`). Plainva-specific enrichment
lives exclusively under a namespaced `plainva` sub-key:

- per property under `properties[<id>].plainva` — among others `input`, `options[]`
  (each option can carry `color` and `group`), and `relationBase`;
- per view under `views[i].plainva` — among others `render` (board/calendar/timeline),
  `dateField`, `endField`, `groupBy`, `coverImage`, `widths`;
- since 2026-07-03 (Base-UX2 P7) additionally `views[0].plainva.fileIconColor`:
  the color tint of the database icon (tree/tabs/header). File-wide
  presentation, deliberately placed in the view slot because a NEW top-level key
  would make the file unreadable for Obsidian (the `columns:` incident).
  `serializeBaseConfig` writes it only on view 0 and cleans up duplicates.
- since 2026-07-03 (Base relations master plan, maintainer workspace) three more keys:
  `properties[<id>].plainva.relationLimit` (`one` = exactly one link; absent =
  unlimited, is never written), `properties[<id>].plainva.reverseOf`
  (`{ base, property }` — computed reverse-relation column; the values live in
  NO note, Obsidian simply shows an empty column), and
  `views[i].plainva.subItemsProperty` (sub-items hierarchy of the table;
  Obsidian shows the rows flat). Relation VALUES in notes remain native
  frontmatter wiki links (`"[[X]]"` or lists thereof) and are visible in Obsidian
  as clickable property links.
- since 2026-07-03 (Base 'New' master plan, maintainer workspace) two more file-wide
  keys in the view-0 slot (same pattern as `fileIconColor`):
  `views[0].plainva.newItemFolder` (where the "New" button stores new items) and
  `views[0].plainva.newItemTemplate` (default template for new items,
  vault-relative path). Both are purely Plainva authoring data — Obsidian ignores
  them. Since then, filters can additionally contain GROUP entries
  (`and: [..., {or: [...]}]` or `or: [..., {and: [...]}]`) — this is Obsidian's
  own, documented nested filter form and remains single-rooted.

Obsidian documents these spots as open ("it is up to the individual view how
to use these configuration values"; plugins "can add additional data"). Expectation:
Obsidian ignores the `plainva` block, opens the file without errors, and renders a
Plainva-only view (board/calendar/timeline) as a plain table.

The only translation layer is `apps/desktop/src/services/baseFormat.ts`
(`parseBaseConfig` / `serializeBaseConfig`). Unknown Obsidian keys
(`formulas`, `displayName`, future fields) are carried losslessly through a parse/serialize
roundtrip via the raw copy kept under `_obsidian`.

## Hard Obsidian requirements (finding, 2026-07-03)

Obsidian rejects the ENTIRE file (not just the individual key) if
either of these two rules is violated:

1. Every view needs a non-empty string `name`
   (error message: "'Name' in view N is missing or invalid").
2. A `filters` object may carry EXACTLY ONE of the keys
   `and`/`or`/`not` at any level (error message: "'Filters' can only contain one of the
   following keywords: 'and', 'or', 'not'").

Older Plainva builds violated both: the base-creation wizard and inline bases
wrote views without a `name`, and every filter edit placed `and` and `or`
side by side. Since 2026-07-03, `serializeBaseConfig` guarantees:

- Every view written carries a `name` (an existing name wins, otherwise
  the previous name from the file, otherwise a unique fallback derived from the
  view type, e.g. "Table"/"Table 2"). The wizard and inline base assign
  the localized name directly. An empty `views` list is never written.
- Filters are written single-rooted: Plainva's in-memory form (an `and` list
  AND an `or` list, semantics: all `and` AND at least one `or`) is
  stored losslessly as `and: [...and, {or: [...or]}]`; when parsing, the
  appended `or` group is lifted back into the flat UI form. Pure
  `not` groups and a bare condition string are preserved.
- Existing files in the old, invalid two-key form heal themselves
  on the NEXT SAVE in Plainva (open the file in Plainva and save any
  configuration change).

## Harness-side status (automated verification)

The code-side part is covered by unit tests
(`apps/desktop/src/services/baseFormat.test.ts`):

- `color` / `group` / `relationBase` only ever end up under `properties[<id>].plainva`
  and never appear at the native property level or top level.
- Board/calendar/timeline serialize as native `type: table` plus
  a `views[i].plainva.render` hint.
- A full parse/serialize roundtrip preserves columns, views, and filters.
- Every view receives a `name` (unique fallbacks for unnamed views);
  never an empty `views` list.
- Filters are single-rooted (`and`/`or`/`not` never side by side); the old
  two-key form is healed during the roundtrip; nested canonical
  form, bare string, and pure `not` group roundtrip stably.
- `fileIconColor` lives only under `views[0].plainva` (never top-level, never on
  further views); invalid hex values are ignored when reading and discarded
  when writing; the roundtrip preserves the value
  (`baseFormat.test.ts`, "file icon color" section).
- `relationLimit` / `reverseOf` / `subItemsProperty` only roundtrip via the
  `plainva` slots and never leak to the native property/view/top-level level;
  an implicit `many` is never written; broken values (invalid
  `relationLimit`, incomplete `reverseOf`) heal on the next
  save (`baseFormat.test.ts`, "relation keys" section).
- `newItemFolder` / `newItemTemplate` live only under `views[0].plainva`
  (never top-level, never on further views); empty values are discarded;
  the roundtrip preserves both (`baseFormat.test.ts`, "stamps newItemFolder...").
- Filter groups roundtrip as entries of the single-rooted `and`/`or` form
  (Obsidian validity is secured via a recursive `validFilterNode` check);
  empty group shells disappear on save; the legacy lifting of old
  Plainva flat forms remains lossless (`baseFormat.test.ts`, P8 sections).

This ensures that Plainva never writes anything outside the
`plainva` namespace. The visual proof in Obsidian itself is not possible in the
harness and remains a maintainer step (see checklist).

## Test vault file

Place this file in an Obsidian vault with the Bases core plugin enabled, e.g.
as `Plainva_Compat_Test.base`. It uses `color`, `group`, `relationBase`, and a
Plainva-only board view:

```yaml
filters:
  and:
    - 'file.hasTag("projekt")'
properties:
  note.status:
    displayName: Status
    plainva:
      input: status
      options:
        - value: offen
          color: teal
          group: Aktiv
        - value: in-arbeit
          color: amber
          group: Aktiv
        - value: erledigt
          color: gray
          group: Abgeschlossen
  note.ref:
    plainva:
      input: relation
      relationBase: DB/Other.base
      relationLimit: one
  note.rueckwaerts:
    plainva:
      reverseOf:
        base: DB/Other.base
        property: ref
views:
  - type: table
    name: Board
    plainva:
      render: board
      groupBy: status
      fileIconColor: "#2f6f6f"
      subItemsProperty: parent
      newItemFolder: Projekte
      newItemTemplate: Templates/Projekt.md
```

For the filter-group verification, additionally check a variant with a nested
filter form (Obsidian must evaluate it without errors):

```yaml
filters:
  and:
    - 'file.hasTag("projekt")'
    - 'status == "offen"'
    - or:
        - 'prio == "1"'
        - 'prio == "2"'
```

## Maintainer checklist (native)

1. Place the test vault file as shown above into an Obsidian vault; create a few notes with
   `tags: [projekt]` and a `status:` frontmatter property.
2. Open the file in Obsidian. Expected: opens without errors; the board view is
   rendered as a plain table (graceful degradation); the filter applies; the
   additional `plainva` keys (`fileIconColor`, `relationLimit`,
   `reverseOf`, `subItemsProperty`, `newItemFolder`, `newItemTemplate`) do not
   disturb Obsidian — the reverse-relation column simply appears empty, the
   rows stay flat.
   Additionally: open a note with `ref: "[[X]]"` in the frontmatter — Obsidian
   shows the value as a clickable property link.
   Additionally for filter groups: open the variant with `and: [..., {or: [...]}]` —
   Obsidian evaluates the group (only notes with `prio` 1 or 2 and
   `status: offen` appear), no error message.
3. Check the Obsidian console (Ctrl+Shift+I) for parser/schema errors. Expected: none.
4. Change and save a small thing in Obsidian; then reopen in Plainva.
   Expected: Plainva's enrichment (status colors/groups, board, relation)
   is preserved (roundtrip via `_obsidian`).
5. Healing check for existing files: open a `.base` that Obsidian previously
   rejected with "Name in view N is missing" or "Filters may only contain one of
   the keywords" in Plainva, save any configuration
   change, and then reopen it in Obsidian. Expected: the file
   opens without errors; filter and view behavior in Plainva is unchanged.
6. Record the result below. If there are problems: adjust `serializeBaseConfig` so that the
   affected keys stay cleanly under `plainva`, add a test, and check again.
7. Template databases (2026-07-04 master plan, maintainer workspace): create a vault
   from the **GTD** template (or **PARA**) and open its generated `.base` files
   (`Tasks.base`/`Projects.base` or `Projects.base`/`Areas.base`) in Obsidian.
   Expected: opens without errors; the board views degrade to a plain table;
   the relation column shows the frontmatter wiki links, the computed reverse
   column (`reverseOf`) appears empty; the filter is a plain `file.folder`
   source (no longer a Plainva-specific `contains(...)` — Obsidian used to
   reject that with "Function 'contains' not found"). The source folder's
   managed index.md may appear in Obsidian as an empty extra row (Plainva
   hides it at the query layer; an accepted UX trade-off in Obsidian).
   Additionally localized: check a `ja` vault (CJK `.base` file names such as
   `プロジェクト.base`) and a `de` vault (umlaut folders) in Obsidian.

## Result

- [ ] Obsidian opens the test file without errors (maintainer, date: ____)
- [ ] Plainva-only view visibly degrades to a table (date: ____)
- [ ] No console errors (date: ____)
- [ ] Roundtrip Obsidian -> Plainva preserves the enrichment (date: ____)
- [ ] Template database (GTD/PARA) opens without errors in Obsidian, reverse column empty, no errors (date: ____)
- [ ] Previously rejected existing file opens without errors after saving in Plainva (date: ____)

Notes: ____
