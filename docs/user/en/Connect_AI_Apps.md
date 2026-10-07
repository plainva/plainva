# Connecting AI apps (Beta)

Last reviewed: 2026-10-07

AI apps on your computer — Claude Code, Claude Desktop, Cursor, VS Code and others that speak the Model Context Protocol (MCP) — can read your vault through Plainva: search it, read notes and their sections, outlines, backlinks, databases, tasks and recent notes, and open a note in Plainva. They cannot change anything. This is part of the experimental AI features and works on the desktop only.

The other direction — Plainva's assistant using tools of servers you connect yourself — is described under **External tools (MCP)** in [AI Assistant](AI_Assistant.md).

## How it works

Plainva ships a small helper program, `plainva-mcp`, next to the app. An AI app starts it, and the helper connects to the running Plainva through a private channel of this computer — a named pipe on Windows, a socket in a private folder on macOS and Linux. No network port is ever opened. Plainva must be running with the vault open; otherwise the app gets a clear message.

## Switching it on

1. Open **Settings → AI & automation** and switch on **Use AI on this device**.
2. Switch on **Let AI apps on this computer read this vault**.
3. Set the app up (see below). The first time it connects, Plainva asks which app it is, which program started it and which folders it may read. Nothing is ticked: choose folders or **The whole vault**, then **Allow**. **Deny** turns the app away, and Plainva does not ask about it again for ten minutes.

The app keeps a secret in the system keychain for the next time. Folders are granted per app and per vault: in another vault, the app asks again.

## Setting an app up

- **Claude Code:** copy the **Command for Claude Code** from the settings and run it in a terminal.
- **Claude Desktop:** **Create package…** writes a `plainva.mcpb` file; open it, and Claude Desktop installs Plainva.
- **Other apps (JSON):** copy the configuration and add it to the app's MCP settings, for example Cursor's `mcp.json`.

## What an app can see

Only the folders you allowed, and only what your privacy rules let go to a cloud model: notes with `cloud: deny`, or in a folder with that rule, do not exist for an app — neither their text nor their titles —, links to them are withheld, and place stamps from the journal never go. Plainva's own folders (`.plainva`, `.agent`) and the rules themselves can never be read. Every path in a request and in an answer is checked twice: in the app window and in Plainva's native part.

The settings list the allowed apps with their folders and the last requests. **Remove** takes an app's permission back in every vault.

Besides the tools, Plainva offers its three skills as prompts, in the language of the app: `daily-orientation`, `weekly-review` and `project-status`, which asks for the project's name. An app that supports prompts lists them among its commands.

## Limits

- Desktop only: phones run no such apps, and neither iOS nor Android lets one app offer another a private channel.
- ChatGPT and claude.ai in the browser cannot reach it: they only connect to servers on the internet, which Plainva does not run.
- Reading only; letting an app propose changes comes in a later version.
