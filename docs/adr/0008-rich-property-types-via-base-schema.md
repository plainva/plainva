# ADR 0008: Rich property types via the .base schema (two-layer model)

Status: Accepted

Date: 2026-06-30

> Verification note: This decision fixes where Plainva stores the
> non-Obsidian "richness" of properties (option sets, status colors/groups,
> column types). The native counter-check (does Obsidian's "Bases" core
> plugin tolerate Plainva-specific extra keys in `.base`?) remains a
> maintainer task. The ADR is revisable if global rich types outside of
> database folders are wanted later.

## Context

The properties view in the right sidebar (`PropertiesSection` /
`PropertyRow`) should offer Notion-like, typed values: select, status (with
a fixed, colored option set and groups), multi-select. Such types need
metadata that goes **beyond the plain value** — the universe of options,
their colors, status groups, the ordering.

Obsidian only knows native property types in frontmatter: text, list
(multitext), number, checkbox, date, date & time, plus the special cases
`tags`/`aliases`. A select/status type with an option set and colors does
**not** exist. Plainva's canonical format is and remains plain Markdown;
existing Obsidian vaults must not be damaged (core rule of the project).

Decision point: where are the option sets/colors/groups stored without
damaging the note or making it unusable in Obsidian?

## Decision

**Two-layer model.**

1. **Layer 1 — canonical frontmatter (the `.md`):** Every note carries
   exclusively Obsidian-native values — scalar (`status: final`), list
   (`tags: [...]`), number, boolean, date/datetime (ISO string). A nested
   object or an "active" flag is **never** written into the frontmatter.
   "Which value is active" is trivially the scalar in the note.

2. **Layer 2 — schema in the existing `.base`:** The richness lives in the
   already existing `.base` column schema that the `BaseViewer` reads today:
   - `columns[prop].input` ("select" | "date" | "datetime" | "number" |
     "checkbox" | …),
   - `columns[prop].options` (`[{ value, label }]`),
   - extended by optional Plainva keys `columns[prop].colors` and
     `columns[prop].groups` for the status type.

It follows that **rich types (select/status/multi-select) are a database
folder feature** — exactly as in Notion, where option-typed properties only
exist inside a database. A note that lives in a folder governed by a
`.base` gets the typed properties UI from exactly that `.base`. Notes
**outside** of any `.base` keep only native types
(text/list/number/checkbox/date/tags), rendered nicely (pills, chips,
formatted dates), but without option-set-driven select/status.

## Consequences

- (+) Notes remain 100 % Obsidian-native Markdown and never break — the
  active value is always a native scalar/native list.
- (+) No new sidecar file and no new parser: the `BaseViewer` already reads
  `columns[x].input`/`options`; the schema is merely lifted onto the
  single-note properties UI.
- (+) Conceptually congruent with Notion (option properties = DB properties)
  and with the existing Plainva database-folder model.
- (±) In the implementation, rich select/status **also** work for
  free-standing notes — via a per-vault type registry plus options
  discovered from vault usage (see refinement below). Curated option
  sets/colors/groups from a `.base` remain the optional, DB-folder-scoped
  extension.
- (−) `columns[prop].colors`/`.groups` are a **Plainva extension** of the
  `.base` format (analogous to the board view). Obsidian's "Bases" core
  plugin is expected to ignore unknown keys (graceful degradation: plain
  values instead of colored status) — to be covered via the existing
  `CompatibilityWarningDialog` pattern and verified natively.

## Alternatives considered

1. **Sidecar `.plainva/properties.json`** (vault-global schema): not chosen
   as the primary path. Would also cover free-standing notes, but introduces
   a second schema format including a parser and duplicates what `.base`
   already provides. Remains the reactivation candidate if rich types
   outside DB folders become a requirement.
2. **Options per note in frontmatter** (a second flat property
   `status_options: [...]`): rejected — bloats every note; Obsidian shows an
   additional list that it does not associate with `status`.
3. **Nested object in frontmatter** (`status: { value, options }`):
   rejected — Obsidian shows an unsupported object type, editing in Obsidian
   degrades and the frontmatter gets polluted; Dataview/search no longer
   treat the field as a simple value.

## Refinement (implemented 2026-06-30, TS-1 through TS-5 in one pass)

The decision was implemented in full; the core stays unchanged (the note
contains exclusively the active scalar or the active list — never
objects/active flags; Obsidian reads every file natively). Mechanics:

