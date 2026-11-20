# Connecting AI apps (Beta)

Last reviewed: 2026-11-18

AI apps on your computer — Claude Code, Claude Desktop, Cursor, VS Code and others that speak the Model Context Protocol (MCP) — can read your vault through Plainva: search it, read notes and their sections, outlines, backlinks, databases, tasks and recent notes, and open a note in Plainva. They change nothing by themselves: where you allow it, an app may propose changes, and those wait until you decide (see below). This is part of the experimental AI features and works on the desktop only.

The other direction — Plainva's assistant using tools of servers you connect yourself — is described under **External tools** in [AI Assistant](AI_Assistant.md).

A third way — Plainva starting an AI agent of another maker in the vault's folder, with its session in the AI tab — is described in [External agents](External_Agents.md).

## How it works

Plainva ships a small helper program, `plainva-mcp`, next to the app. An AI app starts it, and the helper connects to the running Plainva through a private channel of this computer — a named pipe on Windows, a socket in a private folder on macOS and Linux. No network port is ever opened. Plainva must be running with the vault open; otherwise the app gets a clear message.

## Switching it on

1. Open **Settings → AI** and switch on **Use AI on this device**; the card **AI apps on this computer** is further down the page.
2. Switch on **Let AI apps on this computer read this vault**.
3. Set the app up (see below). The first time it connects, Plainva asks which app it is, which program started it and which folders it may read. Nothing is ticked: choose among the vault's top-level folders or **The whole vault**, then **Allow**. **Deny** turns the app away, and Plainva does not ask about it again for ten minutes. Below the folders stands **May suggest changes** — off unless you tick it; what it allows is described further down.

The app keeps a secret in the system keychain for the next time. Folders are granted per app and per vault: in another vault, the app asks again. When you open another vault, the apps connected to the one before are disconnected; they read the new one only once they connect again. While **Fully local** is on (see [AI Assistant](AI_Assistant.md)), the server rests: no app can read the vault, and an app that connects is refused.

## Setting an app up

- **Claude Code:** copy the **Command for Claude Code** from the settings and run it in a terminal.
- **Claude Desktop:** **Create package…** writes a `plainva.mcpb` file; open it, and Claude Desktop installs Plainva.
- **Other apps (JSON):** copy the configuration and add it to the app's MCP settings, for example Cursor's `mcp.json`.

## What an app can see

Only the folders you allowed, and only what your privacy rules let go to a cloud model that can reach the internet — an app counts as one, because Plainva cannot see what it does with what it reads: notes with `cloud: deny` or `web: deny`, or in a folder with one of these rules, do not exist for an app — neither their text nor their titles —, links to them are withheld, and place stamps from the journal never go. A note in an allowed folder whose name cannot be judged as it stands — it ends in a space or a dot, holds a colon or is not in composed Unicode form — is left out as well, and the answer says how many notes were left out. Plainva's own folders (`.plainva`, `.agent`) and the rules themselves can never be read. Every path in a request and in an answer is checked twice: in the app window and in Plainva's native part. A folder link inside an allowed folder that leads elsewhere is not followed, and a database answers only with values made of notes the app may read: a count or a sum over links into other folders leaves those notes out. A link in what an app reads stays only where it leads to a note the app may read; any other — also one to a note that does not exist — is withheld. A search does not find a note by what a withheld link says, and leaves a note out when in doubt; a change that would touch a withheld link, or carry its placeholder into a note, is refused.

The settings list the apps you allowed on this computer with their folders in this vault (**none in this vault** for an app allowed only elsewhere) and the last requests. **Remove** takes an app's permission back in every vault. That holds at once — also for an app that is connected at that moment.

While the encrypted workspace of the open vault is not open on this device — it is locked, or this device holds no key for it —, Plainva answers no app: every request — also a list or a search — is refused with a message that says which of the two it is, a request that runs when you lock it gets nothing of what it found, and an app that connects is told so at once. Unlock the workspace, or set it up on this device, and the same connection answers again. A permission goes by a folder's name: if you rename an allowed folder, the app no longer sees it until you allow it again, and a new folder with the old name would be visible to it.

Besides the tools, Plainva offers five of its skills as prompts, in Plainva's own language, and the file-format reference as a resource (`plainva://format`): the prompts are `daily-orientation`, `weekly-review`, `project-status`, `meeting-prep` and `task-triage`; `project-status` asks for the project's name and `meeting-prep` for the meeting. An app that supports prompts lists them among its commands.

## Letting an app propose changes

Reading is never a leave to write. Whether an app may also propose changes is an answer of its own: **May suggest changes** in the question at its first connection, or later the switch **… may suggest changes** in the settings — per app and per vault, and off until you set it. It holds from the app's next request; Plainva tells a connected app at once that its tools changed (an app that uses the newest protocol revision hears it only if it asked to be told) — whether it then shows them without reconnecting is up to the app.

An app you allowed gets six more tools, and none of them changes the vault:

- **A change to a note** — to its text or to one of its properties — becomes a suggestion in the note's margin, signed with the app's name and “(AI app)”. You accept or decline each change there, as with every suggestion (see [Comments & Suggestions](Comments_and_Suggestions.md)).
- **A new note** becomes a draft under **To decide** in the AI tab. It exists once you choose **Create** there.
- **Renaming, moving and deleting** ask first. Plainva shows in its own window what would happen — for a rename also the notes whose links would follow —, and the app shows a note that Plainva is waiting. Only after **Allow** in Plainva, and once the app continues, Plainva does it the way it does when you do it by hand; the app only learns whether it happened. For a deletion Plainva then opens its own delete dialog, and nothing is gone before you confirm there. An app that cannot show such a note — it needs MCP protocol revision 2026-07-28 or newer and must be able to ask you a question in a form — is not offered these three tools.

A web address an app brings is written so that nothing opens or loads it (`https[://]…`), as with the assistant. A note's own privacy rules (`plainva.ai`) are not an app's to set, and inside an encrypted workspace nothing is proposed, drafted or planned. The list of recent requests in the settings shows the eight newest and marks the ones Plainva asked you about (**asked**), the ones you declined (**declined**) and the ones that did not go through (**refused**); a request that went through carries no word.

## Limits

- Desktop only: phones run no such apps, and neither iOS nor Android lets one app offer another a private channel.
- ChatGPT and claude.ai in the browser cannot reach it: they only connect to servers on the internet, which Plainva does not run.
- An app never changes the vault by itself: what it writes waits as a suggestion or a draft, and a rename, a move or a deletion needs your yes in Plainva.
