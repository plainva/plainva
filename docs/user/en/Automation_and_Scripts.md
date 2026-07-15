# Automation & Scripts

Last reviewed: 2026-07-15

Plainva has no plugin system that runs third-party code. Instead the vault itself is the extension interface: your notes are plain Markdown, databases are plain YAML (`.base`), and the [OKF conventions](OKF.md) give every file a predictable structure. Anything that can read and write files — a shell script, a Python program, a CLI tool, a scheduled job or an AI agent — can extend, generate or reorganize your vault without a single Plainva-specific API.

This page explains how to do that **safely**. The exact byte-level format of every file is documented separately in the [File Format Reference](File_Format_Reference.md); this page is the practical companion: the rules, the workflow, and what to hand an AI assistant.

## Why files instead of a plugin sandbox

- **Security.** A code-plugin system runs someone else's program inside your editor with access to your notes. Plain files need no such trust: a script only ever touches the folder you point it at, with your operating system's normal permissions.
- **Longevity.** The format outlives the app. A Markdown file you generated with a script five years ago still opens today — in Plainva, in Obsidian, in any text editor. There is no plugin API to deprecate.
- **The format is the contract.** Because the on-disk format is open and documented, the "API" is stable and inspectable. You can diff it, version it in Git, and reason about it.

If you want something Plainva does not do out of the box, you do not wait for a plugin — you write a small script against the files.

## Reading a vault safely

Everything is UTF-8 text:

- **Notes (`.md`)** — an optional YAML frontmatter block (between two `---` lines at the very top) holds the properties; the Markdown body follows. Parse the frontmatter with any YAML library.
- **Databases (`.base`)** — plain YAML describing views over notes. The *values* are never in the `.base`; they live in the notes' frontmatter.
- **Structure** — tags are `#tag` in the body or `tags:` in frontmatter; links are `[[Note]]` (wiki links) or `[text](path.md)`. Tasks are `- [ ]` / `- [x]` list items.

Reading never needs care — text files cannot be "corrupted" by reading them. The rules below are all about *writing*.

## Writing a vault safely

Follow these rules and Plainva (and Obsidian) will accept your changes cleanly. Plainva watches the vault folder: an external write is picked up and re-indexed automatically, usually within a second.

1. **Write UTF-8 without a BOM, with LF line endings.** Windows tools that default to UTF-16 or CRLF produce files Plainva treats as changed on every sync.
2. **Write atomically.** Write to a temporary file in the same folder, then rename it over the target. A half-written note (for example after a crash) is worse than no change. Plainva itself writes every note this way.
3. **Preserve OKF frontmatter and unknown keys.** Keep `type` and `okf_version` when you rewrite a note, and never drop frontmatter keys you do not recognize — round-trip them unchanged. Do not "tidy" keys you do not understand.
4. **Never touch `.plainva/`.** That folder holds Plainva's device-local index, backups, graph pins and sync state. It is not part of your content and must never be written, synced or committed to Git by your scripts.
5. **Respect the `.base` rules.** A `.base` uses only Obsidian's four top-level keys (`filters`, `formulas`, `properties`, `views`); every view needs a `name`; filters are single-rooted. All Plainva-specific data goes under nested `plainva:` sub-keys. The [File Format Reference](File_Format_Reference.md#databases-base) has the full contract, including a two-sided relations example.
6. **Don't fight the editor.** If a note is open *and* has unsaved edits in Plainva, prefer not to rewrite it from a script at the same moment. Plainva has a conflict resolver as a safety net, but the cleanest path is to let the app save first (or edit notes that are not currently open).

## Patterns

A few common jobs, all just file operations:

- **Bulk-create notes** — generate `.md` files with an OKF frontmatter block (`type`, `okf_version`, plus your own properties) and a Markdown body. Plainva indexes them as they appear.
- **Daily-note or report generators** — a scheduled script that writes a dated note into your daily-notes folder, filled from another source.
- **Property sweeps** — read every note's frontmatter, transform a field, write it back (atomically, preserving unknown keys).
- **Export / publish** — read the vault and render it to HTML, a static site or a PDF. Reading only — no rules to worry about.
- **Link maintenance** — rescan `[[Note]]` links and `tags:` and produce a report, or fix them in place.

Keep scripts idempotent where you can: running twice should not duplicate content.

## Handing the vault to an AI assistant

An AI agent with read/write access to a vault folder is exactly the case this design is built for. To let it work correctly:

1. **Give it the [File Format Reference](File_Format_Reference.md).** It is written for a machine reader: the OKF frontmatter contract, the property→YAML serialization, the full `.base` schema with its hard Obsidian rules, the `index.md` contract and the safety rules — everything an agent needs to edit files without breaking them.
2. **Point it at the vault folder, not the `.plainva/` folder.** State clearly that `.plainva/` is off-limits.
3. **Ask for atomic, minimal edits.** An agent that rewrites a whole note to change one property should preserve the rest of the frontmatter and body verbatim.

Because the contract is a document, not a live API, the same instructions work with any assistant, offline or online.

## Safety recap

- UTF-8, no BOM, LF.
- Write atomically (temp file + rename).
- Preserve `type`, `okf_version` and unknown keys.
- Never write into `.plainva/`.
- `.base`: four top-level keys, named views, single-rooted filters, `plainva:` sub-keys for everything else.
- The vault is watched — external changes appear in Plainva automatically.

## See also

- [File Format Reference](File_Format_Reference.md) — the exact on-disk format of every file
- [OKF](OKF.md) — the Open Knowledge Format that gives files their predictable structure
- [Databases (.base)](Databases_Base.md) — how `.base` views work
