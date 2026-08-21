# OKF — Open Knowledge Format

Last reviewed: 2026-08-21

OKF (Open Knowledge Format) is an open convention for Markdown knowledge collections: plain Markdown files with a small, uniform frontmatter header. This page explains what OKF is, what Plainva does for it automatically — and why you do not *have* to use any of it.

## What is OKF?

The idea: every document in the vault says for itself what it is. A minimal frontmatter header is all it takes:

```markdown
---
type: Note
---
# My note
```

- **`type`** — what kind of document this is (e.g. `Note`, `Daily Note`, `Project`). The convention's only required field.
- **`okf_version`** — the version of the convention the vault follows. It lives **once**, in the root `index.md` (currently `"0.2"`), not in every note.
- **`index.md`** — each folder may contain one `index.md` as its table of contents; the names `index.md` and `log.md` are reserved for this and should not be used for regular notes.

> Writing files with a tool or script? The exact field contract — allowed values, how each property type serializes, and the reserved-name rules — is in the [File Format Reference](File_Format_Reference.md).

**Where OKF comes from:** OKF is an open specification by Google Cloud ([`GoogleCloudPlatform/knowledge-catalog`](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md), Apache-2.0 licence). Plainva follows **OKF 0.2** (published 25 July 2026). New in 0.2 are five optional fields with which a note says where it came from, whether someone reviewed it and whether it still holds — `generated`, `verified`, `sources`, `stale_after` and `status`. What Plainva shows and writes of them is described below under "Provenance, review and lifecycle".

## Why does Plainva use OKF?

Plain Markdown is wonderfully portable — but on its own it has no reliable structure. OKF adds just enough of it, and everything remains ordinary Markdown with standard frontmatter:

- **Databases, filters and templates can rely on structure.** Every note carries a `type`, so `.base` views over plain files stay robust.
- **Folders stay navigable.** An `index.md` table of contents per folder works for people and tools alike.
- **Scripts and AI assistants can work with your vault safely**, because the on-disk format is uniform and documented.
- **No lock-in.** OKF is an open convention on top of plain Markdown — other OKF tools understand your files, today and in ten years.

## What Plainva does automatically

**New files** get the OKF header automatically: every note created in Plainva receives `type` in its frontmatter — since OKF 0.2 the version marker `okf_version` lives once in the root `index.md`, no longer in every note. You configure the values per vault: **Settings → Vault → Content & structure → OKF (Open Knowledge Format)** → **type for new notes** (default `Note`) and **type for daily notes** (default `Daily Note`). If a template brings its own `type`, the template wins.

**Existing files are never changed unasked.** Plainva only adds OKF fields when creating new files or when you explicitly start the conversion.

**Protected system fields:** In the **Properties** panel, `type` and — where older notes still carry it — `okf_version` are marked as OKF system fields ("OKF system field – managed by Plainva"): the `type` value is selectable from a dropdown of known types, `okf_version` is display-only; renaming, type changes and deletion are locked so the convention cannot break by accident.

**The explainer:** **What is OKF?** in the settings gives you the short version in three sentences plus a link to this page. It no longer opens by itself; if a vault contains files that do not follow OKF, Plainva says so once in a small message with a button that takes you straight to the conversion.

## Provenance, review and lifecycle (OKF 0.2)

Since OKF 0.2 a note can say where it came from, who reviewed it and whether it still holds. Plainva turns that into three things:

**What Plainva shows.**

