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