- **Governing-`.base` resolution (read-only):**
  `apps/desktop/src/services/baseSchema.ts` determines the governing
  `.base` of a note: every `.base` in an ancestor folder is considered, its
  query executed (`VaultQueryService.queryDatabaseFiles`), and the most
  specific one (deepest folder) with a match wins. Its `columns` schema
  drives rendering and options. No write access here.
- **Curated options/colors/groups from the `.base`:** `columns[prop]` =
  `{ input, options: [{ value, label?, color?, group? }], relationBase? }`.
  Select/status/multi-select render colored chips from it; status groups by
  `group` (ordered stages). The `.base` `input` beats the type registry and
  the inference.
- **Fallback without a governing `.base`:** type choice in the per-vault
  localStorage registry (`propertyTypeStore.ts`, the Obsidian `types.json`
  analog), options discovered **folder-scoped** from vault usage
  (`getDistinctPropertyValues(key, folderPrefix)` — fixes the vault-global
  mixing of identical property names such as `status`), colors
  deterministic.
- **Relations:** stored as `[[Note]]` wiki links (Obsidian-native, backlinks
  for free). The picker searches the note index; if `relationBase` is set,
  the candidates are the matches of that target `.base` (the Notion model),
  otherwise any note.
- **Authoring:** in the `BaseViewer` (existing saveConfig write path, no new
  `.base` writer) via the `ColumnSchemaEditor` — type, options
  (value/color/group) and relation target per column.

`columns[prop].color`/`.group`/`.relationBase` are Plainva extensions of the
`.base` format (analogous to the board view); Obsidian's "Bases" core plugin
is expected to ignore unknown keys (graceful degradation) — to be verified
natively.

## Refinement 2 (2026-06-30): Obsidian-compatible on-disk format

The first implementation wrote the Plainva layer as a **top-level
`columns:` map**. Obsidian's "Bases" core plugin, however, only knows the
four top-level keys `filters`, `formulas`, `properties`, `views` and no
longer opens a `.base` with a foreign top-level `columns:`. Since the note
stays Obsidian-native anyway (layer 1), the `.base` file itself is now also
written Obsidian-conformant:

- New module `apps/desktop/src/services/baseFormat.ts` encapsulates the I/O
  boundary (`parseBaseConfig`/`serializeBaseConfig`) — the **only**
  translation layer.
- On disk only native top-level keys. The Plainva richness
  (`input`/`options`/`relationBase`) moves **per property** under
  `properties["note.<key>"].plainva`, view-specific bits (render type,
  `dateField`/`endField`) under `views[i].plainva`. These sub-keys sit
  exactly where Obsidian documents extensions as allowed ("up to the view
  how to use these configuration values"; plugins "can add additional
  data") → graceful degradation (a Plainva board appears in Obsidian as a
  plain table).
- Non-native render types (board/calendar/timeline) are written as a native
  `type: table` + `plainva.render`; gallery↔`cards`, list↔`list`.
  Property IDs are `note.`-prefixed Obsidian-conformant (`order`/`sort`
  likewise).
- The reader still reads the **old top-level `columns:`** (older Plainva
  builds) and migrates automatically on the next save. The **in-memory
  format** (`config.columns`/`config.views`, bare names) stays unchanged, so
  the rest of the app did not have to be touched.
- Unknown keys (Obsidian `formulas`, `properties[x].displayName`, future
  keys) are carried losslessly through the parse→serialize cycle via a raw
  copy kept on `_obsidian`.

Residual risk: whether Obsidian actually tolerates unknown *sub*-keys under
`properties`/`views` remains **to be verified natively by the maintainer**
(the documentation suggests it does). Fallback if not: sharpen the
board/calendar/timeline warning in the `CompatibilityWarningDialog` instead
of global compatibility.

## Links

- Implemented UI: `apps/desktop/src/components/PropertiesSection.tsx`,
  `PropertyValues.tsx`, `propertyModel.ts`, `propertyTypeStore.ts`,
  `ColumnSchemaEditor.tsx`, `apps/desktop/src/services/baseSchema.ts`.
- Existing schema: `apps/desktop/src/components/BaseViewer.tsx`
  (`getColumnInput`/`getColumnOptions`), `packages/core/src/vault/VaultQueryService.ts`.
- Compatibility pattern: `apps/desktop/src/components/CompatibilityWarningDialog.tsx`.
- Related: ADR 0007 (deliberate format/scope decisions), the phase 9 wrap-up
  (extended databases, board/gallery) in the internal status docs
  (maintainer workspace).