- A note with `status: draft` or `status: deprecated` carries a badge in the document header — **Draft** or **Deprecated**. `stable` stays silent; a `status` column of your own with other values (say `Open` in a task database) is not a lifecycle state and gets no badge.
- Once `stale_after` has passed, the notice **Marked as stale (since …)** sits above the note with a jump to the properties. The notice is display only — Plainva changes nothing in the note.
- The **Trust & provenance** section of the properties panel (on the phone: in the note's context sheet) summarises the fields and derives a trust level from them: **Not verified**, **Machine-confirmed** or **Reviewed by a person** — plus generated-by, the verified list, sources as clickable links, status and stale-after.

**What Plainva writes.**

- `generated` (and, where a source is known, `sources`) is set by exactly three machine write paths: the **importer** (`plainva-import/<version>`, one instant per run — the import report carries it too), **mail capture** (`plainva-mail-capture/<version>`, with the message's Message-ID as the source) and the **task sync** (`plainva-task-sync/<version>`, only when it creates a note).
- `verified` is written only by **Mark as reviewed** in the **Trust & provenance** section: Plainva appends `human:<your name>` with the current instant to the list — a second review never overwrites the first. Your name is asked for once per vault; it stays on this device and can be changed under **Settings → Vault → Content & structure → Reviewer name**.
- The editor never touches any of these fields on its own, and existing notes are never stamped after the fact. `status` and `stale_after` are yours to set, as a property or in the frontmatter.

**Upgrading the bundle version.** The version of the convention lives once in the root `index.md`. A vault that still declares `"0.1"` keeps working unchanged — under **Settings → Vault → Content & structure → Bundle version** (on the phone: **Settings → Vault → Maintenance → Bundle version**) you lift it to 0.2 with **Upgrade…**. The dialog shows beforehand what changes: the line in the root `index.md` and, as a checkbox (on by default), removing the legacy `okf_version` field from the notes that still carry it. Every file is backed up before it changes; **Clean up…** does only the second part. The field table and the write rules in detail are in the [File Format Reference](File_Format_Reference.md).

## index.md: the table of contents per folder

An `index.md` is a folder's table of contents: a list of the notes and subfolders it contains, with descriptions and relative links.

- **Generating** — always on your action, never out of nowhere: right-click a folder → **Generate/refresh index.md**, or in bulk via the **index.md manager** (**Settings → Vault → Content & structure**).
- **Adopting instead of generating** — if you already have overview notes (MOC, Overview, folder note, README …), the manager suggests them as candidates. **Adopt** renames the file to `index.md` (links are updated vault-wide) and can optionally prepare it for OKF.
- **Automatic upkeep** — listings *generated* by Plainva carry an invisible marker at the end of the file (an HTML comment). Only such marked files are kept up to date automatically whenever the folder changes — and only in OKF vaults (recognizable by `okf_version` in the root `index.md`).
- **Read-only with an exit** — managed index.md files open in read mode with the banner "This index.md is managed by Plainva and updated automatically." There you can **Refresh** — or choose **Edit anyway**: that removes the marker and the file is fully yours again (no more automatic updates).
- **All at once** — **Update all index.md files** is available in the vault root's context menu and in the settings; files without the marker are skipped.
- **Fill the gaps** — inside the index.md manager, **Generate index.md in all N folders without one** preselects every folder that has no index.md yet, so you can create them all in one run.
- **On the phone** — the same, through two doors: holding a folder offers **Create overview** or **Refresh overview**, whichever that folder needs. For the rare pass across everything there is **Settings → Vault → Maintenance → Overviews**: folders without one come first, and **Generate index.md in all N folders without one** creates them in a single run. A folder whose `index.md` you wrote yourself is listed and left alone — adopting is a named decision in that list, never the side effect of a tap. The automatic upkeep runs on the phone too now: a vault edited there no longer drifts out of date until a desktop opens it.
- In read mode, managed listings render as cards with file/folder icons; links open right inside Plainva.

## Converting an existing vault (opt-in)

If files in the vault do not conform to the OKF format (missing `type` field, or reserved names used as regular notes), Plainva offers the conversion — once when opening the vault, and permanently under **Settings → Vault → Content & structure** (the entry only appears while there is something to do).

The **Convert to OKF format** wizard works in clear steps:

1. **Scan** — shows how many files are affected (template and system folders are excluded; files with unreadable frontmatter are skipped, never "repaired").
2. **Decisions** — a default `type` for files without one; existing `type` values can be **kept** (recommended — they are already valid OKF types) or renamed into a different field.
3. **Preview (no changes)** — a dry run shows in advance what would change.
4. **Convert** — every file is backed up to `.plainva/backups/` before it is changed; a report summarizes what changed, what was skipped, and the backup folder. Afterwards you can optionally **continue to the index.md manager**.

A tip from the wizard: changes go through sync as usual — for git vaults, commit first.

### On the phone

The same route exists on mobile: **Settings → Vault → Maintenance → Convert to OKF format**. The steps are the same — scan, decisions, preview, convert — and the preview names the affected notes before anything is written.

Two things are added, because a phone may take an app out of memory at any moment:

- **Pause and continue.** The run stops at the next file when you tap **Pause** or the app goes to the background. Continuing writes into the same backup folder — no second one appears.
- **Asked at start-up.** If a run is left unfinished, Plainva says so the next time you open the vault and offers **Continue** or **Roll back**; **Later** is a valid answer. An interrupted run leaves a partly converted vault, not a broken one: only frontmatter fields are added, and every note stays valid Markdown.

**Roll back** restores the files from the backup folder — on the desktop too, from the report at the end of the run. The backup folder stays afterwards; it is the only copy of the state before the conversion.

## Do I have to use OKF?

No. OKF is a gentle standard:

- New files get the header automatically — it never gets in the way and costs nothing.
- Existing vaults (e.g. from Obsidian) keep working unchanged; the conversion is strictly opt-in.
- A missing `okf_version` — or one that older notes still carry — does not count as a violation; you can use Plainva and Obsidian side by side permanently without nagging.
- Obsidian and any other editor can still open every file: it is and remains plain Markdown.

## See also

- [File Format Reference](File_Format_Reference.md) — the exact on-disk contract for every vault file
- [Notes & Markdown](Notes_and_Markdown.md) — frontmatter and properties
- [Databases (.base)](Databases_Base.md) — what a uniform `type` buys you in practice
- [FAQ & Troubleshooting](FAQ.md) — backups and read-only index.md, among others
