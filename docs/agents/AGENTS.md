# Working in this vault

This folder is a [Plainva](https://github.com/plainva/plainva) vault: Markdown notes with YAML frontmatter, databases as `.base` files, and two folders that belong to Plainva. Copy this file into the vault's root as `AGENTS.md` (or merge it into yours) so that coding agents and AI assistants that read `AGENTS.md` follow these rules.

## Before you write

- Read the file format reference first: https://github.com/plainva/plainva/blob/main/docs/user/en/File_Format_Reference.md. It is the exact on-disk contract — frontmatter, the `plainva:` namespace, `.base` databases, relations, tasks, the journal.
- Preserve what you do not understand: unknown frontmatter keys, unknown `.base` keys, formatting you did not mean to change.
- Keep edits small and reviewable. Change one property without rewriting the note; never reformat a note you are not changing.
- Write UTF-8 without BOM, LF line endings, atomically (temporary file, then rename).

## Never touch

- `.plainva/` — Plainva's index, backups, comments, sync state and device files.
- `.agent/` — Plainva's AI policy, skills and memory. A change there changes what the user approved; Plainva treats every changed file there as unapproved until the user looks at it again.
- Encrypted workspaces (folders Plainva shows with a lock) — their files are ciphertext.

## Respect the privacy policy

- A note whose frontmatter says `plainva: { ai: { cloud: deny } }`, or that lies in a folder listed with `cloud: deny` in `.agent/policy.yml`, is meant to stay on this device. Do not send its content — nor its title — to a cloud model.
- `web: deny` means the note must not share a task with web access.

## Plainva is not in the loop when you write files

Plainva notices your changes and syncs them, but it makes no backup of the text you replace: its version history only holds what Plainva itself wrote. Prefer a vault under version control (Git) for larger edits, and do not edit a note the user has open with unsaved changes.
