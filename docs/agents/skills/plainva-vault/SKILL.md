---
name: plainva-vault
description: Read and edit a Plainva vault (Markdown notes, .base databases, relations, tasks, journal entries) without breaking its formats, its privacy policy or its sync. Use when a folder contains a .plainva/ directory or .base files, or when the user calls it a Plainva vault.
license: AGPL-3.0-only
compatibility: Any harness that can read and write files. No network access needed.
metadata:
  plainva.version: "1"
  plainva.source: "https://github.com/plainva/plainva/tree/main/docs/agents/skills/plainva-vault"
---

# Working in a Plainva vault

A Plainva vault is an ordinary folder of Markdown notes. Plainva is a local-first editor; the files are the data, and Plainva, Obsidian and other tools read them side by side. Your job is to change them the way a careful person would: precisely, minimally, and without touching what is not yours.

## 1. Learn the contract

Read the file format reference before the first write: https://github.com/plainva/plainva/blob/main/docs/user/en/File_Format_Reference.md. The rules you will need most:

- **The note is the source of truth.** Property values live in each note's frontmatter; a `.base` file is only a view. To change a cell, edit the note.
- **Notes stay Obsidian-native.** Frontmatter values are plain scalars and lists; Plainva's extras live under the single `plainva:` key.
- **A `.base` has only Obsidian's top-level keys** (`filters`, `formulas`, `properties`, `summaries`, `views`); Plainva's options sit under nested `plainva:` sub-keys.
- **Preserve unknown keys** in notes and `.base` files through every read-write round trip.
- **Links** are wiki links (`[[Note]]`, `[[Note#Heading]]`, `[[Note|alias]]`) or relative Markdown links; relations are two-sided (see the reference's "Relations").

## 2. Stay out of Plainva's folders

- `.plainva/` holds the index, backups, comments, sync state and per-device files. Never read logic into it, never write to it.
- `.agent/` holds Plainva's AI policy (`policy.yml`), skills and memory. Do not change it unless the user explicitly asks — Plainva treats any changed file there as unapproved until the user reviews it on each device.
- Encrypted workspaces are ciphertext. Do not open or modify their files.

## 3. Respect the privacy policy

Before reading a note into a model that runs in the cloud, check its policy:

- the note's frontmatter `plainva: { ai: { cloud: deny } }`, or
- a folder rule in `.agent/policy.yml`, for example:

```yaml
folders:
  Private/: { cloud: deny }
  Research/: { web: deny }
```

The note's own value wins, otherwise the nearest folder rule. `cloud: deny` content stays on the device — its text, its title and its file name. `web: deny` content must not share a task with web access.

## 4. Write like Plainva writes

- UTF-8 without BOM, LF line endings, atomic writes (temporary file, then rename).
- One property changes one line of frontmatter; the body stays byte-for-byte.
- New notes: follow the folder's existing naming and frontmatter (`type`, dates, tags); do not invent structure.
- Journal entries are lines `- HH:mm Text` under the journal heading of the day's note; append, never rewrite.
- Tasks are Markdown checkboxes; keep their metadata (dates, priority, repetition) as written.

## 5. Know what you bypass

Plainva watches the vault and syncs your changes, but a direct write skips Plainva's pre-write backup: the version history cannot restore text you overwrote. For larger edits, work in a vault under version control (Git). Do not edit a note that is open with unsaved changes.
