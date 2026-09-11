# Database metadata and vault template boundaries

Last reviewed: 2026-09-11.

## Stored filter contract

The file format remains `.base`. The metadata catalog in
`packages/ui/src/base/baseFilterCatalog.ts` is shared by both shells; core
resolves its fields in `databaseMetadata.ts` and `VaultQueryService.ts`.

| Field | Meaning | Example |
|---|---|---|
| `note.plainva.header_color` | Explicit note header colour, not a status or theme colour | `note.plainva.header_color == "#2a7f7b"` |
| `note.plainva.icon` | Stored emoji or `lucide:` identifier | `note.plainva.icon == "lucide:pin"` |
| `file.tags` | Combined inline and frontmatter tags from the index | `file.tags.contains("#tour")` |
| Configured pinboard label property | That property's existing value or list membership | `labels == "Tour notes"` |

`file.tags.contains`, `!file.tags.contains`, `file.tags.isEmpty()` and
`!file.tags.isEmpty()` use native Bases list syntax. Membership is exact:
`#tour` does not match `#tour/ideas`. A tag source (`file.hasTag(...)`) remains
a separate source clause; a quoted occurrence inside a value is never a source.
The native syntax and file property vocabulary are documented by Obsidian in
[Bases syntax](https://obsidian.md/help/bases/syntax) and
[functions](https://obsidian.md/help/bases/functions).

The `plainva` object is existing note frontmatter, not a fabricated `file.color`
or `file.icon` property. Only these two nested fields are resolved; no arbitrary
property traversal or expression execution is added. Hex colours are trimmed,
lowercased and expanded from short notation for comparison without rewriting
the note. Unknown saved icons and custom summary names remain visible.

Plainva supports its established equality-as-membership behaviour for list
properties and legacy substring `contains(property, value)` expressions. This is not a
promise that every such expression has identical semantics in another editor.
Unsupported expressions survive parsing and editing unchanged. The new native
tag rules do not broaden Plainva into an implementation of the full Obsidian
expression language.

Source-value queries remove property conditions but keep folder/tag source
conditions. They load the tag index in bulk and never reread every note file.
The ordinary displayed query still applies the view's AND/OR rules. Empty
results therefore cannot trap a filter behind an empty value selector.
An unfinished value comparison remains a local UI draft: serializing `is ""`
before a value was picked would turn it into `is empty` and hide the selector.

## Summaries

`ColumnSummarySelect` and `ColumnSummaryRow` share native summary names and
`computeColumnSummaries`. Values come from filtered rows and visible columns;
name and selection cells retain their positions. An empty numeric range stays
blank, while a count can be zero. Foreign summary formulas are retained but
not evaluated. There is no format migration.

## New vaults only

Every call to `scaffoldVaultTemplate` requires explicit new-vault intent and an
empty root listing before the first write. Read failures reject creation.
The per-file existence check is a race guard, never a fill-missing-files mode.

- Desktop creation rejects nonempty destinations and paths already registered
  as vaults, including removed or emptied ones. Opening records that identity.
- Mobile distinguishes a newly allocated container from opening or switching.
  The initial template opportunity is single-use. Existing empty containers,
  external folders and cloud connections do not gain sample notes on boot.
- Creating a cloud vault first checks a complete empty remote inventory. An
  unavailable, partial or occupied inventory is never treated as a new target.
  Opening/syncing an existing vault never invokes template generation.

All template changes apply only to future vault creation. No template updater,
merge, reset, backfill, index rewrite or settings migration exists for an
existing vault. Users can create a separate new vault to explore a newer tour.
Ordinary note templates remain an explicit way to create an individual note.

The tour's data version is provenance, not an update trigger. Its ten localized
stations prioritize useful exercises, with five introductory stops and optional
further exploration. Seven sample days are materialized relative to creation;
daily-note templates retain their future date tokens. Comments and versions
come from real user actions. Accounts, permissions and external execution are
never fabricated or activated by the template.

The learning integration test scaffolds all ten languages on a real filesystem,
indexes them in SQLite, follows links across a year boundary, checks changing
project rollups, runs the synthetic two-note import, and records/restores real
versions. Browser tests cover both configuration surfaces and mobile creation
followed by reopening edited and partially deleted tour contents.
