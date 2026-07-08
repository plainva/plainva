# OKF — Open Knowledge Format

Last reviewed: 2026-07-07

OKF (Open Knowledge Format) is an open convention for Markdown knowledge collections: plain Markdown files with a small, uniform frontmatter header. This page explains what OKF is, what Plainva does for it automatically — and why you do not *have* to use any of it.

## What is OKF?

The idea: every document in the vault says for itself what it is. A minimal frontmatter header is all it takes:

```markdown
---
type: Note
okf_version: "0.1"
---
# My note
```

- **`type`** — what kind of document this is (e.g. `Note`, `Daily Note`, `Project`). The convention's only required field.
- **`okf_version`** — the version of the convention the file was written against.
- **`index.md`** — each folder may contain one `index.md` as its table of contents; the names `index.md` and `log.md` are reserved for this and should not be used for regular notes.

> Writing files with a tool or script? The exact field contract — allowed values, how each property type serializes, and the reserved-name rules — is in the [File Format Reference](File_Format_Reference.md).

## Why does Plainva use OKF?

Plain Markdown is wonderfully portable — but on its own it has no reliable structure. OKF adds just enough of it, and everything remains ordinary Markdown with standard frontmatter:

- **Databases, filters and templates can rely on structure.** Every note carries a `type`, so `.base` views over plain files stay robust.
- **Folders stay navigable.** An `index.md` table of contents per folder works for people and tools alike.
- **Scripts and AI assistants can work with your vault safely**, because the on-disk format is uniform and documented.
- **No lock-in.** OKF is an open convention on top of plain Markdown — other OKF tools understand your files, today and in ten years.

## What Plainva does automatically

**New files** get the OKF header automatically: every note created in Plainva receives `type` and `okf_version` in its frontmatter. You configure the values per vault: **Settings → Vault Settings → OKF (Open Knowledge Format)** → **type for new notes** (default `Note`) and **type for daily notes** (default `Daily Note`). If a template brings its own `type`, the template wins.

**Existing files are never changed unasked.** Plainva only adds OKF fields when creating new files or when you explicitly start the conversion.

**Protected system fields:** In the **Properties** panel, `type` and `okf_version` are marked as OKF system fields ("OKF system field – managed by Plainva"): the `type` value is selectable from a dropdown of known types, `okf_version` is display-only; renaming, type changes and deletion are locked so the convention cannot break by accident.

**The explainer:** When you first open a vault, Plainva shows **What is OKF?** once — the same summary is always available in the settings.

## index.md: the table of contents per folder

An `index.md` is a folder's table of contents: a list of the notes and subfolders it contains, with descriptions and relative links.

- **Generating** — always on your action, never out of nowhere: right-click a folder → **Generate/refresh index.md**, or in bulk via the **index.md manager** (**Settings → OKF → Open…**).
- **Adopting instead of generating** — if you already have overview notes (MOC, Overview, folder note, README …), the manager suggests them as candidates. **Adopt** renames the file to `index.md` (links are updated vault-wide) and can optionally prepare it for OKF.
- **Automatic upkeep** — listings *generated* by Plainva carry an invisible marker at the end of the file (an HTML comment). Only such marked files are kept up to date automatically whenever the folder changes — and only in OKF vaults (recognizable by `okf_version` in the root `index.md`).
- **Read-only with an exit** — managed index.md files open in read mode with the banner "This index.md is managed by Plainva and updated automatically." There you can **Refresh** — or choose **Edit anyway**: that removes the marker and the file is fully yours again (no more automatic updates).
- **All at once** — **Update all index.md files** is available in the vault root's context menu and in the settings; files without the marker are skipped.
- In read mode, managed listings render as cards with file/folder icons; links open right inside Plainva.

## Converting an existing vault (opt-in)

If files in the vault do not conform to the OKF format (missing `type` field, or reserved names used as regular notes), Plainva offers the conversion — once when opening the vault, and permanently under **Settings → OKF → OKF conversion** (the entry only appears while there is something to do).

The **Convert to OKF format** wizard works in clear steps:

1. **Scan** — shows how many files are affected (template and system folders are excluded; files with unreadable frontmatter are skipped, never "repaired").
2. **Decisions** — a default `type` for files without one; existing `type` values can be **kept** (recommended — they are already valid OKF types) or renamed into a different field.
3. **Preview (no changes)** — a dry run shows in advance what would change.
4. **Convert** — every file is backed up to `.plainva/backups/` before it is changed; a report summarizes what changed, what was skipped, and the backup folder. Afterwards you can optionally **continue to the index.md manager**.

A tip from the wizard: changes go through sync as usual — for git vaults, commit first.

## Do I have to use OKF?

No. OKF is a gentle standard:

- New files get the header automatically — it never gets in the way and costs nothing.
- Existing vaults (e.g. from Obsidian) keep working unchanged; the conversion is strictly opt-in.
- A missing `okf_version` alone does not count as a violation — you can use Plainva and Obsidian side by side permanently without nagging.
- Obsidian and any other editor can still open every file: it is and remains plain Markdown.

## See also

- [File Format Reference](File_Format_Reference.md) — the exact on-disk contract for every vault file
- [Notes & Markdown](Notes_and_Markdown.md) — frontmatter and properties
- [Databases (.base)](Databases_Base.md) — what a uniform `type` buys you in practice
- [FAQ & Troubleshooting](FAQ.md) — backups and read-only index.md, among others
