# Connecting AI apps (Beta)

Last reviewed: 2026-10-07

AI apps on your computer — Claude Code, Claude Desktop, Cursor, VS Code and others that speak the Model Context Protocol (MCP) — can read your vault through Plainva: search it, read notes and their sections, outlines, backlinks, databases, tasks and recent notes, and open a note in Plainva. They change nothing by themselves: where you allow it, an app may propose changes, and those wait until you decide (see below). This is part of the experimental AI features and works on the desktop only.

The other direction — Plainva's assistant using tools of servers you connect yourself — is described under **External tools (MCP)** in [AI Assistant](AI_Assistant.md).

A third way — Plainva starting an AI agent of another maker in the vault's folder, with its session in the AI tab — is described in [External agents](External_Agents.md).

## How it works

Plainva ships a small helper program, `plainva-mcp`, next to the app. An AI app starts it, and the helper connects to the running Plainva through a private channel of this computer — a named pipe on Windows, a socket in a private folder on macOS and Linux. No network port is ever opened. Plainva must be running with the vault open; otherwise the app gets a clear message.

## Switching it on

1. Open **Settings → AI & automation** and switch on **Use AI on this device**.
2. Switch on **Let AI apps on this computer read this vault**.
3. Set the app up (see below). The first time it connects, Plainva asks which app it is, which program started it and which folders it may read. Nothing is ticked: choose folders or **The whole vault**, then **Allow**. **Deny** turns the app away, and Plainva does not ask about it again for ten minutes. Below the folders stands **May suggest changes** — off unless you tick it; what it allows is described further down.

The app keeps a secret in the system keychain for the next time. Folders are granted per app and per vault: in another vault, the app asks again.

## Setting an app up

- **Claude Code:** copy the **Command for Claude Code** from the settings and run it in a terminal.
- **Claude Desktop:** **Create package…** writes a `plainva.mcpb` file; open it, and Claude Desktop installs Plainva.
- **Other apps (JSON):** copy the configuration and add it to the app's MCP settings, for example Cursor's `mcp.json`.

## What an app can see

Only the folders you allowed, and only what your privacy rules let go to a cloud model that can reach the internet — an app counts as one, because Plainva cannot see what it does with what it reads: notes with `cloud: deny` or `web: deny`, or in a folder with one of these rules, do not exist for an app — neither their text nor their titles —, links to them are withheld, and place stamps from the journal never go. Plainva's own folders (`.plainva`, `.agent`) and the rules themselves can never be read. Every path in a request and in an answer is checked twice: in the app window and in Plainva's native part.

The settings list the allowed apps with their folders and the last requests. **Remove** takes an app's permission back in every vault. That holds at once — also for an app that is connected at that moment.

Besides the tools, Plainva offers its three skills as prompts, in the language of the app: `daily-orientation`, `weekly-review` and `project-status`, which asks for the project's name. An app that supports prompts lists them among its commands.

## Letting an app propose changes

Reading is never a leave to write. Whether an app may also propose changes is an answer of its own: **May suggest changes** in the question at its first connection, or later the switch **… may suggest changes** in the settings — per app and per vault, and off until you set it. It holds from the app's next request; the additional tools show in the app once it reconnects.

An app you allowed gets six more tools, and none of them changes the vault:

- **A change to a note** — to its text or to one of its properties — becomes a suggestion in the note's margin, signed with the app's name and “(AI app)”. You accept or decline each change there, as with every suggestion (see [Comments & Suggestions](Comments_and_Suggestions.md)).
- **A new note** becomes a draft under **Open** in the AI tab. It exists once you choose **Create** there.
- **Renaming, moving and deleting** ask first. Plainva shows in its own window what would happen — for a rename also the notes whose links would follow —, and the app shows a note that Plainva is waiting. Only after **Allow** in Plainva, and once the app continues, Plainva does it the way it does when you do it by hand; the app only learns whether it happened. For a deletion Plainva then opens its own delete dialog, and nothing is gone before you confirm there. An app that cannot show such a note is not offered these three tools.

A web address an app brings is written so that nothing opens or loads it (`https[://]…`), as with the assistant. A note's own privacy rules (`plainva.ai`) are not an app's to set, and inside an encrypted workspace nothing is proposed, drafted or planned. **Recent requests** in the settings says for every request what became of it — also that Plainva asked you, or that you said no.

## Limits

- Desktop only: phones run no such apps, and neither iOS nor Android lets one app offer another a private channel.
- ChatGPT and claude.ai in the browser cannot reach it: they only connect to servers on the internet, which Plainva does not run.
- An app never changes the vault by itself: what it writes waits as a suggestion or a draft, and a rename, a move or a deletion needs your yes in Plainva.
