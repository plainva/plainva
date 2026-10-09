# Plainva User Guide

Last reviewed: 2026-10-09

Plainva is a Markdown vault editor: your notes are ordinary Markdown files in a folder (a "vault") on your computer — no database silo, no forced cloud account. This guide explains how to work with Plainva and how the file formats work.

## Contents

| Page | What it covers |
|---|---|
| [Getting Started](Getting_Started.md) | Opening or creating a vault, the interface, editor modes, tabs and split view |
| [Notes & Markdown](Notes_and_Markdown.md) | How Markdown files work: writing, formatting, properties (frontmatter), icons, links, templates, images |
| [Databases (.base)](Databases_Base.md) | Viewing notes as a database — views, filters, properties, relations, new entries (similar to Notion, but file-based) |
| [Import from another app](Import.md) | Bringing notes over from Notion, Evernote, Google Keep, Simplenote, Logseq or a Markdown folder — and what each importer cannot carry over |
| [OKF](OKF.md) | The Open Knowledge Format (0.2): `type`, provenance and review marks, the bundle version, index.md management and the optional vault conversion |
| [File Format Reference](File_Format_Reference.md) | The exact on-disk format of every vault file — for tools, scripts or an AI editing notes and `.base` files directly |
| [Automation & Scripts](Automation_and_Scripts.md) | Extending Plainva without plugins: how scripts, CLI tools and AI agents read and write a vault safely |
| [Backups & Version History](Backups_and_Versioning.md) | Automatic file versions, restoring (including deleted files) and daily ZIP backups of the vault |
| [The mobile app](Mobile_App.md) | Plainva on Android and iOS: layout, editing, databases, sync and the safety net |
| [Sync Setup](Sync_Setup.md) | Step by step per provider: WebDAV/Nextcloud, Google Drive, OneDrive, Dropbox, S3 |
| [Security & Sharing](Security_and_Sharing.md) | Personal encrypted workspace, recovery backup, migration and locking |
| [Comments & Suggestions](Comments_and_Suggestions.md) | Comments, suggest mode, overview and notifications — in every vault, with or without encryption |
| [Sync Compatibility](Sync_Compatibility.md) | Which services work today — directly, via WebDAV, or via the provider's desktop client |
| [Google Drive (BYO)](Google_Drive_BYO_Guide.md) | Setting up Google Drive sync with your own credentials |
| [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md) | Setting up OneDrive and Dropbox sync with your own app registration |
| [Search](Search.md) | Full-text search, quick switcher, find & replace, tags |
| [Tasks](Tasks.md) | The vault-wide task view: every checkbox across your notes, with status/tag/folder/due filters and one-click toggling |
| [AI Assistant (Beta)](AI_Assistant.md) | Asking questions about your notes with an AI model of your choice: providers and keys, profiles, context, privacy rules and history |
| [Skills (Beta)](AI_Skills.md) | Instructions for recurring work: the thirteen that come with Plainva, your own, importing, and approving what arrives before it runs |
| [Scripts (Beta)](AI_Scripts.md) | Small programs that read your vault and compute a result: running one, writing one, what its tools return, its limits, and approving what arrives before it runs |
| [Memory (Beta)](AI_Memory.md) | What the AI should know about you without being told again: the two places, adding entries yourself, letting the AI remember, rules, privacy, and the two files |
| [Connecting AI apps (Beta)](Connect_AI_Apps.md) | Letting AI apps on this computer (Claude Code, Claude Desktop, editors) read the vault through Plainva's MCP server: switching it on, pairing, folders, what an app can see, and letting an app propose changes |
| [External agents (Beta)](External_Agents.md) | Starting an AI agent of another maker in a vault's folder: what Plainva controls in its session and what it does not, adding an agent, signing in, suggestions and new notes |
| [Journal](Journal.md) | The quick entry into today's daily note: capturing from anywhere, the journal view across all days, how entries are stored, and the optional global shortcut |
| [Calendar & external tasks](Calendar_and_Tasks.md) | Connecting CalDAV/Google/Microsoft calendars, the calendar tab, meeting notes, and syncing external task lists into the task database |
| [Email capture](Email_Capture.md) | IMAP and Microsoft mail (experimental): the sandboxed viewer, saving mails as notes/.eml/tasks, and composing and sending |
| [Graph](Graph.md) | Context graph, vault map with cleanup mode and time travel, graph as a database view |
| [Keyboard Shortcuts](Keyboard_Shortcuts.md) | All keyboard shortcuts at a glance |
| [FAQ & Troubleshooting](FAQ.md) | Common questions: Obsidian compatibility, conflict files, backups and more |

## Core principles

- **Your files belong to you.** A vault is a plain folder of Markdown files. You can open, copy or back it up with any other program at any time.
- **Plain Markdown is the canonical format.** Even extra features (properties, icons, databases) are stored in open, readable text formats.
- **Obsidian-compatible.** Existing Obsidian vaults are never damaged or reformatted; Obsidian can open every file Plainva creates.
