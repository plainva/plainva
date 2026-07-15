# Plainva User Guide

Last reviewed: 2026-07-06

Plainva is a Markdown vault editor: your notes are ordinary Markdown files in a folder (a "vault") on your computer — no database silo, no forced cloud account. This guide explains how to work with Plainva and how the file formats work.

## Contents

| Page | What it covers |
|---|---|
| [Getting Started](Getting_Started.md) | Opening or creating a vault, the interface, editor modes, tabs and split view |
| [Notes & Markdown](Notes_and_Markdown.md) | How Markdown files work: writing, formatting, properties (frontmatter), icons, links, templates, images |
| [Databases (.base)](Databases_Base.md) | Viewing notes as a database — views, filters, properties, relations, new entries (similar to Notion, but file-based) |
| [OKF](OKF.md) | The Open Knowledge Format: `type`, `okf_version`, index.md management and the optional vault conversion |
| [File Format Reference](File_Format_Reference.md) | The exact on-disk format of every vault file — for tools, scripts or an AI editing notes and `.base` files directly |
| [Automation & Scripts](Automation_and_Scripts.md) | Extending Plainva without plugins: how scripts, CLI tools and AI agents read and write a vault safely |
| [Backups & Version History](Backups_and_Versioning.md) | Automatic file versions, restoring (including deleted files) and daily ZIP backups of the vault |
| [The mobile app](Mobile_App.md) | Plainva on Android and iOS: layout, editing, databases, sync and the safety net |
| [Sync Setup](Sync_Setup.md) | Step by step per provider: WebDAV/Nextcloud, Google Drive, OneDrive, Dropbox, S3 |
| [Sync Compatibility](Sync_Compatibility.md) | Which services work today — directly, via WebDAV, or via the provider's desktop client |
| [Google Drive (BYO)](Google_Drive_BYO_Guide.md) | Setting up Google Drive sync with your own credentials |
| [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md) | Setting up OneDrive and Dropbox sync with your own app registration |
| [Search](Search.md) | Full-text search, quick switcher, find & replace, tags |
| [Tasks](Tasks.md) | The vault-wide task view: every checkbox across your notes, with status/tag/folder/due filters and one-click toggling |
| [Graph](Graph.md) | Context graph, vault map with cleanup mode and time travel, graph as a database view |
| [Keyboard Shortcuts](Keyboard_Shortcuts.md) | All keyboard shortcuts at a glance |
| [FAQ & Troubleshooting](FAQ.md) | Common questions: Obsidian compatibility, conflict files, backups and more |

## Core principles

- **Your files belong to you.** A vault is a plain folder of Markdown files. You can open, copy or back it up with any other program at any time.
- **Plain Markdown is the canonical format.** Even extra features (properties, icons, databases) are stored in open, readable text formats.
- **Obsidian-compatible.** Existing Obsidian vaults are never damaged or reformatted; Obsidian can open every file Plainva creates.
